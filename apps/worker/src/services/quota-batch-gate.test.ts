import { afterEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { LineClient } from '@line-crm/line-sdk';
import { jstNow } from '@line-crm/db';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { processQueuedBroadcasts } from './broadcast.js';

vi.mock('./stealth.js', () => ({
  calculateStaggerDelay: () => 0, sleep: async () => {},
  addMessageVariation: (text: string) => text,
  jitterDeliveryTime: (t: string) => t, addJitter: () => 0,
}));
const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const closes: Array<() => void> = [];
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  closes.splice(0).forEach(close => close()); vi.restoreAllMocks();
});

/** Real receipt rows drive quota usage, regardless of how writes are chunked. */
function makeBatchDb(friendTotal: number, currentSent = 0, offset = currentSent, otherUsage = 0) {
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
  const broadcast = vi.spyOn(LineClient.prototype, 'broadcast').mockResolvedValue({ data: {}, requestId: 'synthetic' });
  sqlite.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,status,total_count,success_count,batch_offset,track_links,segment_conditions)
    VALUES('bc-queued-1','queued send','text','hello','all','sending',?,?,?,0,?)`)
    .run(friendTotal, currentSent, offset, JSON.stringify({ operator: 'AND', rules: [{ type: 'is_following', value: true }] }));
  for (let i = 0; i < friendTotal; i++) {
    sqlite.prepare("INSERT INTO friends(id,line_user_id) VALUES(?,?)").run(`f-${i}`, `U${i}`);
    if (i < currentSent) sqlite.prepare(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,broadcast_id,delivery_type,created_at)
      VALUES(?,?,'outgoing','text','hello','bc-queued-1','push',?)`).run(`prior-${i}`, `f-${i}`, jstNow());
  }
  if (otherUsage) {
    sqlite.exec("INSERT INTO friends(id,line_user_id,is_following) VALUES('historical','historical',0)");
    for (let i = 0; i < otherUsage; i++) sqlite.prepare(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,delivery_type,created_at)
      VALUES(?,'historical','outgoing','text','Other campaign','push',?)`).run(`other-${i}`, jstNow());
  }
  const run = (max?: string) => processQueuedBroadcasts(db, new LineClient('synthetic-default'), undefined,
    max ? { QUOTA_MONTHLY_MESSAGES_MAX: max } : undefined);
  const state = () => sqlite.prepare("SELECT status,batch_offset,batch_lock_at,total_count,success_count,last_error,pending_batch_id,pending_batch FROM broadcasts WHERE id='bc-queued-1'").get();
  const logged = () => Number((sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get() as { n: number }).n);
  return { run, state, logged, multicast, broadcast };
}

describe('queued batch loop quota re-check', () => {
  test('crossing the limit mid-run stops after the current batch (bounded overshoot)', async () => {
    // 600 recipients = 500 + 100. Limit400: only the first500 may send.
    const s = makeBatchDb(600); await s.run('400');
    expect(s.multicast).toHaveBeenCalledTimes(1); expect(s.multicast.mock.calls[0][0]).toHaveLength(500);
    expect(s.logged()).toBe(500); expect(s.state()).toMatchObject({ status: 'sending', batch_offset: 500, success_count: 500, pending_batch: null });
  });
  test('no quotaEnv → all batches send and the broadcast completes', async () => {
    const s = makeBatchDb(600); await s.run();
    expect(s.multicast).toHaveBeenCalledTimes(2); expect(s.logged()).toBe(600);
    expect(new Set(s.multicast.mock.calls.flatMap(call => call[0])).size).toBe(600);
    expect(s.state()).toMatchObject({ status: 'sent', total_count: 600, success_count: 600, last_error: null, pending_batch: null });
  });
  test('over quota + everything already sent → finalization still completes the row', async () => {
    const s = makeBatchDb(600, 600); await s.run('400');
    expect(s.multicast).not.toHaveBeenCalled(); expect(s.broadcast).not.toHaveBeenCalled(); expect(s.logged()).toBe(600);
    expect(s.state()).toMatchObject({ status: 'sent', success_count: 600, last_error: null });
  });
  test('over quota + fresh row (nothing sent) → skipped before the claim, no sends', async () => {
    const s = makeBatchDb(600, 0, 0, 500); await s.run('400');
    expect(s.multicast).not.toHaveBeenCalled(); expect(s.broadcast).not.toHaveBeenCalled(); expect(s.logged()).toBe(500);
    expect(s.state()).toMatchObject({ status: 'sending', batch_offset: 0, batch_lock_at: null, success_count: 0, pending_batch: null });
  });
  test('over quota + unsent recipients remaining mid-run → yields without sending', async () => {
    const s = makeBatchDb(600, 500); await s.run('400');
    expect(s.multicast).not.toHaveBeenCalled(); expect(s.broadcast).not.toHaveBeenCalled(); expect(s.logged()).toBe(500);
    expect(s.state()).toMatchObject({ status: 'sending', batch_offset: 500, success_count: 500, pending_batch: null });
  });
  test('under the limit for the whole run → completes normally', async () => {
    const s = makeBatchDb(600); await s.run('10000');
    expect(s.multicast).toHaveBeenCalledTimes(2); expect(s.logged()).toBe(600);
    expect(s.state()).toMatchObject({ status: 'sent', success_count: 600, last_error: null, pending_batch: null });
  });
});
