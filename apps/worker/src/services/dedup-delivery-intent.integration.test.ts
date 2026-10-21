import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { LineClient, LineApiError } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { processMultiAccountDedupBroadcast } from './dedup-broadcast.js';
import { recoverStalledBroadcasts, linkFriendToUser, type Broadcast } from '@line-crm/db';
import { processQueuedBroadcasts } from './broadcast.js';
import { DEDUP_INTENT_REVIEW, finishJournaledDedupBroadcast, releaseDedupDeliveryClaim } from './dedup-delivery-intent.js';

vi.mock('./stealth.js', async original => ({ ...await original<typeof import('./stealth.js')>(), sleep: async () => {} }));
afterEach(() => vi.restoreAllMocks());

type Mode = 'multicast' | 'push';
function fixture(size = 1001, mode: Mode = 'multicast') {
  const s = sqliteD1();
  s.sqlite.exec(readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8'));
  s.sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
    VALUES('a','a','A','synthetic-token','synthetic-secret');
    INSERT INTO broadcasts(id,title,message_type,message_content,target_type,account_ids,dedup_priority,status,batch_offset,track_links)
    VALUES('campaign','Campaign','text','Hello','multi-account-dedup','["a"]','["a"]','sending',-1,0)`);
  s.db.batch = async <T>(statements: D1PreparedStatement[]) => {
    s.sqlite.exec('BEGIN');
    try {
      const result = [];
      for (const statement of statements) result.push(await statement.run<T>());
      s.sqlite.exec('COMMIT');
      return result;
    } catch (error) { s.sqlite.exec('ROLLBACK'); throw error; }
  };
  const friend = (id: string, created = '2026-01-01') => s.sqlite.prepare(
    "INSERT INTO friends(id,line_user_id,line_account_id,created_at) VALUES(?,?,'a',?)",
  ).run(id, `line-${id}`, created);
  for (let i = 0; i < size; i++) friend(`f${String(i).padStart(4, '0')}`, new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString());
  if (mode === 'push') s.sqlite.exec("UPDATE broadcasts SET message_content = 'Hello {{name}}'; UPDATE friends SET display_name = id");
  const state = () => s.sqlite.prepare("SELECT * FROM broadcasts WHERE id='campaign'").get() as Broadcast;
  const run = () => processMultiAccountDedupBroadcast(s.db, state(), token => new LineClient(token), { now: () => 0 });
  return { ...s, friend, state, run };
}

it.each(['unchanged', 'new-prefix'] as const)('reconciles an unknown accepted second batch with %s audience', async change => {
  const s = fixture();
  const accepted = new Map<string, { raw: string; recipients: string[] }>();
  let calls = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    const headers = new Headers(init?.headers);
    expect(headers.get('authorization')).toBe('Bearer synthetic-token');
    expect(headers.has('x-line-harness-source')).toBe(false);
    if (String(url).endsWith('/quota')) return Response.json({ type: 'none' });
    if (String(url).endsWith('/quota/consumption')) return Response.json({ totalUsage: 0 });
    expect(String(url)).toBe('https://api.line.me/v2/bot/message/multicast');
    const key = headers.get('x-line-retry-key')!;
    const raw = String(init?.body);
    calls++;
    if (accepted.has(key)) {
      expect(raw).toBe(accepted.get(key)!.raw);
      return new Response('accepted', { status: 409, headers: { 'x-line-accepted-request-id': 'local-original' } });
    }
    accepted.set(key, { raw, recipients: JSON.parse(raw).to });
    if (calls === 2) throw new Error('Local lost response after acceptance');
    return Response.json({});
  });
  const prepare = s.db.prepare.bind(s.db);
  let interrupted = true;
  s.db.prepare = sql => {
    if (interrupted && sql.includes('UPDATE broadcasts SET failed_account_ids')) throw new Error('Local worker interrupted before finalization');
    return prepare(sql);
  };
  try {
    // A worker can disappear before its caller marks the broadcast complete.
    try { await s.run(); } catch (error) { expect(String(error)).toContain('Local worker interrupted'); }
    interrupted = false;
    if (change === 'new-prefix') s.friend('new', '1900-01-01');
    await s.run();
    const recipients = [...accepted.values()].flatMap(item => item.recipients);
    expect(recipients.length - new Set(recipients).size).toBe(0);
    expect(new Set(recipients).size).toBe(change === 'new-prefix' ? 1002 : 1001);
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({ n: new Set(recipients).size });
  } finally { s.sqlite.close(); }
});

function localUnknownProvider(mode: Mode = 'multicast') {
  const requests: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).endsWith('/quota')) return Response.json({ type: 'none' });
    if (String(url).endsWith('/quota/consumption')) return Response.json({ totalUsage: 0 });
    expect(String(url)).toBe(`https://api.line.me/v2/bot/message/${mode}`);
    requests.push(String(init?.body));
    throw new Error('Local unknown acceptance');
  });
  return requests;
}

