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
  /** Phase 1-G: 暗号化 token 復号用 (省略可、未設定ならスキップ) */
  env?: { LINE_TOKEN_ENC_KEY?: string };
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
  const due = await db
    .prepare(
      `SELECT r.id, r.booking_id, r.kind, r.retry_count,
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
          AND b.starts_at > ?       -- 開始時刻を過ぎた予約のリマインダは送らない
        LIMIT 100`,
    )
    .bind(params.now.toISOString(), params.now.toISOString())
    .all<DueRow>();

  let sent = 0;
  let failed = 0;
  for (const row of due.results) {
    const kind: NotificationKind = row.kind;
    // Optimistic claim: bump retry_count CAS-style on (id, retry_count).
    // 同じ cron tick の再走、または */5 と 0 */6 の dual-cron が同時に
    // この row を fetch しても、UPDATE が成功するのは 1 つだけ。
    // 他は changes=0 で skip し、二重送信を防ぐ。
    const claim = await db
      .prepare(
        `UPDATE booking_reminders
            SET retry_count = retry_count + 1
          WHERE id = ? AND retry_count = ? AND status IN ('pending','failed')`,
      )
      .bind(row.id, row.retry_count)
      .run();
    if ((claim.meta?.changes ?? 0) === 0) continue;
    const claimedRetry = row.retry_count + 1;

    try {
      // Codex P2 修正: 復号失敗を try 内で扱う
      const { resolveAccessToken } = await import('../lib/account-token.js');
      const token = params.env
        ? await resolveAccessToken(params.env, row.channel_access_token)
        : row.channel_access_token;
      await params.sender({
        channelAccessToken: token,
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
          `UPDATE booking_reminders SET status='sent', sent_at = ? WHERE id = ?`,
        )
        .bind(params.now.toISOString(), row.id)
        .run();
      sent++;
    } catch (e) {
      const newStatus = claimedRetry >= REMINDER_MAX_RETRY ? 'failed_permanent' : 'failed';
      await db
        .prepare(
          `UPDATE booking_reminders SET status = ?, last_error = ? WHERE id = ?`,
        )
        .bind(newStatus, e instanceof Error ? e.message : String(e), row.id)
        .run();
      failed++;
    }
  }
  return { sent, failed };
}
