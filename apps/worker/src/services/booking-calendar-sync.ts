import { GoogleCalendarClient, type BusyInterval } from './google-calendar.js';
import { getGoogleServiceAccountToken } from './google-service-account.js';
import {
  refreshGoogleOAuthAccessToken,
  type GoogleCalendarCredentials,
} from './google-oauth.js';

export interface StaffCalendarConnection {
  id: string;
  calendar_id: string;
  auth_type: string;
  access_token: string | null;
  refresh_token: string | null;
}

export async function getStaffCalendarConnection(
  db: D1Database,
  lineAccountId: string,
  staffId: string,
): Promise<StaffCalendarConnection | null> {
  return db
    .prepare(
      `SELECT id, calendar_id, auth_type, access_token, refresh_token
         FROM google_calendar_connections
        WHERE line_account_id = ? AND staff_id = ? AND is_active = 1
        LIMIT 1`,
    )
    .bind(lineAccountId, staffId)
    .first<StaffCalendarConnection>();
}

async function clientForConnection(
  connection: StaffCalendarConnection,
  credentials: GoogleCalendarCredentials,
): Promise<GoogleCalendarClient> {
  let accessToken: string | null | undefined;
  if (connection.auth_type === 'service_account') {
    accessToken = await getGoogleServiceAccountToken(credentials);
  } else if (connection.auth_type === 'oauth' && connection.refresh_token) {
    const clientId = credentials.oauthClientId?.trim();
    const clientSecret = credentials.oauthClientSecret?.trim();
    if (!clientId || !clientSecret) throw new Error('google_oauth_client_not_configured');
    // access_token の期限列を持たない既存スキーマでも確実に動くよう、利用時に更新する。
    // 更新トークンは長期保持し、短命なアクセストークンだけを毎回取り直す。
    accessToken = await refreshGoogleOAuthAccessToken({
      refreshToken: connection.refresh_token,
      clientId,
      clientSecret,
    });
  } else {
    accessToken = connection.access_token;
  }
  if (!accessToken) throw new Error('google_calendar_access_token_missing');
  return new GoogleCalendarClient({ calendarId: connection.calendar_id, accessToken });
}

export async function getStaffGoogleBusy(
  db: D1Database,
  credentials: GoogleCalendarCredentials,
  input: { lineAccountId: string; staffId: string; timeMin: string; timeMax: string },
): Promise<BusyInterval[] | null> {
  const connection = await getStaffCalendarConnection(db, input.lineAccountId, input.staffId);
  if (!connection) return null;
  const client = await clientForConnection(connection, credentials);
  return client.getFreeBusy(input.timeMin, input.timeMax);
}

export async function verifyStaffCalendarConnection(
  connection: StaffCalendarConnection,
  credentials: GoogleCalendarCredentials,
): Promise<void> {
  const client = await clientForConnection(connection, credentials);
  const now = new Date();
  await client.getFreeBusy(now.toISOString(), new Date(now.getTime() + 60_000).toISOString());
}

/** Create the external event once a booking becomes confirmed. */
export async function syncConfirmedBookingToGoogle(
  db: D1Database,
  credentials: GoogleCalendarCredentials,
  bookingId: string,
  options: { addGoogleMeet?: boolean } = {},
): Promise<{ synced: boolean; eventId?: string; calendarId?: string; meetUrl?: string }> {
  const row = await db
    .prepare(
      `SELECT b.id, b.starts_at, b.ends_at, b.customer_note, b.external_event_id,
              f.display_name AS friend_name, m.name AS menu_name,
              s.display_name AS staff_name,
              gc.id AS connection_id, gc.calendar_id, gc.auth_type,
              gc.access_token, gc.refresh_token
         FROM bookings b
         INNER JOIN friends f ON f.id = b.friend_id
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         LEFT JOIN google_calendar_connections gc
           ON gc.line_account_id = b.line_account_id
          AND gc.staff_id = b.staff_id
          AND gc.is_active = 1
        WHERE b.id = ? AND b.status = 'confirmed'`,
    )
    .bind(bookingId)
    .first<{
      id: string;
      starts_at: string;
      ends_at: string;
      customer_note: string | null;
      external_event_id: string | null;
      friend_name: string | null;
      menu_name: string;
      staff_name: string;
      connection_id: string | null;
      calendar_id: string | null;
      auth_type: string | null;
      access_token: string | null;
      refresh_token: string | null;
    }>();
  if (!row || row.external_event_id || !row.connection_id || !row.calendar_id || !row.auth_type) {
    return { synced: false };
  }

  const connection: StaffCalendarConnection = {
    id: row.connection_id,
    calendar_id: row.calendar_id,
    auth_type: row.auth_type,
    access_token: row.access_token,
    refresh_token: row.refresh_token,
  };
  const client = await clientForConnection(connection, credentials);
  const created = await client.createEvent({
    // Google event IDはbase32hexのみ。UUIDのハイフンを除けば0-9/a-fだけとなり有効。
    externalId: row.id.replace(/-/g, '').toLowerCase(),
    summary: `${row.friend_name ?? 'お客様'}｜${row.menu_name}`,
    start: row.starts_at,
    end: row.ends_at,
    description: [
      `L Harness予約（担当: ${row.staff_name}）`,
      `予約ID: ${row.id}`,
      row.customer_note ? `メモ: ${row.customer_note}` : '',
    ].filter(Boolean).join('\n'),
    addGoogleMeet: options.addGoogleMeet,
  });
  await db
    .prepare(
      `UPDATE bookings
          SET external_event_id = ?, external_calendar_id = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ? AND external_event_id IS NULL`,
    )
    .bind(created.eventId, row.calendar_id, bookingId)
    .run();
  return {
    synced: true,
    eventId: created.eventId,
    calendarId: row.calendar_id,
    meetUrl: created.meetUrl,
  };
}

export async function removeBookingFromGoogle(
  db: D1Database,
  credentials: GoogleCalendarCredentials,
  bookingId: string,
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT b.external_event_id, b.external_calendar_id,
              gc.id, gc.auth_type, gc.access_token, gc.refresh_token
         FROM bookings b
         LEFT JOIN google_calendar_connections gc
           ON gc.calendar_id = b.external_calendar_id
          AND gc.staff_id = b.staff_id
          AND gc.is_active = 1
        WHERE b.id = ?`,
    )
    .bind(bookingId)
    .first<{
      external_event_id: string | null;
      external_calendar_id: string | null;
      id: string | null;
      auth_type: string | null;
      access_token: string | null;
      refresh_token: string | null;
    }>();
  if (!row?.external_event_id || !row.external_calendar_id || !row.id || !row.auth_type) return;
  const client = await clientForConnection({
    id: row.id,
    calendar_id: row.external_calendar_id,
    auth_type: row.auth_type,
    access_token: row.access_token,
    refresh_token: row.refresh_token,
  }, credentials);
  await client.deleteEvent(row.external_event_id);
}