const scopeChanges = ['expired', 'future', 'corrupt', 'content', 'personalized-content', 'account-inactive', 'channel', 'unfollow', 'line-id', 'identity', 'messages', 'liff', 'priority-switch'] as const;
it.each((['multicast', 'push'] as const).flatMap(mode => scopeChanges.map(change => [mode, change] as const)))(
  'retains an uncertain %s intent and sends nothing when %s changes', async (mode, change) => {
    const s = fixture(1, mode);
    const requests = localUnknownProvider(mode);
    try {
      if (change === 'liff') {
        s.sqlite.prepare('UPDATE broadcasts SET message_content = ?').run(mode === 'push' ? 'Hello {{name}} {{liff_id}}' : 'Hello {{liff_id}}');
        s.sqlite.exec("UPDATE line_accounts SET liff_id = 'old-liff'");
      }
      if (change === 'priority-switch') s.sqlite.exec(`
        INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('b','b','B','synthetic-b','secret');
        UPDATE broadcasts SET account_ids = '["a","b"]', dedup_priority = '["a","b"]';
        UPDATE friends SET user_id = 'shared';
        INSERT INTO friends(id,line_user_id,line_account_id,user_id) VALUES('other-channel','other-line','b','shared')`);
      const first = await s.run();
      expect(first.complete).toBe(false);
      const progress = JSON.parse(s.state().dedup_progress!);
      if (change === 'expired') progress.pendingRequest.firstAttemptAt = Date.now() - 23 * 3600_000;
      if (change === 'future') progress.pendingRequest.firstAttemptAt = Date.now() + 3600_000;
      if (change === 'corrupt') progress.pendingRequest.recipients = [];
      if (change === 'messages') progress.pendingRequest.messages[0].text = 'Changed request';
      if (change === 'content') s.sqlite.exec("UPDATE broadcasts SET message_content = 'Changed'");
      if (change === 'personalized-content') s.sqlite.prepare('UPDATE broadcasts SET message_content = ?').run(mode === 'push' ? 'Changed {{name}}' : 'Hello {{name}}');
      if (change === 'account-inactive') s.sqlite.exec('UPDATE line_accounts SET is_active = 0');
      if (change === 'channel') s.sqlite.exec("UPDATE line_accounts SET channel_id = 'new-channel'");
      if (change === 'unfollow') s.sqlite.exec('UPDATE friends SET is_following = 0');
      if (change === 'line-id') s.sqlite.exec("UPDATE friends SET line_user_id = 'new-line-id'");
      if (change === 'identity') s.sqlite.exec("UPDATE friends SET user_id = 'new-user'");
      if (change === 'liff') s.sqlite.exec("UPDATE line_accounts SET liff_id = 'new-liff'");
      if (change === 'priority-switch') s.sqlite.exec("UPDATE friends SET is_following = 0 WHERE line_account_id = 'a'");
      const raw = JSON.stringify(progress);
      s.sqlite.prepare('UPDATE broadcasts SET dedup_progress = ?').run(raw);
      expect((await s.run()).complete).toBe(false);
      expect(requests).toHaveLength(1);
      expect(s.state().dedup_progress).toBe(raw);
      expect(s.state().last_error).toBe(DEDUP_INTENT_REVIEW);
      expect(s.state().success_count).toBe(0);
      expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({ n: 0 });
    } finally { s.sqlite.close(); }
  },
);

it.each(['invalid-json', 'duplicate-identities', 'invalid-version'] as const)('does not reset %s progress and resend', async change => {
  const s = fixture(1); const requests = localUnknownProvider();
  try {
    const raw = change === 'invalid-json' ? '{broken' : JSON.stringify({ sentIdentKeys: change === 'duplicate-identities' ? ['solo:f0000', 'solo:f0000'] : [], journalVersion: 9 });
    s.sqlite.prepare('UPDATE broadcasts SET dedup_progress = ?').run(raw);
    await expect(s.run()).rejects.toThrow(DEDUP_INTENT_REVIEW);
    expect(requests).toEqual([]); expect(s.state().dedup_progress).toBe(raw);
  } finally { s.sqlite.close(); }
});

