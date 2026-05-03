import {
  createCalendarBooking,
  getReservationResourceById,
  type Reservation,
} from '@line-crm/db';
import { GoogleCalendarClient } from './google-calendar.js';
import { getUsableGoogleCalendarConnection, type GoogleOAuthEnv } from './google-oauth.js';

export async function syncReservationCreatedToGoogleCalendar(
  db: D1Database,
  reservation: Reservation,
  env: GoogleOAuthEnv = {},
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
      summary: reservation.title,
      start: reservation.start_at,
      end: reservation.end_at,
      description: buildReservationDescription(reservation),
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

function buildReservationDescription(reservation: Reservation): string {
  return [
    `Reservation ID: ${reservation.id}`,
    `Status: ${reservation.status}`,
    `People: ${reservation.total_people}`,
    reservation.customer_name_snapshot ? `Customer: ${reservation.customer_name_snapshot}` : null,
    reservation.customer_phone_snapshot ? `Phone: ${reservation.customer_phone_snapshot}` : null,
    reservation.customer_email_snapshot ? `Email: ${reservation.customer_email_snapshot}` : null,
  ].filter(Boolean).join('\n');
}
