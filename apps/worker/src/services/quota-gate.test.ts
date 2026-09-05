import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { monthStartJst } from './quota.js';

const dbMocks = {
  getBroadcasts: vi.fn(),
  getBroadcastById: vi.fn(),
  createBroadcast: vi.fn(),
  updateBroadcast: vi.fn(),
  deleteBroadcast: vi.fn(),
  getQueuedBroadcasts: vi.fn(),
  updateBroadcastStatus: vi.fn(),
  updateBroadcastBatchProgress: vi.fn(),
  getFriendsByTag: vi.fn(),
  jstNow: vi.fn(() => '2026-08-21T12:00:00.000'),
  updateBroadcastLineRequestId: vi.fn(),
  createBroadcastInsight: vi.fn(),
  getLineAccountById: vi.fn(),
  getFriendScenariosDueForDelivery: vi.fn(),
  getScenarioSteps: vi.fn(),
  advanceFriendScenario: vi.fn(),
  completeFriendScenario: vi.fn(),
  claimFriendScenarioForDelivery: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  pauseFriendScenarioDelivery: vi.fn(),
  getFriendById: vi.fn(),
  computeNextDeliveryAt: vi.fn(),
  resolveStepContent: vi.fn(),
  addTagToFriend: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const { processQueuedBroadcasts, processBroadcastSend, processScheduledBroadcasts } = await import('./broadcast.js');
const { processStepDeliveries } = await import('./step-delivery.js');
const { broadcasts } = await import('../routes/broadcasts.js');

type LineClient = import('@line-crm/line-sdk').LineClient;

/** DB stub that answers quota COUNT queries and records every prepared SQL. */
function makeDb(counts: { friends?: number; monthly?: number }) {
  const executed: string[] = [];
  const db = {
    prepare(sql: string) {
      executed.push(sql);
      const stmt = {
        bind() { return stmt; },
        async first() {
          if (sql.includes('FROM friends')) return { count: counts.friends ?? 0 };
          if (sql.includes('FROM messages_log')) return { count: counts.monthly ?? 0 };
          return null;
        },
        async all() { return { results: [] }; },
        async run() { return { meta: { changes: 0 } }; },
      };
      return stmt;
    },
  };
  return { db: db as unknown as D1Database, executed };
}

const lineClient = {} as LineClient;

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockClear();
  dbMocks.recoverStuckDeliveries.mockResolvedValue(0);
  dbMocks.getQueuedBroadcasts.mockResolvedValue([]);
  dbMocks.getBroadcasts.mockResolvedValue([]);
  dbMocks.getFriendScenariosDueForDelivery.mockResolvedValue([]);
});

describe('processQueuedBroadcasts quota gate', () => {
  test('over quota → the queue is still read, but a fresh broadcast is never claimed', async () => {
    // The queue must be read even while over quota so that rows needing only
    // finalization can complete; a fresh row (nothing sent, one-time side
    // effects pending) is skipped before the claim.
    dbMocks.getQueuedBroadcasts.mockResolvedValue([{
      id: 'bc-fresh',
      target_type: 'all',
      target_tag_id: null,
      message_type: 'text',
      message_content: 'hello',
      batch_offset: 0,
      dedup_progress: null,
      segment_conditions: JSON.stringify({ operator: 'AND', rules: [{ type: 'is_following', value: true }] }),
      track_links: 0,
      line_account_id: null,
      alt_text: null,
    }]);
    const { db, executed } = makeDb({ friends: 2 });
    await processQueuedBroadcasts(db, lineClient, undefined, { QUOTA_FRIENDS_MAX: '1' });
    expect(dbMocks.getQueuedBroadcasts).toHaveBeenCalledTimes(1);
    expect(executed.some((s) => s.includes('batch_offset = -1'))).toBe(false);
  });
  test('no quotaEnv → proceeds as before', async () => {
    const { db } = makeDb({ friends: 2 });
    await processQueuedBroadcasts(db, lineClient, undefined);
    expect(dbMocks.getQueuedBroadcasts).toHaveBeenCalledTimes(1);
  });
  test('quotaEnv set but under limit → proceeds', async () => {
    const { db } = makeDb({ friends: 1 });
    await processQueuedBroadcasts(db, lineClient, undefined, { QUOTA_FRIENDS_MAX: '5' });
    expect(dbMocks.getQueuedBroadcasts).toHaveBeenCalledTimes(1);
  });
});

describe('processStepDeliveries quota gate', () => {
  test('over quota → recovery still runs, due query does not', async () => {
    const { db } = makeDb({ friends: 2 });
    await processStepDeliveries(db, lineClient, undefined, { QUOTA_FRIENDS_MAX: '1' });
    expect(dbMocks.recoverStuckDeliveries).toHaveBeenCalledTimes(1);
    expect(dbMocks.getFriendScenariosDueForDelivery).not.toHaveBeenCalled();
  });
  test('no quotaEnv → proceeds as before', async () => {
    const { db } = makeDb({ friends: 2 });
    await processStepDeliveries(db, lineClient, undefined);
    expect(dbMocks.getFriendScenariosDueForDelivery).toHaveBeenCalledTimes(1);
  });
});