it('preserves another execution that finishes before intent reservation', async () => {
  const s = fixture(1); const requests = localUnknownProvider();
  const prepare = s.db.prepare.bind(s.db); let replaced = false;
  s.db.prepare = sql => {
    if (!replaced && sql.includes('SET dedup_progress = ?')) {
      replaced = true;
      s.sqlite.exec("UPDATE broadcasts SET status = 'sent', sent_at = '2026-01-01', last_error = 'newer result'");
    }
    return prepare(sql);
  };
  try {
    const result = await s.run();
    await releaseDedupDeliveryClaim(s.db, 'campaign', result.journaledProgress ?? null);
    expect(requests).toEqual([]);
    expect(s.state()).toMatchObject({ status: 'sent', sent_at: '2026-01-01', last_error: 'newer result' });
  } finally { s.sqlite.close(); }
});

it.each(['multicast', 'push'] as const)('an old %s response cannot duplicate receipts after another execution reconciles the same intent', async mode => {
  const s = fixture(1, mode);
  let enter!: () => void; let release!: () => void;
  const entered = new Promise<void>(resolve => { enter = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let calls = 0; let firstBody = '';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).endsWith('/quota')) return Response.json({ type: 'none' });
    if (String(url).endsWith('/quota/consumption')) return Response.json({ totalUsage: 0 });
    expect(String(url)).toBe(`https://api.line.me/v2/bot/message/${mode}`);
    if (++calls === 1) { firstBody = String(init?.body); enter(); await gate; return Response.json({}); }
    expect(String(init?.body)).toBe(firstBody);
    return new Response('accepted', { status: 409, headers: { 'x-line-accepted-request-id': 'local-original' } });
  });
  const old = s.run();
  try {
    await entered;
    const current = await s.run(); expect(current.complete).toBe(true);
    await finishJournaledDedupBroadcast(s.db, 'campaign', current);
    release(); const stale = await old;
    await releaseDedupDeliveryClaim(s.db, 'campaign', stale.journaledProgress ?? null, 'stale error');
    expect(s.state()).toMatchObject({ status: 'sent', success_count: 1, last_error: null, dedup_progress: null });
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({ n: 1 });
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM broadcast_insights').get()).toEqual({ n: 1 });
    expect(calls).toBe(2);
  } finally { release(); await old; s.sqlite.close(); }
});

it('uses fewer than 100 bound parameters in every 500-recipient receipt statement', async () => {
  const s = fixture(500); acceptingProvider();
  const prepare = s.db.prepare.bind(s.db); let maximum = 0;
  s.db.prepare = sql => {
    const statement = prepare(sql);
    return new Proxy(statement, { get(target, key, receiver) {
      if (key === 'bind') return (...values: unknown[]) => { maximum = Math.max(maximum, values.length); return statement.bind(...values); };
      return Reflect.get(target, key, receiver);
    } });
  };
  try {
    expect((await s.run()).successCount).toBe(500);
    expect(maximum).toBeLessThan(100);
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({ n: 500 });
  } finally { s.sqlite.close(); }
});

it('never sends before reservation is durable', async () => {
  const s = fixture(1); const requests = localUnknownProvider();
  const prepare = s.db.prepare.bind(s.db);
  s.db.prepare = sql => { if (sql.includes('SET dedup_progress = ?')) throw new Error('Local reservation failure'); return prepare(sql); };
  try {
    await expect(s.run()).rejects.toThrow('Local reservation failure');
    expect(requests).toEqual([]); expect(s.state().dedup_progress).toBeNull();
  } finally { s.sqlite.close(); }
});

it('keeps a bare 409 exception pending instead of rotating its key', async () => {
  const s = fixture(1);
  const client = { getMessageQuota: async () => ({ type: 'none' }), multicast: async () => { throw new LineApiError(409, 'Conflict', 'no accepted request evidence'); } };
  try {
    const result = await processMultiAccountDedupBroadcast(s.db, s.state(), () => client as unknown as LineClient);
    expect(result.complete).toBe(false); expect(s.state().success_count).toBe(0);
    expect(JSON.parse(s.state().dedup_progress!).pendingRequest.retryKey).toEqual(expect.any(String));
  } finally { s.sqlite.close(); }
});

it('does not let an old release or finalizer erase a newer saved intent', async () => {
  const s = fixture(1); localUnknownProvider();
  try {
    const old = await s.run(); const previous = s.state().dedup_progress;
    const next = JSON.parse(previous!); next.pendingRequest.id = crypto.randomUUID();
    const raw = JSON.stringify(next);
    s.sqlite.prepare('UPDATE broadcasts SET dedup_progress = ?, last_error = ?').run(raw, 'newer error');
    await releaseDedupDeliveryClaim(s.db, 'campaign', old.journaledProgress!, 'old error');
    await finishJournaledDedupBroadcast(s.db, 'campaign', { ...old, complete: true });
    expect(s.state()).toMatchObject({ status: 'sending', dedup_progress: raw, last_error: 'newer error' });
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM broadcast_insights').get()).toEqual({ n: 0 });
  } finally { s.sqlite.close(); }
});

