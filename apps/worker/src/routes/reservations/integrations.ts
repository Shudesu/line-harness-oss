import { Hono } from 'hono';
import { importExternalReservation, listReservationSlots } from '@line-crm/db';
import type { Env } from '../../index.js';
import { parseJalanMail } from '../../services/jalan-mail-parser.js';
import { jsonError, jsonOk } from './responses.js';
import { parseJalanGmailImportBody, parseJalanImportBody, readJsonObject } from './requests.js';
import { toExternalReservationSourceResponse, toReservationResponse } from './serializers.js';

const reservationIntegrations = new Hono<Env>();

type ImportResult = Awaited<ReturnType<typeof importExternalReservation>>;

reservationIntegrations.post('/api/integrations/jalan/reservations/import', async (c) => {
  try {
    const json = await readJsonObject(c);
    if (!json.ok) return jsonError(c, json.error.code, json.error.status, json.error.message);
    const body = parseJalanImportBody(json.value);
    if (!body.ok) return jsonError(c, body.error.code, body.error.status, body.error.message);

    const result = await importExternalReservation(c.env.DB, body.value);
    if (!result.ok) {
      if (result.reason === 'slot_not_available') return jsonError(c, 'slot_not_available', 409, result.reason);
      if (result.reason === 'missing_dedupe_key') return jsonError(c, 'missing_dedupe_key', 400, result.reason);
      return jsonError(c, 'bad_request', 400, result.reason);
    }
    if (result.status === 'needs_review') {
      return jsonOk(c, { status: result.status, source: toExternalReservationSourceResponse(result.source) }, 202);
    }
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
    const parsedPayload = JSON.stringify({
      parser: 'jalan_gmail_v1',
      ...parsed,
      resourceId: body.value.resourceId ?? null,
      menuId: body.value.menuId ?? null,
      slotId: slotId ?? null,
    });

    const result = await importExternalReservation(c.env.DB, {
      source: 'jalan',
      eventType: parsed.eventType,
      externalId: parsed.externalId,
      gmailMessageId: body.value.gmailMessageId,
      receivedAt: body.value.receivedAt,
      rawText: body.value.rawText,
      parsedPayload,
      resourceId: body.value.resourceId,
      menuId: body.value.menuId,
      slotId,
      adultCount: parsed.adultCount ?? undefined,
      childCount: parsed.childCount ?? undefined,
      infantCount: parsed.infantCount ?? undefined,
      customerName: parsed.customerName,
      customerPhone: parsed.customerPhone,
      customerEmail: parsed.customerEmail,
    });

    return importResponse(c, result, parsed);
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

function importResponse(c: Parameters<typeof jsonOk>[0], result: ImportResult, parsed?: unknown): Response {
  if (!result.ok) {
    if (result.reason === 'slot_not_available') return jsonError(c, 'slot_not_available', 409, result.reason);
    if (result.reason === 'missing_dedupe_key') return jsonError(c, 'missing_dedupe_key', 400, result.reason);
    return jsonError(c, 'bad_request', 400, result.reason);
  }
  if (result.status === 'needs_review') {
    return jsonOk(c, { status: result.status, source: toExternalReservationSourceResponse(result.source), parsed }, 202);
  }
  return jsonOk(c, { status: result.status, reservation: toReservationResponse(result.reservation), parsed });
}

export { reservationIntegrations };