describe('processStepDeliveries per-tick send budget', () => {
  const dueRow = (id: string) => ({
    id,
    friend_id: `fr-${id}`,
    scenario_id: 'scn-1',
    current_step_order: 0,
    status: 'active',
    next_delivery_at: '2026-08-21T00:00:00.000+09:00',
    started_at: '2026-08-20T00:00:00.000+09:00',
  });

  function makeStepDb(counts: { monthly: number; friends?: number }) {
    const db = {
      prepare(sql: string) {
        const stmt = {
          bind() { return stmt; },
          async first() {
            if (sql.includes('FROM scenarios')) {
              return { delivery_mode: 'elapsed', line_account_id: null };
            }
            if (sql.includes('FROM messages_log')) return { count: counts.monthly };
            if (sql.includes('SUM(success_count)')) return { count: 0 };
            if (sql.includes('FROM friends')) return { count: counts.friends ?? 0 };
            return null;
          },
          async run() { return { meta: { changes: 1 } }; },
          async all() { return { results: [] }; },
        };
        return stmt;
      },
      async batch() { return []; },
    };
    return db as unknown as D1Database;
  }

  function setupSendMocks(dueCount: number) {
    const rows = Array.from({ length: dueCount }, (_, i) => dueRow(`fs-${i}`));
    dbMocks.getFriendScenariosDueForDelivery.mockResolvedValue(rows);
    dbMocks.claimFriendScenarioForDelivery.mockResolvedValue(true);
    dbMocks.getFriendById.mockImplementation(async (_db: unknown, friendId: string) => ({
      id: friendId,
      line_user_id: `U-${friendId}`,
      is_following: 1,
      line_account_id: null,
      user_id: null,
      metadata: null,
    }));
    dbMocks.getScenarioSteps.mockResolvedValue([{
      id: 'step-1',
      scenario_id: 'scn-1',
      step_order: 1,
      condition_type: null,
      condition_value: null,
      next_step_on_false: null,
      on_reach_tag_id: null,
      delay_minutes: 0,
      offset_days: null,
      offset_minutes: null,
      delivery_time: null,
    }]);
    dbMocks.resolveStepContent.mockResolvedValue({
      messageType: 'text',
      messageContent: 'hi',
      templateIdAtSend: null,
    });
    dbMocks.completeFriendScenario.mockResolvedValue(undefined);
    return { pushMessage: vi.fn(async () => ({})) };
  }

  test('monthly budget caps the sends of one tick (max 5, used 3, 5 due → 2 sent)', async () => {
    const client = setupSendMocks(5);
    await processStepDeliveries(
      makeStepDb({ monthly: 3 }), client as unknown as LineClient, undefined,
      { QUOTA_MONTHLY_MESSAGES_MAX: '5' },
    );
    expect(client.pushMessage).toHaveBeenCalledTimes(2);
    // Only the budgeted deliveries are claimed; the rest stay due for the
    // next tick.
    expect(dbMocks.claimFriendScenarioForDelivery).toHaveBeenCalledTimes(2);
  });

  test('budget already spent (used >= max) → early return, nothing claimed', async () => {
    const client = setupSendMocks(5);
    await processStepDeliveries(
      makeStepDb({ monthly: 5 }), client as unknown as LineClient, undefined,
      { QUOTA_MONTHLY_MESSAGES_MAX: '5' },
    );
    expect(client.pushMessage).not.toHaveBeenCalled();
    expect(dbMocks.getFriendScenariosDueForDelivery).not.toHaveBeenCalled();
  });

  test('friends-only limit keeps the previous behavior (all due sends go out)', async () => {
    const client = setupSendMocks(5);
    await processStepDeliveries(
      makeStepDb({ monthly: 3, friends: 4 }), client as unknown as LineClient, undefined,
      { QUOTA_FRIENDS_MAX: '10' },
    );
    expect(client.pushMessage).toHaveBeenCalledTimes(5);
  });
});