it('does not reconstruct missing historical receipts from a positive count', async () => {
  const s = fixture(1); const requests = localUnknownProvider();
  try {
    s.sqlite.exec('UPDATE broadcasts SET success_count = 1');
    await expect(s.run()).rejects.toThrow(DEDUP_INTENT_REVIEW);
    expect(requests).toEqual([]); expect(s.state().dedup_progress).toBeNull();
  } finally { s.sqlite.close(); }
});

function acceptingProvider(loseAt = 0, mode: Mode = 'multicast') {
  const accepted = new Map<string, string>(); const bodies: string[] = [];
  let calls = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).endsWith('/quota')) return Response.json({ type: 'none' });
    if (String(url).endsWith('/quota/consumption')) return Response.json({ totalUsage: 0 });
    expect(String(url)).toBe(`https://api.line.me/v2/bot/message/${mode}`);
    const key = new Headers(init?.headers).get('x-line-retry-key')!;
    const body = String(init?.body); bodies.push(body); calls++;
    if (accepted.has(key)) {
      expect(body).toBe(accepted.get(key));
      return new Response('accepted', { status: 409, headers: { 'x-line-accepted-request-id': 'local-original' } });
    }
    accepted.set(key, body);
    if (calls === loseAt) throw new Error('Local lost response');
    return Response.json({});
  });
  return { accepted, bodies };
}

it('the real queue retains unknown acceptance, then finishes with one insight and no duplicate receipts', async () => {
  const s = fixture(1001); const provider = acceptingProvider(2);
  try {
    s.sqlite.exec('UPDATE broadcasts SET batch_offset = 0');
    const run = () => processQueuedBroadcasts(s.db, new LineClient('must-not-be-used'));
    await run();
    expect(s.state()).toMatchObject({ status: 'sending', success_count: 500, total_count: 1001, batch_offset: 0 });
    expect(JSON.parse(s.state().dedup_progress!).pendingRequest.recipients).toHaveLength(500);
    s.friend('new', '1900-01-01'); await run();
    expect(s.state()).toMatchObject({ status: 'sent', success_count: 1002, total_count: 1002, dedup_progress: null, last_error: null });
    expect([...provider.accepted.values()].flatMap(raw => JSON.parse(raw).to)).toHaveLength(1002);
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({ n: 1002 });
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM broadcast_insights').get()).toEqual({ n: 1 });
  } finally { s.sqlite.close(); }
});

it.each((['multicast', 'push'] as const).flatMap(mode => (['rollback', 'commit-response'] as const).map(failure => [mode, failure] as const)))('recovers a %s receipt transaction %s without duplicate acceptance', async (mode, failure) => {
  const s = fixture(1, mode); const provider = acceptingProvider(0, mode);
  const batch = s.db.batch.bind(s.db); let fail = true;
  s.db.batch = async <T>(statements: D1PreparedStatement[]) => {
    if (fail) {
      fail = false;
      if (failure === 'commit-response') await batch<T>(statements);
      throw new Error(`Local receipt ${failure}`);
    }
    return batch<T>(statements);
  };
  try {
    s.sqlite.exec('UPDATE broadcasts SET batch_offset = 0');
    const run = () => processQueuedBroadcasts(s.db, new LineClient('must-not-be-used'));
    await run();
    expect(s.state().status).toBe('sending');
    s.sqlite.exec("UPDATE broadcasts SET batch_lock_at = '2000-01-01'");
    await recoverStalledBroadcasts(s.db); await run();
    expect(s.state()).toMatchObject({ status: 'sent', success_count: 1, dedup_progress: null });
    expect(provider.accepted.size).toBe(1);
    expect(provider.bodies).toHaveLength(failure === 'rollback' ? 2 : 1);
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({ n: 1 });
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM broadcast_insights').get()).toEqual({ n: 1 });
  } finally { s.sqlite.close(); }
});

it.each(['multicast', 'push'] as const)('does not write an error over a completed %s broadcast when the final commit response is lost', async mode => {
  const s = fixture(1, mode); acceptingProvider(0, mode);
  const batch = s.db.batch.bind(s.db); let count = 0;
  s.db.batch = async <T>(statements: D1PreparedStatement[]) => {
    const result = await batch<T>(statements);
    if (++count === 2) throw new Error('Local final commit response lost');
    return result;
  };
  try {
    s.sqlite.exec('UPDATE broadcasts SET batch_offset = 0');
    await processQueuedBroadcasts(s.db, new LineClient('must-not-be-used'));
    expect(s.state()).toMatchObject({ status: 'sent', success_count: 1, dedup_progress: null, last_error: null });
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM broadcast_insights').get()).toEqual({ n: 1 });
  } finally { s.sqlite.close(); }
});

