import { describe, it, expect, vi } from 'vitest';
import {
  logRetentionDays,
  retentionCutoff,
  runLogRetention,
} from './log-retention.js';

describe('logRetentionDays', () => {
  it('returns 0 when unset or empty (retention disabled)', () => {
    expect(logRetentionDays({})).toBe(0);
    expect(logRetentionDays({ LOG_RETENTION_DAYS: '' })).toBe(0);
    expect(logRetentionDays({ LOG_RETENTION_DAYS: '  ' })).toBe(0);
  });
  it('returns 0 for invalid or non-positive values', () => {
    expect(logRetentionDays({ LOG_RETENTION_DAYS: 'abc' })).toBe(0);
    expect(logRetentionDays({ LOG_RETENTION_DAYS: '0' })).toBe(0);
    expect(logRetentionDays({ LOG_RETENTION_DAYS: '-5' })).toBe(0);
    expect(logRetentionDays({ LOG_RETENTION_DAYS: '1.5' })).toBe(0);
  });
  it('parses a positive integer', () => {
    expect(logRetentionDays({ LOG_RETENTION_DAYS: '90' })).toBe(90);
    expect(logRetentionDays({ LOG_RETENTION_DAYS: ' 30 ' })).toBe(30);
  });
});

type Exec = { sql: string; params: unknown[] };

function makeDb(selectResults: Array<Record<string, unknown>[]>) {
  const executed: Exec[] = [];
  let selectCall = 0;
  const db = {
    prepare(sql: string) {
      const stmt = {
        params: [] as unknown[],
        bind(...p: unknown[]) { stmt.params = p; return stmt; },
        async all() {
          executed.push({ sql, params: stmt.params });
          const rows = selectResults[selectCall] ?? [];
          selectCall += 1;
          return { results: rows };
        },
        async run() {
          executed.push({ sql, params: stmt.params });
          return { success: true, meta: { changes: stmt.params.length } };
        },
      };
      return stmt;
    },
  };
  return { db: db as unknown as D1Database, executed };
}

function makeR2() {
  const store = new Map<string, string>();
  return {
    store,
    r2: {
      async put(key: string, body: string) { store.set(key, body); return {}; },
    } as unknown as R2Bucket,
  };
}

const row = (id: string, createdAt: string) => ({
  id, friend_id: 'f1', direction: 'outgoing', message_type: 'text',
  content: '{"text":"hi"}', broadcast_id: null, scenario_step_id: null,
  template_id_at_send: null, delivery_type: 'push', source: 'broadcast',
  line_account_id: null, created_at: createdAt,
});

describe('retentionCutoff', () => {
  it('formats the JST cutoff like messages_log.created_at (T-separator, 3-digit millis, no TZ)', () => {
    // 2026-08-21T00:00:00Z, 90 days back → JST 2026-05-23T09:00:00.000
    const cutoff = retentionCutoff(new Date('2026-08-21T00:00:00Z'), 90);
    expect(cutoff).toBe('2026-05-23T09:00:00.000');
  });
});

