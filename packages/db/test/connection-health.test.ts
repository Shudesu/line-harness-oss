// Connection-health failure buckets — real-SQLite gate.
//
// Covers the 2026-11 review fixes:
//  - minute buckets must keep a 12:59 failure visible in the "last 60 minutes"
//    window at 13:01 (hour buckets alone collapsed it to zero),
//  - failure bumps must be atomic SQL increments so concurrent requests cannot
//    lose counts (read-modify-write of the whole JSON used to drop them),
//  - legacy documents (hour buckets only) bump forward correctly,
//  - stale buckets are pruned so the KVS document stays bounded.
import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';

const jstNowMock = vi.hoisted(() => vi.fn(() => '2026-11-16T12:59:00.000+09:00'));
vi.mock('../src/utils', () => ({ jstNow: jstNowMock }));

import {
  getSignatureFailureWindow,
  recordSignatureFailure,
  SIG_FAILURE_KEY,
  UNATTRIBUTED_ACCOUNT_ID,
} from '../src/connection-health';
import { setAccountSetting } from '../src/account-settings';

const opened: Database.Database[] = [];
afterEach(() => {
  opened.splice(0).forEach((s) => s.close());
  jstNowMock.mockReturnValue('2026-11-16T12:59:00.000+09:00');
});

function makeDb(): { sql: Database.Database; db: D1Database } {
  const sql = new Database(':memory:');
  opened.push(sql);
  sql.exec(
    readFileSync(new URL('../migrations/025_account_settings.sql', import.meta.url), 'utf8'),
  );
  const db = {
    prepare(query: string) {
      let values: unknown[] = [];
      return {
        bind(...args: unknown[]) {
          values = args;
          return this;
        },
        async first() {
          return sql.prepare(query).get(...values) ?? null;
        },
        async run() {
          return { meta: { changes: sql.prepare(query).run(...values).changes } };
        },
      };
    },
  } as unknown as D1Database;
  return { sql, db };
}

function rawRecord(sql: Database.Database, accountId: string): Record<string, unknown> {
  const row = sql
    .prepare('SELECT value FROM account_settings WHERE line_account_id = ? AND key = ?')
    .get(accountId, SIG_FAILURE_KEY) as { value: string };
  return JSON.parse(row.value) as Record<string, unknown>;
}

async function seedRecord(db: D1Database, accountId: string, record: unknown): Promise<void> {
  await setAccountSetting(db, accountId, SIG_FAILURE_KEY, JSON.stringify(record));
}

describe('connection-health failure buckets', () => {
  it('keeps a 12:59 failure inside the last-60-minutes window at 13:01', async () => {
    const { db } = makeDb();
    await recordSignatureFailure(db, 'acc1', 'unverified');

    jstNowMock.mockReturnValue('2026-11-16T13:01:00.000+09:00');
    const at1301 = await getSignatureFailureWindow(db, 'acc1', 1);
    expect(at1301.failures).toBe(1);
    expect(at1301.lastReason).toBe('unverified');

    // 60 minutes later the same failure is out of the window again.
    jstNowMock.mockReturnValue('2026-11-16T13:59:30.000+09:00');
    expect((await getSignatureFailureWindow(db, 'acc1', 1)).failures).toBe(0);
  });

  it('increments counters atomically so repeated/concurrent bumps all land', async () => {
    const { sql, db } = makeDb();
    await Promise.all([
      recordSignatureFailure(db, 'acc1', 'missing_signature'),
      recordSignatureFailure(db, 'acc1', 'unverified'),
      recordSignatureFailure(db, 'acc1'),
    ]);

    const record = rawRecord(sql, 'acc1');
    expect(record.total).toBe(3);
    expect((record.hours as Record<string, number>)['2026-11-16T12']).toBe(3);
    expect((record.minutes as Record<string, number>)['2026-11-16T12:59']).toBe(3);
    // The last bump carried no reason → lastReason is JSON null, not a stale one.
    expect(record.lastReason).toBeNull();
    expect((await getSignatureFailureWindow(db, 'acc1', 1)).failures).toBe(3);
  });

  it('bumps a legacy hour-only document and creates minute buckets on the way', async () => {
    const { sql, db } = makeDb();
    await seedRecord(db, 'acc1', {
      total: 5,
      lastAt: '2026-11-16T12:10:00.000+09:00',
      hours: { '2026-11-16T12': 5 },
      lastReason: 'unverified',
    });

    await recordSignatureFailure(db, 'acc1', 'unverified');

    const record = rawRecord(sql, 'acc1');
    expect(record.total).toBe(6);
    expect((record.hours as Record<string, number>)['2026-11-16T12']).toBe(6);
    expect((record.minutes as Record<string, number>)['2026-11-16T12:59']).toBe(1);
  });

  it('starts a fresh record when the stored value is not JSON', async () => {
    const { db } = makeDb();
    await setAccountSetting(db, 'acc1', SIG_FAILURE_KEY, 'not-json{');
    await recordSignatureFailure(db, 'acc1', 'unverified');
    // The corrupt value is replaced by a valid fresh record.
    const window = await getSignatureFailureWindow(db, 'acc1', 1);
    expect(window.failures).toBe(1);
    expect(window.lastReason).toBe('unverified');
  });

  it('records unattributable failures under the __unattributed__ sentinel', async () => {
    const { db } = makeDb();
    await recordSignatureFailure(db, null, 'unverified');
    expect((await getSignatureFailureWindow(db, null, 1)).failures).toBe(1);
    expect((await getSignatureFailureWindow(db, UNATTRIBUTED_ACCOUNT_ID, 1)).failures).toBe(1);
  });

  it('prunes stale hour/minute buckets so the document stays bounded', async () => {
    const { sql, db } = makeDb();
    await seedRecord(db, 'acc1', {
      total: 9,
      lastAt: '2026-11-13T12:00:00.000+09:00',
      hours: { '2026-11-13T12': 7, '2026-11-16T12': 2 },
      minutes: { '2026-11-13T12:00': 7, '2026-11-16T12:59': 2 },
    });

    // The prune runs every N bumps per isolate; 30 guaranteed-crosses it.
    for (let i = 0; i < 30; i++) {
      await recordSignatureFailure(db, 'acc1', 'unverified');
    }

    const record = rawRecord(sql, 'acc1');
    const hours = record.hours as Record<string, number>;
    const minutes = record.minutes as Record<string, number>;
    expect(hours['2026-11-13T12']).toBeUndefined();
    expect(minutes['2026-11-13T12:00']).toBeUndefined();
    // Current buckets survive the prune.
    expect((await getSignatureFailureWindow(db, 'acc1', 1)).failures).toBeGreaterThan(0);
    expect(Object.keys(minutes).every((k) => k.startsWith('2026-11-16T12'))).toBe(true);
  });
});
