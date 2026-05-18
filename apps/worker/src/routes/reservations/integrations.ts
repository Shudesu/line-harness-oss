import { Hono } from 'hono';
import {
  createGmailImportRule,
  getReservationMenuById,
  getReservationResourceById,
  importExternalReservation,
  listGmailImportRules,
  listGmailImportRuns,
  listReservationMenus,
  listReservationResources,
  listReservationSlots,
  softDeleteGmailImportRule,
  updateGmailImportRule,
} from '@line-crm/db';
import type { Env } from '../../index.js';
import { parseJalanMail } from '../../services/jalan-mail-parser.js';
import {
  listGmailLabelsForConnection,
  runGmailImportRule,
} from '../../services/gmail-jalan-import.js';
import {
  syncReservationCancelledToGoogleCalendar,
  syncReservationCreatedToGoogleCalendar,
} from '../../services/reservation-google-calendar.js';
import {
  notifyExternalReviewToDiscord,
  notifyReservationToDiscord,
} from '../../services/discord-notifications.js';
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
      c.executionCtx.waitUntil(notifyExternalReviewToDiscord(c.env, result.source));
      return jsonOk(c, { status: result.status, source: toExternalReservationSourceResponse(result.source) }, 202);
    }
    scheduleExternalCalendarSync(c, result);
    scheduleExternalDiscordNotification(c, result);
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
      underThreeCount: parsed.underThreeCount ?? undefined,
      customerName: parsed.customerName,
      customerPhone: parsed.customerPhone,
      customerEmail: parsed.customerEmail,
    });

    scheduleExternalCalendarSync(c, result);
    scheduleExternalDiscordNotification(c, result);
    if (result.ok && result.status === 'needs_review') {
      c.executionCtx.waitUntil(notifyExternalReviewToDiscord(c.env, result.source));
    }
    return importResponse(c, result, parsed, { slotUnavailableAsReview: true });
  } catch (err) {
    console.error('POST /api/integrations/jalan/gmail/import error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

reservationIntegrations.get('/api/integrations/gmail/labels', async (c) => {
  try {
    const connectionId = c.req.query('connectionId')?.trim();
    if (!connectionId) return jsonError(c, 'bad_request', 400, 'connectionId is required');
    const labels = await listGmailLabelsForConnection(c.env.DB, connectionId, c.env);
    return jsonOk(c, labels);
  } catch (err) {
    console.error('GET /api/integrations/gmail/labels error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

reservationIntegrations.get('/api/integrations/gmail/import-rules', async (c) => {
  try {
    const activeOnly = c.req.query('activeOnly') === 'true';
    const rules = await listGmailImportRules(c.env.DB, { activeOnly });
    return jsonOk(c, rules.map(toGmailImportRuleResponse));
  } catch (err) {
    console.error('GET /api/integrations/gmail/import-rules error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

reservationIntegrations.post('/api/integrations/gmail/import-rules', async (c) => {
  try {
    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const input = parseGmailImportRuleBody(json.value, true);
    if (!input.ok) return jsonError(c, 'bad_request', 400, input.error);
    const rule = await createGmailImportRule(c.env.DB, input.value);
    return jsonOk(c, toGmailImportRuleResponse(rule), 201);
  } catch (err) {
    console.error('POST /api/integrations/gmail/import-rules error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

reservationIntegrations.put('/api/integrations/gmail/import-rules/:id', async (c) => {
  try {
    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const input = parseGmailImportRuleBody(json.value, false);
    if (!input.ok) return jsonError(c, 'bad_request', 400, input.error);
    const rule = await updateGmailImportRule(c.env.DB, c.req.param('id'), input.value);
    if (!rule) return jsonError(c, 'not_found', 404, 'Gmail import rule not found');
    return jsonOk(c, toGmailImportRuleResponse(rule));
  } catch (err) {
    console.error('PUT /api/integrations/gmail/import-rules/:id error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

reservationIntegrations.delete('/api/integrations/gmail/import-rules/:id', async (c) => {
  try {
    const rule = await softDeleteGmailImportRule(c.env.DB, c.req.param('id'));
    if (!rule) return jsonError(c, 'not_found', 404, 'Gmail import rule not found');
    return jsonOk(c, toGmailImportRuleResponse(rule));
  } catch (err) {
    console.error('DELETE /api/integrations/gmail/import-rules/:id error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

reservationIntegrations.get('/api/integrations/gmail/import-runs', async (c) => {
  try {
    const runs = await listGmailImportRuns(
      c.env.DB,
      c.req.query('ruleId')?.trim() || undefined,
      parsePositiveInt(c.req.query('limit'), 20),
    );
    return jsonOk(c, runs.map(toGmailImportRunResponse));
  } catch (err) {
    console.error('GET /api/integrations/gmail/import-runs error:', err);
    return jsonError(c, 'internal_error', 500);
  }
});

reservationIntegrations.post('/api/integrations/gmail/import-rules/:id/run', async (c) => {
  try {
    const json = await readOptionalObjectForRoute(c);
    if (!json.ok) return jsonError(c, 'bad_request', 400, json.error);
    const result = await runGmailImportRule(c.env.DB, c.req.param('id'), c.env, {
      dryRun: json.value.dryRun === true,
      maxResults: typeof json.value.maxResults === 'number' ? json.value.maxResults : undefined,
    });
    return jsonOk(c, result);
  } catch (err) {
    console.error('POST /api/integrations/gmail/import-rules/:id/run error:', err);
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

function scheduleExternalDiscordNotification(
  c: Parameters<typeof jsonOk>[0],
  result: ImportResult,
): void {
  if (!result.ok || result.status === 'needs_review' || result.status === 'duplicate') return;
  c.executionCtx.waitUntil(notifyReservationToDiscord(
    c.env.DB,
    result.reservation,
    c.env,
    result.status === 'cancelled' ? 'cancelled' : 'created',
  ));
}

type GmailImportRuleBody = {
  connectionId?: string;
  name?: string;
  fromEmail?: string | null;
  query?: string | null;
  unprocessedLabelId?: string;
  processedLabelId?: string;
  reviewLabelId?: string;
  failedLabelId?: string;
  resourceId?: string | null;
  menuId?: string | null;
  maxResults?: number;
  isActive?: boolean;
};

function parseGmailImportRuleBody(
  body: Record<string, unknown>,
  creating: boolean,
): { ok: true; value: GmailImportRuleBody & Record<string, unknown> } | { ok: false; error: string } {
  const value: GmailImportRuleBody = {};
  const stringFields = [
    'connectionId',
    'name',
    'unprocessedLabelId',
    'processedLabelId',
    'reviewLabelId',
    'failedLabelId',
  ] as const;
  for (const key of stringFields) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== 'string' || !body[key].trim()) return { ok: false, error: `${key} is invalid` };
      value[key] = body[key].trim();
    }
  }
  for (const key of ['fromEmail', 'query', 'resourceId', 'menuId'] as const) {
    if (body[key] !== undefined) {
      if (body[key] === null) {
        value[key] = null;
      } else if (typeof body[key] === 'string') {
        value[key] = body[key].trim() || null;
      } else {
        return { ok: false, error: `${key} is invalid` };
      }
    }
  }
  if (body.maxResults !== undefined) {
    if (typeof body.maxResults !== 'number' || !Number.isFinite(body.maxResults)) {
      return { ok: false, error: 'maxResults is invalid' };
    }
    value.maxResults = Math.floor(body.maxResults);
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') return { ok: false, error: 'isActive is invalid' };
    value.isActive = body.isActive;
  }
  if (creating) {
    for (const key of stringFields) {
      if (!value[key]) return { ok: false, error: `${key} is required` };
    }
  }
  return { ok: true, value: value as GmailImportRuleBody & Record<string, unknown> };
}

async function readOptionalObjectForRoute(
  c: Parameters<typeof jsonOk>[0],
): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; error: string }> {
  try {
    const body = await c.req.json<unknown>();
    if (body === null || body === undefined) return { ok: true, value: {} };
    if (typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'Request body must be a JSON object' };
    return { ok: true, value: body as Record<string, unknown> };
  } catch {
    return { ok: true, value: {} };
  }
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value ?? `${fallback}`, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function toGmailImportRuleResponse(rule: {
  id: string;
  connection_id: string;
  source_name: string;
  name: string;
  from_email: string | null;
  query: string | null;
  unprocessed_label_id: string;
  processed_label_id: string;
  review_label_id: string;
  failed_label_id: string;
  resource_id: string | null;
  menu_id: string | null;
  max_results: number;
  is_active: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}) {
  return {
    id: rule.id,
    connectionId: rule.connection_id,
    sourceName: rule.source_name,
    name: rule.name,
    fromEmail: rule.from_email,
    query: rule.query,
    unprocessedLabelId: rule.unprocessed_label_id,
    processedLabelId: rule.processed_label_id,
    reviewLabelId: rule.review_label_id,
    failedLabelId: rule.failed_label_id,
    resourceId: rule.resource_id,
    menuId: rule.menu_id,
    maxResults: rule.max_results,
    isActive: rule.is_active === 1,
    lastRunAt: rule.last_run_at,
    createdAt: rule.created_at,
    updatedAt: rule.updated_at,
  };
}

function toGmailImportRunResponse(run: {
  id: string;
  rule_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  fetched_count: number;
  imported_count: number;
  review_count: number;
  failed_count: number;
  last_error: string | null;
}) {
  return {
    id: run.id,
    ruleId: run.rule_id,
    startedAt: run.started_at,
    finishedAt: run.finished_at,
    status: run.status,
    fetchedCount: run.fetched_count,
    importedCount: run.imported_count,
    reviewCount: run.review_count,
    failedCount: run.failed_count,
    lastError: run.last_error,
  };
}

export { reservationIntegrations };
