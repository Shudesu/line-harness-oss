import { describe, expect, test } from 'vitest';
import {
  quotaConfig,
  quotaEnabled,
  monthStartJst,
  jstYyyyMmDd,
  countAccountMonthlyMessages,
  getQuotaUsage,
  isQuotaExceeded,
  wouldExceedMonthlyQuota,
  startBulkSendJobs,
  type QuotaUsage,
} from './quota.js';

type Exec = { sql: string; params: unknown[] };
function makeDb(counts: { friends?: number; monthly?: number; allBroadcasts?: number }) {
  const executed: Exec[] = [];
  const db = {
    prepare(sql: string) {
      const stmt = {
        params: [] as unknown[],
        bind(...p: unknown[]) {
          stmt.params = p;
          return stmt;
        },
        async first() {
          executed.push({ sql, params: stmt.params });
          if (sql.includes('FROM friends')) return { count: counts.friends ?? 0 };
          if (sql.includes('FROM messages_log')) return { count: counts.monthly ?? 0 };
          if (sql.includes('FROM broadcasts')) return { count: counts.allBroadcasts ?? 0 };
          return null;
        },
      };
      return stmt;
    },
  };
  return { db: db as unknown as D1Database, executed };
}

describe('quotaConfig / quotaEnabled', () => {
  test('unset/empty/invalid → unlimited (0) and disabled', () => {
    expect(quotaConfig({})).toEqual({ friendsMax: 0, monthlyMessagesMax: 0, noticeUrl: null });
    expect(quotaConfig({ QUOTA_FRIENDS_MAX: 'abc', QUOTA_MONTHLY_MESSAGES_MAX: '-1' }).friendsMax).toBe(0);
    expect(quotaEnabled({})).toBe(false);
  });
  test('positive integers enable quotas; notice url passes through', () => {
    const c = quotaConfig({
      QUOTA_FRIENDS_MAX: '1000',
      QUOTA_MONTHLY_MESSAGES_MAX: '5000',
      QUOTA_NOTICE_URL: 'https://example.com/x',
    });
    expect(c).toEqual({ friendsMax: 1000, monthlyMessagesMax: 5000, noticeUrl: 'https://example.com/x' });
    expect(quotaEnabled({ QUOTA_FRIENDS_MAX: '1' })).toBe(true);
  });
});

describe('monthStartJst', () => {
  test('JST month boundary, created_at format', () => {
    // 2026-07-31T20:00:00Z = 2026-08-01T05:00 JST → August start
    expect(monthStartJst(new Date('2026-07-31T20:00:00Z'))).toBe('2026-08-01T00:00:00.000');
    // 2026-08-01T05:00:00Z = 2026-08-01T14:00 JST → still August
    expect(monthStartJst(new Date('2026-08-01T05:00:00Z'))).toBe('2026-08-01T00:00:00.000');
  });
});

describe('jstYyyyMmDd', () => {
  test('JST day boundary: UTC evening is already the next JST day', () => {
    // 2026-08-31T20:00:00Z = 2026-09-01T05:00 JST
    expect(jstYyyyMmDd(0, new Date('2026-08-31T20:00:00Z'))).toBe('20260901');
    expect(jstYyyyMmDd(1, new Date('2026-08-31T20:00:00Z'))).toBe('20260831');
    expect(jstYyyyMmDd(2, new Date('2026-08-31T20:00:00Z'))).toBe('20260830');
  });
});

describe('countAccountMonthlyMessages', () => {
  test('sums per-account log rows and all-target broadcast successes, JST month window', async () => {
    const { db, executed } = makeDb({ monthly: 40, allBroadcasts: 2 });
    const total = await countAccountMonthlyMessages(db, 'acc-1', new Date('2026-08-21T00:00:00Z'));
    expect(total).toBe(42);
    const ml = executed.find((e) => e.sql.includes('FROM messages_log'))!;
    expect(ml.sql).toContain('f.line_account_id = ?');
    expect(ml.params).toEqual(['2026-08-01T00:00:00.000', 'acc-1']);
    const bc = executed.find((e) => e.sql.includes('FROM broadcasts'))!;
    expect(bc.sql).toContain(`target_type = 'all'`);
    expect(bc.sql).toContain('line_request_id IS NOT NULL');
    expect(bc.sql).toContain('line_account_id = ?');
    expect(bc.params).toEqual(['2026-08-01T00:00:00.000', 'acc-1']);
  });
});

