import { Hono } from 'hono';
import {
  createReservationWithCapacityCheck,
  calculateReservationPeople,
  getReservationById,
  getReservationSlotAvailability,
  getReservationMenuById,
  getReservationResourceById,
  listReservationResources,
  listReservationMenus,
  listReservationSlots,
  listReservations,
  updateReservationStatus,
} from '@line-crm/db';
import type { Env } from '../../index.js';
import {
  reservationTokenSecret,
  secondsFromNow,
  signReservationToken,
  verifyReservationToken,
} from '../../services/reservation-tokens.js';
import {
  syncReservationCancelledToGoogleCalendar,
  syncReservationCreatedToGoogleCalendar,
} from '../../services/reservation-google-calendar.js';
import { sendWebReservationConfirmationEmail } from '../../services/reservation-email.js';
import { notifyReservationToDiscord } from '../../services/discord-notifications.js';
import { issueGuestReservationSession, issueReservationSession, requireReservationSession } from './auth.js';
import {
  jsonError,
  jsonOk,
  codeForCreateReservationFailure,
  statusForCreateReservationFailure,
} from './responses.js';
import {
  parseReservationCreateBody,
  parseReservationStatusValue,
  queryPositiveInt,
  queryRequired,
  readJsonObject,
} from './requests.js';
import { toMenuResponse, toReservationResponse, toResourceResponse } from './serializers.js';
import { canAccessReservation } from './validators.js';

const publicReservations = new Hono<Env>();

