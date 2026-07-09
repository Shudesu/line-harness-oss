import { GoogleCalendarClient } from './google-calendar.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const STATE_SEPARATOR = '.';
const EXPIRY_SKEW_MS = 5 * 60_000;

export interface GoogleOAuthEnv {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export interface SignedCalendarStatePayload {
  staffId: string;
  accountId: string;
}

export interface StaffCalendarConnectionRow {
  id: string;
  staff_id: string;
  google_calendar_id: string;
  refresh_token: string;
  access_token: string | null;
  access_token_expires_at: string | null;
  sync_events: number;
  created_at: string;
  updated_at: string;
}

export interface ValidStaffCalendarToken {
  accessToken: string;
  calendarId: string;
  syncEvents: boolean;
}

type TokenResponse = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
};

type BookingForCalendar = {
  id: string;
  staff_id: string;
  starts_at: string;
  ends_at: string;
  customer_note: string | null;
  external_event_id: string | null;
  menu_name: string;
  friend_name: string | null;
};

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlEncodeText(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

function base64UrlDecodeText(value: string): string {
  return new TextDecoder().decode(base64UrlToBytes(value));
}

function timingSafeEqual(a: string, b: string): boolean {
  const left = base64UrlToBytes(a);
  const right = base64UrlToBytes(b);
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function hmacSha256Base64Url(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return bytesToBase64Url(new Uint8Array(sig));
}

export function isGoogleCalendarConfigured(env: GoogleOAuthEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export async function signCalendarState(
  payload: SignedCalendarStatePayload,
  secret: string,
): Promise<string> {
  const body = base64UrlEncodeText(JSON.stringify(payload));
  const sig = await hmacSha256Base64Url(secret, body);
  return `${body}${STATE_SEPARATOR}${sig}`;
}

export async function verifyCalendarState(
  state: string,
  secret: string,
): Promise<SignedCalendarStatePayload | null> {
  const [body, sig, ...extra] = state.split(STATE_SEPARATOR);
  if (!body || !sig || extra.length > 0) return null;
  const expected = await hmacSha256Base64Url(secret, body);
  try {
    if (!timingSafeEqual(expected, sig)) return null;
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(base64UrlDecodeText(body)) as Record<string, unknown>;
    if (typeof parsed.staffId !== 'string' || typeof parsed.accountId !== 'string') return null;
    return { staffId: parsed.staffId, accountId: parsed.accountId };
  } catch {
    return null;
  }
}

export async function getStaffCalendarConnection(
  db: D1Database,
  staffId: string,
): Promise<StaffCalendarConnectionRow | null> {
  return db
    .prepare(`SELECT * FROM staff_calendar_connections WHERE staff_id = ?`)
    .bind(staffId)
    .first<StaffCalendarConnectionRow>();
}

export async function upsertStaffCalendarConnection(
  db: D1Database,
  input: {
    staffId: string;
    refreshToken: string;
    accessToken?: string | null;
    accessTokenExpiresAt?: string | null;
    calendarId?: string;
  },
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO staff_calendar_connections
        (id, staff_id, google_calendar_id, refresh_token, access_token, access_token_expires_at, sync_events, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(staff_id) DO UPDATE SET
         google_calendar_id = excluded.google_calendar_id,
         refresh_token = excluded.refresh_token,
         access_token = excluded.access_token,
         access_token_expires_at = excluded.access_token_expires_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      crypto.randomUUID(),
      input.staffId,
      input.calendarId ?? 'primary',
      input.refreshToken,
      input.accessToken ?? null,
      input.accessTokenExpiresAt ?? null,
      now,
      now,
    )
    .run();
}

export async function exchangeAuthorizationCode(
  env: Required<GoogleOAuthEnv>,
  code: string,
  redirectUri: string,
): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok) {
    throw new Error(
      `Google OAuth code exchange failed ${res.status}: ${data.error_description ?? data.error ?? ''}`,
    );
  }
  return data;
}

async function refreshAccessToken(
  env: Required<GoogleOAuthEnv>,
  refreshToken: string,
): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.access_token) {
    throw new Error(
      `Google OAuth refresh failed ${res.status}: ${data.error_description ?? data.error ?? ''}`,
    );
  }
  return data;
}

