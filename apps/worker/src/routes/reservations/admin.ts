import { Hono } from 'hono';
import {
  createReservationMenu,
  createReservationResource,
  createReservationSchedule,
  createReservationWithCapacityCheck,
  deleteReservationSlotsByDateRange,
  generateReservationSlots,
  getReservationById,
  getReservationMenuById,
  getReservationSlotAvailability,
  listExternalReservationSources,
  listReservationMenus,
  listReservationResources,
  listReservationSchedules,
  listReservationSlots,
  listReservations,
  updateExternalReservationSourceParseStatus,
  updateReservationMenu,
  updateReservationResource,
  updateReservationSchedule,
  updateReservationSlot,
  updateReservationStatus,
} from '@line-crm/db';
import type { ExternalReservationParseStatus, ExternalReservationSource, ReservationSlotStatus } from '@line-crm/db';
import type { Env } from '../../index.js';
import {
  syncReservationCancelledToGoogleCalendar,
  syncReservationCreatedToGoogleCalendar,
} from '../../services/reservation-google-calendar.js';
import { resolveBindingValue } from '../../services/bindings.js';
import { signGoogleOAuthState } from '../../services/google-oauth.js';
import {
  toExternalReservationSourceResponse,
  toMenuResponse,
  toReservationResponse,
  toResourceResponse,
  toScheduleResponse,
  toSlotAvailabilityResponse,
  toSlotResponse,
} from './serializers.js';
import {
  jsonError,
  jsonOk,
  codeForCreateReservationFailure,
  statusForCreateReservationFailure,
} from './responses.js';
import {
  optionalNumber,
  optionalString,
  parseReservationCreateBody,
  parseReservationSourceValue,
  parseReservationStatusBody,
  parseReservationStatusValue,
  queryPositiveInt,
  queryRequired,
  readJsonObject,
  requireString,
} from './requests.js';

const adminReservations = new Hono<Env>();

function parseExternalSource(value: string | undefined): ExternalReservationSource | undefined {
  const sources: ExternalReservationSource[] = ['jalan', 'gmail', 'phone', 'manual'];
  return sources.includes(value as ExternalReservationSource) ? value as ExternalReservationSource : undefined;
}

function parseExternalParseStatus(value: string | undefined): ExternalReservationParseStatus | undefined {
  const statuses: ExternalReservationParseStatus[] = ['pending', 'parsed', 'imported', 'needs_review', 'failed', 'duplicate', 'ignored'];
  return statuses.includes(value as ExternalReservationParseStatus) ? value as ExternalReservationParseStatus : undefined;
}

function parseSlotStatus(value: unknown): ReservationSlotStatus | undefined {
  const statuses: ReservationSlotStatus[] = ['open', 'closed', 'sold_out', 'hidden'];
  return statuses.includes(value as ReservationSlotStatus) ? value as ReservationSlotStatus : undefined;
}

function optionalNullableNumber(body: Record<string, unknown>, key: string): number | null | undefined {
  if (body[key] === null) return null;
  return optionalNumber(body, key);
}

function optionalBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
  return typeof body[key] === 'boolean' ? body[key] : undefined;
}

function updateMasterError(c: Parameters<typeof jsonError>[0], reason: string) {
  return jsonError(c, reason === 'not_found' ? 'not_found' : 'bad_request', reason === 'not_found' ? 404 : 400, reason);
}

