import { jstNow } from './utils.js';

// --- 勤怠トークン生成・取得 ---

export async function getOrCreateAttendanceToken(db: D1Database, jobId: string): Promise<string> {
  const row = await db
    .prepare('SELECT attendance_token FROM jobs WHERE id = ?')
    .bind(jobId)
    .first<{ attendance_token: string | null }>();
  if (row?.attendance_token) return row.attendance_token;

  const token = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  await db
    .prepare('UPDATE jobs SET attendance_token = ?, updated_at = ? WHERE id = ?')
    .bind(token, jstNow(), jobId)
    .run();
  return token;
}

export async function getJobByAttendanceToken(
  db: D1Database,
  token: string,
): Promise<{ id: string; nursery_name: string; work_date: string; start_time: string; end_time: string } | null> {
  return db
    .prepare('SELECT id, nursery_name, work_date, start_time, end_time FROM jobs WHERE attendance_token = ?')
    .bind(token)
    .first();
}

// --- チェックイン ---

export async function checkIn(
  db: D1Database,
  bookingId: string,
): Promise<{ check_in_at: string }> {
  const now = jstNow();
  await db
    .prepare('UPDATE calendar_bookings SET check_in_at = ? WHERE id = ?')
    .bind(now, bookingId)
    .run();
  return { check_in_at: now };
}

// --- チェックアウト ---

export async function checkOut(
  db: D1Database,
  bookingId: string,
): Promise<{ check_out_at: string; actual_hours: number }> {
  const now = jstNow();

  // チェックイン時刻を取得して実働時間を計算
  const booking = await db
    .prepare('SELECT check_in_at FROM calendar_bookings WHERE id = ?')
    .bind(bookingId)
    .first<{ check_in_at: string | null }>();

  let actualHours = 0;
  if (booking?.check_in_at) {
    const checkInTime = new Date(booking.check_in_at).getTime();
    const checkOutTime = new Date(now).getTime();
    actualHours = Math.round(((checkOutTime - checkInTime) / (1000 * 60 * 60)) * 100) / 100;
  }

  await db
    .prepare('UPDATE calendar_bookings SET check_out_at = ?, actual_hours = ? WHERE id = ?')
    .bind(now, actualHours, bookingId)
    .run();
  return { check_out_at: now, actual_hours: actualHours };
}

// --- 勤怠ステータス取得 ---

export interface AttendanceStatus {
  booking_id: string;
  friend_id: string | null;
  check_in_at: string | null;
  check_out_at: string | null;
  actual_hours: number | null;
  approval_status: string | null;
}

export async function getBookingForAttendance(
  db: D1Database,
  jobId: string,
  friendId: string,
): Promise<AttendanceStatus | null> {
  return db
    .prepare(
      `SELECT id as booking_id, friend_id, check_in_at, check_out_at, actual_hours, approval_status
       FROM calendar_bookings
       WHERE job_id = ? AND friend_id = ? AND status != 'cancelled'
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(jobId, friendId)
    .first<AttendanceStatus>();
}

// --- 求人の全勤怠一覧（管理者用） ---

export async function getAttendanceByJob(
  db: D1Database,
  jobId: string,
): Promise<AttendanceStatus[]> {
  const result = await db
    .prepare(
      `SELECT id as booking_id, friend_id, check_in_at, check_out_at, actual_hours, approval_status
       FROM calendar_bookings
       WHERE job_id = ? AND status != 'cancelled'
       ORDER BY created_at ASC`,
    )
    .bind(jobId)
    .all<AttendanceStatus>();
  return result.results;
}