describe('getQuotaUsage / isQuotaExceeded', () => {
  test('disabled → no DB queries, exceeded=false', async () => {
    const { db, executed } = makeDb({});
    expect(await isQuotaExceeded(db, {})).toBe(false);
    expect(executed).toHaveLength(0);
  });
  test('under limits → exceeded=false', async () => {
    const { db } = makeDb({ friends: 999, monthly: 4999 });
    const u = await getQuotaUsage(db, { QUOTA_FRIENDS_MAX: '1000', QUOTA_MONTHLY_MESSAGES_MAX: '5000' });
    expect(u.exceeded).toBe(false);
    expect(u.friends).toEqual({ used: 999, max: 1000 });
  });
  test('friends over → exceeded', async () => {
    const { db } = makeDb({ friends: 1001, monthly: 0 });
    expect((await getQuotaUsage(db, { QUOTA_FRIENDS_MAX: '1000' })).exceeded).toBe(true);
  });
  test('friends exactly at limit → not exceeded', async () => {
    const { db } = makeDb({ friends: 1000, monthly: 0 });
    expect((await getQuotaUsage(db, { QUOTA_FRIENDS_MAX: '1000' })).exceeded).toBe(false);
  });
  test('monthly at limit → exceeded (send would go over)', async () => {
    const { db } = makeDb({ friends: 0, monthly: 5000 });
    expect((await getQuotaUsage(db, { QUOTA_MONTHLY_MESSAGES_MAX: '5000' })).exceeded).toBe(true);
  });
  test('monthly tally includes broadcast-API sends (no per-recipient log rows)', async () => {
    const { db } = makeDb({ monthly: 3000, allBroadcasts: 1500 });
    const u = await getQuotaUsage(db, { QUOTA_MONTHLY_MESSAGES_MAX: '5000' });
    expect(u.monthlyMessages.used).toBe(4500);
    expect(u.exceeded).toBe(false);
    const over = makeDb({ monthly: 3000, allBroadcasts: 2000 });
    expect((await getQuotaUsage(over.db, { QUOTA_MONTHLY_MESSAGES_MAX: '5000' })).exceeded).toBe(true);
  });
  test('broadcast-API tally is scoped to all-target API sends in the JST month', async () => {
    const { db, executed } = makeDb({ monthly: 1, allBroadcasts: 1 });
    await getQuotaUsage(db, { QUOTA_MONTHLY_MESSAGES_MAX: '10' }, new Date('2026-08-21T00:00:00Z'));
    const bc = executed.find((e) => e.sql.includes('FROM broadcasts'))!;
    expect(bc.sql).toContain(`target_type = 'all'`);
    expect(bc.sql).toContain('line_request_id IS NOT NULL');
    expect(bc.sql).toContain('sent_at >= ?');
    expect(bc.params).toContain('2026-08-01T00:00:00.000');
  });
  test('counts use is_following=1 and push-only month window', async () => {
    const { db, executed } = makeDb({ friends: 1, monthly: 1 });
    await getQuotaUsage(
      db,
      { QUOTA_FRIENDS_MAX: '10', QUOTA_MONTHLY_MESSAGES_MAX: '10' },
      new Date('2026-08-21T00:00:00Z'),
    );
    const fr = executed.find((e) => e.sql.includes('FROM friends'))!;
    expect(fr.sql).toContain('is_following = 1');
    const ml = executed.find((e) => e.sql.includes('FROM messages_log'))!;
    expect(ml.sql).toContain(`direction = 'outgoing'`);
    expect(ml.sql).toContain(`delivery_type IS NULL OR delivery_type = 'push'`);
    expect(ml.params).toContain('2026-08-01T00:00:00.000');
  });
});