adminReservations.get('/api/reservation-resources', async (c) => {
  try {
    const resources = await listReservationResources(c.env.DB);
    return jsonOk(c, resources.map(toResourceResponse));
  } catch (err) {
    console.error('GET /api/reservation-resources error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.post('/api/reservation-resources', async (c) => {
  try {
    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const name = requireString(json.value, 'name');
    if (!name.ok) return jsonError(c, name.error.code, name.error.status, name.error.message);
    const body = json.value;
    const resource = await createReservationResource(c.env.DB, {
      id: optionalString(body, 'id') ?? undefined,
      name: name.value,
      description: optionalString(body, 'description'),
      lineAccountId: optionalString(body, 'lineAccountId'),
      defaultDurationMinutes: optionalNumber(body, 'defaultDurationMinutes'),
      defaultCapacity: optionalNumber(body, 'defaultCapacity'),
      defaultLineCapacity: optionalNumber(body, 'defaultLineCapacity') ?? null,
      defaultExternalCapacity: optionalNumber(body, 'defaultExternalCapacity') ?? null,
      defaultBufferCapacity: optionalNumber(body, 'defaultBufferCapacity'),
      googleCalendarConnectionId: optionalString(body, 'googleCalendarConnectionId'),
      slotIntervalMinutes: optionalNumber(body, 'slotIntervalMinutes'),
      displayOrder: optionalNumber(body, 'displayOrder'),
      metadata: typeof body.metadata === 'string' ? body.metadata : undefined,
    });
    return jsonOk(c, toResourceResponse(resource), 201);
  } catch (err) {
    console.error('POST /api/reservation-resources error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.put('/api/reservation-resources/:resourceId', async (c) => {
  try {
    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const body = json.value;
    const result = await updateReservationResource(c.env.DB, c.req.param('resourceId'), {
      name: optionalString(body, 'name') ?? undefined,
      description: optionalString(body, 'description'),
      defaultDurationMinutes: optionalNumber(body, 'defaultDurationMinutes'),
      defaultCapacity: optionalNumber(body, 'defaultCapacity'),
      defaultLineCapacity: optionalNullableNumber(body, 'defaultLineCapacity'),
      defaultExternalCapacity: optionalNullableNumber(body, 'defaultExternalCapacity'),
      defaultBufferCapacity: optionalNumber(body, 'defaultBufferCapacity'),
      googleCalendarConnectionId: optionalString(body, 'googleCalendarConnectionId'),
      slotIntervalMinutes: optionalNumber(body, 'slotIntervalMinutes'),
      isActive: optionalBoolean(body, 'isActive'),
      displayOrder: optionalNumber(body, 'displayOrder'),
      metadata: typeof body.metadata === 'string' ? body.metadata : undefined,
    });
    if (!result.ok) return updateMasterError(c, result.reason);
    return jsonOk(c, toResourceResponse(result.item));
  } catch (err) {
    console.error('PUT /api/reservation-resources/:resourceId error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.delete('/api/reservation-resources/:resourceId', async (c) => {
  try {
    const result = await updateReservationResource(c.env.DB, c.req.param('resourceId'), {
      isActive: false,
    });
    if (!result.ok) return updateMasterError(c, result.reason);
    return jsonOk(c, toResourceResponse(result.item));
  } catch (err) {
    console.error('DELETE /api/reservation-resources/:resourceId error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.get('/api/reservation-resources/:resourceId/menus', async (c) => {
  try {
    const menus = await listReservationMenus(c.env.DB, c.req.param('resourceId'));
    return jsonOk(c, menus.map(toMenuResponse));
  } catch (err) {
    console.error('GET /api/reservation-resources/:resourceId/menus error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.post('/api/reservation-resources/:resourceId/menus', async (c) => {
  try {
    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const name = requireString(json.value, 'name');
    if (!name.ok) return jsonError(c, name.error.code, name.error.status, name.error.message);
    const body = json.value;
    const menu = await createReservationMenu(c.env.DB, {
      id: optionalString(body, 'id') ?? undefined,
      name: name.value,
      description: optionalString(body, 'description'),
      durationMinutes: optionalNumber(body, 'durationMinutes'),
      unitType: body.unitType === 'person' || body.unitType === 'group' || body.unitType === 'seat' || body.unitType === 'table' ? body.unitType : undefined,
      minPeople: optionalNumber(body, 'minPeople'),
      maxPeople: optionalNumber(body, 'maxPeople') ?? null,
      priceAdult: optionalNumber(body, 'priceAdult') ?? null,
      priceChild: optionalNumber(body, 'priceChild') ?? null,
      priceInfant: optionalNumber(body, 'priceInfant') ?? null,
      capacityCountAdult: optionalBoolean(body, 'capacityCountAdult'),
      capacityCountChild: optionalBoolean(body, 'capacityCountChild'),
      capacityCountInfant: optionalBoolean(body, 'capacityCountInfant'),
      formFields: typeof body.formFields === 'string' ? body.formFields : undefined,
      displayOrder: optionalNumber(body, 'displayOrder'),
      metadata: typeof body.metadata === 'string' ? body.metadata : undefined,
      resourceId: c.req.param('resourceId'),
    });
    return jsonOk(c, toMenuResponse(menu), 201);
  } catch (err) {
    console.error('POST /api/reservation-resources/:resourceId/menus error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.put('/api/reservation-resources/:resourceId/menus/:menuId', async (c) => {
  try {
    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const body = json.value;
    const existing = await getReservationMenuById(c.env.DB, c.req.param('menuId'));
    if (!existing || existing.resource_id !== c.req.param('resourceId')) return jsonError(c, 'not_found', 404, 'Menu not found');
    const result = await updateReservationMenu(c.env.DB, c.req.param('menuId'), {
      name: optionalString(body, 'name') ?? undefined,
      description: optionalString(body, 'description'),
      durationMinutes: optionalNumber(body, 'durationMinutes'),
      unitType: body.unitType === 'person' || body.unitType === 'group' || body.unitType === 'seat' || body.unitType === 'table' ? body.unitType : undefined,
      minPeople: optionalNumber(body, 'minPeople'),
      maxPeople: optionalNullableNumber(body, 'maxPeople'),
      priceAdult: optionalNullableNumber(body, 'priceAdult'),
      priceChild: optionalNullableNumber(body, 'priceChild'),
      priceInfant: optionalNullableNumber(body, 'priceInfant'),
      capacityCountAdult: optionalBoolean(body, 'capacityCountAdult'),
      capacityCountChild: optionalBoolean(body, 'capacityCountChild'),
      capacityCountInfant: optionalBoolean(body, 'capacityCountInfant'),
      formFields: typeof body.formFields === 'string' ? body.formFields : undefined,
      isActive: optionalBoolean(body, 'isActive'),
      displayOrder: optionalNumber(body, 'displayOrder'),
      metadata: typeof body.metadata === 'string' ? body.metadata : undefined,
    });
    if (!result.ok) return updateMasterError(c, result.reason);
    return jsonOk(c, toMenuResponse(result.item));
  } catch (err) {
    console.error('PUT /api/reservation-resources/:resourceId/menus/:menuId error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.delete('/api/reservation-resources/:resourceId/menus/:menuId', async (c) => {
  try {
    const existing = await getReservationMenuById(c.env.DB, c.req.param('menuId'));
    if (!existing || existing.resource_id !== c.req.param('resourceId')) return jsonError(c, 'not_found', 404, 'Menu not found');
    const result = await updateReservationMenu(c.env.DB, c.req.param('menuId'), {
      isActive: false,
    });
    if (!result.ok) return updateMasterError(c, result.reason);
    return jsonOk(c, toMenuResponse(result.item));
  } catch (err) {
    console.error('DELETE /api/reservation-resources/:resourceId/menus/:menuId error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.get('/api/reservation-resources/:resourceId/schedules', async (c) => {
  try {
    const schedules = await listReservationSchedules(c.env.DB, c.req.param('resourceId'));
    return jsonOk(c, schedules.map(toScheduleResponse));
  } catch (err) {
    console.error('GET /api/reservation-resources/:resourceId/schedules error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.post('/api/reservation-resources/:resourceId/schedules', async (c) => {
  try {
    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const startTime = requireString(json.value, 'startTime');
    if (!startTime.ok) return jsonError(c, startTime.error.code, startTime.error.status, startTime.error.message);
    const endTime = requireString(json.value, 'endTime');
    if (!endTime.ok) return jsonError(c, endTime.error.code, endTime.error.status, endTime.error.message);
    const dayOfWeek = optionalNumber(json.value, 'dayOfWeek');
    if (dayOfWeek === undefined) return jsonError(c, 'bad_request', 400, 'dayOfWeek is required');
    const schedule = await createReservationSchedule(c.env.DB, {
      id: optionalString(json.value, 'id') ?? undefined,
      resourceId: c.req.param('resourceId'),
      dayOfWeek,
      startTime: startTime.value,
      endTime: endTime.value,
      slotIntervalMinutes: optionalNumber(json.value, 'slotIntervalMinutes'),
      defaultCapacity: optionalNumber(json.value, 'defaultCapacity'),
      defaultLineCapacity: optionalNumber(json.value, 'defaultLineCapacity') ?? null,
      defaultExternalCapacity: optionalNumber(json.value, 'defaultExternalCapacity') ?? null,
      defaultBufferCapacity: optionalNumber(json.value, 'defaultBufferCapacity'),
    });
    return jsonOk(c, toScheduleResponse(schedule), 201);
  } catch (err) {
    console.error('POST /api/reservation-resources/:resourceId/schedules error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.put('/api/reservation-resources/:resourceId/schedules/:scheduleId', async (c) => {
  try {
    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const body = json.value;
    const existing = await c.env.DB
      .prepare(`SELECT resource_id FROM reservation_schedules WHERE id = ?`)
      .bind(c.req.param('scheduleId'))
      .first<{ resource_id: string }>();
    if (!existing || existing.resource_id !== c.req.param('resourceId')) return jsonError(c, 'not_found', 404, 'Schedule not found');
    const result = await updateReservationSchedule(c.env.DB, c.req.param('scheduleId'), {
      dayOfWeek: optionalNumber(body, 'dayOfWeek'),
      startTime: optionalString(body, 'startTime') ?? undefined,
      endTime: optionalString(body, 'endTime') ?? undefined,
      slotIntervalMinutes: optionalNumber(body, 'slotIntervalMinutes'),
      defaultCapacity: optionalNumber(body, 'defaultCapacity'),
      defaultLineCapacity: optionalNullableNumber(body, 'defaultLineCapacity'),
      defaultExternalCapacity: optionalNullableNumber(body, 'defaultExternalCapacity'),
      defaultBufferCapacity: optionalNumber(body, 'defaultBufferCapacity'),
      isActive: optionalBoolean(body, 'isActive'),
    });
    if (!result.ok) return updateMasterError(c, result.reason);
    return jsonOk(c, toScheduleResponse(result.item));
  } catch (err) {
    console.error('PUT /api/reservation-resources/:resourceId/schedules/:scheduleId error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.get('/api/reservation-slots', async (c) => {
  try {
    const resourceId = queryRequired(c, 'resourceId');
    if (!resourceId.ok) return jsonError(c, resourceId.error.code, resourceId.error.status, resourceId.error.message);
    const date = queryRequired(c, 'date');
    if (!date.ok) return jsonError(c, date.error.code, date.error.status, date.error.message);
    const people = queryPositiveInt(c, 'people', 1);
    const slots = await listReservationSlots(c.env.DB, { resourceId: resourceId.value, date: date.value });
    return jsonOk(
      c,
      slots.map((slot) => ({
        ...toSlotResponse(slot),
        availability: toSlotAvailabilityResponse(getReservationSlotAvailability(slot, people)),
      })),
    );
  } catch (err) {
    console.error('GET /api/reservation-slots error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.post('/api/reservation-slots/generate', async (c) => {
  try {
    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const resourceId = requireString(json.value, 'resourceId');
    if (!resourceId.ok) return jsonError(c, resourceId.error.code, resourceId.error.status, resourceId.error.message);
    const dateFrom = requireString(json.value, 'dateFrom');
    if (!dateFrom.ok) return jsonError(c, dateFrom.error.code, dateFrom.error.status, dateFrom.error.message);
    const dateTo = requireString(json.value, 'dateTo');
    if (!dateTo.ok) return jsonError(c, dateTo.error.code, dateTo.error.status, dateTo.error.message);
    const slots = await generateReservationSlots(c.env.DB, {
      resourceId: resourceId.value,
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
    });
    return jsonOk(c, slots.map(toSlotResponse), 201);
  } catch (err) {
    console.error('POST /api/reservation-slots/generate error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.delete('/api/reservation-slots', async (c) => {
  try {
    const resourceId = queryRequired(c, 'resourceId');
    if (!resourceId.ok) return jsonError(c, resourceId.error.code, resourceId.error.status, resourceId.error.message);
    const dateFrom = queryRequired(c, 'dateFrom');
    if (!dateFrom.ok) return jsonError(c, dateFrom.error.code, dateFrom.error.status, dateFrom.error.message);
    const dateTo = queryRequired(c, 'dateTo');
    if (!dateTo.ok) return jsonError(c, dateTo.error.code, dateTo.error.status, dateTo.error.message);
    const result = await deleteReservationSlotsByDateRange(c.env.DB, {
      resourceId: resourceId.value,
      dateFrom: dateFrom.value,
      dateTo: dateTo.value,
    });
    return jsonOk(c, result);
  } catch (err) {
    console.error('DELETE /api/reservation-slots error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.put('/api/reservation-slots/:id', async (c) => {
  try {
    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const status = json.value.status === undefined ? undefined : parseSlotStatus(json.value.status);
    if (json.value.status !== undefined && !status) return jsonError(c, 'bad_request', 400, 'status is invalid');
    const result = await updateReservationSlot(c.env.DB, c.req.param('id'), {
      status,
      totalCapacity: optionalNumber(json.value, 'totalCapacity'),
      lineCapacity: optionalNullableNumber(json.value, 'lineCapacity'),
      externalCapacity: optionalNullableNumber(json.value, 'externalCapacity'),
      bufferCapacity: optionalNumber(json.value, 'bufferCapacity'),
      note: optionalString(json.value, 'note'),
    });
    if (!result.ok) {
      return jsonError(
        c,
        result.reason === 'not_found' ? 'not_found' : 'bad_request',
        result.reason === 'not_found' ? 404 : 400,
        result.reason,
      );
    }
    return jsonOk(c, toSlotResponse(result.slot));
  } catch (err) {
    console.error('PUT /api/reservation-slots/:id error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.get('/api/reservations', async (c) => {
  try {
    const items = await listReservations(c.env.DB, {
      date: c.req.query('date'),
      slotId: c.req.query('slotId'),
      userId: c.req.query('userId'),
      status: parseReservationStatusValue(c.req.query('status')),
      source: parseReservationSourceValue(c.req.query('source')),
    });
    return jsonOk(c, items.map(toReservationResponse));
  } catch (err) {
    console.error('GET /api/reservations error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.get('/api/reservations/:id', async (c) => {
  try {
    const item = await getReservationById(c.env.DB, c.req.param('id'));
    if (!item) return jsonError(c, 'not_found', 404, 'Reservation not found');
    return jsonOk(c, toReservationResponse(item));
  } catch (err) {
    console.error('GET /api/reservations/:id error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.post('/api/reservations', async (c) => {
  try {
    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const parsed = parseReservationCreateBody(json.value);
    if (!parsed.ok) return jsonError(c, parsed.error.code, parsed.error.status, parsed.error.message);
    const body = parsed.value;
    const result = await createReservationWithCapacityCheck(c.env.DB, {
      resourceId: body.resourceId,
      menuId: body.menuId,
      slotId: body.slotId,
      source: body.source ?? 'admin',
      capacityChannel: body.capacityChannel ?? 'line',
      lineAccountId: body.lineAccountId,
      userId: body.userId,
      friendId: body.friendId,
      adultCount: body.adultCount ?? 0,
      childCount: body.childCount ?? 0,
      infantCount: body.infantCount ?? 0,
      customerName: body.customer?.name,
      customerPhone: body.customer?.phone,
      customerEmail: body.customer?.email,
      formData: JSON.stringify(body.formData ?? {}),
      metadata: JSON.stringify(body.metadata ?? {}),
      actorType: 'admin',
      actorId: c.get('staff')?.id ?? null,
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
    return jsonOk(c, toReservationResponse(result.reservation), 201);
  } catch (err) {
    console.error('POST /api/reservations error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.put('/api/reservations/:id/status', async (c) => {
  try {
    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const parsed = parseReservationStatusBody(json.value);
    if (!parsed.ok) return jsonError(c, parsed.error.code, parsed.error.status, parsed.error.message);
    const body = parsed.value;
    const result = await updateReservationStatus(c.env.DB, c.req.param('id'), {
      status: body.status,
      reason: body.reason,
      actorType: 'admin',
      actorId: c.get('staff')?.id ?? null,
    });
    if (!result.ok) {
      return jsonError(
        c,
        result.reason === 'not_found' ? 'not_found' : 'invalid_state_transition',
        result.reason === 'not_found' ? 404 : 409,
        result.reason,
      );
    }
    if (body.status === 'cancelled' && result.changed) {
      c.executionCtx.waitUntil(syncReservationCancelledToGoogleCalendar(c.env.DB, result.reservation, c.env));
    }
    return jsonOk(c, { reservation: toReservationResponse(result.reservation), changed: result.changed });
  } catch (err) {
    console.error('PUT /api/reservations/:id/status error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.get('/api/external-reservation-sources', async (c) => {
  try {
    const sources = await listExternalReservationSources(c.env.DB, {
      source: parseExternalSource(c.req.query('source')),
      parseStatus: parseExternalParseStatus(c.req.query('parseStatus')),
      limit: queryPositiveInt(c, 'limit', 100),
    });
    return jsonOk(c, sources.map(toExternalReservationSourceResponse));
  } catch (err) {
    console.error('GET /api/external-reservation-sources error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.put('/api/external-reservation-sources/:id/parse-status', async (c) => {
  try {
    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const parseStatus = parseExternalParseStatus(optionalString(json.value, 'parseStatus') ?? undefined);
    if (!parseStatus) return jsonError(c, 'bad_request', 400, 'parseStatus is invalid');
    const source = await updateExternalReservationSourceParseStatus(c.env.DB, c.req.param('id'), {
      parseStatus,
      lastError: optionalString(json.value, 'lastError'),
    });
    if (!source) return jsonError(c, 'not_found', 404, 'External reservation source not found');
    return jsonOk(c, toExternalReservationSourceResponse(source));
  } catch (err) {
    console.error('PUT /api/external-reservation-sources/:id/parse-status error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.post('/api/reservations/:id/google-calendar/sync', async (c) => {
  try {
    const reservation = await getReservationById(c.env.DB, c.req.param('id'));
    if (!reservation) return jsonError(c, 'not_found', 404, 'Reservation not found');
    if (reservation.status === 'cancelled' || reservation.status === 'no_show') {
      return jsonError(c, 'bad_request', 400, 'Only active reservations can be synced');
    }
    const sync = await syncReservationCreatedToGoogleCalendar(c.env.DB, reservation, c.env);
    return jsonOk(c, {
      reservation: toReservationResponse(reservation),
      sync,
    });
  } catch (err) {
    console.error('POST /api/reservations/:id/google-calendar/sync error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.get('/api/reservations/google-calendar/oauth-url', async (c) => {
  try {
    const clientId = await resolveBindingValue(c.env.GOOGLE_OAUTH_CLIENT_ID);
    const apiKey = await resolveBindingValue(c.env.API_KEY);
    if (!clientId) {
      return jsonError(c, 'bad_request', 400, 'GOOGLE_OAUTH_CLIENT_ID is not configured');
    }
    if (!apiKey) {
      return jsonError(c, 'bad_request', 400, 'API_KEY is not configured');
    }
    const calendarId = c.req.query('calendarId') || 'primary';
    const returnTo = c.req.query('returnTo') || `${new URL(c.req.url).origin}/admin/reservations`;
    const redirectUri = await resolveBindingValue(c.env.GOOGLE_OAUTH_REDIRECT_URI)
      || `${new URL(c.req.url).origin}/api/integrations/google-calendar/oauth/callback`;
    const state = await signGoogleOAuthState(
      {
        calendarId,
        returnTo,
        exp: Math.floor(Date.now() / 1000) + 10 * 60,
      },
      apiKey,
    );
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', 'https://www.googleapis.com/auth/calendar.events');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);
    return jsonOk(c, { url: url.toString() });
  } catch (err) {
    console.error('GET /api/reservations/google-calendar/oauth-url error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

export { adminReservations };
