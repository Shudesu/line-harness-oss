import { Hono } from 'hono';
import {
  getReservationMenuById,
  getReservationResourceById,
  importExternalReservation,
  listReservationMenus,
  listReservationResources,
  listReservationSlots,
} from '@line-crm/db';
import type { Env } from '../../index.js';
import { parseJalanMail } from '../../services/jalan-mail-parser.js';
import {
  syncReservationCancelledToGoogleCalendar,
  syncReservationCreatedToGoogleCalendar,
} from '../../services/reservation-google-calendar.js';
import { jsonError, jsonOk } from './responses.js';
import { parseJalanGmailImportBody, parseJalanImportBody, readJsonObject } from './requests.js';
import { toExternalReservationSourceResponse, toReservationResponse } from './serializers.js';

const reservationIntegrations = new Hono<Env>();

type ImportResult = Awaited<ReturnType<typeof importExternalReservation>>;
type RouteValidation = {
  resourceId?: string;
  menuId?: string;
  slotId?: string;
  reviewReason?: string;
};

reservationIntegrations.get('/api/integrations/jalan/catalog', async (c) => {
  try {
    const resources = await listReservationResources(c.env.DB);
    const activeResources = resources.filter((resource) => resource.is_active === 1);
    const items = await Promise.all(activeResources.map(async (resource) => {
      const menus = await listReservationMenus(c.env.DB, resource.id);
      return {
        resourceId: resource.id,
        resourceName: resource.name,
        menus: menus
          .filter((menu) => menu.is_active === 1)
          .map((menu) => ({
            menuId: menu.id,
            menuName: menu.name,
            durationMinutes: menu.duration_minutes,
            minPeople: menu.min_people,
            maxPeople: menu.max_people,
          })),
      };
    }));
    return jsonOk(c, { resources: items });
  } catch (err) {
    console.error('GET /api/integrations/jalan/catalog error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

reservationIntegrations.post('/api/integrations/jalan/reservations/import', async (c) => {
  try {
    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const body = parseJalanImportBody(json.value);
    if (!body.ok) return jsonError(c, body.error.code, body.error.status, body.error.message);

    const route = await validateExternalRoute(c.env.DB, {
      resourceId: body.value.resourceId,
      menuId: body.value.menuId,
      slotId: body.value.slotId,
    });
    const shouldCreateReservation = body.value.eventType === 'created';
    const result = await importExternalReservation(c.env.DB, {
      ...body.value,
      resourceId: shouldCreateReservation ? route.resourceId : body.value.resourceId,
      menuId: shouldCreateReservation ? route.menuId : body.value.menuId,
      slotId: shouldCreateReservation ? route.slotId : body.value.slotId,
      reviewReason: body.value.reviewReason ?? (shouldCreateReservation ? route.reviewReason : undefined),
    });
    if (!result.ok) {
      if (result.reason === 'slot_not_available') return jsonError(c, 'slot_not_available', 409, result.reason);
      if (result.reason === 'missing_dedupe_key') return jsonError(c, 'missing_dedupe_key', 400, result.reason);
      return jsonError(c, 'bad_request', 400, result.reason);
    }
    if (result.status === 'needs_review') {
      return jsonOk(c, { status: result.status, source: toExternalReservationSourceResponse(result.source) }, 202);
    }
    scheduleExternalCalendarSync(c, result);
    return jsonOk(c, { status: result.status, reservation: toReservationResponse(result.reservation) });
  } catch (err) {
    console.error('POST /api/integrations/jalan/reservations/import error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

reservationIntegrations.post('/api/integrations/jalan/gmail/import', async (c) => {
  try {
    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const body = parseJalanGmailImportBody(json.value);
    if (!body.ok) return jsonError(c, body.error.code, body.error.status, body.error.message);

    const parsed = parseJalanMail(body.value.rawText);
    const slotId = body.value.slotId
      ?? await resolveSlotId(c.env.DB, {
        resourceId: body.value.resourceId,
        date: parsed.reservationDate,
        startTime: parsed.startTime,
      });
    const route = await validateExternalRoute(c.env.DB, {
      resourceId: body.value.resourceId,
      menuId: body.value.menuId,
      slotId,
    });
    const parsedPayload = JSON.stringify({
      parser: 'jalan_gmail_v1',
      ...parsed,
      resourceId: body.value.resourceId ?? null,
      menuId: body.value.menuId ?? null,
      slotId: slotId ?? null,
      routeName: body.value.routeName ?? null,
      routeKeyword: body.value.routeKeyword ?? null,
      routeReviewReason: route.reviewReason ?? null,
    });

    const shouldCreateReservation = parsed.eventType === 'created';
    const result = await importExternalReservation(c.env.DB, {
      source: 'jalan',
      eventType: parsed.eventType,
      externalId: parsed.externalId,
      gmailMessageId: body.value.gmailMessageId,
      receivedAt: body.value.receivedAt,
      rawText: body.value.rawText,
      parsedPayload,
      reviewReason: shouldCreateReservation ? route.reviewReason : undefined,
      resourceId: shouldCreateReservation ? route.resourceId : body.value.resourceId,
      menuId: shouldCreateReservation ? route.menuId : body.value.menuId,
      slotId: shouldCreateReservation ? route.slotId : slotId,
      adultCount: parsed.adultCount ?? undefined,
      childCount: parsed.childCount ?? undefined,
      infantCount: parsed.infantCount ?? undefined,
      customerName: parsed.customerName,
      customerPhone: parsed.customerPhone,
      customerEmail: parsed.customerEmail,
    });

    scheduleExternalCalendarSync(c, result);
    return importResponse(c, result, parsed, { slotUnavailableAsReview: true });
  } catch (err) {
    console.error('POST /api/integrations/jalan/gmail/import error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

async function resolveSlotId(
  db: D1Database,
  params: { resourceId?: string; date: string | null; startTime: string | null },
): Promise<string | undefined> {
  if (!params.resourceId || !params.date || !params.startTime) return undefined;
  const slots = await listReservationSlots(db, { resourceId: params.resourceId, date: params.date });
  const slot = slots.find((item) => item.start_at.includes(`T${params.startTime}:`));
  return slot?.id;
}

async function validateExternalRoute(
  db: D1Database,
  params: { resourceId?: string; menuId?: string; slotId?: string },
): Promise<RouteValidation> {
  if (!params.resourceId || !params.menuId || !params.slotId) {
    return {
      reviewReason: missingRouteReason(params),
    };
  }

  const resource = await getReservationResourceById(db, params.resourceId);
  if (!resource || resource.is_active !== 1) {
    return { reviewReason: 'configured resource is missing or inactive' };
  }

  const menu = await getReservationMenuById(db, params.menuId);
  if (!menu || menu.is_active !== 1) {
    return { reviewReason: 'configured menu is missing or inactive' };
  }
  if (menu.resource_id !== resource.id) {
    return { reviewReason: 'configured menu does not belong to configured resource' };
  }

  const slot = await db
    .prepare(`SELECT id, resource_id FROM reservation_slots WHERE id = ?`)
    .bind(params.slotId)
    .first<{ id: string; resource_id: string }>();
  if (!slot || slot.resource_id !== resource.id) {
    return { reviewReason: 'matching slot is missing for configured resource' };
  }

  return {
    resourceId: resource.id,
    menuId: menu.id,
    slotId: slot.id,
  };
}

function missingRouteReason(params: { resourceId?: string; menuId?: string; slotId?: string }): string {
  const missing = [
    params.resourceId ? null : 'resourceId',
    params.menuId ? null : 'menuId',
    params.slotId ? null : 'slotId',
  ].filter(Boolean);
  return `created event is missing ${missing.join('/')}`;
}

function importResponse(
  c: Parameters<typeof jsonOk>[0],
  result: ImportResult,
  parsed?: unknown,
  opts: { slotUnavailableAsReview?: boolean } = {},
): Response {
  if (!result.ok) {
    if (opts.slotUnavailableAsReview && result.reason === 'slot_not_available') {
      return jsonOk(c, { status: 'needs_review', parsed, reason: result.reason }, 202);
    }
    if (result.reason === 'slot_not_available') return jsonError(c, 'slot_not_available', 409, result.reason);
    if (result.reason === 'missing_dedupe_key') return jsonError(c, 'missing_dedupe_key', 400, result.reason);
    return jsonError(c, 'bad_request', 400, result.reason);
  }
  if (result.status === 'needs_review') {
    return jsonOk(c, { status: result.status, source: toExternalReservationSourceResponse(result.source), parsed }, 202);
  }
  return jsonOk(c, { status: result.status, reservation: toReservationResponse(result.reservation), parsed });
}

function scheduleExternalCalendarSync(
  c: Parameters<typeof jsonOk>[0],
  result: ImportResult,
): void {
  if (!result.ok || result.status === 'needs_review') return;
  if (result.status === 'imported') {
    c.executionCtx.waitUntil(syncReservationCreatedToGoogleCalendar(c.env.DB, result.reservation, c.env));
    return;
  }
  if (result.status === 'cancelled') {
    c.executionCtx.waitUntil(syncReservationCancelledToGoogleCalendar(c.env.DB, result.reservation, c.env));
  }
}

export { reservationIntegrations };
