import { describe, expect, test, vi } from 'vitest';
import { runExpirer } from './booking-expirer.js';

interface StaleRow {
  id: string;
  starts_at: string;
  menu_name: string;
  staff_name: string;
  line_account_id: string;
  channel_access_token: string;
  line_user_id: string;
}

function stubDB(stale: StaleRow[], idempotencyPurged = 0, settings: Record<string, string> = {}) {
  const updates: Array<{ sql: string; bound: unknown[] }> = [];
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async all() {
          if (sql.includes('FROM bookings')) {
            return { results: stale };
          }
          return { results: [] };
        },
        async run() {
          updates.push({ sql, bound });
          if (sql.includes('DELETE FROM booking_idempotency_keys')) {
            return { success: true, meta: { changes: idempotencyPurged } };
          }
          return { success: true, meta: { changes: 1 } };
        },
        async first() {
          if (sql.includes('FROM account_settings')) {
            const value = settings[String(bound[0])];
            return value === undefined ? null : { value };
          }
          return null;
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, updates };
}

const NOW = new Date('2026-05-08T01:00:00Z');

describe('runExpirer', () => {
  test('24h 経過 requested を expired にし期限切れ通知を呼ぶ', async () => {
    const stale: StaleRow[] = [
      {
        id: 'B1',
        starts_at: '2026-05-12T05:00:00Z',
        menu_name: 'カット',
        staff_name: '山田',
        line_account_id: 'acc1',
        channel_access_token: 'tok',
        line_user_id: 'U',
      },
    ];
    const { db, updates } = stubDB(stale, 0, {
      acc1: JSON.stringify({ expired: '期限切れ {menu}' }),
    });
    const sender = vi.fn().mockResolvedValue(undefined);
    const result = await runExpirer(db, { now: NOW, sender });
    expect(result.expired).toBe(1);
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'expired',
        toLineUserId: 'U',
        templates: { expired: '期限切れ {menu}' },
      }),
    );
    // bookings UPDATE expired + reminders UPDATE cancelled が発行されている
    expect(updates.some((u) => u.sql.includes("status='expired'"))).toBe(true);
    expect(updates.some((u) => u.sql.includes("status='cancelled'"))).toBe(true);
  });

  test('idempotency expired keys 削除件数を返す', async () => {
    const { db } = stubDB([], 3);
    const sender = vi.fn();
    const result = await runExpirer(db, { now: NOW, sender });
    expect(result.idempotencyPurged).toBe(3);
  });

  test('通知失敗しても expired 化は実行される', async () => {
    const stale: StaleRow[] = [
      {
        id: 'B1',
        starts_at: '2026-05-12T05:00:00Z',
        menu_name: 'カット',
        staff_name: '山田',
        line_account_id: 'acc1',
        channel_access_token: 'tok',
        line_user_id: 'U',
      },
    ];
    const { db, updates } = stubDB(stale);
    const sender = vi.fn().mockRejectedValue(new Error('LINE 500'));
    const result = await runExpirer(db, { now: NOW, sender });
    expect(result.expired).toBe(1);
    expect(updates.some((u) => u.sql.includes("status='expired'"))).toBe(true);
  });
});
