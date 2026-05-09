import { Hono } from 'hono';
import {
  createReservationWithCapacityCheck,
  calculateReservationPeople,
  getReservationById,
  getReservationSlotAvailability,
  getReservationMenuById,
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
import { issueReservationSession, requireReservationSession } from './auth.js';
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

publicReservations.get('/api/public/reservation-resources/:resourceId/slots', async (c) => {
  try {
    const resourceId = c.req.param('resourceId');
    const date = queryRequired(c, 'date');
    if (!date.ok) return jsonError(c, date.error.code, date.error.status, date.error.message);

    const slots = await listReservationSlots(c.env.DB, { resourceId, date: date.value });
    const menuId = c.req.query('menuId');
    const menu = menuId ? await getReservationMenuById(c.env.DB, menuId) : null;
    const requestedPeople = menu
      ? calculateReservationPeople(menu, {
        adultCount: queryPositiveInt(c, 'adultCount', queryPositiveInt(c, 'people', 1)),
        childCount: queryPositiveInt(c, 'childCount', 0),
        infantCount: queryPositiveInt(c, 'infantCount', 0),
      }).capacityPeople
      : queryPositiveInt(c, 'people', 1);
    return jsonOk(
      c,
      slots.map((slot) => {
        const availability = getReservationSlotAvailability(slot, requestedPeople);
        return {
          slotId: slot.id,
          resourceId: slot.resource_id,
          date: slot.date,
          startAt: slot.start_at,
          endAt: slot.end_at,
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

    const result = await createReservationWithCapacityCheck(c.env.DB, {
      resourceId: body.resourceId,
      menuId: body.menuId,
      slotId: body.slotId,
      source: 'line',
      capacityChannel: 'line',
      lineAccountId: session.lineAccountId ?? null,
      userId: session.userId ?? null,
      friendId: session.friendId ?? null,
      adultCount: body.adultCount ?? 0,
      childCount: body.childCount ?? 0,
      infantCount: body.infantCount ?? 0,
      customerName: body.customer?.name ?? null,
      customerPhone: body.customer?.phone ?? null,
      customerEmail: body.customer?.email ?? null,
      formData: JSON.stringify(body.formData ?? {}),
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
    return jsonOk(c, { reservation: toReservationResponse(result.reservation), changed: result.changed });
  } catch (err) {
    console.error('POST /api/public/reservations/:id/cancel error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

export { publicReservations };
