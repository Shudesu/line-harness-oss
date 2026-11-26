import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { broadcasts } from '../routes/broadcasts.js';
import { processQueuedBroadcasts, processScheduledBroadcasts } from './broadcast.js';
import { estimateSendAudience, queuedTagAudienceCount } from './quota.js';

vi.mock('./stealth.js', () => ({
  sleep: async () => {}, calculateStaggerDelay: () => 0,
  addMessageVariation: (text: string) => text,
}));
const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
});

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  db.batch = async <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map(s => s.run<T>()));
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No real network allowed'));
  vi.spyOn(LineClient.prototype, 'getMessageQuota').mockResolvedValue({ type: 'none' });
  vi.spyOn(LineClient.prototype, 'getMessageQuotaConsumption').mockResolvedValue({ totalUsage: 0 });
  const multicast = vi.spyOn(LineClient.prototype, 'multicast').mockResolvedValue({ data: {}, requestId: 'synthetic' });
  sqlite.exec("INSERT INTO tags(id,name) VALUES('shared','Shared campaign')");
  for (const id of ['a', 'b', 'c', 'd']) {
    sqlite.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)')
      .run(id, id, id, `synthetic-${id}`, 'synthetic');
    for (const kind of ['yes', 'blocked', 'untagged']) {
      const friend = `${id}-${kind}`;
      sqlite.prepare('INSERT INTO friends(id,line_user_id,display_name,line_account_id,is_following) VALUES(?,?,?,?,?)')
        .run(friend, `line-${friend}`, friend, id, kind === 'blocked' ? 0 : 1);
      if (kind !== 'untagged') sqlite.prepare("INSERT INTO friend_tags(friend_id,tag_id) VALUES(?,'shared')").run(friend);
    }
  }
  sqlite.exec("INSERT INTO friends(id,line_user_id) VALUES('legacy','line-legacy'); INSERT INTO friend_tags VALUES('legacy','shared',datetime('now'))");
  function addBroadcast(id: string, account: string, status: string, marker: string | null = null) {
    sqlite.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,target_tag_id,line_account_id,status,scheduled_at,segment_conditions,track_links)
      VALUES(?,?,'text','Same announcement','tag','shared',?,?, '2020-01-01T00:00:00Z',?,0)`)
      .run(id, id, account, status, marker);
  }
  const app = new Hono(); app.route('/', broadcasts);
  return { db, sqlite, multicast, addBroadcast, app };
}

describe('tag broadcasts keep shared tags isolated by sending account', () => {
  it('four simultaneous scheduled broadcasts deliver once to each account member, including a second cron tick', async () => {
    const s = setup();
    try {
      for (const account of ['a', 'b', 'c', 'd']) s.addBroadcast(`send-${account}`, account, 'scheduled');
      await processScheduledBroadcasts(s.db, new LineClient('unused-default'));
      await processScheduledBroadcasts(s.db, new LineClient('unused-default'));
      expect(s.multicast).toHaveBeenCalledTimes(4);
      expect(s.multicast.mock.calls.map(call => call[0]).sort()).toEqual(
        ['a', 'b', 'c', 'd'].map(id => [`line-${id}-yes`]),
      );
      const rows = s.sqlite.prepare(`SELECT friend_id,COUNT(*) n FROM messages_log GROUP BY friend_id ORDER BY friend_id`).all();
      expect(rows).toEqual(['a','b','c','d'].map(id => ({ friend_id: `${id}-yes`, n: 1 })));
      expect(s.sqlite.prepare("SELECT COUNT(*) n FROM messages_log m JOIN friends f ON f.id=m.friend_id WHERE m.line_account_id != f.line_account_id").get()).toEqual({ n: 0 });
    } finally { s.sqlite.close(); }
  });

  it.each(['', JSON.stringify({ operator: 'AND', rules: [{ type: 'tag_exists', value: 'shared' }] })])(
    'queued tag delivery is account-scoped and following-only, including legacy markers %s', async marker => {
      const s = setup();
      try {
        s.addBroadcast('queued', 'a', 'sending', marker);
        await processQueuedBroadcasts(s.db, new LineClient('unused-default'));
        expect(s.multicast).toHaveBeenCalledTimes(1);
        expect(s.multicast.mock.calls[0][0]).toEqual(['line-a-yes']);
        expect(s.sqlite.prepare("SELECT total_count,success_count,status FROM broadcasts WHERE id='queued'").get())
          .toEqual({ total_count: 1, success_count: 1, status: 'sent' });
      } finally { s.sqlite.close(); }
    },
  );

  it('preview and quota estimates match the exact tagged, following account audience', async () => {
    const s = setup();
    try {
      s.addBroadcast('preview', 'a', 'draft');
      const response = await s.app.request('/api/broadcasts/preview/preview-count', {}, { DB: s.db });
      expect(await response.json()).toMatchObject({ success: true, data: { count: 1 } });
      const row = { target_type: 'tag', target_tag_id: 'shared', line_account_id: 'a' };
      expect(await estimateSendAudience(s.db, row)).toBe(1);
      expect(await queuedTagAudienceCount(s.db, row)).toBe(1);
      expect(s.multicast).not.toHaveBeenCalled();
    } finally { s.sqlite.close(); }
  });

  it.each([1, 501])('the /send route and queued batches keep %i recipients in their own account', async count => {
    const s = setup();
    try {
      for (let i = 1; i < count; i++) {
        s.sqlite.prepare("INSERT INTO friends(id,line_user_id,line_account_id) VALUES(?,?,'a')").run(`extra-${i}`, `line-extra-${i}`);
        s.sqlite.prepare("INSERT INTO friend_tags(friend_id,tag_id) VALUES(?,'shared')").run(`extra-${i}`);
      }
      s.addBroadcast('direct', 'a', 'draft');
      const response = await s.app.request('/api/broadcasts/direct/send', { method: 'POST' }, { DB: s.db, LINE_CHANNEL_ACCESS_TOKEN: 'synthetic' });
      expect(response.status).toBe(count > 500 ? 202 : 200);
      if (count > 500) await processQueuedBroadcasts(s.db, new LineClient('unused-default'));
      const recipients = s.multicast.mock.calls.flatMap(call => call[0]);
      expect(recipients).toHaveLength(count);
      expect(new Set(recipients).size).toBe(count);
      expect(recipients.every(id => id === 'line-a-yes' || id.startsWith('line-extra-'))).toBe(true);
      expect(s.sqlite.prepare("SELECT success_count,status FROM broadcasts WHERE id='direct'").get())
        .toEqual({ success_count: count, status: 'sent' });
    } finally { s.sqlite.close(); }
  });
});
