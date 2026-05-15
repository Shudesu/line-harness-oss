import {
  createCalendarBooking,
  getReservationResourceById,
  type Reservation,
} from '@line-crm/db';
import { resolveBindingValue, type SecretLike } from './bindings.js';
import { GoogleCalendarClient } from './google-calendar.js';
import { getUsableGoogleCalendarConnection, type GoogleOAuthEnv } from './google-oauth.js';

interface ReservationGoogleCalendarEnv extends GoogleOAuthEnv {
  WORKER_URL?: SecretLike;
  WEB_URL?: SecretLike;
  NEXT_PUBLIC_WEB_URL?: SecretLike;
}

export async function syncReservationCreatedToGoogleCalendar(
  db: D1Database,
  reservation: Reservation,
  env: ReservationGoogleCalendarEnv = {},
): Promise<void> {
  const resource = await getResourceForReservation(db, reservation);
  if (!resource?.google_calendar_connection_id) return;

  const booking = await createCalendarBooking(db, {
    connectionId: resource.google_calendar_connection_id,
    friendId: reservation.friend_id ?? undefined,
    title: reservation.title,
    startAt: reservation.start_at,
    endAt: reservation.end_at,
    metadata: JSON.stringify({ reservationId: reservation.id, source: 'reservations' }),
  });

  const conn = await getUsableGoogleCalendarConnection(db, resource.google_calendar_connection_id, env);
  if (!conn?.access_token) return;

  try {
    const gcal = new GoogleCalendarClient({
      calendarId: conn.calendar_id,
      accessToken: conn.access_token,
    });
    const { eventId } = await gcal.createEvent({
      summary: buildReservationSummary(reservation),
      start: reservation.start_at,
      end: reservation.end_at,
      description: await buildReservationDescription(reservation, env),
    });
    await db
      .prepare(`UPDATE calendar_bookings SET event_id = ?, updated_at = datetime('now') WHERE id = ?`)
      .bind(eventId, booking.id)
      .run();
  } catch (err) {
    await db
      .prepare(
        `INSERT INTO external_sync_tasks
           (id, reservation_id, slot_id, provider, task_type, adjustment_count, status, note, last_error, created_at)
         VALUES (?, ?, ?, 'google_calendar', 'create_event', ?, 'failed', ?, ?, datetime('now'))`,
      )
      .bind(
        crypto.randomUUID(),
        reservation.id,
        reservation.slot_id,
        reservation.total_people,
        'Google Calendar event creation failed',
        err instanceof Error ? err.message : String(err),
      )
      .run();
  }
}

