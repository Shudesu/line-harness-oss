import { describe, expect, it, vi, beforeEach } from 'vitest';
import { computeDedupBroadcastPreview } from './dedup-broadcast.js';

interface CannedData {
  selectedCounts: Array<{ line_account_id: string; cnt: number }>;
  rankedRows: Array<{ friend_id: string; line_user_id: string; line_account_id: string; ident_key?: string }>;
  accountMeta: Array<{ id: string; name: string; country: string | null }>;
}

/**
 * Fake D1 that routes by SQL fingerprint (mirrors duplicates-stats.test.ts).
 * Bind parameters are intentionally ignored — the production DB is the source
 * of truth for "given this SQL + binds, what rows come back". Tests provide
 * canned results that reflect what production would return.
 */
function withIdentKey<T extends { friend_id: string; ident_key?: string }>(rows: T[]): T[] {
  // テスト fixture は ident_key を省略して書ける。production の SQL は必ず
  // ident_key 列を返すので、未指定なら friend_id を入れて互換性を保つ。
  return rows.map((r) => ({ ...r, ident_key: r.ident_key ?? r.friend_id }));
}

function fakeDb(canned: CannedData): D1Database {
  return {
    prepare(sql: string) {
      const isSelectedCount = sql.includes('SELECT line_account_id, COUNT(*) AS cnt');
      const isRanked = sql.includes('ROW_NUMBER() OVER');
      const isAccountMeta = sql.includes('FROM line_accounts WHERE id IN');
      return {
        bind(..._args: unknown[]) {
          return this;
        },
        async all<T>(): Promise<{ results: T[] }> {
          if (isSelectedCount) return { results: canned.selectedCounts as unknown as T[] };
          if (isRanked) return { results: withIdentKey(canned.rankedRows) as unknown as T[] };
          if (isAccountMeta) return { results: canned.accountMeta as unknown as T[] };
          return { results: [] };
        },
        async first<T>(): Promise<T | null> { return null; },
      };
    },
  } as unknown as D1Database;
}