describe('send routes quota gate', () => {
  const row = {
    id: '11111111-2222-4333-8444-555555555555',
    title: 'greeting',
    message_type: 'text',
    message_content: 'hello',
    target_type: 'all',
    target_tag_id: null,
    status: 'draft',
    scheduled_at: null,
    sent_at: null,
    total_count: 0,
    success_count: 0,
    created_at: '2026-08-11T12:00:00.000+09:00',
    account_ids: null,
    dedup_priority: null,
    failed_account_ids: null,
    dedup_progress: null,
    batch_lock_at: null,
    track_links: 0,
    line_account_id: null,
    alt_text: null,
  };

  function setupApp(db: D1Database, quotaEnv: Record<string, string>) {
    const app = new Hono<{ Bindings: Record<string, unknown> }>();
    app.use('*', async (c, next) => {
      c.env = { DB: db, ...quotaEnv };
      await next();
    });
    app.route('/', broadcasts);
    return app;
  }

  test('POST /api/broadcasts/:id/send → structured 403 while over quota', async () => {
    dbMocks.getBroadcastById.mockResolvedValue(row);
    const { db } = makeDb({ friends: 2 });
    const res = await setupApp(db, { QUOTA_FRIENDS_MAX: '1' }).request(
      `/api/broadcasts/${row.id}/send`,
      { method: 'POST' },
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { success: boolean; error: string; quota: { exceeded: boolean } };
    expect(body.success).toBe(false);
    expect(body.error).toBe('quota_exceeded');
    expect(body.quota.exceeded).toBe(true);
  });

  test('POST /api/broadcasts/:id/send-segment → structured 403 while over quota', async () => {
    dbMocks.getBroadcastById.mockResolvedValue(row);
    const { db } = makeDb({ friends: 2 });
    const res = await setupApp(db, { QUOTA_FRIENDS_MAX: '1' }).request(
      `/api/broadcasts/${row.id}/send-segment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditions: { operator: 'AND', rules: [] } }),
      },
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('quota_exceeded');
  });
});

describe("processBroadcastSend 'all' recipient recording", () => {
  const allRow = {
    id: 'bc-all-1',
    title: 'to everyone',
    message_type: 'text',
    message_content: 'hello',
    target_type: 'all',
    target_tag_id: null,
    status: 'sending',
    scheduled_at: null,
    sent_at: null,
    total_count: 0,
    success_count: 0,
    created_at: '2026-08-11T12:00:00.000+09:00',
    account_ids: null,
    dedup_priority: null,
    failed_account_ids: null,
    dedup_progress: null,
    batch_lock_at: null,
    track_links: 0,
    line_account_id: null,
    alt_text: null,
  };

  function makeCountingDb(friendCount: number) {
    const executed: { sql: string; params: unknown[] }[] = [];
    const db = {
      prepare(sql: string) {
        const stmt = {
          params: [] as unknown[],
          bind(...p: unknown[]) { stmt.params = p; return stmt; },
          async first() {
            executed.push({ sql, params: stmt.params });
            if (sql.includes('FROM friends')) return { count: friendCount };
            return null;
          },
          async run() { return { meta: { changes: 1 } }; },
          async all() { return { results: [] }; },
        };
        return stmt;
      },
      async batch() { return []; },
    };
    return { db: db as unknown as D1Database, executed };
  }

  test('records the is_following follower count as total/success at send time', async () => {
    dbMocks.getBroadcastById.mockResolvedValue(allRow);
    const client = { broadcast: vi.fn(async () => ({ requestId: 'req-1' })) };
    const { db, executed } = makeCountingDb(7);

    await processBroadcastSend(db, client as unknown as LineClient, allRow.id);

    expect(client.broadcast).toHaveBeenCalledTimes(1);
    const fr = executed.find((e) => e.sql.includes('FROM friends'))!;
    expect(fr.sql).toContain('is_following = 1');
    expect(dbMocks.updateBroadcastStatus).toHaveBeenCalledWith(
      db, allRow.id, 'sent', { totalCount: 7, successCount: 7 },
    );
  });

  test('follower COUNT runs before the broadcast API call (no D1 read after acceptance)', async () => {
    dbMocks.getBroadcastById.mockResolvedValue(allRow);
    const { db, executed } = makeCountingDb(7);
    // Record the broadcast call into the same ordered log as the SQL reads.
    const client = {
      broadcast: vi.fn(async () => {
        executed.push({ sql: 'LINE_BROADCAST_CALL', params: [] });
        return { requestId: 'req-order' };
      }),
    };

    await processBroadcastSend(db, client as unknown as LineClient, allRow.id);

    const countIdx = executed.findIndex((e) => e.sql.includes('FROM friends'));
    const sendIdx = executed.findIndex((e) => e.sql === 'LINE_BROADCAST_CALL');
    expect(countIdx).toBeGreaterThanOrEqual(0);
    expect(sendIdx).toBeGreaterThanOrEqual(0);
    // A COUNT failure must abort before LINE accepts the broadcast — a D1
    // read failing after acceptance would reset the row to draft and re-send
    // to everyone on retry.
    expect(countIdx).toBeLessThan(sendIdx);
  });

  test('scopes the follower count to the broadcast account when one is set', async () => {
    dbMocks.getBroadcastById.mockResolvedValue({ ...allRow, line_account_id: 'acc-1' });
    dbMocks.getLineAccountById.mockResolvedValue(null);
    const client = { broadcast: vi.fn(async () => ({ requestId: 'req-2' })) };
    const { db, executed } = makeCountingDb(3);

    await processBroadcastSend(db, client as unknown as LineClient, allRow.id);

    const fr = executed.find((e) => e.sql.includes('FROM friends'))!;
    // Legacy friends rows may have a NULL line_account_id; they still receive
    // an account's broadcast, so the recorded count must include them.
    expect(fr.sql).toContain('(line_account_id = ? OR line_account_id IS NULL)');
    expect(fr.params).toContain('acc-1');
    expect(dbMocks.updateBroadcastStatus).toHaveBeenCalledWith(
      db, allRow.id, 'sent', { totalCount: 3, successCount: 3 },
    );
  });
});

describe('send routes projected-audience guard', () => {
  const draftRow = {
    id: '22222222-3333-4444-8555-666666666666',
    title: 'big send',
    message_type: 'text',
    message_content: 'hello',
    target_type: 'all',
    target_tag_id: null,
    status: 'draft',
    scheduled_at: null,
    sent_at: null,
    total_count: 0,
    success_count: 0,
    created_at: '2026-08-11T12:00:00.000+09:00',
    account_ids: null,
    dedup_priority: null,
    failed_account_ids: null,
    dedup_progress: null,
    batch_lock_at: null,
    track_links: 0,
    line_account_id: null,
    alt_text: null,
  };

  function setupApp(db: D1Database, quotaEnv: Record<string, string>) {
    const app = new Hono<{ Bindings: Record<string, unknown> }>();
    app.use('*', async (c, next) => {
      c.env = { DB: db, ...quotaEnv };
      await next();
    });
    app.route('/', broadcasts);
    return app;
  }

  test("/send target 'all': projected total over the monthly limit → 403", async () => {
    dbMocks.getBroadcastById.mockResolvedValue(draftRow);
    // 4999 used, 500 followers → 5499 > 5000
    const { db } = makeDb({ friends: 500, monthly: 4999 });
    const res = await setupApp(db, { QUOTA_MONTHLY_MESSAGES_MAX: '5000' }).request(
      `/api/broadcasts/${draftRow.id}/send`,
      { method: 'POST' },
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('quota_exceeded');
  });

  test("/send target 'tag': projected total over the monthly limit → 403", async () => {
    dbMocks.getBroadcastById.mockResolvedValue({
      ...draftRow, target_type: 'tag', target_tag_id: 'tag-1',
    });
    const { db, executed } = makeDb({ friends: 500, monthly: 4999 });
    const res = await setupApp(db, { QUOTA_MONTHLY_MESSAGES_MAX: '5000' }).request(
      `/api/broadcasts/${draftRow.id}/send`,
      { method: 'POST' },
    );
    expect(res.status).toBe(403);
    const est = executed.find((s) => s.includes('friend_tags'));
    expect(est).toBeDefined();
  });

  function makePersonalizedDb(counts: { monthly: number; unfilteredTag: number; audienceTotal: number }) {
    const db = {
      prepare(sql: string) {
        const stmt = {
          bind() { return stmt; },
          async first() {
            // The personalized branch's exact audience query (account-filtered).
            if (sql.includes('missing_name')) {
              return { total: counts.audienceTotal, missing_name: 0 };
            }
            if (sql.includes('FROM messages_log')) return { count: counts.monthly };
            if (sql.includes('SUM(success_count)')) return { count: 0 };
            // The generic unfiltered tag estimate (estimateSendAudience).
            if (sql.includes('FROM friends')) return { count: counts.unfilteredTag };
            return null;
          },
          async run() { return { meta: { changes: 0 } }; },
          async all() { return { results: [] }; },
        };
        return stmt;
      },
      async batch() { return []; },
    };
    return db as unknown as D1Database;
  }

  const personalizedTagRow = {
    ...draftRow,
    message_content: '{{name}}さん、こんにちは',
    target_type: 'tag',
    target_tag_id: 'tag-1',
    line_account_id: 'acc-1',
  };

  test('personalized account-bound tag: judged by its own account-filtered audience, not the unfiltered tag count', async () => {
    dbMocks.getBroadcastById.mockResolvedValue(personalizedTagRow);
    // Other accounts share the tag (unfiltered count 500 would project over),
    // but the personalized send only goes to this account's 1 tagged friend:
    // 4999 + 1 <= 5000 fits, so the guard must let it through. The lock stub
    // then returns 0 changes → 409, proving we got past the quota gate.
    const db = makePersonalizedDb({ monthly: 4999, unfilteredTag: 500, audienceTotal: 1 });
    const res = await setupApp(db, { QUOTA_MONTHLY_MESSAGES_MAX: '5000' }).request(
      `/api/broadcasts/${draftRow.id}/send`,
      { method: 'POST' },
    );
    expect(res.status).toBe(409);
  });

  test('personalized account-bound tag: its exact audience over the limit → 403', async () => {
    dbMocks.getBroadcastById.mockResolvedValue(personalizedTagRow);
    const db = makePersonalizedDb({ monthly: 4999, unfilteredTag: 500, audienceTotal: 2 });
    const res = await setupApp(db, { QUOTA_MONTHLY_MESSAGES_MAX: '5000' }).request(
      `/api/broadcasts/${draftRow.id}/send`,
      { method: 'POST' },
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('quota_exceeded');
  });

  function makeTagDb(counts: { monthly: number; unfilteredTag: number; accountTag: number; queuedUnscopedTag?: number }) {
    const executed: string[] = [];
    const db = {
      prepare(sql: string) {
        executed.push(sql);
        const stmt = {
          bind() { return stmt; },
          async first() {
            if (sql.includes('FROM messages_log')) return { count: counts.monthly };
            if (sql.includes('SUM(success_count)')) return { count: 0 };
            // Account-filtered tag COUNT (queued-path population).
            if (sql.includes('line_account_id = ?')) return { count: counts.accountTag };
            // Unscoped queued tag COUNT (tag membership only, no is_following).
            if (sql.includes('friend_tags') && !sql.includes('is_following')) {
              return { count: counts.queuedUnscopedTag ?? 0 };
            }
            // Unfiltered tag COUNT (inline getFriendsByTag population).
            if (sql.includes('FROM friends')) return { count: counts.unfilteredTag };
            return null;
          },
          async run() { return { meta: { changes: 0 } }; },
          async all() { return { results: [] }; },
        };
        return stmt;
      },
      async batch() { return []; },
    };
    return { db: db as unknown as D1Database, executed };
  }

  test('account-bound tag send above the queue threshold: judged by the queued (account-filtered) population', async () => {
    dbMocks.getBroadcastById.mockResolvedValue({
      ...draftRow, target_type: 'tag', target_tag_id: 'tag-1', line_account_id: 'acc-1',
    });
    // >500 following tag members → the route takes the queued path, whose
    // executor injects the account filter. Unfiltered count 600 would project
    // over (4999 + 600 > 5000), but the queued send only reaches this
    // account's 1 member: 4999 + 1 <= 5000 must pass. The lock stub then
    // returns 0 changes → 409, proving we got past the guard.
    dbMocks.getFriendsByTag.mockResolvedValue(
      Array.from({ length: 600 }, (_, i) => ({ id: `f${i}`, line_user_id: `U${i}`, is_following: 1 })),
    );
    const { db, executed } = makeTagDb({ monthly: 4999, unfilteredTag: 600, accountTag: 1 });
    const res = await setupApp(db, { QUOTA_MONTHLY_MESSAGES_MAX: '5000' }).request(
      `/api/broadcasts/${draftRow.id}/send`,
      { method: 'POST' },
    );
    expect(res.status).toBe(409);
    // The queued executor's tag-marker WHERE has no is_following rule —
    // unfollowed tagged rows are part of the send (and log) population, so
    // the estimate must include them too.
    const accountCount = executed.find((s) => s.includes('line_account_id = ?') && s.includes('friend_tags'))!;
    expect(accountCount).toBeDefined();
    expect(accountCount).not.toContain('is_following');
  });

  test('unscoped tag send above the queue threshold: judged by the tag-marker population (no is_following)', async () => {
    dbMocks.getBroadcastById.mockResolvedValue({
      ...draftRow, target_type: 'tag', target_tag_id: 'tag-1', line_account_id: null,
    });
    dbMocks.getFriendsByTag.mockResolvedValue(
      Array.from({ length: 600 }, (_, i) => ({ id: `f${i}`, line_user_id: `U${i}`, is_following: 1 })),
    );
    // Following count 600 (> 500 → queued path). The tag marker's WHERE has
    // no is_following rule, so the queued population may differ; the guard
    // must use it (stubbed to 1 → 4999 + 1 <= 5000 passes; the lock stub then
    // returns 0 changes → 409, proving that figure decided).
    const { db, executed } = makeTagDb({ monthly: 4999, unfilteredTag: 600, accountTag: 999, queuedUnscopedTag: 1 });
    const res = await setupApp(db, { QUOTA_MONTHLY_MESSAGES_MAX: '5000' }).request(
      `/api/broadcasts/${draftRow.id}/send`,
      { method: 'POST' },
    );
    expect(res.status).toBe(409);
    const queuedCount = executed.find((s) => s.includes('friend_tags') && !s.includes('is_following'))!;
    expect(queuedCount).toBeDefined();
    expect(queuedCount).not.toContain('line_account_id');
  });

  test('account-bound tag send above the queue threshold: its account-filtered population over the limit → 403', async () => {
    dbMocks.getBroadcastById.mockResolvedValue({
      ...draftRow, target_type: 'tag', target_tag_id: 'tag-1', line_account_id: 'acc-1',
    });
    dbMocks.getFriendsByTag.mockResolvedValue(
      Array.from({ length: 600 }, (_, i) => ({ id: `f${i}`, line_user_id: `U${i}`, is_following: 1 })),
    );
    const { db } = makeTagDb({ monthly: 4999, unfilteredTag: 600, accountTag: 501 });
    const res = await setupApp(db, { QUOTA_MONTHLY_MESSAGES_MAX: '5000' }).request(
      `/api/broadcasts/${draftRow.id}/send`,
      { method: 'POST' },
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('quota_exceeded');
  });

  test("account-bound 'tag': estimate mirrors the unfiltered send path (no account filter)", async () => {
    dbMocks.getBroadcastById.mockResolvedValue({
      ...draftRow, target_type: 'tag', target_tag_id: 'tag-1', line_account_id: 'acc-1',
    });
    const { db, executed } = makeDb({ friends: 500, monthly: 4999 });
    const res = await setupApp(db, { QUOTA_MONTHLY_MESSAGES_MAX: '5000' }).request(
      `/api/broadcasts/${draftRow.id}/send`,
      { method: 'POST' },
    );
    expect(res.status).toBe(403);
    // The actual tag send (getFriendsByTag) applies no account filter, so the
    // estimate must not either — filtering would undercount and let a send
    // slip past the limit.
    const est = executed.find((s) => s.includes('friend_tags'))!;
    expect(est).toBeDefined();
    expect(est).not.toContain('line_account_id');
  });

  test('/send under the projected limit proceeds past the guard', async () => {
    dbMocks.getBroadcastById.mockResolvedValue(draftRow);
    // 100 used + 500 followers = 600 ≤ 5000 → guard passes; the atomic claim
    // then fails (stub returns changes: 0) proving we got past the quota gate.
    const { db } = makeDb({ friends: 500, monthly: 100 });
    const res = await setupApp(db, { QUOTA_MONTHLY_MESSAGES_MAX: '5000' }).request(
      `/api/broadcasts/${draftRow.id}/send`,
      { method: 'POST' },
    );
    expect(res.status).toBe(409);
  });

  test("/send account-bound 'all': estimate includes legacy NULL-account rows", async () => {
    dbMocks.getBroadcastById.mockResolvedValue({ ...draftRow, line_account_id: 'acc-1' });
    const { db, executed } = makeDb({ friends: 500, monthly: 4999 });
    const res = await setupApp(db, { QUOTA_MONTHLY_MESSAGES_MAX: '5000' }).request(
      `/api/broadcasts/${draftRow.id}/send`,
      { method: 'POST' },
    );
    expect(res.status).toBe(403);
    const est = executed.find((s) => s.includes('FROM friends'))!;
    expect(est).toContain('(line_account_id = ? OR line_account_id IS NULL)');
  });

  function makeDedupDb(counts: { monthly: number; recipients: number }) {
    const recipients = Array.from({ length: counts.recipients }, (_, i) => ({
      friend_id: `f${i}`,
      line_user_id: `u${i}`,
      line_account_id: 'acc1',
      ident_key: `k${i}`,
      display_name: `F${i}`,
    }));
    const db = {
      prepare(sql: string) {
        const stmt = {
          bind() { return stmt; },
          async first() {
            if (sql.includes('FROM messages_log')) return { count: counts.monthly };
            if (sql.includes('SUM(success_count)')) return { count: 0 };
            return null;
          },
          async all() {
            if (sql.includes('COUNT(*) AS cnt')) {
              return { results: [{ line_account_id: 'acc1', cnt: counts.recipients }] };
            }
            if (sql.includes('ROW_NUMBER() OVER')) return { results: recipients };
            return { results: [] };
          },
          async run() { return { meta: { changes: 1 } }; },
        };
        return stmt;
      },
      async batch() { return []; },
    };
    return db as unknown as D1Database;
  }

  test('/send multi-account-dedup: projected total over the monthly limit → 403', async () => {
    dbMocks.getBroadcastById.mockResolvedValue({
      ...draftRow,
      target_type: 'multi-account-dedup',
      account_ids: '["acc1"]',
      dedup_priority: '["acc1"]',
    });
    dbMocks.getLineAccountById.mockResolvedValue({
      id: 'acc1', is_active: 1, channel_access_token: 'tok',
    });
    // 4999 used of 5000, dedup preview projects 500 recipients → 5499 > 5000.
    const res = await setupApp(makeDedupDb({ monthly: 4999, recipients: 500 }), {
      QUOTA_MONTHLY_MESSAGES_MAX: '5000',
    }).request(`/api/broadcasts/${draftRow.id}/send`, { method: 'POST' });
    expect(res.status).toBe(403);
    const body = await res.json() as { success: boolean; error: string; quota: { exceeded: boolean } };
    expect(body.success).toBe(false);
    expect(body.error).toBe('quota_exceeded');
    expect(body.quota.exceeded).toBe(false); // blocked by projection, not current usage
  });

  test('/send multi-account-dedup: projected total within the budget proceeds', async () => {
    dbMocks.getBroadcastById.mockResolvedValue({
      ...draftRow,
      target_type: 'multi-account-dedup',
      account_ids: '["acc1"]',
      dedup_priority: '["acc1"]',
    });
    dbMocks.getLineAccountById.mockResolvedValue({
      id: 'acc1', is_active: 1, channel_access_token: 'tok',
    });
    const res = await setupApp(makeDedupDb({ monthly: 100, recipients: 500 }), {
      QUOTA_MONTHLY_MESSAGES_MAX: '5000',
    }).request(`/api/broadcasts/${draftRow.id}/send`, { method: 'POST' });
    expect(res.status).not.toBe(403);
    const body = await res.json() as { success: boolean };
    expect(body.success).toBe(true);
  });

  test('/send-segment: projected segment count over the monthly limit → 403', async () => {
    dbMocks.getBroadcastById.mockResolvedValue(draftRow);
    const { db } = makeDb({ friends: 500, monthly: 4999 });
    const res = await setupApp(db, { QUOTA_MONTHLY_MESSAGES_MAX: '5000' }).request(
      `/api/broadcasts/${draftRow.id}/send-segment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditions: { operator: 'AND', rules: [{ type: 'is_following', value: true }] } }),
      },
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('quota_exceeded');
  });

  test('/send-segment under the projected limit proceeds past the guard', async () => {
    dbMocks.getBroadcastById.mockResolvedValue(draftRow);
    const { db } = makeDb({ friends: 500, monthly: 100 });
    const res = await setupApp(db, { QUOTA_MONTHLY_MESSAGES_MAX: '5000' }).request(
      `/api/broadcasts/${draftRow.id}/send-segment`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ conditions: { operator: 'AND', rules: [{ type: 'is_following', value: true }] } }),
      },
    );
    expect(res.status).toBe(409);
  });
});

