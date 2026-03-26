/**
 * 求人リマインド＆口コミ依頼 — cronトリガーで5分毎に実行
 *
 * - 前日 18:00: 「明日は〇〇園です」
 * - 当日 07:00: 「本日〇時〜 〇〇園です」
 * - 勤務終了 2時間後: 「お疲れ様でした！口コミをお願いします」
 */

import { getFriendById, getProfileByFriendId, jstNow } from '@line-crm/db';
import type { LineClient } from '@line-crm/line-sdk';

interface BookingWithJob {
  booking_id: string;
  friend_id: string;
  job_id: string;
  nursery_name: string;
  work_date: string;
  start_time: string;
  end_time: string;
  address: string | null;
  reminder_day_before_sent: number;
  reminder_day_of_sent: number;
  review_request_sent: number;
}

function getJstNow(): Date {
  const now = new Date();
  // UTC → JST (+9h)
  return new Date(now.getTime() + 9 * 60 * 60_000);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getMonth() + 1}月${d.getDate()}日(${weekdays[d.getDay()]})`;
}

export async function processJobReminders(
  db: D1Database,
  lineClient: LineClient,
): Promise<void> {
  const jstNowDate = getJstNow();
  const todayStr = `${jstNowDate.getFullYear()}-${String(jstNowDate.getMonth() + 1).padStart(2, '0')}-${String(jstNowDate.getDate()).padStart(2, '0')}`;
  const hour = jstNowDate.getHours();
  const minute = jstNowDate.getMinutes();

  // 翌日の日付
  const tomorrow = new Date(jstNowDate);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

  // 求人付き予約を取得（confirmed のみ）
  const bookings = await db
    .prepare(`
      SELECT
        cb.id as booking_id,
        cb.friend_id,
        cb.job_id,
        j.nursery_name,
        j.work_date,
        j.start_time,
        j.end_time,
        j.address,
        cb.reminder_day_before_sent,
        cb.reminder_day_of_sent,
        cb.review_request_sent
      FROM calendar_bookings cb
      JOIN jobs j ON cb.job_id = j.id
      WHERE cb.status = 'confirmed'
        AND cb.friend_id IS NOT NULL
        AND cb.job_id IS NOT NULL
        AND j.work_date >= ?
    `)
    .bind(todayStr)
    .all<BookingWithJob>();

  if (!bookings.results.length) return;

  for (const b of bookings.results) {
    try {
      // ========== 前日リマインド (18:00以降) ==========
      if (
        b.work_date === tomorrowStr &&
        !b.reminder_day_before_sent &&
        hour >= 18
      ) {
        await sendReminder(db, lineClient, b, 'day_before');
      }

      // ========== 当日リマインド (07:00以降) ==========
      if (
        b.work_date === todayStr &&
        !b.reminder_day_of_sent &&
        hour >= 7
      ) {
        await sendReminder(db, lineClient, b, 'day_of');
      }
    } catch (err) {
      console.error(`Job reminder error (booking ${b.booking_id}):`, err);
    }
  }

  // ========== 口コミ依頼（勤務終了2時間後） ==========
  const pastBookings = await db
    .prepare(`
      SELECT
        cb.id as booking_id,
        cb.friend_id,
        cb.job_id,
        j.nursery_name,
        j.work_date,
        j.start_time,
        j.end_time,
        j.address,
        cb.reminder_day_before_sent,
        cb.reminder_day_of_sent,
        cb.review_request_sent
      FROM calendar_bookings cb
      JOIN jobs j ON cb.job_id = j.id
      WHERE cb.status = 'confirmed'
        AND cb.friend_id IS NOT NULL
        AND cb.job_id IS NOT NULL
        AND cb.review_request_sent = 0
        AND j.work_date = ?
    `)
    .bind(todayStr)
    .all<BookingWithJob>();

  for (const b of pastBookings.results) {
    try {
      const [endH, endM] = b.end_time.split(':').map(Number);
      const endMinutes = endH * 60 + endM;
      const nowMinutes = hour * 60 + minute;

      // 勤務終了2時間後かつ21時まで
      if (nowMinutes >= endMinutes + 120 && hour <= 21) {
        await sendReviewRequest(db, lineClient, b);
      }
    } catch (err) {
      console.error(`Review request error (booking ${b.booking_id}):`, err);
    }
  }
}

async function sendReminder(
  db: D1Database,
  lineClient: LineClient,
  booking: BookingWithJob,
  type: 'day_before' | 'day_of',
): Promise<void> {
  const friend = await getFriendById(db, booking.friend_id);
  if (!friend || !friend.is_following) return;

  // プロフィールから本名を取得
  const profile = await getProfileByFriendId(db, booking.friend_id);
  const name = profile?.real_name || friend.display_name || '';

  const dateStr = formatDate(booking.work_date);
  let message: string;

  if (type === 'day_before') {
    message = [
      `${name}様`,
      '',
      `明日のお仕事のリマインドです。`,
      '',
      `📍 ${booking.nursery_name}`,
      `📅 ${dateStr}`,
      `⏰ ${booking.start_time}〜${booking.end_time}`,
      booking.address ? `📌 ${booking.address}` : '',
      '',
      `お気をつけてお越しください。`,
      `ご不明点があればお気軽にメッセージください。`,
    ].filter(Boolean).join('\n');
  } else {
    message = [
      `${name}様`,
      '',
      `本日のお仕事のリマインドです。`,
      '',
      `📍 ${booking.nursery_name}`,
      `⏰ ${booking.start_time}〜${booking.end_time}`,
      booking.address ? `📌 ${booking.address}` : '',
      '',
      `本日もよろしくお願いいたします！`,
    ].filter(Boolean).join('\n');
  }

  await lineClient.pushMessage(friend.line_user_id, [
    { type: 'text', text: message },
  ]);

  // フラグ更新
  const column = type === 'day_before' ? 'reminder_day_before_sent' : 'reminder_day_of_sent';
  await db
    .prepare(`UPDATE calendar_bookings SET ${column} = 1 WHERE id = ?`)
    .bind(booking.booking_id)
    .run();

  // メッセージログ
  await db
    .prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at)
       VALUES (?, ?, 'outgoing', 'text', ?, ?)`,
    )
    .bind(crypto.randomUUID(), friend.id, message, jstNow())
    .run();
}

async function sendReviewRequest(
  db: D1Database,
  lineClient: LineClient,
  booking: BookingWithJob,
): Promise<void> {
  const friend = await getFriendById(db, booking.friend_id);
  if (!friend || !friend.is_following) return;

  const profile = await getProfileByFriendId(db, booking.friend_id);
  const name = profile?.real_name || friend.display_name || '';

  const message = [
    `${name}様`,
    '',
    `本日は${booking.nursery_name}でのお仕事、お疲れ様でした！`,
    '',
    `よろしければ、園の雰囲気や働きやすさについて口コミをお聞かせください。`,
    `今後応募される方の参考になります。`,
    '',
    `「口コミを書く」とメッセージを送ってください。`,
  ].join('\n');

  await lineClient.pushMessage(friend.line_user_id, [
    { type: 'text', text: message },
  ]);

  // フラグ更新
  await db
    .prepare('UPDATE calendar_bookings SET review_request_sent = 1 WHERE id = ?')
    .bind(booking.booking_id)
    .run();

  // メッセージログ
  await db
    .prepare(
      `INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at)
       VALUES (?, ?, 'outgoing', 'text', ?, ?)`,
    )
    .bind(crypto.randomUUID(), friend.id, message, jstNow())
    .run();
}