it.each([0, 22])('reconciles a saved %s-hour-old acceptance even when provider quota is exhausted', async age => {
  const s = fixture(1); const requests = localUnknownProvider();
  try {
    await s.run(); expect(requests).toHaveLength(1);
    const progress = JSON.parse(s.state().dedup_progress!);
    progress.pendingRequest.firstAttemptAt = Date.now() - age * 3600_000;
    s.sqlite.prepare('UPDATE broadcasts SET dedup_progress = ?').run(JSON.stringify(progress));
    const replay = vi.spyOn(globalThis, 'fetch').mockClear().mockImplementation(async (url, init) => {
      // Replaying an already accepted key needs no new quota allowance.
      expect(String(url)).toBe('https://api.line.me/v2/bot/message/multicast');
      expect(String(init?.body)).toBe(requests[0]);
      return new Response('accepted', { status: 409, headers: { 'x-line-accepted-request-id': 'local-original' } });
    });
    expect((await s.run()).successCount).toBe(1);
    expect(replay).toHaveBeenCalledTimes(1);
  } finally { s.sqlite.close(); }
});

it('honors the monthly usage boundary using real receipt rows, including batched INSERTs', async () => {
  const s = fixture(1001); const provider = acceptingProvider();
  try {
    const result = await processMultiAccountDedupBroadcast(s.db, s.state(), token => new LineClient(token), {
      now: () => 0, quotaEnv: { QUOTA_MONTHLY_MESSAGES_MAX: '400' },
    });
    expect(result.complete).toBe(false); expect(result.successCount).toBe(500);
    expect(provider.accepted.size).toBe(1);
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({ n: 500 });
  } finally { s.sqlite.close(); }
});

it('an actual prior completed receipt state cannot finalize a newer pending request', async () => {
  const s = fixture(1); acceptingProvider();
  try {
    const completed = await s.run(); expect(completed.complete).toBe(true);
    s.friend('new', '1900-01-01'); localUnknownProvider();
    expect((await s.run()).complete).toBe(false);
    const raw = s.state().dedup_progress;
    await finishJournaledDedupBroadcast(s.db, 'campaign', completed);
    await releaseDedupDeliveryClaim(s.db, 'campaign', completed.journaledProgress ?? null);
    expect(s.state()).toMatchObject({ status: 'sending', success_count: 1, dedup_progress: raw });
    expect(JSON.parse(raw!).pendingRequest.recipients).toHaveLength(1);
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM broadcast_insights').get()).toEqual({ n: 0 });
  } finally { s.sqlite.close(); }
});