describe('processScheduledBroadcasts per-broadcast quota re-check', () => {
  const scheduledRow = (id: string) => ({
    id,
    title: `due ${id}`,
    message_type: 'text',
    message_content: 'hello',
    target_type: 'all',
    target_tag_id: null,
    status: 'scheduled',
    scheduled_at: '2026-08-01T00:00:00.000+09:00',
    sent_at: null,
    total_count: 0,
    success_count: 0,
    created_at: '2026-07-31T12:00:00.000+09:00',
    account_ids: null,
    dedup_priority: null,
    failed_account_ids: null,
    dedup_progress: null,
    batch_lock_at: null,
    track_links: 0,
    line_account_id: null,
    alt_text: null,
  });

  /**
   * DB stub whose monthly tally grows as broadcast-API sends complete, so a
   * tick that starts under the limit crosses it between two due broadcasts.
   */
  function makeScheduledDb(state: { monthly: number }) {
    const db = {
      prepare(sql: string) {
        const stmt = {
          bind() { return stmt; },
          async first() {
            if (sql.includes('FROM messages_log')) return { count: state.monthly };
            if (sql.includes('SUM(success_count)')) return { count: 0 };
            if (sql.includes('FROM friends')) return { count: 500 };
            return null;
          },
          async run() { return { meta: { changes: 1 } }; },
          async all() { return { results: [] }; },
        };
        return stmt;
      },
      async batch() { return []; },
    };
    return db as unknown as D1Database;
  }

  test('crossing the limit after the first due send stops the rest of the tick', async () => {
    const rows = [scheduledRow('sched-1'), scheduledRow('sched-2')];
    dbMocks.getBroadcasts.mockResolvedValue(rows);
    dbMocks.getBroadcastById.mockImplementation(async (_db: unknown, id: string) =>
      rows.find((r) => r.id === id) ?? rows[0],
    );
    const state = { monthly: 0 };
    const client = {
      broadcast: vi.fn(async () => {
        state.monthly += 500; // the send is now part of this month's usage
        return { requestId: 'req-s' };
      }),
    };
    await processScheduledBroadcasts(
      makeScheduledDb(state), client as unknown as LineClient, undefined,
      { QUOTA_MONTHLY_MESSAGES_MAX: '900' },
    );
    // First due broadcast fits its estimate (0 + 500 <= 900) and sends; the
    // re-check before the second projects 500 + 500 > 900 and skips it.
    expect(client.broadcast).toHaveBeenCalledTimes(1);
  });

  test('a due send whose estimate alone would cross the limit is never claimed', async () => {
    const rows = [scheduledRow('sched-big')];
    dbMocks.getBroadcasts.mockResolvedValue(rows);
    dbMocks.getBroadcastById.mockImplementation(async () => rows[0]);
    // 4999 used of 5000, audience estimate 500 → projected 5499 > 5000.
    const state = { monthly: 4999 };
    const client = {
      broadcast: vi.fn(async () => {
        state.monthly += 500;
        return { requestId: 'req-s' };
      }),
    };
    await processScheduledBroadcasts(
      makeScheduledDb(state), client as unknown as LineClient, undefined,
      { QUOTA_MONTHLY_MESSAGES_MAX: '5000' },
    );
    expect(client.broadcast).not.toHaveBeenCalled();
  });

  function makeScheduledDedupDb(counts: { monthly: number; recipients: number }) {
    const recipients = Array.from({ length: counts.recipients }, (_, i) => ({
      friend_id: `f${i}`,
      line_user_id: `u${i}`,
      line_account_id: 'acc1',
      ident_key: `k${i}`,
      display_name: `F${i}`,
    }));
    const executed: string[] = [];
    const db = {
      prepare(sql: string) {
        const stmt = {
          bind() { return stmt; },
          async first() {
            if (sql.includes('FROM messages_log')) return { count: counts.monthly };
            if (sql.includes('SUM(success_count)')) return { count: 0 };
            return null;
          },
          async all() {
            if (sql.includes('COUNT(*) AS cnt')) {
              return { results: [{ line_account_id: 'acc1', cnt: counts.recipients }] };
            }
            if (sql.includes('ROW_NUMBER() OVER')) return { results: recipients };
            return { results: [] };
          },
          async run() {
            executed.push(sql);
            return { meta: { changes: 1 } };
          },
        };
        return stmt;
      },
      async batch() { return []; },
    };
    return { db: db as unknown as D1Database, executed };
  }

  const dedupScheduledRow = {
    ...scheduledRow('sched-dedup'),
    target_type: 'multi-account-dedup',
    account_ids: '["acc1"]',
    dedup_priority: '["acc1"]',
  };

  test('due dedup whose projected total would cross the limit is never claimed', async () => {
    dbMocks.getBroadcasts.mockResolvedValue([dedupScheduledRow]);
    dbMocks.getBroadcastById.mockResolvedValue(dedupScheduledRow);
    dbMocks.getLineAccountById.mockResolvedValue({
      id: 'acc1', is_active: 1, channel_access_token: 'tok',
    });
    // 4999 used of 5000, dedup preview projects 500 → 5499 > 5000.
    const { db, executed } = makeScheduledDedupDb({ monthly: 4999, recipients: 500 });
    await processScheduledBroadcasts(
      db, {} as LineClient, undefined, { QUOTA_MONTHLY_MESSAGES_MAX: '5000' },
    );
    expect(executed.filter((s) => s.includes(`SET status = 'sending'`))).toEqual([]);
  });

  test('due dedup within the budget is claimed and queued as before', async () => {
    dbMocks.getBroadcasts.mockResolvedValue([dedupScheduledRow]);
    dbMocks.getBroadcastById.mockResolvedValue(dedupScheduledRow);
    dbMocks.getLineAccountById.mockResolvedValue({
      id: 'acc1', is_active: 1, channel_access_token: 'tok',
    });
    const { db, executed } = makeScheduledDedupDb({ monthly: 100, recipients: 500 });
    await processScheduledBroadcasts(
      db, {} as LineClient, undefined, { QUOTA_MONTHLY_MESSAGES_MAX: '5000' },
    );
    expect(executed.some((s) => s.includes(`SET status = 'sending'`))).toBe(true);
  });

  const personalizedScheduledRow = {
    ...scheduledRow('sched-pers'),
    message_content: '{{name}}さん、こんにちは',
    target_type: 'tag',
    target_tag_id: 'tag-1',
    line_account_id: 'acc-1',
  };

  /**
   * DB stub for the personalized scheduled path: answers the account-filtered
   * personalized audience COUNT distinctly from the unfiltered tag estimate,
   * so the tests can prove which figure decided the outcome.
   */
  function makePersonalizedScheduledDb(counts: { monthly: number; personal: number; unfilteredTag: number }) {
    const executed: string[] = [];
    const db = {
      prepare(sql: string) {
        const stmt = {
          bind() { return stmt; },
          async first() {
            // processBroadcastSend's personalized conversion query (after claim).
            if (sql.includes('missing_name')) {
              return { total: counts.personal, missing_name: 0 };
            }
            if (sql.includes('FROM messages_log')) return { count: counts.monthly };
            if (sql.includes('SUM(success_count)')) return { count: 0 };
            // Shared personalized audience COUNT (account-filtered).
            if (sql.includes('line_account_id = ?')) return { count: counts.personal };
            // Generic unfiltered tag estimate — must not decide here.
            if (sql.includes('FROM friends')) return { count: counts.unfilteredTag };
            return null;
          },
          async run() {
            executed.push(sql);
            return { meta: { changes: 1 } };
          },
          async all() { return { results: [] }; },
        };
        return stmt;
      },
      async batch() { return []; },
    };
    return { db: db as unknown as D1Database, executed };
  }

  test('due personalized tag send: judged by its account-filtered audience, not the unfiltered tag count', async () => {
    dbMocks.getBroadcasts.mockResolvedValue([personalizedScheduledRow]);
    dbMocks.getBroadcastById.mockResolvedValue(personalizedScheduledRow);
    // Other accounts share the tag (unfiltered 500 would project over), but
    // this account's personalized send goes to 1 friend: 4999 + 1 <= 5000.
    const { db, executed } = makePersonalizedScheduledDb({ monthly: 4999, personal: 1, unfilteredTag: 500 });
    await processScheduledBroadcasts(
      db, {} as LineClient, undefined, { QUOTA_MONTHLY_MESSAGES_MAX: '5000' },
    );
    expect(executed.some((s) => s.includes(`SET status = 'sending'`))).toBe(true);
  });

  test('due personalized tag send whose own audience would cross the limit is skipped', async () => {
    dbMocks.getBroadcasts.mockResolvedValue([personalizedScheduledRow]);
    dbMocks.getBroadcastById.mockResolvedValue(personalizedScheduledRow);
    const { db, executed } = makePersonalizedScheduledDb({ monthly: 4999, personal: 2, unfilteredTag: 500 });
    await processScheduledBroadcasts(
      db, {} as LineClient, undefined, { QUOTA_MONTHLY_MESSAGES_MAX: '5000' },
    );
    expect(executed.filter((s) => s.includes(`SET status = 'sending'`))).toEqual([]);
  });

  test('a due send that fits within the remaining budget still goes out', async () => {
    const rows = [scheduledRow('sched-fit')];
    dbMocks.getBroadcasts.mockResolvedValue(rows);
    dbMocks.getBroadcastById.mockImplementation(async () => rows[0]);
    const state = { monthly: 100 };
    const client = {
      broadcast: vi.fn(async () => {
        state.monthly += 500;
        return { requestId: 'req-s' };
      }),
    };
    await processScheduledBroadcasts(
      makeScheduledDb(state), client as unknown as LineClient, undefined,
      { QUOTA_MONTHLY_MESSAGES_MAX: '5000' },
    );
    expect(client.broadcast).toHaveBeenCalledTimes(1);
  });

  test('no quotaEnv → every due broadcast sends as before', async () => {
    const rows = [scheduledRow('sched-1'), scheduledRow('sched-2')];
    dbMocks.getBroadcasts.mockResolvedValue(rows);
    dbMocks.getBroadcastById.mockImplementation(async (_db: unknown, id: string) =>
      rows.find((r) => r.id === id) ?? rows[0],
    );
    const state = { monthly: 0 };
    const client = {
      broadcast: vi.fn(async () => {
        state.monthly += 500;
        return { requestId: 'req-s' };
      }),
    };
    await processScheduledBroadcasts(makeScheduledDb(state), client as unknown as LineClient);
    expect(client.broadcast).toHaveBeenCalledTimes(2);
  });
});

