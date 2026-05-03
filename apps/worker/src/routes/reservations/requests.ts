import type { Context } from 'hono';
import type {
  CapacityChannel,
  ExternalReservationEventType,
  ReservationApiErrorCode,
  ReservationSource,
  ReservationStatus,
} from '@line-crm/shared';

type ValidationError = {
  code: ReservationApiErrorCode;
  message: string;
  status: 400 | 401 | 409;
};

type ValidationResult<T> = { ok: true; value: T } | { ok: false; error: ValidationError };

type JsonObject = Record<string, unknown>;

export async function readJsonObject(c: Context): Promise<ValidationResult<JsonObject>> {
  try {
    const body = await c.req.json<unknown>();
    if (!isObject(body)) return invalid('Request body must be a JSON object');
    return { ok: true, value: body };
  } catch {
    return invalid('Request body must be valid JSON');
  }
}

export async function readOptionalJsonObject(c: Context): Promise<ValidationResult<JsonObject>> {
  try {
    const body = await c.req.json<unknown>();
    if (body === null || body === undefined) return { ok: true, value: {} };
    if (!isObject(body)) return invalid('Request body must be a JSON object');
    return { ok: true, value: body };
  } catch {
    return { ok: true, value: {} };
  }
}

export function requireString(body: JsonObject, key: string): ValidationResult<string> {
  const value = body[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    return invalid(`${key} is required`);
  }
  return { ok: true, value: value.trim() };
}

export function optionalString(body: JsonObject, key: string): string | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === 'string' ? value.trim() || null : undefined;
}