publicReservations.post('/api/public/reservation-session', async (c) => {
  try {
    const body = await c.req.json<{ idToken?: string; displayName?: string | null }>();
    const result = await issueReservationSession(c, body);
    if (!result.ok) {
      if (result.status === 400) return jsonError(c, 'bad_request', 400, result.error);
      if (result.status === 401) return jsonError(c, 'unauthorized', 401, result.error);
      return jsonError(c, 'not_found', 404, result.error);
    }
    return jsonOk(c, result.data);
  } catch (err) {
    console.error('POST /api/public/reservation-session error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

publicReservations.post('/api/public/reservation-session/guest', async (c) => {
  try {
    const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
    const result = await issueGuestReservationSession(c, {
      channel: body.channel,
      ref: body.ref,
      utmSource: body.utmSource,
      utmMedium: body.utmMedium,
      utmCampaign: body.utmCampaign,
    });
    return jsonOk(c, result.data);
  } catch (err) {
    console.error('POST /api/public/reservation-session/guest error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

publicReservations.get('/api/public/reservation-resources', async (c) => {
  try {
    const resources = await listReservationResources(c.env.DB);
    return jsonOk(c, resources.filter((resource) => resource.is_active === 1).map(toResourceResponse));
  } catch (err) {
    console.error('GET /api/public/reservation-resources error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

publicReservations.get('/api/public/reservation-resources/:resourceId/menus', async (c) => {
  try {
    const menus = await listReservationMenus(c.env.DB, c.req.param('resourceId'));
    return jsonOk(c, menus.filter((menu) => menu.is_active === 1).map(toMenuResponse));
  } catch (err) {
    console.error('GET /api/public/reservation-resources/:resourceId/menus error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

function isDateString(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00`).getTime());
}

function addDateString(date: string, amount: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + amount);
  return d.toISOString().slice(0, 10);
}

function daysBetweenInclusive(dateFrom: string, dateTo: string): number {
  const from = new Date(`${dateFrom}T00:00:00`).getTime();
  const to = new Date(`${dateTo}T00:00:00`).getTime();
  return Math.floor((to - from) / 86_400_000) + 1;
}

publicReservations.get('/api/public/reservation-resources/:resourceId/availability-summary', async (c) => {
  try {
    const resourceId = c.req.param('resourceId');
    const dateFrom = queryRequired(c, 'dateFrom');
    if (!dateFrom.ok) return jsonError(c, dateFrom.error.code, dateFrom.error.status, dateFrom.error.message);
    const dateTo = queryRequired(c, 'dateTo');
    if (!dateTo.ok) return jsonError(c, dateTo.error.code, dateTo.error.status, dateTo.error.message);
    if (!isDateString(dateFrom.value) || !isDateString(dateTo.value) || dateFrom.value > dateTo.value) {
      return jsonError(c, 'bad_request', 400, 'dateFrom/dateTo are invalid');
    }
    const dayCount = daysBetweenInclusive(dateFrom.value, dateTo.value);
    if (dayCount > 45) return jsonError(c, 'bad_request', 400, 'date range is too large');

    const resource = await getReservationResourceById(c.env.DB, resourceId);
    if (!resource || resource.is_active !== 1) return jsonError(c, 'not_found', 404, 'Resource not found');

    const menuId = c.req.query('menuId');
    const menu = menuId ? await getReservationMenuById(c.env.DB, menuId) : null;
    if (menuId && (!menu || menu.resource_id !== resourceId || menu.is_active !== 1)) {
      return jsonError(c, 'not_found', 404, 'Menu not found');
    }
    const requestedPeople = menu
      ? calculateReservationPeople(menu, {
        adultCount: queryPositiveInt(c, 'adultCount', queryPositiveInt(c, 'people', 1)),
        childCount: queryPositiveInt(c, 'childCount', 0),
        infantCount: queryPositiveInt(c, 'infantCount', 0),
        underThreeCount: queryPositiveInt(c, 'underThreeCount', 0),
      }).capacityPeople
      : queryPositiveInt(c, 'people', 1);

    const rows = (
      await c.env.DB
        .prepare(
          `SELECT * FROM reservation_slots
           WHERE resource_id = ?
             AND date >= ?
             AND date <= ?
           ORDER BY start_at ASC`,
        )
        .bind(resourceId, dateFrom.value, dateTo.value)
        .all()
    ).results as Array<{
      id: string;
      resource_id: string;
      date: string;
      start_at: string;
      end_at: string;
      total_capacity: number;
      line_capacity: number | null;
      external_capacity: number | null;
      buffer_capacity: number;
      reserved_count: number;
      line_reserved_count: number;
      external_reserved_count: number;
      status: string;
      note: string | null;
      created_at: string;
      updated_at: string;
    }>;

    const byDate = new Map<string, { slotCount: number; availableSlotCount: number }>();
    for (const slot of rows) {
      const current = byDate.get(slot.date) ?? { slotCount: 0, availableSlotCount: 0 };
      current.slotCount += 1;
      const availability = getReservationSlotAvailability({
        ...slot,
        line_capacity: slot.line_capacity ?? resource.default_line_capacity ?? null,
        external_capacity: slot.external_capacity ?? resource.default_external_capacity ?? null,
      }, requestedPeople);
      if (availability.available) current.availableSlotCount += 1;
      byDate.set(slot.date, current);
    }

    const data = Array.from({ length: dayCount }, (_, index) => {
      const date = addDateString(dateFrom.value, index);
      const summary = byDate.get(date) ?? { slotCount: 0, availableSlotCount: 0 };
      return {
        date,
        available: summary.availableSlotCount > 0,
        slotCount: summary.slotCount,
        availableSlotCount: summary.availableSlotCount,
      };
    });
    return jsonOk(c, data);
  } catch (err) {
    console.error('GET /api/public/reservation-resources/:resourceId/availability-summary error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

publicReservations.get('/api/public/reservation-resources/:resourceId/slots', async (c) => {
  try {
    const resourceId = c.req.param('resourceId');
    const date = queryRequired(c, 'date');
    if (!date.ok) return jsonError(c, date.error.code, date.error.status, date.error.message);

    const slots = await listReservationSlots(c.env.DB, { resourceId, date: date.value });
    const resource = await getReservationResourceById(c.env.DB, resourceId);
    const menuId = c.req.query('menuId');
    const menu = menuId ? await getReservationMenuById(c.env.DB, menuId) : null;
    const requestedPeople = menu
      ? calculateReservationPeople(menu, {
        adultCount: queryPositiveInt(c, 'adultCount', queryPositiveInt(c, 'people', 1)),
        childCount: queryPositiveInt(c, 'childCount', 0),
        infantCount: queryPositiveInt(c, 'infantCount', 0),
        underThreeCount: queryPositiveInt(c, 'underThreeCount', 0),
      }).capacityPeople
      : queryPositiveInt(c, 'people', 1);
    return jsonOk(
      c,
      slots.map((slot) => {
        const effectiveSlot = {
          ...slot,
          line_capacity: slot.line_capacity ?? resource?.default_line_capacity ?? null,
          external_capacity: slot.external_capacity ?? resource?.default_external_capacity ?? null,
        };
        const availability = getReservationSlotAvailability(effectiveSlot, requestedPeople);
        return {
          slotId: slot.id,
          resourceId: slot.resource_id,
          date: slot.date,
          startAt: slot.start_at,
          endAt: slot.end_at,
          lineCapacity: effectiveSlot.line_capacity,
          remainingCapacity: availability.remaining_capacity,
          lineRemainingCapacity: availability.line_remaining_capacity,
          externalRemainingCapacity: availability.external_remaining_capacity,
          available: availability.available,
        };
      }),
    );
  } catch (err) {
    console.error('GET /api/public/reservation-resources/:resourceId/slots error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

publicReservations.post('/api/public/reservations', async (c) => {
  try {
    const session = await requireReservationSession(c);
    if (!session) return jsonError(c, 'unauthorized', 401);

    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const parsed = parseReservationCreateBody(json.value);
    if (!parsed.ok) return jsonError(c, parsed.error.code, parsed.error.status, parsed.error.message);
    const body = parsed.value;
    const isGuestSession = session.sessionType === 'guest';
    const customerEmail = body.customer?.email ?? null;
    if (isGuestSession && (!customerEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail))) {
      return jsonError(c, 'bad_request', 400, 'Web予約ではメールアドレスを入力してください。');
    }
    const metadata = {
      ...body.metadata,
      entry: {
        ...(typeof body.metadata.entry === 'object' && body.metadata.entry !== null ? body.metadata.entry : {}),
        sessionType: session.sessionType ?? 'line',
        channel: session.entryChannel ?? (session.sessionType === 'guest' ? 'web' : 'line'),
        ref: session.entryRef ?? null,
        utmSource: session.utmSource ?? null,
        utmMedium: session.utmMedium ?? null,
        utmCampaign: session.utmCampaign ?? null,
      },
    };

    const result = await createReservationWithCapacityCheck(c.env.DB, {
      resourceId: body.resourceId,
      menuId: body.menuId,
      slotId: body.slotId,
      source: isGuestSession ? 'web' : 'line',
      capacityChannel: 'line',
      lineAccountId: session.lineAccountId ?? null,
      userId: session.userId ?? null,
      friendId: session.friendId ?? null,
      adultCount: body.adultCount ?? 0,
      childCount: body.childCount ?? 0,
      infantCount: body.infantCount ?? 0,
      underThreeCount: body.underThreeCount ?? 0,
      customerName: body.customer?.name ?? null,
      customerPhone: body.customer?.phone ?? null,
      customerEmail,
      formData: JSON.stringify(body.formData ?? {}),
      metadata: JSON.stringify(metadata),
      actorType: 'customer',
      actorId: session.friendId ?? null,
    });

    if (!result.ok) {
      return jsonError(
        c,
        codeForCreateReservationFailure(result.reason),
        statusForCreateReservationFailure(result.reason),
        result.reason,
      );
    }
    c.executionCtx.waitUntil(syncReservationCreatedToGoogleCalendar(c.env.DB, result.reservation, c.env));
    c.executionCtx.waitUntil(notifyReservationToDiscord(c.env.DB, result.reservation, c.env, 'created'));
    if (isGuestSession) {
      c.executionCtx.waitUntil(sendWebReservationConfirmationEmail(result.reservation, c.env));
    }

    const secret = await reservationTokenSecret(c.env);
    const detailToken = await signReservationToken(
      {
        scope: 'reservation:read',
        reservationId: result.reservation.id,
        lineUserId: session.lineUserId,
        friendId: session.friendId,
        userId: session.userId,
        exp: secondsFromNow(60 * 60 * 24),
      },
      secret,
    );
    const cancelToken = await signReservationToken(
      {
        scope: 'reservation:cancel',
        reservationId: result.reservation.id,
        lineUserId: session.lineUserId,
        friendId: session.friendId,
        userId: session.userId,
        exp: secondsFromNow(60 * 60 * 24),
      },
      secret,
    );

    return jsonOk(c, { ...toReservationResponse(result.reservation), detailToken, cancelToken }, 201);
  } catch (err) {
    console.error('POST /api/public/reservations error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

publicReservations.get('/api/public/me/reservations', async (c) => {
  try {
    const session = await requireReservationSession(c);
    if (!session?.userId) return jsonError(c, 'unauthorized', 401);
    const statusParam = c.req.query('status');
    const items = await listReservations(c.env.DB, {
      userId: session.userId,
      status: statusParam === 'active' ? undefined : parseReservationStatusValue(statusParam),
      limit: 100,
    });
    const filtered = statusParam === 'active'
      ? items.filter((item) => item.status === 'pending' || item.status === 'confirmed')
      : items;
    return jsonOk(c, filtered.map(toReservationResponse));
  } catch (err) {
    console.error('GET /api/public/me/reservations error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

publicReservations.get('/api/public/reservations/:id', async (c) => {
  try {
    const token = c.req.query('token');
    if (!token) return jsonError(c, 'unauthorized', 401, 'token is required');
    const payload = await verifyReservationToken(token, await reservationTokenSecret(c.env), 'reservation:read');
    if (!payload || payload.reservationId !== c.req.param('id')) {
      return jsonError(c, 'unauthorized', 401);
    }
    const reservation = await getReservationById(c.env.DB, c.req.param('id'));
    if (!reservation) return jsonError(c, 'not_found', 404, 'Reservation not found');
    if (!canAccessReservation(payload, reservation)) return jsonError(c, 'forbidden', 403);
    return jsonOk(c, toReservationResponse(reservation));
  } catch (err) {
    console.error('GET /api/public/reservations/:id error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

publicReservations.post('/api/public/reservations/:id/tokens', async (c) => {
  try {
    const session = await requireReservationSession(c);
    if (!session) return jsonError(c, 'unauthorized', 401);

    const reservation = await getReservationById(c.env.DB, c.req.param('id'));
    if (!reservation) return jsonError(c, 'not_found', 404, 'Reservation not found');
    if (!canAccessReservation(session, reservation)) return jsonError(c, 'forbidden', 403);

    const expiresIn = 60 * 60 * 24;
    const secret = await reservationTokenSecret(c.env);
    const commonPayload = {
      reservationId: reservation.id,
      lineUserId: session.lineUserId,
      friendId: session.friendId,
      userId: session.userId,
      exp: secondsFromNow(expiresIn),
    };
    const detailToken = await signReservationToken(
      { ...commonPayload, scope: 'reservation:read' },
      secret,
    );
    const cancelToken = reservation.status === 'pending' || reservation.status === 'confirmed'
      ? await signReservationToken({ ...commonPayload, scope: 'reservation:cancel' }, secret)
      : undefined;

    return jsonOk(c, {
      reservationId: reservation.id,
      detailToken,
      cancelToken,
      expiresIn,
    });
  } catch (err) {
    console.error('POST /api/public/reservations/:id/tokens error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

publicReservations.post('/api/public/reservations/lookup', async (c) => {
  try {
    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const reservationId = typeof json.value.reservationId === 'string' ? json.value.reservationId.trim() : '';
    const email = typeof json.value.email === 'string' ? json.value.email.trim().toLowerCase() : '';
    if (!reservationId || !email) return jsonError(c, 'bad_request', 400, 'reservationId and email are required');

    const reservation = await getReservationById(c.env.DB, reservationId);
    if (!reservation) return jsonError(c, 'not_found', 404, 'Reservation not found');
    const reservationEmail = reservation.customer_email_snapshot?.trim().toLowerCase();
    if (!reservationEmail || reservationEmail !== email) return jsonError(c, 'forbidden', 403);

    const expiresIn = 60 * 60 * 24;
    const secret = await reservationTokenSecret(c.env);
    const commonPayload = {
      reservationId: reservation.id,
      sessionType: 'guest' as const,
      exp: secondsFromNow(expiresIn),
    };
    const detailToken = await signReservationToken({ ...commonPayload, scope: 'reservation:read' }, secret);
    const cancelToken = reservation.status === 'pending' || reservation.status === 'confirmed'
      ? await signReservationToken({ ...commonPayload, scope: 'reservation:cancel' }, secret)
      : undefined;

    return jsonOk(c, {
      reservation: toReservationResponse(reservation),
      reservationId: reservation.id,
      detailToken,
      cancelToken,
      expiresIn,
    });
  } catch (err) {
    console.error('POST /api/public/reservations/lookup error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

publicReservations.post('/api/public/reservations/:id/cancel', async (c) => {
  try {
    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const token = typeof json.value.token === 'string' ? json.value.token : undefined;
    if (!token) return jsonError(c, 'unauthorized', 401, 'token is required');
    const payload = await verifyReservationToken(token, await reservationTokenSecret(c.env), 'reservation:cancel');
    if (!payload || payload.reservationId !== c.req.param('id')) {
      return jsonError(c, 'unauthorized', 401);
    }
    const existing = await getReservationById(c.env.DB, c.req.param('id'));
    if (!existing) return jsonError(c, 'not_found', 404, 'Reservation not found');
    if (!canAccessReservation(payload, existing)) return jsonError(c, 'forbidden', 403);

    const result = await updateReservationStatus(c.env.DB, existing.id, {
      status: 'cancelled',
      reason: typeof json.value.reason === 'string' ? json.value.reason : 'customer_requested',
      actorType: 'customer',
      actorId: payload.friendId ?? null,
    });
    if (!result.ok) return jsonError(c, result.reason === 'not_found' ? 'not_found' : 'invalid_state_transition', 409, result.reason);
    if (result.changed) c.executionCtx.waitUntil(syncReservationCancelledToGoogleCalendar(c.env.DB, result.reservation, c.env));
    if (result.changed) c.executionCtx.waitUntil(notifyReservationToDiscord(c.env.DB, result.reservation, c.env, 'cancelled'));
    return jsonOk(c, { reservation: toReservationResponse(result.reservation), changed: result.changed });
  } catch (err) {
    console.error('POST /api/public/reservations/:id/cancel error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

export { publicReservations };