describe('PUT /api/broadcasts/:id usage-record guard', () => {
  // status 'scheduled' passes the route's draft/scheduled edit gate, so these
  // tests exercise the usage-record lock itself (the same condition as the
  // DELETE guard), independent of the status check.
  const lockedRow = {
    id: '44444444-5555-4666-8777-888888888888',
    title: 'sent to everyone',
    message_type: 'text',
    message_content: 'hello',
    target_type: 'all',
    target_tag_id: null,
    status: 'scheduled',
    scheduled_at: null,
    sent_at: monthStartJst().slice(0, 8) + '15T10:00:00.000+09:00',
    total_count: 500,
    success_count: 500,
    created_at: '2026-08-11T12:00:00.000+09:00',
    account_ids: null,
    dedup_priority: null,
    failed_account_ids: null,
    dedup_progress: null,
    batch_lock_at: null,
    track_links: 0,
    line_account_id: null,
    alt_text: null,
    line_request_id: 'req-1',
  };

  function setupApp(quotaEnv: Record<string, string>) {
    const app = new Hono<{ Bindings: Record<string, unknown> }>();
    app.use('*', async (c, next) => {
      c.env = {
        DB: {
          prepare() {
            const stmt = {
              bind() { return stmt; },
              async run() { return { meta: { changes: 1 } }; },
              async first() { return null; },
              async all() { return { results: [] }; },
            };
            return stmt;
          },
        } as unknown as D1Database,
        ...quotaEnv,
      };
      await next();
    });
    app.route('/', broadcasts);
    return app;
  }

  function putRequest(id: string) {
    return { method: 'PUT' as const, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'renamed' }) };
  }

  test("monthly limit active: current-month sent 'all' record cannot be edited (edit clears the send markers)", async () => {
    dbMocks.getBroadcastById.mockResolvedValue(lockedRow);
    const res = await setupApp({ QUOTA_MONTHLY_MESSAGES_MAX: '5000' }).request(
      `/api/broadcasts/${lockedRow.id}`, putRequest(lockedRow.id),
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('usage_record_locked');
    expect(dbMocks.updateBroadcast).not.toHaveBeenCalled();
  });

  test('no monthly limit: the same row stays editable as before', async () => {
    dbMocks.getBroadcastById.mockResolvedValue(lockedRow);
    dbMocks.updateBroadcast.mockResolvedValue(lockedRow);
    const res = await setupApp({}).request(
      `/api/broadcasts/${lockedRow.id}`, putRequest(lockedRow.id),
    );
    expect(res.status).toBe(200);
    expect(dbMocks.updateBroadcast).toHaveBeenCalledTimes(1);
  });

  test("previous month's 'all' row is editable", async () => {
    dbMocks.getBroadcastById.mockResolvedValue({
      ...lockedRow, sent_at: '2020-01-15T10:00:00.000+09:00',
    });
    dbMocks.updateBroadcast.mockResolvedValue(lockedRow);
    const res = await setupApp({ QUOTA_MONTHLY_MESSAGES_MAX: '5000' }).request(
      `/api/broadcasts/${lockedRow.id}`, putRequest(lockedRow.id),
    );
    expect(res.status).toBe(200);
    expect(dbMocks.updateBroadcast).toHaveBeenCalledTimes(1);
  });

  test('multicast-path row (line_request_id NULL) is editable — its usage lives in messages_log', async () => {
    dbMocks.getBroadcastById.mockResolvedValue({ ...lockedRow, line_request_id: null });
    dbMocks.updateBroadcast.mockResolvedValue(lockedRow);
    const res = await setupApp({ QUOTA_MONTHLY_MESSAGES_MAX: '5000' }).request(
      `/api/broadcasts/${lockedRow.id}`, putRequest(lockedRow.id),
    );
    expect(res.status).toBe(200);
    expect(dbMocks.updateBroadcast).toHaveBeenCalledTimes(1);
  });
});

