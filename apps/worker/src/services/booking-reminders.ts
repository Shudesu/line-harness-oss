// Cron handler: send due booking reminders.
// Joined with bookings/menus/staff/line_accounts/friends for everything
// the notification text renderer needs in one query.

import type { BookingNotificationSender, NotificationKind } from './booking-notifier.js';
import { REMINDER_MAX_RETRY } from './booking-types.js';

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

export interface ProcessRemindersParams {
  now: Date;
  sender: BookingNotificationSender;
  reminderHoursBefore: number;
}

const JST_OFFSET_MS = 9 * 3600_000;

function startsAtJst(utcIso: string): string {
  const jst = new Date(new Date(utcIso).getTime() + JST_OFFSET_MS).toISOString();
  return `${jst.slice(0, 10)} ${jst.slice(11, 16)}`;
}

export async function processDueReminders(
  db: D1Database,
  params: ProcessRemindersParams,
): Promise<{ sent: number; failed: number }> {
  // status は 'pending' に加え 'failed'（一時エラーで失敗、retry 残あり）も拾う。
  // 'failed_permanent' / 'sent' / 'cancelled' は再送対象外。
  // Reuse the same eligibility rules when refreshing each queued row.
  const eligibleQuery = `SELECT r.id, r.booking_id, r.kind, r.retry_count,
              b.starts_at,
              m.name AS menu_name,
              s.display_name AS staff_name,
              la.channel_access_token,
              f.line_user_id
         FROM booking_reminders r
         INNER JOIN bookings b ON b.id = r.booking_id
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         INNER JOIN line_accounts la ON la.id = b.line_account_id
         INNER JOIN friends f ON f.id = b.friend_id
        WHERE r.status IN ('pending','failed')
          AND r.scheduled_at <= ?
          AND b.status = 'confirmed'
          AND b.starts_at > ?       -- 開始時刻を過ぎた予約のリマインダは送らない`;
  const due = await db
    .prepare(`${eligibleQuery}\n LIMIT 100`)
    .bind(params.now.toISOString(), params.now.toISOString())
    .all<DueRow>();

  let sent = 0;
  let failed = 0;
  for (const candidate of due.results) {
    let row = candidate;
    try {
      const current = await db
        .prepare(`${eligibleQuery}\n AND r.id = ?`)
        .bind(params.now.toISOString(), params.now.toISOString(), candidate.id)
        .first<DueRow>();
      if (!current) continue;
      row = current;
      const kind: NotificationKind = row.kind;
      await params.sender({
        retryKey: row.id,
        channelAccessToken: row.channel_access_token,
        toLineUserId: row.line_user_id,
        kind,
        ctx: {
          menuName: row.menu_name,
          staffName: row.staff_name,
          startsAtJst: startsAtJst(row.starts_at),
          hoursBefore: params.reminderHoursBefore,
        },
      });
      await db
        .prepare(
          `UPDATE booking_reminders SET status='sent', sent_at = ? WHERE id = ? AND status IN ('pending','failed','failed_permanent')`,
        )
        .bind(params.now.toISOString(), row.id)
        .run();
      sent++;
    } catch (e) {
      const newRetry = row.retry_count + 1;
      const newStatus = newRetry >= REMINDER_MAX_RETRY ? 'failed_permanent' : 'failed';
      await db
        .prepare(
          `UPDATE booking_reminders SET status = ?, retry_count = ?, last_error = ? WHERE id = ? AND status IN ('pending','failed')`,
        )
        .bind(newStatus, newRetry, e instanceof Error ? e.message : String(e), row.id)
        .run();
      failed++;
    }
  }
  return { sent, failed };
}