export function optionalNumber(body: JsonObject, key: string): number | undefined {
  const value = body[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function optionalJsonRecord(body: JsonObject, key: string): Record<string, unknown> | undefined {
  const value = body[key];
  return isObject(value) ? value : undefined;
}

export function queryRequired(c: Context, key: string): ValidationResult<string> {
  const value = c.req.query(key);
  if (!value?.trim()) return invalid(`${key} is required`);
  return { ok: true, value: value.trim() };
}

export function queryPositiveInt(c: Context, key: string, fallback: number): number {
  const value = Number.parseInt(c.req.query(key) ?? `${fallback}`, 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function parseReservationCreateBody(body: JsonObject): ValidationResult<{
  resourceId: string;
  menuId: string;
  slotId: string;
  source?: ReservationSource;
  capacityChannel?: CapacityChannel;
  lineAccountId?: string | null;
  userId?: string | null;
  friendId?: string | null;
  adultCount: number;
  childCount: number;
  customer: { name?: string | null; phone?: string | null; email?: string | null };
  formData: Record<string, unknown>;
  metadata: Record<string, unknown>;
}> {
  const resourceId = requireString(body, 'resourceId');
  if (!resourceId.ok) return resourceId;
  const menuId = requireString(body, 'menuId');
  if (!menuId.ok) return menuId;
  const slotId = requireString(body, 'slotId');
  if (!slotId.ok) return slotId;

  const source = parseReservationSourceValue(body.source);
  if (body.source !== undefined && !source) return invalid('source is invalid');
  const capacityChannel = parseCapacityChannelValue(body.capacityChannel);
  if (body.capacityChannel !== undefined && !capacityChannel) return invalid('capacityChannel is invalid');
  const customer = isObject(body.customer) ? body.customer : {};

  return {
    ok: true,
    value: {
      resourceId: resourceId.value,
      menuId: menuId.value,
      slotId: slotId.value,
      source,
      capacityChannel,
      lineAccountId: optionalString(body, 'lineAccountId'),
      userId: optionalString(body, 'userId'),
      friendId: optionalString(body, 'friendId'),
      adultCount: optionalNumber(body, 'adultCount') ?? 0,
      childCount: optionalNumber(body, 'childCount') ?? 0,
      customer: {
        name: optionalString(customer, 'name'),
        phone: optionalString(customer, 'phone'),
        email: optionalString(customer, 'email'),
      },
      formData: optionalJsonRecord(body, 'formData') ?? {},
      metadata: optionalJsonRecord(body, 'metadata') ?? {},
    },
  };
}

export function parseReservationStatusBody(body: JsonObject): ValidationResult<{
  status: ReservationStatus;
  reason?: string | null;
}> {
  const status = parseReservationStatusValue(body.status);
  if (!status) return invalid('status is required');
  return { ok: true, value: { status, reason: optionalString(body, 'reason') } };
}

export function parseJalanImportBody(body: JsonObject): ValidationResult<{
  source: 'jalan';
  eventType: ExternalReservationEventType;
  externalId?: string | null;
  dedupeKey?: string | null;
  gmailMessageId?: string | null;
  receivedAt?: string | null;
  rawText?: string | null;
  parsedPayload?: string;
  resourceId?: string;
  menuId?: string;
  slotId?: string;
  adultCount?: number;
  childCount?: number;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
}> {
  const eventType = parseExternalReservationEventType(body.eventType);
  if (!eventType) return invalid('eventType is required');
  return {
    ok: true,
    value: {
      source: 'jalan',
      eventType,
      externalId: optionalString(body, 'externalId'),
      dedupeKey: optionalString(body, 'dedupeKey'),
      gmailMessageId: optionalString(body, 'gmailMessageId'),
      receivedAt: optionalString(body, 'receivedAt'),
      rawText: optionalString(body, 'rawText'),
      parsedPayload: typeof body.parsedPayload === 'string' ? body.parsedPayload : undefined,
      resourceId: optionalString(body, 'resourceId') ?? undefined,
      menuId: optionalString(body, 'menuId') ?? undefined,
      slotId: optionalString(body, 'slotId') ?? undefined,
      adultCount: optionalNumber(body, 'adultCount'),
      childCount: optionalNumber(body, 'childCount'),
      customerName: optionalString(body, 'customerName'),
      customerPhone: optionalString(body, 'customerPhone'),
      customerEmail: optionalString(body, 'customerEmail'),
    },
  };
}

export function parseJalanGmailImportBody(body: JsonObject): ValidationResult<{
  gmailMessageId: string;
  rawText: string;
  receivedAt?: string | null;
  resourceId?: string;
  menuId?: string;
  slotId?: string;
}> {
  const gmailMessageId = requireString(body, 'gmailMessageId');
  if (!gmailMessageId.ok) return gmailMessageId;
  const rawText = requireString(body, 'rawText');
  if (!rawText.ok) return rawText;
  return {
    ok: true,
    value: {
      gmailMessageId: gmailMessageId.value,
      rawText: rawText.value,
      receivedAt: optionalString(body, 'receivedAt'),
      resourceId: optionalString(body, 'resourceId') ?? undefined,
      menuId: optionalString(body, 'menuId') ?? undefined,
      slotId: optionalString(body, 'slotId') ?? undefined,
    },
  };
}

export function parseReservationSourceValue(value: unknown): ReservationSource | undefined {
  const sources: ReservationSource[] = ['line', 'jalan', 'phone', 'gmail', 'admin', 'mcp'];
  return sources.includes(value as ReservationSource) ? (value as ReservationSource) : undefined;
}

export function parseCapacityChannelValue(value: unknown): CapacityChannel | undefined {
  const channels: CapacityChannel[] = ['line', 'external', 'manual'];
  return channels.includes(value as CapacityChannel) ? (value as CapacityChannel) : undefined;
}

export function parseReservationStatusValue(value: unknown): ReservationStatus | undefined {
  const statuses: ReservationStatus[] = ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'];
  return statuses.includes(value as ReservationStatus) ? (value as ReservationStatus) : undefined;
}

function parseExternalReservationEventType(value: unknown): ExternalReservationEventType | undefined {
  const eventTypes: ExternalReservationEventType[] = ['created', 'updated', 'cancelled', 'unknown'];
  return eventTypes.includes(value as ExternalReservationEventType) ? (value as ExternalReservationEventType) : undefined;
}

function invalid(message: string): ValidationResult<never> {
  return { ok: false, error: { code: 'bad_request', message, status: 400 } };
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
