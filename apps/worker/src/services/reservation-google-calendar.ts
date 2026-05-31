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

export type ReservationGoogleCalendarSyncResult =
  | { status: 'created'; reservationId: string; bookingId: string; eventId: string }
  | { status: 'already_synced'; reservationId: string; bookingId: string; eventId: string }
  | { status: 'skipped'; reservationId: string; reason: 'resource_not_found' | 'resource_not_connected' | 'connection_not_usable' }
  | { status: 'failed'; reservationId: string; reason: string };

export type ReservationGoogleCalendarResyncSource = 'line' | 'jalan' | 'web';

export interface ReservationGoogleCalendarBulkResyncInput {
  dateFrom: string;
  dateTo: string;
  resourceId?: string | null;
  sources?: ReservationGoogleCalendarResyncSource[];
  limit?: number;
}

export interface ReservationGoogleCalendarBulkResyncResult {
  scannedCount: number;
  resetBookingCount: number;
  deletedEventCount: number;
  deleteFailedCount: number;
  createdCount: number;
  alreadySyncedCount: number;
  skippedCount: number;
  failedCount: number;
  items: Array<{
    reservationId: string;
    source: Reservation['source'];
    title: string;
    reservationDate: string;
    reset: {
      bookingCount: number;
      deletedEventCount: number;
      deleteFailedCount: number;
      errors: string[];
    };
    sync: ReservationGoogleCalendarSyncResult;
  }>;
}

export async function syncReservationCreatedToGoogleCalendar(
  db: D1Database,
  reservation: Reservation,
  env: ReservationGoogleCalendarEnv = {},
): Promise<ReservationGoogleCalendarSyncResult> {
  const resource = await getResourceForReservation(db, reservation);
  if (!resource) return { status: 'skipped', reservationId: reservation.id, reason: 'resource_not_found' };
  if (!resource.google_calendar_connection_id) {
    return { status: 'skipped', reservationId: reservation.id, reason: 'resource_not_connected' };
  }

  const booking = await getOrCreateCalendarBooking(db, reservation, resource.google_calendar_connection_id);
  if (booking.event_id) {
    return { status: 'already_synced', reservationId: reservation.id, bookingId: booking.id, eventId: booking.event_id };
  }

  let conn;
  try {
    conn = await getUsableGoogleCalendarConnection(db, resource.google_calendar_connection_id, env);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await insertGoogleCalendarSyncFailure(db, reservation, 'Google Calendar connection refresh failed', reason);
    return { status: 'failed', reservationId: reservation.id, reason };
  }
  if (!conn?.access_token) {
    return { status: 'skipped', reservationId: reservation.id, reason: 'connection_not_usable' };
  }

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
    return { status: 'created', reservationId: reservation.id, bookingId: booking.id, eventId };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await insertGoogleCalendarSyncFailure(db, reservation, 'Google Calendar event creation failed', reason);
    return { status: 'failed', reservationId: reservation.id, reason };
  }
}

export async function resetAndResyncReservationsToGoogleCalendar(
  db: D1Database,
  input: ReservationGoogleCalendarBulkResyncInput,
  env: ReservationGoogleCalendarEnv = {},
): Promise<ReservationGoogleCalendarBulkResyncResult> {
  const sources = input.sources?.length ? input.sources : ['line', 'jalan', 'web'];
  const reservations = await listReservationsForCalendarResync(db, {
    ...input,
    sources,
    limit: Math.min(Math.max(input.limit ?? 500, 1), 1000),
  });
  const items: ReservationGoogleCalendarBulkResyncResult['items'] = [];

  for (const reservation of reservations) {
    const reset = await resetCalendarBookingsForReservation(db, reservation, env);
    const sync = await syncReservationCreatedToGoogleCalendar(db, reservation, env);
    items.push({
      reservationId: reservation.id,
      source: reservation.source,
      title: reservation.title,
      reservationDate: reservation.reservation_date,
      reset,
      sync,
    });
  }

  return {
    scannedCount: reservations.length,
    resetBookingCount: items.reduce((sum, item) => sum + item.reset.bookingCount, 0),
    deletedEventCount: items.reduce((sum, item) => sum + item.reset.deletedEventCount, 0),
    deleteFailedCount: items.reduce((sum, item) => sum + item.reset.deleteFailedCount, 0),
    createdCount: items.filter((item) => item.sync.status === 'created').length,
    alreadySyncedCount: items.filter((item) => item.sync.status === 'already_synced').length,
    skippedCount: items.filter((item) => item.sync.status === 'skipped').length,
    failedCount: items.filter((item) => item.sync.status === 'failed').length,
    items,
  };
}

async function listReservationsForCalendarResync(
  db: D1Database,
  input: Required<Pick<ReservationGoogleCalendarBulkResyncInput, 'dateFrom' | 'dateTo' | 'sources' | 'limit'>> & {
    resourceId?: string | null;
  },
): Promise<Reservation[]> {
  const sourcePlaceholders = input.sources.map(() => '?').join(', ');
  const resourceFilter = input.resourceId ? 'AND s.resource_id = ?' : '';
  const params: unknown[] = [
    input.dateFrom,
    input.dateTo,
    ...input.sources,
  ];
  if (input.resourceId) params.push(input.resourceId);
  params.push(input.limit);

  const result = await db
    .prepare(
      `SELECT r.*,
              COALESCE((SELECT SUM(amount) FROM reservation_items WHERE reservation_id = r.id), NULL) AS total_amount
       FROM reservations r
       JOIN reservation_slots s ON s.id = r.slot_id
       WHERE r.status IN ('pending', 'confirmed')
         AND r.reservation_date BETWEEN ? AND ?
         AND r.source IN (${sourcePlaceholders})
         ${resourceFilter}
       ORDER BY r.start_at ASC, r.created_at ASC
       LIMIT ?`,
    )
    .bind(...params)
    .all<Reservation>();

  return result.results ?? [];
}

