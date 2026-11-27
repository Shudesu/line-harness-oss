import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { LineClient } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { processQueuedBroadcasts } from './broadcast.js';

vi.mock('./stealth.js', () => ({ sleep: async () => {}, calculateStaggerDelay: () => 0, addMessageVariation: (s: string) => s }));
const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const closes: Array<() => void> = [];
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  closes.splice(0).forEach(close => close());
  vi.restoreAllMocks();
});
function setup(count = 1) {
  const { db, sqlite } = sqliteD1(); sqlite.exec(schema); closes.push(() => sqlite.close());
  db.batch = async <T>(statements: D1PreparedStatement[]) => {
    sqlite.exec('BEGIN');
    try { const results = []; for (const statement of statements) results.push(await statement.run<T>()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  };
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real network forbidden'));
  vi.spyOn(LineClient.prototype, 'getMessageQuota').mockResolvedValue({ type: 'none' });
  vi.spyOn(LineClient.prototype, 'getMessageQuotaConsumption').mockResolvedValue({ totalUsage: 0 });
  const multicast = vi.spyOn(LineClient.prototype, 'multicast').mockResolvedValue({ data: {}, requestId: 'synthetic' });
  sqlite.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','a','A','synthetic-token','synthetic-secret')");
  for (let i = 0; i < count; i++) sqlite.prepare("INSERT INTO friends(id,line_user_id,line_account_id) VALUES(?,?,'a')").run(`f${i}`, `line-f${i}`);
  sqlite.exec(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,account_ids,dedup_priority,status,track_links)
    VALUES('campaign','Campaign','text','Hello','multi-account-dedup','["a"]','["a"]','sending',0)`);
  const client = new LineClient('unused');
  const run = () => processQueuedBroadcasts(db, client);
  // Pause the first executor just before its atomic claim. A second executor can
  // finish or yield while the first still holds the previously selected row.
  function beforeFirstClaim(interleave: () => Promise<void>) {
    const prepare = db.prepare.bind(db); let pending = true;
    function wrap(statement: D1PreparedStatement): D1PreparedStatement {
      return new Proxy(statement, { get(target, key) {
        if (key === 'bind') return (...args: unknown[]) => wrap(target.bind(...args));
        if (key === 'run') return async () => { if (pending) { pending = false; await interleave(); } return target.run(); };
        const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
      } });
    }
    db.prepare = sql => sql.startsWith('UPDATE broadcasts SET batch_offset = -1') ? wrap(prepare(sql)) : prepare(sql);
  }
  const state = () => sqlite.prepare("SELECT status,batch_offset,success_count,dedup_progress,message_content FROM broadcasts WHERE id='campaign'").get() as Record<string, unknown>;
  return { db, sqlite, multicast, run, beforeFirstClaim, state };
}
describe('queued broadcast claims reject stale snapshots', () => {
  it('does not resend the first dedup batch after an overlapping executor yields back to offset zero', async () => {
    const s = setup(501); let now = 0; vi.spyOn(Date, 'now').mockImplementation(() => now);
    s.multicast.mockImplementation(async () => { now += 100000; return { data: {}, requestId: 'synthetic' }; });
    s.beforeFirstClaim(async () => { await s.run(); expect(s.state()).toMatchObject({status:'sending',batch_offset:0,success_count:500});
      // Audience membership can change between ticks. A stale first batch now
      // has a different retry key, so provider retry dedup alone cannot save it.
      s.sqlite.prepare('UPDATE friends SET is_following=0 WHERE line_user_id=?').run(s.multicast.mock.calls[0][0][0]); now = 0; });
    await s.run();
    expect(s.multicast).toHaveBeenCalledTimes(1);
    expect(s.state()).toMatchObject({status:'sending',batch_offset:0,success_count:500});
    now = 0; await s.run();
    expect(s.multicast).toHaveBeenCalledTimes(2);
    const recipients = s.multicast.mock.calls.flatMap(call => call[0]);
    expect(recipients).toHaveLength(501); expect(new Set(recipients).size).toBe(501);
    expect(s.state()).toMatchObject({status:'sent',success_count:501,dedup_progress:null});
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({n:501});
  });
  it.each(['draft','scheduled','sent'])('does not acquire a row changed to %s after selection', async status => {
    const s = setup(); s.beforeFirstClaim(async () => { s.sqlite.prepare("UPDATE broadcasts SET status=? WHERE id='campaign'").run(status); });
    await s.run(); expect(s.multicast).not.toHaveBeenCalled(); expect(s.state()).toMatchObject({status,batch_offset:0,success_count:0});
  });
  it('leaves an unchanged snapshot eligible after another executor releases without progress', async () => {
    const s = setup(); s.beforeFirstClaim(async () => { s.sqlite.exec("UPDATE broadcasts SET batch_offset=-1; UPDATE broadcasts SET batch_offset=0"); });
    await s.run(); expect(s.multicast).toHaveBeenCalledTimes(1); expect(s.state()).toMatchObject({status:'sent',success_count:1});
  });
  it.each([
    "UPDATE broadcasts SET sent_at='2026-10-21T00:00:00'",
    "UPDATE broadcasts SET batch_offset=-1",
    "UPDATE broadcasts SET dedup_progress='{\"sentIdentKeys\":[\"solo:f0\"]}'",
    "UPDATE broadcasts SET message_content='Tracked replacement'",
    "UPDATE broadcasts SET message_type='flex'",
    "DELETE FROM broadcasts",
  ])('skips a stale row without touching newer state: %s', async sql => {
    const s = setup(); let expected: unknown;
    s.beforeFirstClaim(async () => { s.sqlite.exec(sql); expected = s.sqlite.prepare('SELECT * FROM broadcasts').get(); });
    await s.run(); expect(s.multicast).not.toHaveBeenCalled();
    expect(s.sqlite.prepare('SELECT * FROM broadcasts').get()).toEqual(expected);
  });
  it('uses persisted replacement content on the next fresh tick', async () => {
    const s = setup(); s.beforeFirstClaim(async () => { s.sqlite.exec("UPDATE broadcasts SET message_content='Tracked replacement'"); });
    await s.run(); expect(s.multicast).not.toHaveBeenCalled();
    await s.run(); expect(s.multicast).toHaveBeenCalledTimes(1);
    expect(s.multicast.mock.calls[0][1]).toEqual([{type:'text',text:'Tracked replacement'}]);
  });

});