it('resolves an unknown request before continuing to a different selected account', async () => {
  const s = fixture(1); const provider = acceptingProvider(1);
  try {
    s.sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
      VALUES('b','b','B','synthetic-b','secret');
      UPDATE broadcasts SET account_ids = '["a","b"]', dedup_priority = '["a","b"]';
      INSERT INTO friends(id,line_user_id,line_account_id) VALUES('other','line-other','b')`);
    expect((await s.run()).complete).toBe(false);
    expect(provider.accepted.size).toBe(1);
    const complete = await s.run();
    expect(complete).toMatchObject({ complete: true, successCount: 2, totalCount: 2, failedAccountIds: [] });
    await finishJournaledDedupBroadcast(s.db, 'campaign', complete);
    expect(provider.accepted.size).toBe(2);
    expect(s.sqlite.prepare('SELECT line_account_id, COUNT(*) n FROM messages_log GROUP BY line_account_id ORDER BY line_account_id').all())
      .toEqual([{ line_account_id: 'a', n: 1 }, { line_account_id: 'b', n: 1 }]);
  } finally { s.sqlite.close(); }
});

it.each(['name-change', 'expired-key'] as const)('does not duplicate personalized acceptance after %s', async change => {
  const s = fixture(1);
  s.sqlite.exec("UPDATE broadcasts SET message_content = 'Hello {{name}}'; UPDATE friends SET display_name = 'Old name'");
  let currentTime = Date.now();
  vi.spyOn(Date, 'now').mockImplementation(() => currentTime);
  const accepted: Array<{ key: string; at: number }> = [];
  let pushes = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).endsWith('/quota')) return Response.json({ type: 'none' });
    if (String(url).endsWith('/quota/consumption')) return Response.json({ totalUsage: 0 });
    expect(String(url)).toBe('https://api.line.me/v2/bot/message/push');
    const key = new Headers(init?.headers).get('x-line-retry-key')!;
    if (accepted.some(item => item.key === key && currentTime - item.at < 24 * 3600_000)) {
      return new Response('accepted', { status: 409, headers: { 'x-line-accepted-request-id': 'local-original' } });
    }
    accepted.push({ key, at: currentTime });
    if (++pushes === 1) throw new Error('Local lost personalized response');
    return Response.json({});
  });
  const prepare = s.db.prepare.bind(s.db); let interrupted = true;
  s.db.prepare = sql => {
    if (interrupted && sql.includes('UPDATE broadcasts SET failed_account_ids')) throw new Error('Local interruption before finalization');
    return prepare(sql);
  };
  try {
    try { await s.run(); } catch (error) { expect(String(error)).toContain('Local interruption'); }
    interrupted = false;
    if (change === 'name-change') s.sqlite.exec("UPDATE friends SET display_name = 'New name'");
    else currentTime += 24 * 3600_000;
    const saved = s.state().dedup_progress;
    const resumed = await s.run();
    expect(accepted).toHaveLength(1);
    expect(resumed.complete).toBe(false);
    expect(s.state()).toMatchObject({ success_count: 0, dedup_progress: saved, last_error: DEDUP_INTENT_REVIEW });
  } finally { s.sqlite.close(); }
});

it.each(['multicast', 'push'] as const)('reports a current %s metadata failure after durable receipts', async mode => {
  const s = fixture(1, mode); acceptingProvider(0, mode);
  const prepare = s.db.prepare.bind(s.db); let fail = true;
  s.db.prepare = sql => {
    if (fail && sql.includes('UPDATE broadcasts SET failed_account_ids')) { fail = false; throw new Error('Local owned metadata failure'); }
    return prepare(sql);
  };
  try {
    s.sqlite.exec('UPDATE broadcasts SET batch_offset = 0');
    await processQueuedBroadcasts(s.db, new LineClient('must-not-be-used'));
    expect(s.state()).toMatchObject({ status: 'sending', success_count: 1, batch_offset: -1 });
    expect(s.state().last_error).toContain('配信処理を継続できませんでした');
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({ n: 1 });
  } finally { s.sqlite.close(); }
});

it('records the known personalized prefix and replays only the uncertain push', async () => {
  const s = fixture(5, 'push'); const provider = acceptingProvider(3, 'push');
  try {
    const incomplete = await s.run();
    expect(incomplete).toMatchObject({ complete: false, successCount: 2 });
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({ n: 2 });
    const complete = await s.run();
    expect(complete).toMatchObject({ complete: true, successCount: 5, totalCount: 5 });
    expect(provider.accepted.size).toBe(5); expect(provider.bodies).toHaveLength(6);
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({ n: 5 });
  } finally { s.sqlite.close(); }
});

it('preserves personalized partial rejection and continues another selected account', async () => {
  const s = fixture(5, 'push'); const accepted: string[] = [];
  s.sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('b','b','B','synthetic-b','secret');
    UPDATE broadcasts SET account_ids = '["a","b"]', dedup_priority = '["a","b"]';
    INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('other','line-other','b','Other')`);
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
    if (String(url).endsWith('/quota')) return Response.json({ type: 'none' });
    if (String(url).endsWith('/quota/consumption')) return Response.json({ totalUsage: 0 });
    expect(String(url)).toBe('https://api.line.me/v2/bot/message/push');
    const to = JSON.parse(String(init?.body)).to;
    if (to === 'line-f0002') return new Response('definite rejection', { status: 400 });
    accepted.push(to); return Response.json({});
  });
  try {
    const result = await s.run();
    expect(result).toMatchObject({ complete: true, successCount: 3, totalCount: 6, failedAccountIds: ['a'] });
    expect(accepted).toEqual(['line-f0000', 'line-f0001', 'line-other']);
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({ n: 3 });
    expect(JSON.parse(s.state().dedup_progress!).pendingRequest).toBeUndefined();
  } finally { s.sqlite.close(); }
});

it('preserves the ten-person personalized time-budget boundary', async () => {
  const s = fixture(11, 'push'); const provider = acceptingProvider(0, 'push');
  let times = 0;
  try {
    const result = await processMultiAccountDedupBroadcast(s.db, s.state(), token => new LineClient(token), {
      maxRunMs: 15_000, now: () => ++times === 1 ? 0 : 1_000_000,
    });
    expect(result).toMatchObject({ complete: false, successCount: 10, totalCount: 11 });
    expect(provider.accepted.size).toBe(10);
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({ n: 10 });
  } finally { s.sqlite.close(); }
});

it.each(['multicast', 'push'] as const)('retains the actionable %s review reason through the real queue catch', async mode => {
  const s = fixture(1, mode); const requests = localUnknownProvider(mode);
  try {
    s.sqlite.exec("UPDATE broadcasts SET batch_offset = 0, dedup_progress = '{broken'");
    await processQueuedBroadcasts(s.db, new LineClient('must-not-be-used'));
    expect(s.state().last_error).toBe(DEDUP_INTENT_REVIEW);
    expect(s.state().dedup_progress).toBe('{broken');
    expect(requests).toEqual([]);
  } finally { s.sqlite.close(); }
});

