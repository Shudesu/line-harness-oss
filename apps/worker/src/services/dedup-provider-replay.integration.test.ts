import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, expect, it, vi } from 'vitest';
import { LineClient } from '@line-crm/line-sdk';
import type { Broadcast } from '@line-crm/db';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { processMultiAccountDedupBroadcast } from './dedup-broadcast.js';

// Exercise request/receipt recovery without waiting for production pacing.
vi.mock('./stealth.js', () => ({
  sleep: async () => {}, calculateStaggerDelay: () => 0, addMessageVariation: (text: string) => text,
}));

afterEach(() => vi.unstubAllGlobals());

it('replays the accepted HTTP request before processing a new audience prefix', async () => {
  const { db, sqlite } = sqliteD1();
  const accepted = new Map<string, { to: string[]; messages: unknown[] }>();
  let calls = 0;
  let acceptedRetries = 0;
  vi.stubGlobal('fetch', vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer synthetic-token');
    expect(headers.has('x-line-harness-source')).toBe(false);
    if (String(url) === 'https://api.line.me/v2/bot/message/quota') {
      return Response.json({ type: 'none' });
    }
    if (String(url) === 'https://api.line.me/v2/bot/message/quota/consumption') {
      return Response.json({ totalUsage: 0 });
    }
    expect(String(url)).toBe('https://api.line.me/v2/bot/message/multicast');
    const key = headers.get('x-line-retry-key');
    expect(key).toBeTruthy();
    if (!key) throw new Error('Missing retry key');
    const body = JSON.parse(String(init?.body));
    calls++;
    if (accepted.has(key)) {
      expect(body).toEqual(accepted.get(key));
      acceptedRetries++;
      return new Response('accepted', {
        status: 409, headers: { 'x-line-accepted-request-id': 'original-request' },
      });
    }
    accepted.set(key, body);
    if (calls === 2) throw new Error('Synthetic lost response after acceptance');
    return Response.json({}, { headers: { 'x-line-request-id': 'synthetic-request' } });
  }));

  db.batch = async <T>(statements: D1PreparedStatement[]) => {
    sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run<T>());
      sqlite.exec('COMMIT');
      return results;
    } catch (error) {
      sqlite.exec('ROLLBACK');
      throw error;
    }
  };

  try {
    sqlite.exec(readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8'));
    sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
      VALUES('a','a','A','synthetic-token','synthetic-secret')`);
    for (let index = 0; index < 1001; index++) {
      const id = `friend-${String(index).padStart(4, '0')}`;
      sqlite.prepare(`INSERT INTO friends(id,line_user_id,line_account_id,created_at) VALUES(?,?,'a',?)`)
        .run(id, `line-${id}`, new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString());
    }
    sqlite.exec(`INSERT INTO broadcasts
      (id,title,message_type,message_content,target_type,account_ids,dedup_priority,status,batch_offset,track_links)
      VALUES('campaign','Campaign','text','Hello','multi-account-dedup','["a"]','["a"]','sending',-1,0)`);
    const prepare = db.prepare.bind(db);
    let interruptOldFinalizer = true;
    db.prepare = (sql: string) => {
      if (interruptOldFinalizer && sql.includes('UPDATE broadcasts SET failed_account_ids')) {
        throw new Error('Synthetic interruption before finalization');
      }
      return prepare(sql);
    };
    const current = () => sqlite.prepare("SELECT * FROM broadcasts WHERE id='campaign'").get() as Broadcast;
    const run = () => processMultiAccountDedupBroadcast(db, current(), token => new LineClient(token), { now: () => 0 });
    try {
      await run();
    } catch (error) {
      expect(error).toMatchObject({ message: 'Synthetic interruption before finalization' });
    }
    interruptOldFinalizer = false;
    const prefix = JSON.parse(current().dedup_progress!);
    expect(prefix.sentIdentKeys).toHaveLength(500);
    sqlite.exec(`INSERT INTO friends(id,line_user_id,line_account_id,created_at)
      VALUES('new-prefix','line-new','a','1900-01-01')`);
    expect((await run()).successCount).toBe(1002);
    const recipients = [...accepted.values()].flatMap(body => body.to);
    expect(new Set(recipients).size).toBe(1002);
    expect(recipients).toHaveLength(1002);
    expect(acceptedRetries).toBe(1);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM messages_log').get()).toEqual({ n: 1002 });
  } finally {
    sqlite.close();
  }
});