async function resetCalendarBookingsForReservation(
  db: D1Database,
  reservation: Reservation,
  env: ReservationGoogleCalendarEnv,
): Promise<{
  bookingCount: number;
  deletedEventCount: number;
  deleteFailedCount: number;
  errors: string[];
}> {
  const bookings = await db
    .prepare(
      `SELECT id, connection_id, event_id
       FROM calendar_bookings
       WHERE json_extract(metadata, '$.reservationId') = ?
         AND status != 'cancelled'
       ORDER BY created_at DESC`,
    )
    .bind(reservation.id)
    .all<{ id: string; connection_id: string; event_id: string | null }>();

  let deletedEventCount = 0;
  let deleteFailedCount = 0;
  const errors: string[] = [];

  for (const booking of bookings.results ?? []) {
    if (!booking.event_id) continue;
    try {
      const conn = await getUsableGoogleCalendarConnection(db, booking.connection_id, env);
      if (!conn?.access_token) throw new Error('Google Calendar connection is not usable');
      const gcal = new GoogleCalendarClient({
        calendarId: conn.calendar_id,
        accessToken: conn.access_token,
      });
      await gcal.deleteEvent(booking.event_id);
      deletedEventCount += 1;
    } catch (err) {
      deleteFailedCount += 1;
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  for (const booking of bookings.results ?? []) {
    await db
      .prepare(`UPDATE calendar_bookings SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`)
      .bind(booking.id)
      .run();
  }

  return {
    bookingCount: bookings.results?.length ?? 0,
    deletedEventCount,
    deleteFailedCount,
    errors,
  };
}

async function insertGoogleCalendarSyncFailure(
  db: D1Database,
  reservation: Reservation,
  note: string,
  reason: string,
): Promise<void> {
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
        note,
        reason,
      )
      .run();
}

async function getOrCreateCalendarBooking(
  db: D1Database,
  reservation: Reservation,
  connectionId: string,
): Promise<{ id: string; event_id: string | null }> {
  const existing = await db
    .prepare(
      `SELECT id, event_id
       FROM calendar_bookings
       WHERE json_extract(metadata, '$.reservationId') = ?
         AND status != 'cancelled'
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(reservation.id)
    .first<{ id: string; event_id: string | null }>();
  if (existing) return existing;

  const created = await createCalendarBooking(db, {
    connectionId,
    friendId: reservation.friend_id ?? undefined,
    title: reservation.title,
    startAt: reservation.start_at,
    endAt: reservation.end_at,
    metadata: JSON.stringify({ reservationId: reservation.id, source: 'reservations' }),
  });
  return { id: created.id, event_id: created.event_id };
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
  const price = findReservationPriceDetails(reservation);
  return [
    `名前: ${reservation.customer_name_snapshot || reservation.title}`,
    `人数: 合計${reservation.total_people}名 / 大人${reservation.adult_count}名 / 小学生${reservation.child_count}名 / 幼児${reservation.infant_count}名 / 3歳以下${reservation.under_three_count}名`,
    price ? `料金: ${formatPriceDetails(price)}` : null,
    managementUrl ? `管理画面: ${managementUrl}` : null,
  ].filter(Boolean).join('\n');
}

function sourceLabel(source: Reservation['source']): string {
  const labels: Record<Reservation['source'], string> = {
    line: 'LINE',
    web: 'Web',
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
    || 'https://line-harness-reservation-web.pages.dev';
  if (!base) return null;

  try {
    const url = new URL(base);
    url.pathname = '/reservation-ops';
    return url.toString();
  } catch {
    return null;
  }
}

type ReservationPriceDetails = {
  totalAmount: number | null;
  pointAmount: number | null;
  couponAmount: number | null;
  customerChargeAmount: number | null;
};

function findReservationPriceDetails(reservation: Reservation): ReservationPriceDetails | null {
  const metadata = parseMetadata(reservation.metadata);
  const totalAmount = readMoneyCandidate(metadata, [
    'totalAmount',
    'total_amount',
    'totalAmountYen',
    'totalPrice',
    'total_price',
    'amount',
  ]);
  const fallbackTotal = typeof reservation.total_amount === 'number' && Number.isFinite(reservation.total_amount)
    ? reservation.total_amount
    : null;
  const price = {
    totalAmount: totalAmount ?? fallbackTotal,
    pointAmount: readMoneyCandidate(metadata, ['pointAmount', 'point_amount', 'pointsAmount', 'points_amount']),
    couponAmount: readMoneyCandidate(metadata, ['couponAmount', 'coupon_amount']),
    customerChargeAmount: readMoneyCandidate(metadata, ['customerChargeAmount', 'customer_charge_amount', 'chargeAmount', 'charge_amount']),
  };
  return Object.values(price).some((value) => value !== null) ? price : null;
}

function formatPriceDetails(price: ReservationPriceDetails): string {
  return [
    price.totalAmount !== null ? `合計 ${formatYen(price.totalAmount)}` : null,
    price.pointAmount !== null ? `ポイント ${formatYen(price.pointAmount)}` : null,
    price.couponAmount !== null ? `クーポン ${formatYen(price.couponAmount)}` : null,
    price.customerChargeAmount !== null ? `請求 ${formatYen(price.customerChargeAmount)}` : null,
  ].filter(Boolean).join(' / ');
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