it.each((['multicast', 'push'] as const).flatMap(mode => [false, true].map(newerError => [mode, newerError] as const)))(
  'a %s preview error respects newer-reason=%s without hiding a current failure', async (mode, newerError) => {
    const s = fixture(1, mode); const requests = localUnknownProvider(mode);
    const prepare = s.db.prepare.bind(s.db);
    s.db.prepare = sql => {
      if (sql.includes('ROW_NUMBER() OVER')) {
        if (newerError) s.sqlite.exec("UPDATE broadcasts SET last_error = 'newer result'");
        throw new Error('Local recipient-preview failure');
      }
      return prepare(sql);
    };
    try {
      s.sqlite.exec('UPDATE broadcasts SET batch_offset = 0');
      await processQueuedBroadcasts(s.db, new LineClient('must-not-be-used'));
      expect(s.state().last_error).toBe(newerError ? 'newer result' : '配信処理を継続できませんでした。配信状況を確認してください。');
      expect(requests).toEqual([]);
    } finally { s.sqlite.close(); }
  },
);

it.each((['multicast', 'push'] as const).flatMap(mode => (['same', 'move', 'inactive'] as const).map(winnerMoves => [mode, winnerMoves] as const)))(
  '%s registration link preserves known receipts when cross-account winner moves=%s', async (mode, winnerMoves) => {
    const size = mode === 'push' ? 11 : 501;
    const s = fixture(size, mode); const provider = acceptingProvider(0, mode);
    const userId = crypto.randomUUID();
    s.sqlite.prepare('INSERT INTO users(id,display_name) VALUES(?,?)').run(userId, 'Synthetic registered user');
    if (winnerMoves !== 'same') s.sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('b','b','B','synthetic-b','secret');
      UPDATE broadcasts SET account_ids = '["a","b"]', dedup_priority = '["a","b"]';
      INSERT INTO friends(id,line_user_id,line_account_id,is_following,display_name) VALUES('other','line-other','b',0,'Other')`);
    try {
      let clocks = 0;
      const first = await processMultiAccountDedupBroadcast(s.db, s.state(), token => new LineClient(token), { now: () => clocks++ === 0 ? 0 : 20_000 });
      expect(first).toMatchObject({ complete: false, successCount: size - 1 });
      const oldLogIds = s.sqlite.prepare('SELECT id FROM messages_log ORDER BY id').all();
      const oldKeys = JSON.parse(s.state().dedup_progress!).sentIdentKeys as string[];
      await linkFriendToUser(s.db, 'f0000', userId);
      if (winnerMoves !== 'same') {
        await linkFriendToUser(s.db, 'other', userId);
        s.sqlite.exec("UPDATE friends SET is_following = 0 WHERE id = 'f0000'; UPDATE friends SET is_following = 1 WHERE id = 'other'");
        if (winnerMoves === 'inactive') s.sqlite.exec("UPDATE line_accounts SET is_active = 0 WHERE id = 'a'");
      }
      const complete = await s.run();
      const physical = [...provider.accepted.values()].flatMap(raw => { const to = JSON.parse(raw).to; return Array.isArray(to) ? to : [to]; });
      const logical = physical.map(id => id === 'line-other' ? 'line-f0000' : id);
      const expected = winnerMoves === 'inactive' ? size - 1 : size;
      expect(logical).toHaveLength(expected); expect(new Set(logical).size).toBe(expected);
      expect(provider.bodies).toHaveLength(mode === 'push' ? expected : winnerMoves === 'inactive' ? 1 : 2);
      expect(complete).toMatchObject({ complete: true, successCount: expected, totalCount: expected });
      expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({ n: expected });
      expect(JSON.parse(s.state().dedup_progress!).sentIdentKeys.slice(0, oldKeys.length)).toEqual(oldKeys);
      expect(JSON.parse(s.state().dedup_progress!).sentIdentKeys).not.toContain('uid:' + userId);
      for (const row of oldLogIds) expect(s.sqlite.prepare('SELECT id FROM messages_log WHERE id = ?').get((row as { id: string }).id)).toEqual(row);
    } finally { s.sqlite.close(); }
  },
);

it.each(['missing', 'duplicate', 'incoming', 'test', 'manual', 'foreign-account'] as const)(
  'does not infer linked identities from a %s journal receipt set or repair it', async invalid => {
    const s = fixture(1); const provider = acceptingProvider();
    try {
      expect((await s.run()).successCount).toBe(1);
      const userId = crypto.randomUUID(); s.sqlite.prepare('INSERT INTO users(id) VALUES(?)').run(userId);
      await linkFriendToUser(s.db, 'f0000', userId);
      if (invalid === 'missing') s.sqlite.exec('DELETE FROM messages_log');
      if (invalid === 'duplicate') s.sqlite.exec(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,broadcast_id,source,line_account_id)
        SELECT 'duplicate',friend_id,direction,message_type,content,broadcast_id,source,line_account_id FROM messages_log`);
      if (invalid === 'incoming') s.sqlite.exec("UPDATE messages_log SET direction = 'incoming'");
      if (invalid === 'test') s.sqlite.exec("UPDATE messages_log SET delivery_type = 'test'");
      if (invalid === 'manual') s.sqlite.exec("UPDATE messages_log SET source = 'manual'");
      if (invalid === 'foreign-account') {
        s.sqlite.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('foreign','foreign','Foreign','synthetic-other','secret'); UPDATE messages_log SET line_account_id = 'foreign'");
      }
      const receipts = s.sqlite.prepare('SELECT * FROM messages_log ORDER BY id').all();
      const progress = s.state().dedup_progress;
      await expect(s.run()).rejects.toThrow(DEDUP_INTENT_REVIEW);
      expect(provider.bodies).toHaveLength(1);
      expect(s.state()).toMatchObject({ success_count: 1, dedup_progress: progress, last_error: DEDUP_INTENT_REVIEW });
      expect(s.sqlite.prepare('SELECT * FROM messages_log ORDER BY id').all()).toEqual(receipts);
    } finally { s.sqlite.close(); }
  },
);

