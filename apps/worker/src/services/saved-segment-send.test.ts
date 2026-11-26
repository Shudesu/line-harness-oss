import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { broadcasts } from '../routes/broadcasts.js';
import { processQueuedBroadcasts, processScheduledBroadcasts } from './broadcast.js';
import { parseSavedSegmentConditions, savedSegmentAudience } from './saved-segment.js';
import { buildSegmentQuery } from './segment-query.js';

vi.mock('./stealth.js', () => ({
  sleep: async () => {}, calculateStaggerDelay: () => 0,
  addMessageVariation: (text: string) => text,
}));

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

afterEach(() => {
  if (vi.isMockFunction(globalThis.fetch)) expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

// Friends of account "a": tags → paused / left / lite / seminar / vip
const FRIENDS: Array<[string, string[], number]> = [
  ['plain', [], 1],
  ['paused', ['paused'], 1],
  ['left', ['left'], 1],
  ['lite', ['lite'], 1],
  ['vip', ['vip'], 1],
  ['vip-paused', ['vip', 'paused'], 1],
  ['seminar', ['seminar'], 1],
  ['blocked', [], 0],
];

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  db.batch = async <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map(statement => statement.run<T>()));
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No real network allowed'));
  vi.spyOn(LineClient.prototype, 'getMessageQuota').mockResolvedValue({ type: 'none' });
  vi.spyOn(LineClient.prototype, 'getMessageQuotaConsumption').mockResolvedValue({ totalUsage: 0 });
  const multicast = vi.spyOn(LineClient.prototype, 'multicast').mockResolvedValue({ data: {}, requestId: 'synthetic' });
  const broadcastApi = vi.spyOn(LineClient.prototype, 'broadcast').mockResolvedValue({ requestId: 'synthetic' } as never);
  sqlite.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)')
    .run('a', 'a', 'a', 'synthetic-a', 'synthetic');
  for (const tag of ['paused', 'left', 'lite', 'seminar', 'vip']) {
    sqlite.prepare('INSERT INTO tags(id,name) VALUES(?,?)').run(tag, tag);
  }
  for (const [id, tags, following] of FRIENDS) {
    sqlite.prepare('INSERT INTO friends(id,line_user_id,line_account_id,display_name,is_following) VALUES(?,?,?,?,?)')
      .run(id, `line-${id}`, 'a', id, following);
    for (const tag of tags) sqlite.prepare('INSERT INTO friend_tags(friend_id,tag_id) VALUES(?,?)').run(id, tag);
  }
  function addBroadcast(id: string, options: { status?: string; scheduledAt?: string; tag?: string } = {}) {
    sqlite.prepare(`INSERT INTO broadcasts
      (id,title,message_type,message_content,target_type,target_tag_id,line_account_id,status,scheduled_at,track_links)
      VALUES(?,?,'text','Synthetic announcement',?,?,'a',?,?,0)`)
      .run(id, id, options.tag ? 'tag' : 'all', options.tag ?? null, options.status ?? 'draft', options.scheduledAt ?? null);
  }
  const app = new Hono();
  app.route('/', broadcasts);
  const env = { DB: db, LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-a' };
  const put = (id: string, body: unknown) => app.request(`/api/broadcasts/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, env);
  const sentTo = () => multicast.mock.calls.flatMap(call => call[0] as string[]).sort();
  return { db, sqlite, multicast, broadcastApi, addBroadcast, app, env, put, sentTo };
}

const excludePausedLeft = {
  operator: 'AND',
  rules: [{ type: 'tag_not_exists', value: 'paused' }, { type: 'tag_not_exists', value: 'left' }],
};
const excludeFour = {
  operator: 'AND',
  rules: ['seminar', 'paused', 'left', 'lite'].map(value => ({ type: 'tag_not_exists', value })),
};
const vipExceptPaused = {
  operator: 'AND',
  rules: [
    { type: 'group', value: { operator: 'OR', rules: [{ type: 'tag_exists', value: 'vip' }, { type: 'tag_exists', value: 'seminar' }] } },
    { type: 'tag_not_exists', value: 'paused' },
  ],
};

describe('saved segment conditions are honoured by the real send paths', () => {
  it('PUT persists segmentConditions (object or JSON string) and returns them', async () => {
    const s = setup();
    try {
      s.addBroadcast('b1');
      const res = await s.put('b1', { segmentConditions: excludePausedLeft });
      expect(res.status).toBe(200);
      const json = await res.json() as { data: { segmentConditions: unknown } };
      expect(json.data.segmentConditions).toEqual(excludePausedLeft);
      const res2 = await s.put('b1', { segmentConditions: JSON.stringify(excludeFour) });
      expect(res2.status).toBe(200);
      expect(JSON.parse((s.sqlite.prepare("SELECT segment_conditions sc FROM broadcasts WHERE id='b1'").get() as { sc: string }).sc))
        .toEqual(excludeFour);
      const cleared = await s.put('b1', { segmentConditions: null });
      expect(cleared.status).toBe(200);
      expect(s.sqlite.prepare("SELECT segment_conditions sc FROM broadcasts WHERE id='b1'").get()).toEqual({ sc: null });
    } finally { s.sqlite.close(); }
  });

  it('PUT rejects malformed conditions and leaves the row unchanged', async () => {
    const s = setup();
    try {
      s.addBroadcast('b1');
      for (const bad of [{ operator: 'XOR', rules: [] }, { operator: 'AND', rules: [{ type: 'tag_exists', value: 1 }] }, 'not json']) {
        const res = await s.put('b1', { segmentConditions: bad });
        expect(res.status).toBe(400);
      }
      expect(s.sqlite.prepare("SELECT segment_conditions sc FROM broadcasts WHERE id='b1'").get()).toEqual({ sc: null });
    } finally { s.sqlite.close(); }
  });

  it('preview-count reflects the saved exclusions (following friends only)', async () => {
    const s = setup();
    try {
      s.addBroadcast('b1');
      const before = await (await s.app.request('/api/broadcasts/b1/preview-count', {}, s.env)).json() as { data: { count: number } };
      expect(before.data.count).toBe(7);
      await s.put('b1', { segmentConditions: excludePausedLeft });
      const ex1 = await (await s.app.request('/api/broadcasts/b1/preview-count', {}, s.env)).json() as { data: { count: number } };
      expect(ex1.data.count).toBe(4); // plain, lite, vip, seminar
      await s.put('b1', { segmentConditions: excludeFour });
      const ex2 = await (await s.app.request('/api/broadcasts/b1/preview-count', {}, s.env)).json() as { data: { count: number } };
      expect(ex2.data.count).toBe(2); // plain, vip
    } finally { s.sqlite.close(); }
  });

  it('POST /send with saved exclusions delivers only to the matching audience (never LINE broadcast)', async () => {
    const s = setup();
    try {
      s.addBroadcast('b1');
      await s.put('b1', { segmentConditions: excludePausedLeft });
      const res = await s.app.request('/api/broadcasts/b1/send', { method: 'POST' }, s.env);
      expect(res.status).toBe(202);
      await processQueuedBroadcasts(s.db, new LineClient('synthetic-a'));
      expect(s.broadcastApi).not.toHaveBeenCalled();
      expect(s.sentTo()).toEqual(['line-lite', 'line-plain', 'line-seminar', 'line-vip']);
      expect(s.sqlite.prepare("SELECT status,total_count FROM broadcasts WHERE id='b1'").get())
        .toEqual({ status: 'sent', total_count: 4 });
    } finally { s.sqlite.close(); }
  });

  it('include-any + exclude via a nested group, combined with a tag target', async () => {
    const s = setup();
    try {
      s.addBroadcast('b1');
      await s.put('b1', { segmentConditions: vipExceptPaused });
      await s.app.request('/api/broadcasts/b1/send', { method: 'POST' }, s.env);
      await processQueuedBroadcasts(s.db, new LineClient('synthetic-a'));
      expect(s.sentTo()).toEqual(['line-seminar', 'line-vip']);

      s.multicast.mockClear();
      s.addBroadcast('b2', { tag: 'vip' });
      await s.put('b2', { segmentConditions: { operator: 'AND', rules: [{ type: 'tag_not_exists', value: 'paused' }] } });
      await s.app.request('/api/broadcasts/b2/send', { method: 'POST' }, s.env);
      await processQueuedBroadcasts(s.db, new LineClient('synthetic-a'));
      expect(s.sentTo()).toEqual(['line-vip']);
    } finally { s.sqlite.close(); }
  });

  it('scheduled broadcasts with saved conditions are queued as segment sends by the cron', async () => {
    const s = setup();
    try {
      s.addBroadcast('b1', { status: 'scheduled', scheduledAt: '2020-01-01T00:00:00+09:00' });
      await s.put('b1', { segmentConditions: excludeFour, scheduledAt: '2020-01-01T00:00:00+09:00' });
      await processScheduledBroadcasts(s.db, new LineClient('synthetic-a'));
      await processQueuedBroadcasts(s.db, new LineClient('synthetic-a'));
      expect(s.broadcastApi).not.toHaveBeenCalled();
      expect(s.sentTo()).toEqual(['line-plain', 'line-vip']);
    } finally { s.sqlite.close(); }
  });

  it('broadcasts without saved conditions keep the original behaviour', async () => {
    const s = setup();
    try {
      s.addBroadcast('b1');
      const res = await s.app.request('/api/broadcasts/b1/send', { method: 'POST' }, s.env);
      expect(res.status).toBe(200);
      expect(s.broadcastApi).toHaveBeenCalledTimes(1);
      expect(s.multicast).not.toHaveBeenCalled();
    } finally { s.sqlite.close(); }
  });
});

describe('segment query helpers', () => {
  it('rejects deep nesting and unknown shapes, treats empty rules as no conditions', () => {
    let deep: unknown = { operator: 'AND', rules: [] };
    for (let i = 0; i < 12; i++) deep = { operator: 'AND', rules: [{ type: 'group', value: deep }] };
    expect(() => buildSegmentQuery(deep as never)).toThrow();
    expect(parseSavedSegmentConditions({ operator: 'AND', rules: [] })).toBeNull();
    expect(parseSavedSegmentConditions('')).toBeNull();
    expect(() => parseSavedSegmentConditions({ operator: 'AND' })).toThrow();
  });

  it('savedSegmentAudience ignores multi-account-dedup and fails closed on corrupt rows', () => {
    expect(savedSegmentAudience({ target_type: 'multi-account-dedup', segment_conditions: JSON.stringify(excludeFour) } as never)).toBeNull();
    expect(() => savedSegmentAudience({ target_type: 'all', segment_conditions: '{broken' } as never)).toThrow();
  });
});
