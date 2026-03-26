import { jstNow } from './utils.js';
// Google Calendar 連携クエリヘルパー

export interface GoogleCalendarConnectionRow {
  id: string;
  calendar_id: string;
  access_token: string | null;
  refresh_token: string | null;
  api_key: string | null;
  auth_type: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CalendarBookingRow {
  id: string;
  connection_id: string;
  friend_id: string | null;
  event_id: string | null;
  title: string;
  start_at: string;
  end_at: string;
  status: string;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  // 承認制フロー（011_lstep_migration）
  approval_status: string | null;
  approved_at: string | null;
  approval_note: string | null;
  job_id: string | null;
}

// --- 接続管理 ---

export async function getCalendarConnections(db: D1Database): Promise<GoogleCalendarConnectionRow[]> {
  const result = await db.prepare(`SELECT * FROM google_calendar_connections ORDER BY created_at DESC`).all<GoogleCalendarConnectionRow>();
  return result.results;
}

export async function getCalendarConnectionById(db: D1Database, id: string): Promise<GoogleCalendarConnectionRow | null> {
  return db.prepare(`SELECT * FROM google_calendar_connections WHERE id = ?`).bind(id).first<GoogleCalendarConnectionRow>();
}

export async function createCalendarConnection(
  db: D1Database,
  input: { calendarId: string; authType: string; accessToken?: string; refreshToken?: string; apiKey?: string },
): Promise<GoogleCalendarConnectionRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(`INSERT INTO google_calendar_connections (id, calendar_id, auth_type, access_token, refresh_token, api_key, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.calendarId, input.authType, input.accessToken ?? null, input.refreshToken ?? null, input.apiKey ?? null, now, now)
    .run();
  return (await getCalendarConnectionById(db, id))!;
}

export async function deleteCalendarConnection(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM google_calendar_connections WHERE id = ?`).bind(id).run();
}

// --- 予約管理 ---

export async function getCalendarBookings(db: D1Database, opts: { connectionId?: string; friendId?: string } = {}): Promise<CalendarBookingRow[]> {
  if (opts.friendId) {
    const result = await db.prepare(`SELECT * FROM calendar_bookings WHERE friend_id = ? ORDER BY start_at ASC`).bind(opts.friendId).all<CalendarBookingRow>();
    return result.results;
  }
  if (opts.connectionId) {
    const result = await db.prepare(`SELECT * FROM calendar_bookings WHERE connection_id = ? ORDER BY start_at ASC`).bind(opts.connectionId).all<CalendarBookingRow>();
    return result.results;
  }
  const result = await db.prepare(`SELECT * FROM calendar_bookings ORDER BY start_at ASC`).all<CalendarBookingRow>();
  return result.results;
}

export async function getCalendarBookingById(db: D1Database, id: string): Promise<CalendarBookingRow | null> {
  return db.prepare(`SELECT * FROM calendar_bookings WHERE id = ?`).bind(id).first<CalendarBookingRow>();
}

export async function createCalendarBooking(
  db: D1Database,
  input: { connectionId: string; friendId?: string; eventId?: string; title: string; startAt: string; endAt: string; metadata?: string },
): Promise<CalendarBookingRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(`INSERT INTO calendar_bookings (id, connection_id, friend_id, event_id, title, start_at, end_at, metadata, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.connectionId, input.friendId ?? null, input.eventId ?? null, input.title, input.startAt, input.endAt, input.metadata ?? null, now, now)
    .run();
  return (await getCalendarBookingById(db, id))!;
}

export async function updateCalendarBookingStatus(db: D1Database, id: string, status: string): Promise<void> {
  await db.prepare(`UPDATE calendar_bookings SET status = ?, updated_at = ? WHERE id = ?`)
    .bind(status, jstNow(), id).run();
}

export async function updateCalendarBookingEventId(db: D1Database, id: string, eventId: string): Promise<void> {
  await db.prepare(`UPDATE calendar_bookings SET event_id = ?, updated_at = ? WHERE id = ?`)
    .bind(eventId, jstNow(), id).run();
}

/** 空きスロット計算用: 指定日範囲の予約一覧を取得 */
export async function getBookingsInRange(db: D1Database, connectionId: string, startAt: string, endAt: string): Promise<CalendarBookingRow[]> {
  const result = await db
    .prepare(`SELECT * FROM calendar_bookings WHERE connection_id = ? AND start_at >= ? AND end_at <= ? AND status != 'cancelled' ORDER BY start_at ASC`)
    .bind(connectionId, startAt, endAt)
    .all<CalendarBookingRow>();
  return result.results;
}

// --- 承認制フロー ---

export async function approveBooking(db: D1Database, id: string, note?: string): Promise<void> {
  const now = jstNow();
  await db
    .prepare(`UPDATE calendar_bookings SET approval_status = 'approved', approved_at = ?, approval_note = ?, status = 'confirmed', updated_at = ? WHERE id = ?`)
    .bind(now, note ?? null, now, id)
    .run();
}

export async function denyBooking(db: D1Database, id: string, note?: string): Promise<void> {
  const now = jstNow();
  await db
    .prepare(`UPDATE calendar_bookings SET approval_status = 'denied', approved_at = ?, approval_note = ?, status = 'cancelled', updated_at = ? WHERE id = ?`)
    .bind(now, note ?? null, now, id)
    .run();
}

/** 承認待ちの予約一覧を取得 */
export async function getPendingBookings(db: D1Database): Promise<CalendarBookingRow[]> {
  const result = await db
    .prepare(`SELECT * FROM calendar_bookings WHERE approval_status = 'pending' AND status != 'cancelled' ORDER BY start_at ASC`)
    .all<CalendarBookingRow>();
  return result.results;
}
