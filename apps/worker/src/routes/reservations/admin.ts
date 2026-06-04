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
  getReservationResourceById,
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
  resetAndResyncReservationsToGoogleCalendar,
  type ReservationGoogleCalendarResyncSource,
  syncReservationCancelledToGoogleCalendar,
  syncReservationCreatedToGoogleCalendar,
} from '../../services/reservation-google-calendar.js';
import { notifyReservationToDiscord } from '../../services/discord-notifications.js';
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
      priceUnderThree: optionalNumber(body, 'priceUnderThree') ?? 0,
      capacityCountAdult: optionalBoolean(body, 'capacityCountAdult'),
      capacityCountChild: optionalBoolean(body, 'capacityCountChild'),
      capacityCountInfant: optionalBoolean(body, 'capacityCountInfant'),
      capacityCountUnderThree: optionalBoolean(body, 'capacityCountUnderThree'),
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
      priceUnderThree: optionalNullableNumber(body, 'priceUnderThree'),
      capacityCountAdult: optionalBoolean(body, 'capacityCountAdult'),
      capacityCountChild: optionalBoolean(body, 'capacityCountChild'),
      capacityCountInfant: optionalBoolean(body, 'capacityCountInfant'),
      capacityCountUnderThree: optionalBoolean(body, 'capacityCountUnderThree'),
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
    const resource = await getReservationResourceById(c.env.DB, c.req.param('resourceId'));
    const schedule = await createReservationSchedule(c.env.DB, {
      id: optionalString(json.value, 'id') ?? undefined,
      resourceId: c.req.param('resourceId'),
      dayOfWeek,
      startTime: startTime.value,
      endTime: endTime.value,
      slotIntervalMinutes: optionalNumber(json.value, 'slotIntervalMinutes'),
      defaultCapacity: optionalNumber(json.value, 'defaultCapacity') ?? resource?.default_capacity,
      defaultLineCapacity: optionalNullableNumber(json.value, 'defaultLineCapacity') ?? resource?.default_line_capacity ?? null,
      defaultExternalCapacity: optionalNullableNumber(json.value, 'defaultExternalCapacity') ?? resource?.default_external_capacity ?? null,
      defaultBufferCapacity: optionalNumber(json.value, 'defaultBufferCapacity') ?? resource?.default_buffer_capacity,
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

adminReservations.delete('/api/reservation-resources/:resourceId/schedules/:scheduleId', async (c) => {
  try {
    const existing = await c.env.DB
      .prepare(`SELECT resource_id FROM reservation_schedules WHERE id = ?`)
      .bind(c.req.param('scheduleId'))
      .first<{ resource_id: string }>();
    if (!existing || existing.resource_id !== c.req.param('resourceId')) return jsonError(c, 'not_found', 404, 'Schedule not found');
    const result = await updateReservationSchedule(c.env.DB, c.req.param('scheduleId'), {
      isActive: false,
    });
    if (!result.ok) return updateMasterError(c, result.reason);
    return jsonOk(c, toScheduleResponse(result.item));
  } catch (err) {
    console.error('DELETE /api/reservation-resources/:resourceId/schedules/:scheduleId error:', err);
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
    const resource = await getReservationResourceById(c.env.DB, resourceId.value);
    return jsonOk(
      c,
      slots.map((slot) => {
        const effectiveSlot = {
          ...slot,
          line_capacity: slot.line_capacity ?? resource?.default_line_capacity ?? null,
          external_capacity: slot.external_capacity ?? resource?.default_external_capacity ?? null,
        };
        return {
          ...toSlotResponse(effectiveSlot),
          availability: toSlotAvailabilityResponse(getReservationSlotAvailability(effectiveSlot, people)),
        };
      }),
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
      underThreeCount: body.underThreeCount ?? 0,
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
    c.executionCtx.waitUntil(notifyReservationToDiscord(c.env.DB, result.reservation, c.env, 'created'));
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
    if (result.changed && (body.status === 'cancelled' || body.status === 'completed')) {
      c.executionCtx.waitUntil(notifyReservationToDiscord(
        c.env.DB,
        result.reservation,
        c.env,
        body.status === 'completed' ? 'completed' : 'cancelled',
      ));
    }
    return jsonOk(c, { reservation: toReservationResponse(result.reservation), changed: result.changed });
  } catch (err) {
    console.error('PUT /api/reservations/:id/status error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.get('/api/reservations/maintenance/orphaned', async (c) => {
  try {
    const limit = queryPositiveInt(c, 'limit', 100);
    const items = await listOrphanedActiveReservations(c.env.DB, limit);
    return jsonOk(c, {
      count: items.length,
      reservations: items.map((item) => ({
        reason: item.orphan_reason,
        resourceId: item.orphan_resource_id,
        resourceName: item.orphan_resource_name,
        reservation: toReservationResponse(item),
      })),
    });
  } catch (err) {
    console.error('GET /api/reservations/maintenance/orphaned error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

adminReservations.post('/api/reservations/maintenance/orphaned/cancel', async (c) => {
  try {
    const json = await readOptionalJsonObjectForMaintenance(c);
    if (!json.ok) return jsonError(c, 'bad_request', 400, json.error);
    const limit = typeof json.value.limit === 'number' && Number.isFinite(json.value.limit)
      ? Math.min(Math.max(Math.floor(json.value.limit), 1), 500)
      : 100;
    const dryRun = json.value.dryRun === true;
    const items = await listOrphanedActiveReservations(c.env.DB, limit);
    if (dryRun) {
      return jsonOk(c, {
        dryRun,
        count: items.length,
        cancelled: 0,
        failed: 0,
        reservations: items.map((item) => ({
          reason: item.orphan_reason,
          reservation: toReservationResponse(item),
        })),
      });
    }

    const cancelled: Array<{ id: string; changed: boolean }> = [];
    const failed: Array<{ id: string; reason: string }> = [];
    for (const item of items) {
      const result = await updateReservationStatus(c.env.DB, item.id, {
        status: 'cancelled',
        reason: `maintenance_orphaned_${item.orphan_reason}`,
        actorType: 'admin',
        actorId: c.get('staff')?.id ?? null,
      });
      if (!result.ok) {
        failed.push({ id: item.id, reason: result.reason });
        continue;
      }
      cancelled.push({ id: item.id, changed: result.changed });
      if (result.changed) {
        c.executionCtx.waitUntil(syncReservationCancelledToGoogleCalendar(c.env.DB, result.reservation, c.env));
      }
    }

    return jsonOk(c, {
      dryRun,
      scanned: items.length,
      cancelled: cancelled.length,
      failed: failed.length,
      items: cancelled,
      errors: failed,
    });
  } catch (err) {
    console.error('POST /api/reservations/maintenance/orphaned/cancel error:', err);
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

adminReservations.post('/api/reservations/google-calendar/resync', async (c) => {
  try {
    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const dateFromInput = requireString(json.value, 'dateFrom');
    const dateToInput = requireString(json.value, 'dateTo');
    if (!dateFromInput.ok) return jsonError(c, dateFromInput.error.code, dateFromInput.error.status, dateFromInput.error.message);
    if (!dateToInput.ok) return jsonError(c, dateToInput.error.code, dateToInput.error.status, dateToInput.error.message);
    const dateFrom = dateFromInput.value;
    const dateTo = dateToInput.value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom) || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) {
      return jsonError(c, 'bad_request', 400, 'dateFrom and dateTo must be YYYY-MM-DD');
    }
    if (dateFrom > dateTo) return jsonError(c, 'bad_request', 400, 'dateFrom must be before dateTo');

    const fromTime = new Date(`${dateFrom}T00:00:00Z`).getTime();
    const toTime = new Date(`${dateTo}T00:00:00Z`).getTime();
    const rangeDays = Math.floor((toTime - fromTime) / 86_400_000) + 1;
    if (!Number.isFinite(rangeDays) || rangeDays < 1 || rangeDays > 370) {
      return jsonError(c, 'bad_request', 400, 'Date range must be 1 to 370 days');
    }

    const sources = parseGoogleCalendarResyncSources(json.value.sources);
    const result = await resetAndResyncReservationsToGoogleCalendar(c.env.DB, {
      dateFrom,
      dateTo,
      resourceId: optionalString(json.value, 'resourceId') || null,
      sources,
      limit: optionalNumber(json.value, 'limit') ?? 1000,
    }, c.env);
    return jsonOk(c, result);
  } catch (err) {
    console.error('POST /api/reservations/google-calendar/resync error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

function parseGoogleCalendarResyncSources(value: unknown): ReservationGoogleCalendarResyncSource[] {
  const allowed: ReservationGoogleCalendarResyncSource[] = ['line', 'jalan', 'web'];
  if (!Array.isArray(value)) return allowed;
  const sources = value.filter((item): item is ReservationGoogleCalendarResyncSource => (
    typeof item === 'string' && allowed.includes(item as ReservationGoogleCalendarResyncSource)
  ));
  return sources.length ? Array.from(new Set(sources)) : allowed;
}

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
    url.searchParams.set('scope', [
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/gmail.modify',
    ].join(' '));
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('state', state);
    return jsonOk(c, { url: url.toString() });
  } catch (err) {
    console.error('GET /api/reservations/google-calendar/oauth-url error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

type OrphanedReservationRow = Awaited<ReturnType<typeof listReservations>>[number] & {
  orphan_reason: 'slot_missing' | 'resource_missing' | 'resource_inactive';
  orphan_resource_id: string | null;
  orphan_resource_name: string | null;
};

async function listOrphanedActiveReservations(db: D1Database, limit: number): Promise<OrphanedReservationRow[]> {
  const capped = Math.min(Math.max(Math.floor(limit), 1), 500);
  const result = await db
    .prepare(
      `SELECT r.*,
              (SELECT SUM(amount) FROM reservation_items WHERE reservation_id = r.id) AS total_amount,
              CASE
                WHEN s.id IS NULL THEN 'slot_missing'
                WHEN rr.id IS NULL THEN 'resource_missing'
                ELSE 'resource_inactive'
              END AS orphan_reason,
              s.resource_id AS orphan_resource_id,
              rr.name AS orphan_resource_name
       FROM reservations r
       LEFT JOIN reservation_slots s ON s.id = r.slot_id
       LEFT JOIN reservation_resources rr ON rr.id = s.resource_id
       WHERE r.status IN ('pending', 'confirmed')
         AND (s.id IS NULL OR rr.id IS NULL OR rr.is_active = 0)
       ORDER BY r.reservation_date ASC, r.start_at ASC, r.created_at ASC
       LIMIT ?`,
    )
    .bind(capped)
    .all<OrphanedReservationRow>();
  return result.results;
}

async function readOptionalJsonObjectForMaintenance(
  c: Parameters<typeof jsonOk>[0],
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const body = await c.req.json<unknown>();
    if (body === null || body === undefined) return { ok: true, value: {} };
    if (typeof body !== 'object' || Array.isArray(body)) {
      return { ok: false, error: 'Request body must be a JSON object' };
    }
    return { ok: true, value: body as Record<string, unknown> };
  } catch {
    return { ok: true, value: {} };
  }
}

export { adminReservations };
