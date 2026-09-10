import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { broadcasts } from '../routes/broadcasts.js';
import { processQueuedBroadcasts } from './broadcast.js';
import { processSegmentSend } from './segment-send.js';
import { buildSegmentQuery, type SegmentCondition } from './segment-query.js';

vi.mock('./stealth.js', () => ({
  sleep: async () => {}, calculateStaggerDelay: () => 0,
  addMessageVariation: (text: string) => text,
}));

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const conditions: SegmentCondition = {
  operator: 'OR',
  rules: [
    { type: 'tag_exists', value: 'first-branch' },
    { type: 'metadata_equals', value: { key: 'tier', value: 'vip' } },
  ],
};

afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  db.batch = async <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map(statement => statement.run<T>()));
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No real network allowed'));
  vi.spyOn(LineClient.prototype, 'getMessageQuota').mockResolvedValue({ type: 'none' });
  vi.spyOn(LineClient.prototype, 'getMessageQuotaConsumption').mockResolvedValue({ totalUsage: 0 });
  const multicast = vi.spyOn(LineClient.prototype, 'multicast').mockResolvedValue({ data: {}, requestId: 'synthetic' });
  for (const id of ['a', 'b']) {
    sqlite.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)')
      .run(id, id, id, `synthetic-${id}`, 'synthetic');
  }
  const rows: Array<[string, string | null, string | null, string]> = [
    ['a-left', 'a', 'A left', '{}'],
    ['a-right', 'a', 'A right', '{"tier":"vip"}'],
    ['a-neither', 'a', 'A neither', '{}'],
    // Missing display names must not block a personalized send from account A.
    ['b-right', 'b', null, '{"tier":"vip"}'],
    ['legacy-right', null, null, '{"tier":"vip"}'],
  ];
  for (const [id, account, displayName, metadata] of rows) {
    sqlite.prepare('INSERT INTO friends(id,line_user_id,line_account_id,display_name,metadata) VALUES(?,?,?,?,?)')
      .run(id, `line-${id}`, account, displayName, metadata);
  }
  sqlite.exec("INSERT INTO tags(id,name) VALUES('first-branch','First branch'); INSERT INTO friend_tags(friend_id,tag_id) VALUES('a-left','first-branch')");
  function addBroadcast(id: string, options: { status?: string; tag?: boolean; personalized?: boolean } = {}) {
    sqlite.prepare(`INSERT INTO broadcasts
      (id,title,message_type,message_content,target_type,target_tag_id,line_account_id,status,segment_conditions,track_links)
      VALUES(?,?,'text',?, ?,?,'a',?,?,0)`)
      .run(id, id, options.personalized ? 'Hello {{name}}' : 'Synthetic announcement',
        options.tag ? 'tag' : 'all', options.tag ? 'first-branch' : null,
        options.status ?? 'draft', JSON.stringify(conditions));
  }
  const app = new Hono();
  app.route('/', broadcasts);
  return { db, sqlite, multicast, addBroadcast, app };
}

describe('OR segments stay inside the selected sending account', () => {
  it('groups both OR branches under account scope and keeps parameter order and unscoped semantics', async () => {
    const s = setup();
    try {
      const { sql, bindings } = buildSegmentQuery(conditions);
      const scoped = sql.replace('WHERE', 'WHERE f.line_account_id = ? AND');
      const scopedRows = await s.db.prepare(scoped).bind('a', ...bindings).all<{ id: string }>();
      expect(scopedRows.results.map(row => row.id).sort()).toEqual(['a-left', 'a-right']);
      const unscopedRows = await s.db.prepare(sql).bind(...bindings).all<{ id: string }>();
      expect(unscopedRows.results.map(row => row.id).sort())
        .toEqual(['a-left', 'a-right', 'b-right', 'legacy-right']);
    } finally { s.sqlite.close(); }
  });

  it('counts the same OR audience with nested tag subqueries in the segment preview API', async () => {
    const s = setup();
    try {
      const response = await s.app.request('/api/segments/count', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditions, accountId: 'a' }),
      }, { DB: s.db });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ success: true, count: 2 });
      expect(s.multicast).not.toHaveBeenCalled();
    } finally { s.sqlite.close(); }
  });

  it('the direct segment service sends both local branches without sending the other account branch', async () => {
    const s = setup();
    try {
      s.addBroadcast('direct');
      await processSegmentSend(s.db, new LineClient('synthetic-a'), 'direct', conditions);
      expect(s.multicast.mock.calls.flatMap(call => call[0]).sort()).toEqual(['line-a-left', 'line-a-right']);
      expect(s.sqlite.prepare("SELECT total_count,success_count,status FROM broadcasts WHERE id='direct'").get())
        .toEqual({ total_count: 2, success_count: 2, status: 'sent' });
    } finally { s.sqlite.close(); }
  });

  it('projected quota and queued dispatch both use the two local OR matches', async () => {
    const s = setup();
    try {
      s.addBroadcast('queued');
      const response = await s.app.request('/api/broadcasts/queued/send-segment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conditions }),
      }, { DB: s.db, QUOTA_MONTHLY_MESSAGES_MAX: '2' });
      expect(response.status).toBe(202);
      await processQueuedBroadcasts(s.db, new LineClient('synthetic-a'));
      expect(s.multicast.mock.calls.flatMap(call => call[0]).sort()).toEqual(['line-a-left', 'line-a-right']);
      expect(s.sqlite.prepare("SELECT total_count,success_count,status FROM broadcasts WHERE id='queued'").get())
        .toEqual({ total_count: 2, success_count: 2, status: 'sent' });
    } finally { s.sqlite.close(); }
  });

  it('queued tag OR markers keep following and account filters outside both branches', async () => {
    const s = setup();
    try {
      s.sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,is_following,metadata)
        VALUES('a-blocked','line-a-blocked','a',0,'{"tier":"vip"}')`);
      s.addBroadcast('tag-queued', { status: 'sending', tag: true });
      await processQueuedBroadcasts(s.db, new LineClient('synthetic-a'));
      expect(s.multicast.mock.calls.flatMap(call => call[0]).sort()).toEqual(['line-a-left', 'line-a-right']);
    } finally { s.sqlite.close(); }
  });

  it('personalized audience validation ignores nameless OR matches belonging to another account', async () => {
    const s = setup();
    try {
      s.addBroadcast('personalized', { personalized: true });
      const response = await s.app.request('/api/broadcasts/personalized/send-segment', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conditions }),
      }, { DB: s.db });
      expect(response.status).toBe(202);
      expect(s.multicast).not.toHaveBeenCalled();
    } finally { s.sqlite.close(); }
  });
});