it('ignores unrelated test/incoming/manual/foreign records while preserving the known linked person', async () => {
  const s = fixture(1); const provider = acceptingProvider();
  try {
    await s.run();
    s.sqlite.exec("INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('foreign','foreign','Foreign','synthetic-other','secret')");
    for (const [id, direction, deliveryType, source, account] of [
      ['test', 'outgoing', 'test', 'broadcast', 'a'], ['incoming', 'incoming', null, 'broadcast', 'a'],
      ['manual', 'outgoing', null, 'manual', 'a'], ['foreign', 'outgoing', null, 'broadcast', 'foreign'],
    ]) s.sqlite.prepare(`INSERT INTO messages_log(id,friend_id,direction,message_type,content,broadcast_id,delivery_type,source,line_account_id)
      VALUES(?,'f0000',?,'text','unrelated','campaign',?,?,?)`).run(id, direction, deliveryType, source, account);
    const userId = crypto.randomUUID(); s.sqlite.prepare('INSERT INTO users(id) VALUES(?)').run(userId);
    await linkFriendToUser(s.db, 'f0000', userId);
    expect(await s.run()).toMatchObject({ complete: true, successCount: 1, totalCount: 1 });
    expect(provider.bodies).toHaveLength(1);
    expect(s.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({ n: 5 });
  } finally { s.sqlite.close(); }
});

it('uses one indexed receipt read per resumed execution', async () => {
  const s = fixture(1); acceptingProvider(); const sqls: string[] = [];
  const prepare = s.db.prepare.bind(s.db);
  s.db.prepare = sql => { if (sql.includes('SELECT ml.friend_id')) sqls.push(sql); return prepare(sql); };
  try {
    await s.run(); expect(sqls).toEqual([]);
    await s.run(); expect(sqls).toHaveLength(1);
    const plan = s.sqlite.prepare('EXPLAIN QUERY PLAN ' + sqls[0]).all('campaign', '["a"]') as Array<{ detail: string }>;
    expect(plan.some(row => row.detail.includes('idx_messages_log_broadcast_id'))).toBe(true);
  } finally { s.sqlite.close(); }
});

it('keeps two historical acceptances when their current identities later merge', async () => {
  const s = fixture(2); const provider = acceptingProvider();
  try {
    expect((await s.run()).successCount).toBe(2);
    const receipts = s.sqlite.prepare('SELECT * FROM messages_log ORDER BY id').all();
    const keys = JSON.parse(s.state().dedup_progress!).sentIdentKeys;
    const userId = crypto.randomUUID(); s.sqlite.prepare('INSERT INTO users(id) VALUES(?)').run(userId);
    await linkFriendToUser(s.db, 'f0000', userId); await linkFriendToUser(s.db, 'f0001', userId);
    expect(await s.run()).toMatchObject({ complete: true, successCount: 2, totalCount: 2 });
    expect(provider.bodies).toHaveLength(1);
    expect(JSON.parse(s.state().dedup_progress!).sentIdentKeys).toEqual(keys);
    expect(s.sqlite.prepare('SELECT * FROM messages_log ORDER BY id').all()).toEqual(receipts);
  } finally { s.sqlite.close(); }
});