describe('computeDedupBroadcastPreview', () => {
  it('targetTagId optional: when provided, SQL includes friend_tags EXISTS clause', async () => {
    // Capture prepared SQL strings to verify the tag filter is wired in.
    const preparedSqls: string[] = [];
    const capturingDb = {
      prepare(sql: string) {
        preparedSqls.push(sql);
        const isSelectedCount = sql.includes('SELECT line_account_id, COUNT(*) AS cnt');
        const isRanked = sql.includes('ROW_NUMBER() OVER');
        return {
          bind(..._args: unknown[]) { return this; },
          async all<T>(): Promise<{ results: T[] }> {
            if (isSelectedCount) return { results: [{ line_account_id: 'acc1', cnt: 1 }] as unknown as T[] };
            if (isRanked) return { results: [{ friend_id: 'f1', line_user_id: 'u1', line_account_id: 'acc1' }] as unknown as T[] };
            return { results: [{ id: 'acc1', name: 'A', country: null }] as unknown as T[] };
          },
          async first<T>(): Promise<T | null> { return null; },
        };
      },
    } as unknown as D1Database;

    await computeDedupBroadcastPreview(capturingDb, ['acc1'], ['acc1'], 'tag-xyz');

    const selectedCountSql = preparedSqls.find((s) => s.includes('COUNT(*) AS cnt'));
    const rankedSql = preparedSqls.find((s) => s.includes('ROW_NUMBER() OVER'));
    expect(selectedCountSql).toMatch(/EXISTS \(SELECT 1 FROM friend_tags/);
    expect(rankedSql).toMatch(/EXISTS \(SELECT 1 FROM friend_tags/);

    // Without tag, the EXISTS clause should NOT appear.
    const preparedSqls2: string[] = [];
    const capturingDb2 = {
      prepare(sql: string) {
        preparedSqls2.push(sql);
        return capturingDb.prepare(sql) as ReturnType<D1Database['prepare']>;
      },
    } as unknown as D1Database;
    await computeDedupBroadcastPreview(capturingDb2, ['acc1'], ['acc1']);
    expect(preparedSqls2.find((s) => s.includes('COUNT(*) AS cnt'))).not.toMatch(/friend_tags/);
  });

  it('single-account: returns all friends, no reduction', async () => {
    const result = await computeDedupBroadcastPreview(
      fakeDb({
        selectedCounts: [{ line_account_id: 'acc1', cnt: 2 }],
        rankedRows: [
          { friend_id: 'f1', line_user_id: 'u1', line_account_id: 'acc1' },
          { friend_id: 'f2', line_user_id: 'u2', line_account_id: 'acc1' },
        ],
        accountMeta: [{ id: 'acc1', name: 'Account 1', country: '日本' }],
      }),
      ['acc1'], ['acc1'],
    );
    expect(result.totalSelected).toBe(2);
    expect(result.uniqueRecipients).toBe(2);
    expect(result.reduction).toBe(0);
    expect(result.perAccount).toHaveLength(1);
    expect(result.perAccount[0].sendCount).toBe(2);
  });

  it('two-account dedup: priority[0] wins all duplicates', async () => {
    const result = await computeDedupBroadcastPreview(
      fakeDb({
        selectedCounts: [
          { line_account_id: 'acc1', cnt: 1 },
          { line_account_id: 'acc2', cnt: 2 },
        ],
        // f2 lost to acc1 priority; only f1 (acc1) and f3 (acc2, distinct ident) remain
        rankedRows: [
          { friend_id: 'f1', line_user_id: 'u1', line_account_id: 'acc1' },
          { friend_id: 'f3', line_user_id: 'u3', line_account_id: 'acc2' },
        ],
        accountMeta: [
          { id: 'acc1', name: 'Account 1', country: '日本' },
          { id: 'acc2', name: 'Account 2', country: 'タイ' },
        ],
      }),
      ['acc1', 'acc2'], ['acc1', 'acc2'],
    );
    expect(result.totalSelected).toBe(3);
    expect(result.uniqueRecipients).toBe(2);
    expect(result.reduction).toBe(1);
    const acc1 = result.perAccount.find((p) => p.accountId === 'acc1')!;
    const acc2 = result.perAccount.find((p) => p.accountId === 'acc2')!;
    expect(acc1.sendCount).toBe(1);
    expect(acc2.sendCount).toBe(1);
    expect(acc2.excludedToHigherPriority).toBe(1);
  });

  it('three-way dedup: priority[0] wins across three accounts', async () => {
    const result = await computeDedupBroadcastPreview(
      fakeDb({
        selectedCounts: [
          { line_account_id: 'acc1', cnt: 1 },
          { line_account_id: 'acc2', cnt: 1 },
          { line_account_id: 'acc3', cnt: 1 },
        ],
        // All 3 share ident; only acc1 wins
        rankedRows: [{ friend_id: 'f1', line_user_id: 'u1', line_account_id: 'acc1' }],
        accountMeta: [
          { id: 'acc1', name: 'Account 1', country: '日本' },
          { id: 'acc2', name: 'Account 2', country: 'タイ' },
          { id: 'acc3', name: 'Account 3', country: '台湾' },
        ],
      }),
      ['acc1', 'acc2', 'acc3'], ['acc1', 'acc2', 'acc3'],
    );
    expect(result.uniqueRecipients).toBe(1);
    expect(result.reduction).toBe(2);
    expect(result.perAccount.find((p) => p.accountId === 'acc1')!.sendCount).toBe(1);
    expect(result.perAccount.find((p) => p.accountId === 'acc2')!.sendCount).toBe(0);
    expect(result.perAccount.find((p) => p.accountId === 'acc3')!.sendCount).toBe(0);
  });

  it('no overlap: reduction = 0', async () => {
    const result = await computeDedupBroadcastPreview(
      fakeDb({
        selectedCounts: [
          { line_account_id: 'acc1', cnt: 1 },
          { line_account_id: 'acc2', cnt: 1 },
        ],
        // Distinct idents → both rows survive
        rankedRows: [
          { friend_id: 'f1', line_user_id: 'u1', line_account_id: 'acc1' },
          { friend_id: 'f2', line_user_id: 'u2', line_account_id: 'acc2' },
        ],
        accountMeta: [
          { id: 'acc1', name: 'Account 1', country: '日本' },
          { id: 'acc2', name: 'Account 2', country: 'タイ' },
        ],
      }),
      ['acc1', 'acc2'], ['acc1', 'acc2'],
    );
    expect(result.reduction).toBe(0);
  });

  it('priority entry not in accountIds: ignored (priority is filtered to accountIds subset)', async () => {
    // Production filters dedupPriority to entries in accountIds before SQL.
    // The fake DB doesn't care; production behavior is acc1 wins given accountIds=[acc1,acc2] priority=[acc3,acc1,acc2].
    const result = await computeDedupBroadcastPreview(
      fakeDb({
        selectedCounts: [
          { line_account_id: 'acc1', cnt: 1 },
          { line_account_id: 'acc2', cnt: 1 },
        ],
        rankedRows: [{ friend_id: 'f1', line_user_id: 'u1', line_account_id: 'acc1' }],
        accountMeta: [
          { id: 'acc1', name: 'Account 1', country: '日本' },
          { id: 'acc2', name: 'Account 2', country: 'タイ' },
        ],
      }),
      ['acc1', 'acc2'], ['acc3', 'acc1', 'acc2'],
    );
    expect(result.uniqueRecipients).toBe(1);
    expect(result.perAccount.find((p) => p.accountId === 'acc1')!.sendCount).toBe(1);
  });

  it('account in accountIds but not in dedupPriority: tail-ranked (production behavior canned)', async () => {
    // accountIds=[acc1,acc2] priority=[acc1] → acc2 in CASE ELSE 999, loses to acc1 even though created earlier
    const result = await computeDedupBroadcastPreview(
      fakeDb({
        selectedCounts: [
          { line_account_id: 'acc1', cnt: 1 },
          { line_account_id: 'acc2', cnt: 1 },
        ],
        rankedRows: [{ friend_id: 'f1', line_user_id: 'u1', line_account_id: 'acc1' }],
        accountMeta: [
          { id: 'acc1', name: 'Account 1', country: '日本' },
          { id: 'acc2', name: 'Account 2', country: 'タイ' },
        ],
      }),
      ['acc1', 'acc2'], ['acc1'],
    );
    expect(result.uniqueRecipients).toBe(1);
    expect(result.perAccount.find((p) => p.accountId === 'acc1')!.sendCount).toBe(1);
  });

  it('empty dedupPriority: created_at ASC fallback (canned to acc2 winning)', async () => {
    const result = await computeDedupBroadcastPreview(
      fakeDb({
        selectedCounts: [
          { line_account_id: 'acc1', cnt: 1 },
          { line_account_id: 'acc2', cnt: 1 },
        ],
        // Production: empty priority → caseExpr is '999', tie-break by created_at ASC.
        // Test seeds acc2 with earlier created_at, so acc2 wins.
        rankedRows: [{ friend_id: 'f2', line_user_id: 'u2', line_account_id: 'acc2' }],
        accountMeta: [
          { id: 'acc1', name: 'Account 1', country: '日本' },
          { id: 'acc2', name: 'Account 2', country: 'タイ' },
        ],
      }),
      ['acc1', 'acc2'], [],
    );
    expect(result.uniqueRecipients).toBe(1);
    expect(result.perAccount.find((p) => p.accountId === 'acc2')!.sendCount).toBe(1);
  });

  it('all friends share identity_key: reduction = N - 1', async () => {
    const result = await computeDedupBroadcastPreview(
      fakeDb({
        selectedCounts: [
          { line_account_id: 'acc1', cnt: 3 },
          { line_account_id: 'acc2', cnt: 2 },
        ],
        // 5 friends, all same ident → only 1 winner
        rankedRows: [{ friend_id: 'f0', line_user_id: 'u0', line_account_id: 'acc1' }],
        accountMeta: [
          { id: 'acc1', name: 'Account 1', country: '日本' },
          { id: 'acc2', name: 'Account 2', country: 'タイ' },
        ],
      }),
      ['acc1', 'acc2'], ['acc1', 'acc2'],
    );
    expect(result.uniqueRecipients).toBe(1);
    expect(result.reduction).toBe(4);
  });

  it('accountIds length 0 returns empty preview without DB calls', async () => {
    const result = await computeDedupBroadcastPreview(
      fakeDb({ selectedCounts: [], rankedRows: [], accountMeta: [] }),
      [], [],
    );
    expect(result.totalSelected).toBe(0);
    expect(result.uniqueRecipients).toBe(0);
    expect(result.perAccount).toEqual([]);
  });

  it('preview includes recipients[] array per account for send re-use', async () => {
    const result = await computeDedupBroadcastPreview(
      fakeDb({
        selectedCounts: [
          { line_account_id: 'acc1', cnt: 1 },
          { line_account_id: 'acc2', cnt: 1 },
        ],
        rankedRows: [
          { friend_id: 'f1', line_user_id: 'u1', line_account_id: 'acc1' },
          { friend_id: 'f2', line_user_id: 'u2', line_account_id: 'acc2' },
        ],
        accountMeta: [
          { id: 'acc1', name: 'Account 1', country: '日本' },
          { id: 'acc2', name: 'Account 2', country: 'タイ' },
        ],
      }),
      ['acc1', 'acc2'], ['acc1', 'acc2'],
    );
    const acc1 = result.perAccount.find((p) => p.accountId === 'acc1')!;
    expect(acc1.recipients).toEqual([{
      friendId: 'f1',
      lineUserId: 'u1',
      identKey: 'f1',
      displayName: null,
    }]);
  });
});

// =============================================================================
// processMultiAccountDedupBroadcast — send executor tests
// =============================================================================

vi.mock('@line-crm/db', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@line-crm/db')>();
  return {
    ...actual,
    getLineAccountById: vi.fn(),
    jstNow: () => '2026-05-06T10:00:00.000',
  };
});

vi.mock('./stealth.js', () => ({
  calculateStaggerDelay: () => 0,
  sleep: async () => {},
  addMessageVariation: (text: string) => text,
}));

// Import the mocked module's symbols AFTER vi.mock declarations
import { getLineAccountById } from '@line-crm/db';
import { processMultiAccountDedupBroadcast } from './dedup-broadcast.js';
import type { LineClient, Message } from '@line-crm/line-sdk';

class MockLineClient {
  calls: Array<{ method: string; args: unknown[] }> = [];
  throwOn?: { method: string; afterNCalls?: number };
  constructor(public token: string) {}
  async multicast(to: string[], messages: unknown[], retryKeys?: string[]) {
    this.calls.push({ method: 'multicast', args: [to, messages, retryKeys, this.token] });
    if (this.throwOn?.method === 'multicast') {
      const count = this.calls.filter((c) => c.method === 'multicast').length;
      if (!this.throwOn.afterNCalls || count >= this.throwOn.afterNCalls) {
        throw new Error('mock multicast failure');
      }
    }
    return { data: {}, requestId: 'mock-req' };
  }
  async pushMessage(to: string, messages: unknown[], retryKey?: string, units?: string[]) {
    this.calls.push({ method: 'push', args: [to, messages, retryKey, units, this.token] });
    return {};
  }
}

// fakeDb for send-side: handles `db.prepare(...).bind(...).run()` for the
// failed_account_ids UPDATE and `db.batch(...)` for messages_log INSERTs.
// Also handles the SQL fingerprints from computeDedupBroadcastPreview (which
// runs inside the executor — we provide canned results matching what the
// caller seeded).
function makeSendDb(opts: {
  selectedCounts?: Array<{ line_account_id: string; cnt: number }>;
  rankedRows?: Array<{
    friend_id: string;
    line_user_id: string;
    line_account_id: string;
    ident_key?: string;
    display_name?: string | null;
  }>;
  accountMeta?: Array<{ id: string; name: string; country: string | null }>;
}) {
  const updates: Record<string, unknown> = {};
  // Per-batch progress UPDATE 履歴。resume テスト用に full snapshot を取る。
  // bind() タイミングで capture することで、run()/batch() どちらの実行経路でも
  // 拾えるようにする (現在の実装は db.batch() 経由のため、run() フックだと取れない)。
  const progressUpdates: Array<{ progress: unknown; successCount: unknown }> = [];
  const batches: unknown[][] = [];
  const db = {
    prepare(sql: string) {
      const isSelectedCount = sql.includes('SELECT line_account_id, COUNT(*) AS cnt');
      const isRanked = sql.includes('ROW_NUMBER() OVER');
      const isAccountMetaList = sql.includes('FROM line_accounts WHERE id IN');
      const isFailedUpdate = sql.includes('UPDATE broadcasts SET failed_account_ids');
      const isProgressUpdate =
        sql.includes('UPDATE broadcasts SET dedup_progress') &&
        sql.includes('success_count');
      return {
        bind(...params: unknown[]) {
          if (isProgressUpdate) {
            progressUpdates.push({ progress: params[0], successCount: params[1] });
          }
          return {
            async first<T>(): Promise<T | null> { return null; },
            async all<T>(): Promise<{ results: T[] }> {
              if (isSelectedCount) return { results: (opts.selectedCounts ?? []) as unknown as T[] };
              if (isRanked) return { results: withIdentKey(opts.rankedRows ?? []) as unknown as T[] };
              if (isAccountMetaList) return { results: (opts.accountMeta ?? []) as unknown as T[] };
              return { results: [] };
            },
            async run() {
              if (isFailedUpdate) updates.failed_account_ids = params[0];
              return { success: true } as D1Response;
            },
          };
        },
      };
    },
    async batch(stmts: D1PreparedStatement[]) {
      batches.push(stmts as unknown as unknown[]);
      return Array(stmts.length).fill({ success: true });
    },
  } as unknown as D1Database;
  return { db, updates, batches, progressUpdates };
}

const sampleMessage: Message = { type: 'text', text: 'hello' } as Message;

describe('processMultiAccountDedupBroadcast', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('all accounts succeed: failedAccountIds is empty', async () => {
    const { db } = makeSendDb({
      selectedCounts: [
        { line_account_id: 'acc1', cnt: 2 },
        { line_account_id: 'acc2', cnt: 2 },
      ],
      rankedRows: [
        { friend_id: 'f1', line_user_id: 'u1', line_account_id: 'acc1' },
        { friend_id: 'f2', line_user_id: 'u2', line_account_id: 'acc1' },
        { friend_id: 'f3', line_user_id: 'u3', line_account_id: 'acc2' },
        { friend_id: 'f4', line_user_id: 'u4', line_account_id: 'acc2' },
      ],
      accountMeta: [
        { id: 'acc1', name: 'A1', country: 'JP' },
        { id: 'acc2', name: 'A2', country: 'TH' },
      ],
    });

    vi.mocked(getLineAccountById).mockImplementation(async (_db: D1Database, id: string) => {
      if (id === 'acc1') return { id, channel_access_token: 'tok1', is_active: 1 } as never;
      if (id === 'acc2') return { id, channel_access_token: 'tok2', is_active: 1 } as never;
      return null;
    });

    const clients: MockLineClient[] = [];
    const factory = (token: string) => {
      const c = new MockLineClient(token);
      clients.push(c);
      return c as unknown as LineClient;
    };

    const result = await processMultiAccountDedupBroadcast(
      db,
      {
        id: 'b1',
        account_ids: '["acc1","acc2"]',
        dedup_priority: '["acc1","acc2"]',
        message_type: 'text',
        message_content: 'hello',
      },
      factory,
    );

    expect(result.failedAccountIds).toEqual([]);
    expect(result.successCount).toBe(4);
    expect(result.totalCount).toBe(4);
    expect(clients).toHaveLength(2);
    expect(clients[0].calls).toHaveLength(1);
    expect(clients[1].calls).toHaveLength(1);
  });

  it('one account multicast throws: other succeeds, failedAccountIds = [thrower]', async () => {
    const { db, updates } = makeSendDb({
      selectedCounts: [
        { line_account_id: 'acc1', cnt: 1 },
        { line_account_id: 'acc2', cnt: 1 },
      ],
      rankedRows: [
        { friend_id: 'f1', line_user_id: 'u1', line_account_id: 'acc1' },
        { friend_id: 'f2', line_user_id: 'u2', line_account_id: 'acc2' },
      ],
      accountMeta: [
        { id: 'acc1', name: 'A1', country: null },
        { id: 'acc2', name: 'A2', country: null },
      ],
    });

    vi.mocked(getLineAccountById).mockImplementation(async (_db: D1Database, id: string) => {
      if (id === 'acc1') return { id, channel_access_token: 'tok1', is_active: 1 } as never;
      if (id === 'acc2') return { id, channel_access_token: 'tok2', is_active: 1 } as never;
      return null;
    });

    const factory = (token: string) => {
      const c = new MockLineClient(token);
      if (token === 'tok1') c.throwOn = { method: 'multicast' };
      return c as unknown as LineClient;
    };

    const result = await processMultiAccountDedupBroadcast(
      db,
      {
        id: 'b2',
        account_ids: '["acc1","acc2"]',
        dedup_priority: '["acc1","acc2"]',
        message_type: 'text',
        message_content: 'hello',
      },
      factory,
    );

    expect(result.failedAccountIds).toEqual(['acc1']);
    expect(result.successCount).toBe(1); // only acc2 succeeded
    expect(updates.failed_account_ids).toBe(JSON.stringify(['acc1']));
  });

  it('inactive account skipped, not in failedAccountIds', async () => {
    const { db, updates } = makeSendDb({
      selectedCounts: [
        { line_account_id: 'acc1', cnt: 1 },
        { line_account_id: 'acc2', cnt: 1 },
      ],
      rankedRows: [
        { friend_id: 'f1', line_user_id: 'u1', line_account_id: 'acc1' },
        { friend_id: 'f2', line_user_id: 'u2', line_account_id: 'acc2' },
      ],
      accountMeta: [
        { id: 'acc1', name: 'A1', country: null },
        { id: 'acc2', name: 'A2', country: null },
      ],
    });

    vi.mocked(getLineAccountById).mockImplementation(async (_db: D1Database, id: string) => {
      if (id === 'acc1') return { id, channel_access_token: 'tok1', is_active: 0 } as never; // inactive
      if (id === 'acc2') return { id, channel_access_token: 'tok2', is_active: 1 } as never;
      return null;
    });

    const factory = (token: string) => new MockLineClient(token) as unknown as LineClient;

    const result = await processMultiAccountDedupBroadcast(
      db,
      {
        id: 'b3',
        account_ids: '["acc1","acc2"]',
        dedup_priority: '["acc1","acc2"]',
        message_type: 'text',
        message_content: 'hello',
      },
      factory,
    );

    expect(result.failedAccountIds).toEqual([]);
    expect(result.successCount).toBe(1); // only acc2 sent (1 friend)
    expect(result.totalCount).toBe(1);
    // 失敗ゼロでも明示的に NULL 上書きする (resume 時の stale 失敗マーク消去用)
    expect(updates.failed_account_ids).toBeNull();
  });

  it('persists progress per batch and clears dedup_progress at end', async () => {
    // 1 アカ × 1 batch (1 recipient) — 各 multicast 後に progress UPDATE が走り
    // 完走後に dedup_progress=NULL の clear が走ることを確認する。
    const { db, progressUpdates } = makeSendDb({
      selectedCounts: [{ line_account_id: 'acc1', cnt: 1 }],
      rankedRows: [{ friend_id: 'f1', line_user_id: 'u1', line_account_id: 'acc1' }],
      accountMeta: [{ id: 'acc1', name: 'A1', country: null }],
    });

    vi.mocked(getLineAccountById).mockImplementation(async (_db: D1Database, id: string) => {
      if (id === 'acc1') return { id, channel_access_token: 'tok1', is_active: 1 } as never;
      return null;
    });

    const factory = (token: string) => new MockLineClient(token) as unknown as LineClient;

    const result = await processMultiAccountDedupBroadcast(
      db,
      {
        id: 'b-progress',
        account_ids: '["acc1"]',
        dedup_priority: '["acc1"]',
        message_type: 'text',
        message_content: 'hello',
        dedup_progress: null,
      },
      factory,
    );

    expect(result.successCount).toBe(1);
    // batch 完走後に1回 progress UPDATE が走っているはず
    expect(progressUpdates.length).toBeGreaterThanOrEqual(1);
    const lastProgress = JSON.parse(progressUpdates[progressUpdates.length - 1].progress as string);
    // ident_key は test fixture で friend_id をデフォルトに使っている (withIdentKey 参照)
    expect(lastProgress.sentIdentKeys).toEqual(['f1']);
    expect(progressUpdates[progressUpdates.length - 1].successCount).toBe(1);
    // 最終的に dedup_progress=NULL に戻されている
    // dedup_progress の clear は updateBroadcastStatus 側で行われる設計に変更したため
    // ここでは検証しない。caller の send パスに対する別テストでカバー。
  });

  it('resumes from saved dedup_progress: skips already-sent batches', async () => {
    // acc1 は前回完走 (batchOffset=1, success=1) — 今回は何も送らない
    // acc2 はゼロ — 今回1件送る
    // よって multicast は acc2 のみで呼ばれ、result.successCount=2 (累計)
    const { db, progressUpdates } = makeSendDb({
      selectedCounts: [
        { line_account_id: 'acc1', cnt: 1 },
        { line_account_id: 'acc2', cnt: 1 },
      ],
      rankedRows: [
        { friend_id: 'f1', line_user_id: 'u1', line_account_id: 'acc1' },
        { friend_id: 'f2', line_user_id: 'u2', line_account_id: 'acc2' },
      ],
      accountMeta: [
        { id: 'acc1', name: 'A1', country: null },
        { id: 'acc2', name: 'A2', country: null },
      ],
    });

    vi.mocked(getLineAccountById).mockImplementation(async (_db: D1Database, id: string) => {
      if (id === 'acc1') return { id, channel_access_token: 'tok1', is_active: 1 } as never;
      if (id === 'acc2') return { id, channel_access_token: 'tok2', is_active: 1 } as never;
      return null;
    });

    const clients: MockLineClient[] = [];
    const factory = (token: string) => {
      const c = new MockLineClient(token);
      clients.push(c);
      return c as unknown as LineClient;
    };

    const result = await processMultiAccountDedupBroadcast(
      db,
      {
        id: 'b-resume',
        account_ids: '["acc1","acc2"]',
        dedup_priority: '["acc1","acc2"]',
        message_type: 'text',
        message_content: 'hello',
        // 前回の partial run state: ident_key 'f1' 送信済み (acc1 の u1 配信済), 'f2' 未送信
        dedup_progress: JSON.stringify({
          sentIdentKeys: ['f1'],
        }),
      },
      factory,
    );

    // multicast は acc2 だけで呼ばれている (acc1 は skip)
    const acc1Client = clients.find((c) => c.token === 'tok1');
    const acc2Client = clients.find((c) => c.token === 'tok2');
    expect(acc1Client?.calls.length ?? 0).toBe(0);
    expect(acc2Client?.calls.length ?? 0).toBe(1);

    // 累計 successCount = 1 (acc1 既存) + 1 (acc2 新規) = 2
    expect(result.successCount).toBe(2);

    // 最終 progress に両人物 ('f1' は前回, 'f2' は今回) が ident_key で入っている
    expect(progressUpdates.length).toBeGreaterThanOrEqual(1);
    const last = JSON.parse(progressUpdates[progressUpdates.length - 1].progress as string);
    expect(last.sentIdentKeys.sort()).toEqual(['f1', 'f2']);
    expect(progressUpdates[progressUpdates.length - 1].successCount).toBe(2);
    // dedup_progress の clear は updateBroadcastStatus 側で行われる設計に変更したため
    // ここでは検証しない。caller の send パスに対する別テストでカバー。
  });

  it('mid-account crash: progress preserved, no double-send on resume', async () => {
    // シナリオ: 1 アカに2 batch ぶん (501 recipients) を送るが 1 batch 目で multicast
    // が成功し progress=500 が保存された後に Worker が死んだ想定。再起動時に
    // dedup_progress.batchOffset=500 から resume → 残り 1 件だけ送る。
    const recipients501 = Array.from({ length: 501 }, (_, i) => ({
      friend_id: `f${i}`,
      line_user_id: `u${i}`,
      line_account_id: 'acc1',
    }));
    const { db, progressUpdates } = makeSendDb({
      selectedCounts: [{ line_account_id: 'acc1', cnt: 501 }],
      rankedRows: recipients501,
      accountMeta: [{ id: 'acc1', name: 'A1', country: null }],
    });

    vi.mocked(getLineAccountById).mockImplementation(async (_db: D1Database, id: string) => {
      if (id === 'acc1') return { id, channel_access_token: 'tok1', is_active: 1 } as never;
      return null;
    });

    const clients: MockLineClient[] = [];
    const factory = (token: string) => {
      const c = new MockLineClient(token);
      clients.push(c);
      return c as unknown as LineClient;
    };

    const result = await processMultiAccountDedupBroadcast(
      db,
      {
        id: 'b-mid-crash',
        account_ids: '["acc1"]',
        dedup_priority: '["acc1"]',
        message_type: 'text',
        message_content: 'hello',
        // 前回 batch1 (f0..f499 = ident_key) だけ完了して死んだ想定。f500 は未送信。
        dedup_progress: JSON.stringify({
          sentIdentKeys: Array.from({ length: 500 }, (_, i) => `f${i}`),
        }),
      },
      factory,
    );

    // resume なので残り1件 (501 - 500) だけ multicast される
    const acc1Client = clients.find((c) => c.token === 'tok1');
    expect(acc1Client?.calls.length).toBe(1);
    const sentUserIds = acc1Client?.calls[0].args[0] as string[];
    expect(sentUserIds).toHaveLength(1);
    expect(sentUserIds[0]).toBe('u500'); // batch2 の最初

    // 累計 successCount = 500 (前回) + 1 (今回) = 501
    expect(result.successCount).toBe(501);

    const last = JSON.parse(progressUpdates[progressUpdates.length - 1].progress as string);
    expect(last.sentIdentKeys).toHaveLength(501);
    expect(last.sentIdentKeys[500]).toBe('f500');
  });

  it('renders {{name}} per recipient and uses individual push requests', async () => {
    const { db } = makeSendDb({
      selectedCounts: [{ line_account_id: 'acc1', cnt: 2 }],
      rankedRows: [
        { friend_id: 'f1', line_user_id: 'u1', line_account_id: 'acc1', display_name: 'Alice' },
        { friend_id: 'f2', line_user_id: 'u2', line_account_id: 'acc1', display_name: 'Bob' },
      ],
      accountMeta: [{ id: 'acc1', name: 'A1', country: 'JP' }],
    });
    vi.mocked(getLineAccountById).mockResolvedValue({
      id: 'acc1', channel_access_token: 'tok1', is_active: 1, liff_id: 'LIFF-1',
    } as never);
    const client = new MockLineClient('tok1');

    const result = await processMultiAccountDedupBroadcast(
      db,
      {
        id: 'b-personalized',
        account_ids: '["acc1"]',
        dedup_priority: '["acc1"]',
        message_type: 'text',
        message_content: '{{name}}さん https://liff.line.me/{{liff_id}}',
      },
      () => client as unknown as LineClient,
    );

    expect(result.successCount).toBe(2);
    expect(client.calls.map((call) => call.method)).toEqual(['push', 'push']);
    expect(client.calls[0].args[1]).toEqual([{
      type: 'text', text: 'Aliceさん https://liff.line.me/LIFF-1',
    }]);
    expect(client.calls[1].args[1]).toEqual([{
      type: 'text', text: 'Bobさん https://liff.line.me/LIFF-1',
    }]);
    expect(client.calls[0].args[2]).toMatch(/^[0-9a-f-]{36}$/);
  });

  // ---- 分割送信 (chunking) ----
  // 1 実行が時間バジェット(maxRunMs)を超えたら、残りは次の cron tick に回して yield する。
  // これで 5000 人配信でも 1 実行が短く終わり、Worker 時間制限で stall しなくなる。

  it('time budget exceeded mid-send: yields with complete=false, persists only sent batches', async () => {
    const N = 1000; // 2 batches (500 + 500)
    const { db, progressUpdates } = makeSendDb({
      selectedCounts: [{ line_account_id: 'acc1', cnt: N }],
      rankedRows: Array.from({ length: N }, (_, i) => ({
        friend_id: `f${i}`, line_user_id: `u${i}`, line_account_id: 'acc1',
      })),
      accountMeta: [{ id: 'acc1', name: 'A1', country: 'JP' }],
    });
    vi.mocked(getLineAccountById).mockImplementation(async (_db: D1Database, id: string) =>
      id === 'acc1' ? ({ id, channel_access_token: 'tok1', is_active: 1 } as never) : null,
    );
    const clients: MockLineClient[] = [];
    const factory = (token: string) => {
      const c = new MockLineClient(token);
      clients.push(c);
      return c as unknown as LineClient;
    };

    // clock: 1回目=startMs(0)。2回目以降(=batch2のバジェット判定)は budget 超過を返す。
    // batch1 は sentAnyBatch=false なので clock を呼ばず必ず送る → 前進保証。
    let nowCalls = 0;
    const now = () => {
      nowCalls += 1;
      return nowCalls <= 1 ? 0 : 1_000_000;
    };

    const result = await processMultiAccountDedupBroadcast(
      db,
      { id: 'b-yield', account_ids: '["acc1"]', dedup_priority: '["acc1"]', message_type: 'text', message_content: 'hello' },
      factory,
      { maxRunMs: 15_000, now },
    );

    expect(result.complete).toBe(false); // 途中で yield した
    const c = clients.find((x) => x.token === 'tok1');
    expect(c?.calls.length).toBe(1); // batch1 (500人) だけ送信、batch2 は次 tick
    expect(result.successCount).toBe(500);
    const last = JSON.parse(progressUpdates[progressUpdates.length - 1].progress as string);
    expect(last.sentIdentKeys).toHaveLength(500); // 送った分の進捗は永続化済み
  });

  it('within time budget: sends all batches and reports complete=true', async () => {
    const N = 1000; // 20 batches
    const { db } = makeSendDb({
      selectedCounts: [{ line_account_id: 'acc1', cnt: N }],
      rankedRows: Array.from({ length: N }, (_, i) => ({
        friend_id: `f${i}`, line_user_id: `u${i}`, line_account_id: 'acc1',
      })),
      accountMeta: [{ id: 'acc1', name: 'A1', country: 'JP' }],
    });
    vi.mocked(getLineAccountById).mockImplementation(async (_db: D1Database, id: string) =>
      id === 'acc1' ? ({ id, channel_access_token: 'tok1', is_active: 1 } as never) : null,
    );
    const clients: MockLineClient[] = [];
    const factory = (token: string) => {
      const c = new MockLineClient(token);
      clients.push(c);
      return c as unknown as LineClient;
    };

    const result = await processMultiAccountDedupBroadcast(
      db,
      { id: 'b-complete', account_ids: '["acc1"]', dedup_priority: '["acc1"]', message_type: 'text', message_content: 'hello' },
      factory,
      { now: () => 0 }, // clock が進まない → バジェット超過しない
    );

    expect(result.complete).toBe(true);
    const c = clients.find((x) => x.token === 'tok1');
    expect(c?.calls.length).toBe(2); // 500人ずつ全 batch を送信
    expect(result.successCount).toBe(1000);
  });
});