export async function syncReservationCancelledToGoogleCalendar(
  db: D1Database,
  reservation: Reservation,
  env: GoogleOAuthEnv = {},
): Promise<void> {
  const booking = await db
    .prepare(
      `SELECT id, connection_id, event_id
       FROM calendar_bookings
       WHERE json_extract(metadata, '$.reservationId') = ?
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(reservation.id)
    .first<{ id: string; connection_id: string; event_id: string | null }>();

  if (!booking) return;

  await db
    .prepare(`UPDATE calendar_bookings SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`)
    .bind(booking.id)
    .run();

  if (!booking.event_id) return;
  const conn = await getUsableGoogleCalendarConnection(db, booking.connection_id, env);
  if (!conn?.access_token) return;

  try {
    const gcal = new GoogleCalendarClient({
      calendarId: conn.calendar_id,
      accessToken: conn.access_token,
    });
    await gcal.deleteEvent(booking.event_id);
  } catch (err) {
    await db
      .prepare(
        `INSERT INTO external_sync_tasks
           (id, reservation_id, slot_id, provider, task_type, adjustment_count, status, note, last_error, created_at)
         VALUES (?, ?, ?, 'google_calendar', 'cancel_event', ?, 'failed', ?, ?, datetime('now'))`,
      )
      .bind(
        crypto.randomUUID(),
        reservation.id,
        reservation.slot_id,
        reservation.total_people,
        'Google Calendar event cancellation failed',
        err instanceof Error ? err.message : String(err),
      )
      .run();
  }
}

async function getResourceForReservation(db: D1Database, reservation: Reservation) {
  const row = await db
    .prepare(`SELECT resource_id FROM reservation_slots WHERE id = ?`)
    .bind(reservation.slot_id)
    .first<{ resource_id: string }>();
  return row ? getReservationResourceById(db, row.resource_id) : null;
}

function buildReservationSummary(reservation: Reservation): string {
  const source = sourceLabel(reservation.source);
  return `[${source}] ${reservation.title} (${reservation.total_people}名)`;
}

async function buildReservationDescription(
  reservation: Reservation,
  env: ReservationGoogleCalendarEnv,
): Promise<string> {
  const managementUrl = await buildManagementUrl(reservation, env);
  const jalanAmount = reservation.source === 'jalan' ? findJalanTotalAmount(reservation) : null;
  return [
    `予約ID: ${reservation.id}`,
    `予約元: ${sourceLabel(reservation.source)}`,
    reservation.external_reservation_id ? `外部予約番号: ${reservation.external_reservation_id}` : null,
    `状態: ${reservation.status}`,
    `日時: ${reservation.start_at} - ${reservation.end_at}`,
    `人数: 合計${reservation.total_people}名 / 大人${reservation.adult_count}名 / 子ども${reservation.child_count}名 / 幼児${reservation.infant_count}名`,
    `枠消費人数: ${reservation.capacity_people}名`,
    reservation.customer_name_snapshot ? `代表者: ${reservation.customer_name_snapshot}` : null,
    reservation.customer_phone_snapshot ? `電話: ${reservation.customer_phone_snapshot}` : null,
    reservation.customer_email_snapshot ? `メール: ${reservation.customer_email_snapshot}` : null,
    jalanAmount !== null ? `じゃらん合計金額(税込): ${formatYen(jalanAmount)}` : null,
    managementUrl ? `管理画面: ${managementUrl}` : null,
  ].filter(Boolean).join('\n');
}

function sourceLabel(source: Reservation['source']): string {
  const labels: Record<Reservation['source'], string> = {
    line: 'LINE',
    jalan: 'じゃらん',
    phone: '電話',
    gmail: 'Gmail',
    admin: '管理画面',
    mcp: 'MCP',
  };
  return labels[source] ?? source;
}

async function buildManagementUrl(
  reservation: Reservation,
  env: ReservationGoogleCalendarEnv,
): Promise<string | null> {
  const base = await resolveBindingValue(env.WEB_URL)
    || await resolveBindingValue(env.NEXT_PUBLIC_WEB_URL)
    || await resolveBindingValue(env.WORKER_URL);
  if (!base) return null;

  try {
    const url = new URL(base);
    url.searchParams.set('page', 'admin-reservations');
    url.searchParams.set('date', reservation.reservation_date);
    url.searchParams.set('slotId', reservation.slot_id);
    url.searchParams.set('reservationId', reservation.id);
    return url.toString();
  } catch {
    return null;
  }
}

function findJalanTotalAmount(reservation: Reservation): number | null {
  const metadata = parseMetadata(reservation.metadata);
  const parsed = readMoneyCandidate(metadata, [
    'totalAmount',
    'total_amount',
    'totalAmountYen',
    'totalPrice',
    'total_price',
    'amount',
  ]);
  if (parsed !== null) return parsed;
  return typeof reservation.total_amount === 'number' && Number.isFinite(reservation.total_amount)
    ? reservation.total_amount
    : null;
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function readMoneyCandidate(metadata: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string') {
      const parsed = Number.parseInt(value.replace(/[^\d-]/g, ''), 10);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return null;
}

function formatYen(value: number): string {
  return `${new Intl.NumberFormat('ja-JP').format(value)}円`;
}