export async function getValidAccessToken(
  db: D1Database,
  staffId: string,
  env: GoogleOAuthEnv,
  now: Date = new Date(),
): Promise<ValidStaffCalendarToken | null> {
  if (!isGoogleCalendarConfigured(env)) return null;
  const requiredEnv = env as Required<GoogleOAuthEnv>;
  const row = await getStaffCalendarConnection(db, staffId);
  if (!row) return null;

  const expiresAt = row.access_token_expires_at
    ? new Date(row.access_token_expires_at).getTime()
    : 0;
  if (row.access_token && expiresAt > now.getTime() + EXPIRY_SKEW_MS) {
    return {
      accessToken: row.access_token,
      calendarId: row.google_calendar_id,
      syncEvents: row.sync_events === 1,
    };
  }

  const refreshed = await refreshAccessToken(requiredEnv, row.refresh_token);
  const expiresIn = typeof refreshed.expires_in === 'number' ? refreshed.expires_in : 3600;
  const nextExpiresAt = new Date(now.getTime() + expiresIn * 1000).toISOString();
  await db
    .prepare(
      `UPDATE staff_calendar_connections
          SET access_token = ?, access_token_expires_at = ?, updated_at = ?
        WHERE staff_id = ?`,
    )
    .bind(refreshed.access_token, nextExpiresAt, new Date().toISOString(), staffId)
    .run();

  return {
    accessToken: refreshed.access_token!,
    calendarId: row.google_calendar_id,
    syncEvents: row.sync_events === 1,
  };
}

async function getBookingForCalendar(
  db: D1Database,
  bookingId: string,
): Promise<BookingForCalendar | null> {
  return db
    .prepare(
      `SELECT b.id, b.staff_id, b.starts_at, b.ends_at, b.customer_note, b.external_event_id,
              m.name AS menu_name,
              f.display_name AS friend_name
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         LEFT JOIN friends f ON f.id = b.friend_id
        WHERE b.id = ?`,
    )
    .bind(bookingId)
    .first<BookingForCalendar>();
}

function eventDescription(row: BookingForCalendar): string {
  const parts = [`メニュー: ${row.menu_name}`];
  const note = row.customer_note?.trim();
  if (note) parts.push(`備考: ${note}`);
  return parts.join('\n');
}

export async function syncBookingEventCreate(
  db: D1Database,
  bookingId: string,
  env: GoogleOAuthEnv,
): Promise<void> {
  if (!isGoogleCalendarConfigured(env)) return;
  const row = await getBookingForCalendar(db, bookingId);
  if (!row || row.external_event_id) return;

  const token = await getValidAccessToken(db, row.staff_id, env);
  if (!token || !token.syncEvents) return;

  const client = new GoogleCalendarClient({
    calendarId: token.calendarId,
    accessToken: token.accessToken,
  });
  const created = await client.createEvent({
    summary: `面接: ${row.friend_name || 'お客様'}`,
    description: eventDescription(row),
    start: row.starts_at,
    end: row.ends_at,
  });

  await db
    .prepare(
      `UPDATE bookings
          SET external_event_id = ?, external_calendar_id = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ? AND (external_event_id IS NULL OR external_event_id = '')`,
    )
    .bind(created.eventId, token.calendarId, bookingId)
    .run();
}

export async function syncBookingEventDelete(
  db: D1Database,
  bookingId: string,
  env: GoogleOAuthEnv,
): Promise<void> {
  if (!isGoogleCalendarConfigured(env)) return;
  const row = await db
    .prepare(
      `SELECT id, staff_id, external_event_id
         FROM bookings
        WHERE id = ?`,
    )
    .bind(bookingId)
    .first<{ id: string; staff_id: string; external_event_id: string | null }>();
  if (!row?.external_event_id) return;

  const token = await getValidAccessToken(db, row.staff_id, env);
  if (!token) return;

  const client = new GoogleCalendarClient({
    calendarId: token.calendarId,
    accessToken: token.accessToken,
  });
  await client.deleteEvent(row.external_event_id);

  await db
    .prepare(
      `UPDATE bookings
          SET external_event_id = NULL, external_calendar_id = NULL,
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ?`,
    )
    .bind(bookingId)
    .run();
}