describe('interplay with log retention', () => {
  test('retention (days=7) never removes rows inside an active monthly usage window', async () => {
    // With a monthly limit configured, the tally counts messages_log rows
    // from monthStartJst onward; log retention must clamp its delete cutoff
    // to that same boundary so a short window cannot shrink the count.
    const { runLogRetention } = await import('./log-retention.js');
    const executed: { sql: string; params: unknown[] }[] = [];
    const db = {
      prepare(sql: string) {
        const stmt = {
          params: [] as unknown[],
          bind(...p: unknown[]) { stmt.params = p; return stmt; },
          async all() { executed.push({ sql, params: stmt.params }); return { results: [] }; },
          async run() { return { success: true }; },
        };
        return stmt;
      },
    } as unknown as D1Database;
    const r2 = { async put() { return {}; } } as unknown as R2Bucket;

    const now = new Date('2026-08-21T00:00:00Z');
    await runLogRetention(
      db, r2,
      { LOG_RETENTION_DAYS: '7', QUOTA_MONTHLY_MESSAGES_MAX: '5000' },
      now,
    );

    const sel = executed.find((e) => e.sql.includes('created_at <'))!;
    expect(sel).toBeDefined();
    // Everything the quota window counts (created_at >= monthStartJst) is
    // outside the retention delete range (created_at < cutoff).
    expect(String(sel.params[0]) <= monthStartJst(now)).toBe(true);
  });
});

describe('wouldExceedMonthlyQuota', () => {
  const usage = (used: number, max: number): QuotaUsage => ({
    friends: { used: 0, max: 0 },
    monthlyMessages: { used, max },
    exceeded: false,
    noticeUrl: null,
  });
  test('projected total over the limit blocks', () => {
    expect(wouldExceedMonthlyQuota(usage(4999, 5000), 500)).toBe(true);
  });
  test('projected total exactly at the limit is allowed', () => {
    expect(wouldExceedMonthlyQuota(usage(4500, 5000), 500)).toBe(false);
  });
  test('no limit, unknown estimate, or empty audience never block', () => {
    expect(wouldExceedMonthlyQuota(usage(4999, 0), 500)).toBe(false);
    expect(wouldExceedMonthlyQuota(usage(4999, 5000), null)).toBe(false);
    expect(wouldExceedMonthlyQuota(usage(4999, 5000), 0)).toBe(false);
  });
});

describe('startBulkSendJobs', () => {
  function makeTasks(events: string[], opts: { failFirst?: boolean } = {}) {
    const mk = (n: number) => async () => {
      events.push(`${n}:start`);
      await new Promise((r) => setTimeout(r, 5));
      if (n === 1 && opts.failFirst) {
        events.push(`${n}:end`);
        throw new Error('task 1 failed');
      }
      events.push(`${n}:end`);
    };
    return [mk(1), mk(2), mk(3)];
  }

  test('no monthly limit → all jobs start in parallel (previous behavior)', async () => {
    const events: string[] = [];
    const promises = startBulkSendJobs({}, makeTasks(events));
    // Every task has started before any of them is awaited.
    expect(events).toEqual(['1:start', '2:start', '3:start']);
    expect(promises).toHaveLength(3);
    await Promise.allSettled(promises);
    expect(events.filter((e) => e.endsWith(':end'))).toHaveLength(3);
  });

  test('monthly limit active → jobs run serially in order', async () => {
    const events: string[] = [];
    const promises = startBulkSendJobs({ QUOTA_MONTHLY_MESSAGES_MAX: '100' }, makeTasks(events));
    expect(promises).toHaveLength(1); // one chain promise, awaitable alongside other jobs
    await Promise.allSettled(promises);
    expect(events).toEqual(['1:start', '1:end', '2:start', '2:end', '3:start', '3:end']);
  });

  test('serial mode: one failing job does not stop the ones after it', async () => {
    const events: string[] = [];
    const promises = startBulkSendJobs(
      { QUOTA_MONTHLY_MESSAGES_MAX: '100' },
      makeTasks(events, { failFirst: true }),
    );
    const results = await Promise.allSettled(promises);
    expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
    expect(events).toContain('2:start');
    expect(events).toContain('3:end');
  });

  test('friends-only limit stays parallel (only the monthly limit needs serialization)', async () => {
    const events: string[] = [];
    const promises = startBulkSendJobs({ QUOTA_FRIENDS_MAX: '10' }, makeTasks(events));
    expect(events).toEqual(['1:start', '2:start', '3:start']);
    await Promise.allSettled(promises);
  });
});
