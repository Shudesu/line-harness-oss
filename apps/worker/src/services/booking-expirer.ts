// Cron handler: expire 24h-old request bookings + purge idempotency rows.

import type { BookingNotificationSender } from './booking-notifier.js';
import { purgeExpiredIdempotency } from './booking-idempotency.js';
import { REQUEST_TTL_HOURS } from './booking-types.js';

interface StaleRow {
  id: string;
  starts_at: string;
  menu_name: string;
  staff_name: string;
  channel_access_token: string;
  line_user_id: string;
}

const JST_OFFSET_MS = 9 * 3600_000;

function startsAtJst(utcIso: string): string {
  const jst = new Date(new Date(utcIso).getTime() + JST_OFFSET_MS).toISOString();
  return `${jst.slice(0, 10)} ${jst.slice(11, 16)}`;
}

export interface RunExpirerParams {
  now: Date;
  sender: BookingNotificationSender;
  /** Phase 1-G: 暗号化 token 復号用 */
  env?: { LINE_TOKEN_ENC_KEY?: string };
}

export async function runExpirer(
  db: D1Database,
  params: RunExpirerParams,
): Promise<{ expired: number; idempotencyPurged: number }> {
  const cutoff = new Date(params.now.getTime() - REQUEST_TTL_HOURS * 3600_000).toISOString();
  const stale = await db
    .prepare(
      `SELECT b.id, b.starts_at,
              m.name AS menu_name,
              s.display_name AS staff_name,
              la.channel_access_token,
              f.line_user_id
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         INNER JOIN line_accounts la ON la.id = b.line_account_id
         INNER JOIN friends f ON f.id = b.friend_id
        WHERE b.status = 'requested'
          AND b.requested_at < ?
        LIMIT 200`,
    )
    .bind(cutoff)
    .all<StaleRow>();

  let expired = 0;
  for (const row of stale.results) {
    // 条件付き UPDATE: cron 走行中に admin が同じ予約を承認/拒否した場合、
    // requested 行に対してのみ expired 化する。changes=0 なら後続処理（通知/reminders cancel）
    // をスキップして、誤通知を防ぐ。
    const upd = await db
      .prepare(`UPDATE bookings SET status='expired', decided_at = ? WHERE id = ? AND status = 'requested'`)
      .bind(params.now.toISOString(), row.id)
      .run();
    if ((upd.meta?.changes ?? 0) === 0) continue;
    await db
      .prepare(
        `UPDATE booking_reminders SET status='cancelled' WHERE booking_id = ? AND status IN ('pending','failed')`,
      )
      .bind(row.id)
      .run();
    // Phase 1-G: 暗号化 token を復号
    const { resolveAccessToken } = await import('../lib/account-token.js');
    const token = params.env
      ? await resolveAccessToken(params.env, row.channel_access_token)
      : row.channel_access_token;
    try {
      await params.sender({
        channelAccessToken: token,
        toLineUserId: row.line_user_id,
        kind: 'expired',
        ctx: {
          menuName: row.menu_name,
          staffName: row.staff_name,
          startsAtJst: startsAtJst(row.starts_at),
          hoursBefore: 0,
        },
      });
    } catch {
      // 通知失敗は許容、expirer 自体は完了
    }
    expired++;
  }

  const idempotencyPurged = await purgeExpiredIdempotency(db, params.now);
  return { expired, idempotencyPurged };
}