describe('DELETE /api/broadcasts/:id usage-record guard', () => {
  const baseRow = {
    id: '33333333-4444-4555-8666-777777777777',
    title: 'sent to everyone',
    message_type: 'text',
    message_content: 'hello',
    target_type: 'all',
    target_tag_id: null,
    status: 'sent',
    scheduled_at: null,
    sent_at: monthStartJst().slice(0, 8) + '15T10:00:00.000+09:00', // current JST month
    total_count: 500,
    success_count: 500,
    created_at: '2026-08-11T12:00:00.000+09:00',
    account_ids: null,
    dedup_priority: null,
    failed_account_ids: null,
    dedup_progress: null,
    batch_lock_at: null,
    track_links: 0,
    line_account_id: null,
    alt_text: null,
    line_request_id: 'req-1',
  };

  function setupApp(quotaEnv: Record<string, string>) {
    const app = new Hono<{ Bindings: Record<string, unknown> }>();
    app.use('*', async (c, next) => {
      c.env = { DB: {} as D1Database, ...quotaEnv };
      await next();
    });
    app.route('/', broadcasts);
    return app;
  }

  test("monthly limit active: current-month sent 'all' row cannot be deleted", async () => {
    dbMocks.getBroadcastById.mockResolvedValue(baseRow);
    const res = await setupApp({ QUOTA_MONTHLY_MESSAGES_MAX: '5000' }).request(
      `/api/broadcasts/${baseRow.id}`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(403);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('usage_record_locked');
    expect(dbMocks.deleteBroadcast).not.toHaveBeenCalled();
  });

  test('no monthly limit: deletion behaves exactly as before', async () => {
    dbMocks.getBroadcastById.mockResolvedValue(baseRow);
    const res = await setupApp({}).request(
      `/api/broadcasts/${baseRow.id}`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(200);
    expect(dbMocks.deleteBroadcast).toHaveBeenCalledTimes(1);
  });

  test("previous month's 'all' row is deletable (its usage no longer counts)", async () => {
    dbMocks.getBroadcastById.mockResolvedValue({
      ...baseRow,
      sent_at: '2020-01-15T10:00:00.000+09:00',
    });
    const res = await setupApp({ QUOTA_MONTHLY_MESSAGES_MAX: '5000' }).request(
      `/api/broadcasts/${baseRow.id}`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(200);
    expect(dbMocks.deleteBroadcast).toHaveBeenCalledTimes(1);
  });

  test('multicast-path row (line_request_id NULL) is deletable — its usage lives in messages_log', async () => {
    dbMocks.getBroadcastById.mockResolvedValue({ ...baseRow, line_request_id: null });
    const res = await setupApp({ QUOTA_MONTHLY_MESSAGES_MAX: '5000' }).request(
      `/api/broadcasts/${baseRow.id}`,
      { method: 'DELETE' },
    );
    expect(res.status).toBe(200);
    expect(dbMocks.deleteBroadcast).toHaveBeenCalledTimes(1);
  });
});