describe('runLogRetention', () => {
  it('does nothing when retention is disabled', async () => {
    const { db, executed } = makeDb([]);
    const { r2, store } = makeR2();
    const res = await runLogRetention(db, r2, {});
    expect(res).toEqual({ archived: 0, batches: 0 });
    expect(executed).toHaveLength(0);
    expect(store.size).toBe(0);
  });

  it('archives to R2 before deleting, as NDJSON, then deletes exactly those ids', async () => {
    const rows = [row('m1', '2026-01-01T10:00:00.000'), row('m2', '2026-01-02T11:00:00.000')];
    const { db, executed } = makeDb([rows, []]);
    const { r2, store } = makeR2();
    const res = await runLogRetention(db, r2, { LOG_RETENTION_DAYS: '90' }, new Date('2026-08-21T00:00:00Z'));

    expect(res).toEqual({ archived: 2, batches: 1 });
    // R2 key: date of first row + first id
    const key = 'archive/messages_log/2026-01-01/m1.ndjson';
    expect([...store.keys()]).toEqual([key]);
    // NDJSON: one JSON object per line, round-trips to the selected rows
    expect(store.get(key)!.trimEnd().split('\n').map((l) => JSON.parse(l))).toEqual(rows);
    // SELECT uses the cutoff + limit; DELETE binds exactly the archived ids
    const del = executed.find((e) => e.sql.includes('DELETE FROM messages_log'));
    expect(del).toBeDefined();
    expect(del!.params).toEqual(['m1', 'm2']);
    // archive-then-delete: SELECT → (R2 put) → DELETE の順。executed 上で DELETE が最後
    expect(executed[executed.length - 1]!.sql).toContain('DELETE FROM messages_log');
  });

  it('stops when a batch comes back empty and reports batch count', async () => {
    const batch1 = Array.from({ length: 90 }, (_, i) => row(`a${i}`, '2026-01-01T00:00:00.000'));
    const { db } = makeDb([batch1, []]);
    const { r2, store } = makeR2();
    const res = await runLogRetention(db, r2, { LOG_RETENTION_DAYS: '90' }, new Date('2026-08-21T00:00:00Z'));
    expect(res).toEqual({ archived: 90, batches: 1 });
    expect(store.size).toBe(1);
  });

  it('monthly quota active: short retention window clamps to the JST month start', async () => {
    // 2026-08-21 JST, days=7 → the raw cutoff (08-14) is inside the current
    // month. With a monthly send limit configured, this month's rows feed the
    // usage tally, so the effective cutoff clamps to the month start.
    const { db, executed } = makeDb([[], []]);
    const { r2 } = makeR2();
    await runLogRetention(
      db, r2,
      { LOG_RETENTION_DAYS: '7', QUOTA_MONTHLY_MESSAGES_MAX: '5000' },
      new Date('2026-08-21T00:00:00Z'),
    );
    const sel = executed.find((e) => e.sql.includes('FROM messages_log WHERE created_at <'))!;
    expect(sel).toBeDefined();
    expect(sel.params[0]).toBe('2026-08-01T00:00:00.000');
  });

  it('no monthly quota: short retention window keeps its own cutoff (no silent behavior change)', async () => {
    // Deployments that use a short window purely to limit stored history and
    // have no monthly send limit must keep exactly the configured window.
    const { db, executed } = makeDb([[], []]);
    const { r2 } = makeR2();
    await runLogRetention(db, r2, { LOG_RETENTION_DAYS: '7' }, new Date('2026-08-21T00:00:00Z'));
    const sel = executed.find((e) => e.sql.includes('FROM messages_log WHERE created_at <'))!;
    expect(sel.params[0]).toBe('2026-08-14T09:00:00.000');
  });

  it('monthly quota active: long retention window keeps its own cutoff (already before the month start)', async () => {
    const { db, executed } = makeDb([[], []]);
    const { r2 } = makeR2();
    await runLogRetention(
      db, r2,
      { LOG_RETENTION_DAYS: '90', QUOTA_MONTHLY_MESSAGES_MAX: '5000' },
      new Date('2026-08-21T00:00:00Z'),
    );
    const sel = executed.find((e) => e.sql.includes('FROM messages_log WHERE created_at <'))!;
    expect(sel.params[0]).toBe('2026-05-23T09:00:00.000');
  });

  it('does not delete when the R2 put throws (no data loss)', async () => {
    const { db, executed } = makeDb([[row('m1', '2026-01-01T10:00:00.000')]]);
    const r2 = { put: vi.fn(async () => { throw new Error('r2 down'); }) } as unknown as R2Bucket;
    await expect(
      runLogRetention(db, r2, { LOG_RETENTION_DAYS: '90' }, new Date('2026-08-21T00:00:00Z')),
    ).rejects.toThrow('r2 down');
    expect(executed.some((e) => e.sql.includes('DELETE'))).toBe(false);
  });
});
