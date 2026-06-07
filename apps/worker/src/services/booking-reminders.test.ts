import { describe, expect, test, vi } from 'vitest';
import { processDueReminders } from './booking-reminders.js';

interface DueRow {
  id: string;
  booking_id: string;
  kind: 'day_before' | 'hours_before';
  retry_count: number;
  starts_at: string;
  menu_name: string;
  staff_name: string;
  channel_access_token: string;
  line_user_id: string;
}

function stubDB(due: DueRow[]) {
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
          if (sql.includes('FROM booking_reminders')) {
            return { results: due };
          }
          return { results: [] };
        },
        async run() {
          updates.push({ sql, bound });
          // CAS claim 行 (`SET retry_count = retry_count + 1`) は in-memory の
          // due[].retry_count を bump して、test 側で claimedRetry を検証可能にする。
          if (sql.includes('SET retry_count = retry_count + 1')) {
            const id = bound[0];
            const row = due.find((r) => r.id === id);
            if (row) row.retry_count += 1;
          }
          return { success: true, meta: { changes: 1 } };
        },
        async first() {
          return null;
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, updates };
}

const REMINDER_HOURS_BEFORE = 2;
const NOW = new Date('2026-05-10T05:01:00Z');

describe('processDueReminders', () => {
  test('due な reminder を sent にし sender を呼ぶ', async () => {
    const due: DueRow[] = [
      {
        id: 'R1',
        booking_id: 'B1',
        kind: 'day_before',
        retry_count: 0,
        starts_at: '2026-05-10T05:00:00Z',
        menu_name: 'カット',
        staff_name: '山田',
        channel_access_token: 'tok',
        line_user_id: 'U_xyz',
      },
    ];
    const { db, updates } = stubDB(due);
    const sender = vi.fn().mockResolvedValue(undefined);
    const result = await processDueReminders(db, {
      now: NOW,
      sender,
      reminderHoursBefore: REMINDER_HOURS_BEFORE,
    });
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(sender).toHaveBeenCalledTimes(1);
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({
        channelAccessToken: 'tok',
        toLineUserId: 'U_xyz',
        kind: 'day_before',
      }),
    );
    expect(updates.find((u) => u.sql.includes("status='sent'"))).toBeTruthy();
  });

  test('未来の reminder は対象外（DB が返さない前提なので空入力）', async () => {
    const { db } = stubDB([]);
    const sender = vi.fn();
    const result = await processDueReminders(db, {
      now: NOW,
      sender,
      reminderHoursBefore: REMINDER_HOURS_BEFORE,
    });
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(sender).not.toHaveBeenCalled();
  });

  test('送信失敗 1 回目: status=failed, retry_count=1', async () => {
    const due: DueRow[] = [
      {
        id: 'R1',
        booking_id: 'B1',
        kind: 'day_before',
        retry_count: 0,
        starts_at: '2026-05-10T05:00:00Z',
        menu_name: 'カット',
        staff_name: '山田',
        channel_access_token: 'tok',
        line_user_id: 'U',
      },
    ];
    const { db, updates } = stubDB(due);
    const sender = vi.fn().mockRejectedValue(new Error('LINE 500'));
    const result = await processDueReminders(db, {
      now: NOW,
      sender,
      reminderHoursBefore: REMINDER_HOURS_BEFORE,
    });
    expect(result).toEqual({ sent: 0, failed: 1 });
    // CAS 移行後: retry_count は claim 側 (`SET retry_count = retry_count + 1`) で
    // bump されるため、失敗 UPDATE には含まれない (status, last_error, id の 3 binds)。
    const failedUpdate = updates.find((u) => u.sql.includes('UPDATE booking_reminders SET status ='));
    expect(failedUpdate).toBeTruthy();
    expect(failedUpdate!.bound[0]).toBe('failed');
    // bumped retry_count は in-memory に反映される (claim 側)
    expect(due[0].retry_count).toBe(1);
  });

  test('送信失敗 3 回目: failed_permanent', async () => {
    const due: DueRow[] = [
      {
        id: 'R1',
        booking_id: 'B1',
        kind: 'hours_before',
        retry_count: 2, // 3回目
        starts_at: '2026-05-10T05:00:00Z',
        menu_name: 'カット',
        staff_name: '山田',
        channel_access_token: 'tok',
        line_user_id: 'U',
      },
    ];
    const { db, updates } = stubDB(due);
    const sender = vi.fn().mockRejectedValue(new Error('LINE 500'));
    await processDueReminders(db, {
      now: NOW,
      sender,
      reminderHoursBefore: REMINDER_HOURS_BEFORE,
    });
    const u = updates.find((x) => x.sql.includes('UPDATE booking_reminders SET status ='));
    expect(u!.bound[0]).toBe('failed_permanent');
    expect(due[0].retry_count).toBe(3); // claim 側 で bump 済み
  });
});
