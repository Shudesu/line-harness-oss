import { beforeEach, describe, expect, test, vi } from 'vitest';

const dbMocks = {
  getBroadcasts: vi.fn(),
  getBroadcastById: vi.fn(),
  getQueuedBroadcasts: vi.fn(),
  updateBroadcastStatus: vi.fn(),
  updateBroadcastBatchProgress: vi.fn(),
  getFriendsByTag: vi.fn(),
  jstNow: vi.fn(() => '2026-08-21T12:00:00.000'),
  updateBroadcastLineRequestId: vi.fn(),
  createBroadcastInsight: vi.fn(),
  getLineAccountById: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);
// No real delays in tests: neutralize stealth pacing between batches.
vi.mock('./stealth.js', () => ({
  calculateStaggerDelay: () => 0,
  sleep: async () => {},
  addMessageVariation: (text: string) => text,
  jitterDeliveryTime: (t: string) => t,
  addJitter: () => 0,
}));

const { processQueuedBroadcasts } = await import('./broadcast.js');

type LineClient = import('@line-crm/line-sdk').LineClient;

const queuedRow = {
  id: 'bc-queued-1',
  title: 'queued send',
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
  batch_offset: 0,
  track_links: 0,
  line_account_id: null,
  alt_text: null,
  segment_conditions: JSON.stringify({ operator: 'AND', rules: [{ type: 'is_following', value: true }] }),
};

/**
 * DB stub for the queued batch loop: serves the segment friend list, answers
 * quota COUNTs from a live "rows logged so far" counter (so usage grows as
 * batches are sent), and accepts every raw UPDATE (lock claim succeeds).
 */
function makeBatchDb(friendTotal: number, baseLogged = 0) {
  const friends = Array.from({ length: friendTotal }, (_, i) => ({
    id: `f-${i}`,
    line_user_id: `U${i}`,
    display_name: `friend ${i}`,
  }));
  const state = { logged: baseLogged };
  const db = {
    prepare(sql: string) {
      const stmt = {
        bind() { return stmt; },
        async first() {
          if (sql.includes('FROM messages_log')) return { count: state.logged };
          if (sql.includes('FROM broadcasts')) return { count: 0 };
          if (sql.includes('FROM friends')) return { count: friendTotal };
          return null;
        },
        async all() {
          if (sql.includes('line_user_id')) return { results: friends };
          return { results: [] };
        },
        async run() { return { meta: { changes: 1 } }; },
      };
      return stmt;
    },
    async batch(stmts: unknown[]) {
      state.logged += stmts.length;
      return [];
    },
  };
  return { db: db as unknown as D1Database, state };
}

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockClear();
  dbMocks.getQueuedBroadcasts.mockResolvedValue([queuedRow]);
});

describe('queued batch loop quota re-check', () => {
  test('crossing the limit mid-run stops after the current batch (bounded overshoot)', async () => {
    // 600 recipients = 2 multicast batches (500 + 100). Limit 400: the run
    // starts under the limit, batch 1 pushes usage to 500, so batch 2 must
    // not be sent; progress is persisted for the next tick instead.
    const { db, state } = makeBatchDb(600);
    const client = { multicast: vi.fn(async () => ({})), broadcast: vi.fn() };

    await processQueuedBroadcasts(db, client as unknown as LineClient, undefined, {
      QUOTA_MONTHLY_MESSAGES_MAX: '400',
    });

    expect(client.multicast).toHaveBeenCalledTimes(1);
    expect(state.logged).toBe(500);
    expect(dbMocks.updateBroadcastBatchProgress).toHaveBeenCalledWith(
      expect.anything(), queuedRow.id, 500, 0,
    );
    expect(dbMocks.updateBroadcastStatus).not.toHaveBeenCalled();
  });

  test('no quotaEnv → all batches send and the broadcast completes', async () => {
    const { db, state } = makeBatchDb(600);
    const client = { multicast: vi.fn(async () => ({})), broadcast: vi.fn() };

    await processQueuedBroadcasts(db, client as unknown as LineClient, undefined);

    expect(client.multicast).toHaveBeenCalledTimes(2);
    expect(state.logged).toBe(600);
    expect(dbMocks.updateBroadcastStatus).toHaveBeenCalledWith(
      expect.anything(), queuedRow.id, 'sent',
    );
  });

  test('over quota + everything already sent → finalization still completes the row', async () => {
    // Crash-after-last-batch shape: batch_offset equals the audience size,
    // status still 'sending'. While over the limit no sends may go out, but
    // pure finalization must run or the row sits in 'sending' until the
    // month rolls over.
    dbMocks.getQueuedBroadcasts.mockResolvedValue([{ ...queuedRow, batch_offset: 600 }]);
    const { db } = makeBatchDb(600, 500); // 500 logged of limit 400 → exceeded
    const client = { multicast: vi.fn(async () => ({})), broadcast: vi.fn() };

    await processQueuedBroadcasts(db, client as unknown as LineClient, undefined, {
      QUOTA_MONTHLY_MESSAGES_MAX: '400',
    });

    expect(client.multicast).not.toHaveBeenCalled();
    expect(client.broadcast).not.toHaveBeenCalled();
    expect(dbMocks.updateBroadcastStatus).toHaveBeenCalledWith(
      expect.anything(), queuedRow.id, 'sent',
    );
  });

  test('over quota + fresh row (nothing sent) → skipped before the claim, no sends', async () => {
    dbMocks.getQueuedBroadcasts.mockResolvedValue([{ ...queuedRow, batch_offset: 0 }]);
    const { db, state } = makeBatchDb(600, 500);
    const client = { multicast: vi.fn(async () => ({})), broadcast: vi.fn() };

    await processQueuedBroadcasts(db, client as unknown as LineClient, undefined, {
      QUOTA_MONTHLY_MESSAGES_MAX: '400',
    });

    expect(client.multicast).not.toHaveBeenCalled();
    expect(state.logged).toBe(500); // nothing new recorded
    expect(dbMocks.updateBroadcastStatus).not.toHaveBeenCalled();
  });

  test('over quota + unsent recipients remaining mid-run → yields without sending', async () => {
    dbMocks.getQueuedBroadcasts.mockResolvedValue([{ ...queuedRow, batch_offset: 500 }]);
    const { db } = makeBatchDb(600, 500);
    const client = { multicast: vi.fn(async () => ({})), broadcast: vi.fn() };

    await processQueuedBroadcasts(db, client as unknown as LineClient, undefined, {
      QUOTA_MONTHLY_MESSAGES_MAX: '400',
    });

    expect(client.multicast).not.toHaveBeenCalled();
    // Claimed, then the between-batch gate released the lock with progress
    // intact for the next tick.
    expect(dbMocks.updateBroadcastBatchProgress).toHaveBeenCalledWith(
      expect.anything(), queuedRow.id, 500, 0,
    );
    expect(dbMocks.updateBroadcastStatus).not.toHaveBeenCalled();
  });

  test('under the limit for the whole run → completes normally', async () => {
    const { db } = makeBatchDb(600);
    const client = { multicast: vi.fn(async () => ({})), broadcast: vi.fn() };

    await processQueuedBroadcasts(db, client as unknown as LineClient, undefined, {
      QUOTA_MONTHLY_MESSAGES_MAX: '10000',
    });

    expect(client.multicast).toHaveBeenCalledTimes(2);
    expect(dbMocks.updateBroadcastStatus).toHaveBeenCalledWith(
      expect.anything(), queuedRow.id, 'sent',
    );
  });
});
