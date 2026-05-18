import { jstNow } from './utils.js';
import { recordUserEvent } from './events.js';
import { recomputeReservationSystemTagsForFriend, recomputeReservationSystemTagsForUser } from './tags.js';

// =============================================================================
// Reservations — capacity-safe booking helpers
// =============================================================================

export type ReservationSource = 'line' | 'jalan' | 'phone' | 'gmail' | 'admin' | 'mcp';
export type ExternalReservationSource = 'jalan' | 'gmail' | 'phone' | 'manual';
export type CapacityChannel = 'line' | 'external' | 'manual';
export type ReservationStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show';
export type ReservationSlotStatus = 'open' | 'closed' | 'sold_out' | 'hidden';
export type ReservationActorType = 'customer' | 'admin' | 'gas' | 'mcp' | 'system';
export type ReservationEventType =
  | 'created'
  | 'updated'
  | 'confirmed'
  | 'cancelled'
  | 'completed'
  | 'no_show'
  | 'sync_failed'
  | 'imported';
export type ExternalReservationEventType = 'created' | 'updated' | 'cancelled' | 'unknown';
export type ExternalReservationParseStatus =
  | 'pending'
  | 'parsed'
  | 'imported'
  | 'needs_review'
  | 'failed'
  | 'duplicate'
  | 'ignored';

let reservationPeopleCapacitySchemaReady = false;

async function ensureReservationPeopleCapacitySchema(db: D1Database): Promise<void> {
  if (reservationPeopleCapacitySchemaReady) return;
  await ensureColumns(db, 'reservation_resources', [
    ['google_calendar_connection_id', 'TEXT'],
    ['slot_interval_minutes', 'INTEGER NOT NULL DEFAULT 60'],
    ['timezone', "TEXT NOT NULL DEFAULT 'Asia/Tokyo'"],
  ]);
  await ensureColumns(db, 'reservation_menus', [
    ['price_infant', 'INTEGER'],
    ['price_under_three', 'INTEGER'],
    ['capacity_count_adult', 'INTEGER NOT NULL DEFAULT 1 CHECK (capacity_count_adult IN (0, 1))'],
    ['capacity_count_child', 'INTEGER NOT NULL DEFAULT 1 CHECK (capacity_count_child IN (0, 1))'],
    ['capacity_count_infant', 'INTEGER NOT NULL DEFAULT 1 CHECK (capacity_count_infant IN (0, 1))'],
    ['capacity_count_under_three', 'INTEGER NOT NULL DEFAULT 0 CHECK (capacity_count_under_three IN (0, 1))'],
  ]);
  await ensureColumns(db, 'reservations', [
    ['infant_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['under_three_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['capacity_people', 'INTEGER NOT NULL DEFAULT 0'],
  ]);
  await ensureColumns(db, 'reservation_items', [
    ['infant_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['under_three_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['capacity_people', 'INTEGER NOT NULL DEFAULT 0'],
  ]);
  reservationPeopleCapacitySchemaReady = true;
}

async function ensureColumns(db: D1Database, tableName: string, columns: Array<[string, string]>): Promise<void> {
  const result = await db.prepare(`PRAGMA table_info(${tableName})`).all<{ name: string }>();
  const existing = new Set((result.results ?? []).map((column) => column.name));
  for (const [name, definition] of columns) {
    if (!existing.has(name)) {
      await db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${name} ${definition}`).run();
    }
  }
}

export interface ReservationResource {
  id: string;
  line_account_id: string | null;
  name: string;
  description: string | null;
  default_duration_minutes: number;
  default_capacity: number;
  default_line_capacity: number | null;
  default_external_capacity: number | null;
  default_buffer_capacity: number;
  google_calendar_connection_id: string | null;
  slot_interval_minutes: number;
  timezone: string;
  is_active: number;
  display_order: number;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface ReservationMenu {
  id: string;
  resource_id: string;
  name: string;
  description: string | null;
  duration_minutes: number;
  unit_type: 'person' | 'group' | 'seat' | 'table';
  min_people: number;
  max_people: number | null;
  price_adult: number | null;
  price_child: number | null;
  price_infant: number | null;
  price_under_three: number | null;
  capacity_count_adult: number;
  capacity_count_child: number;
  capacity_count_infant: number;
  capacity_count_under_three: number;
  form_fields: string;
  is_active: number;
  display_order: number;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface ReservationSchedule {
  id: string;
  resource_id: string;
  day_of_week: number;
  start_time: string;
  end_time: string;
  slot_interval_minutes: number;
  default_capacity: number;
  default_line_capacity: number | null;
  default_external_capacity: number | null;
  default_buffer_capacity: number;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface ReservationSlot {
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
  status: ReservationSlotStatus;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface Reservation {
  id: string;
  line_account_id: string | null;
  user_id: string | null;
  friend_id: string | null;
  slot_id: string;
  source: ReservationSource;
  capacity_channel: CapacityChannel;
  external_reservation_id: string | null;
  dedupe_key: string | null;
  title: string;
  reservation_date: string;
  start_at: string;
  end_at: string;
  status: ReservationStatus;
  adult_count: number;
  child_count: number;
  infant_count: number;
  under_three_count: number;
  total_people: number;
  capacity_people: number;
  customer_name_snapshot: string | null;
  customer_phone_snapshot: string | null;
  customer_email_snapshot: string | null;
  cancel_reason: string | null;
  form_data: string;
  metadata: string;
  total_amount?: number | null;
  created_at: string;
  updated_at: string;
}

export interface ExternalReservationSourceRow {
  id: string;
  source: ExternalReservationSource;
  event_type: ExternalReservationEventType;
  external_id: string | null;
  dedupe_key: string | null;
  reservation_id: string | null;
  raw_text: string | null;
  parsed_payload: string;
  parse_status: ExternalReservationParseStatus;
  received_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ReservationSlotAvailability {
  slot_id: string;
  resource_id: string;
  date: string;
  start_at: string;
  end_at: string;
  remaining_capacity: number;
  line_remaining_capacity: number;
  external_remaining_capacity: number;
  available: boolean;
}

export interface CreateReservationResourceInput {
  id?: string;
  lineAccountId?: string | null;
  name: string;
  description?: string | null;
  defaultDurationMinutes?: number;
  defaultCapacity?: number;
  defaultLineCapacity?: number | null;
  defaultExternalCapacity?: number | null;
  defaultBufferCapacity?: number;
  googleCalendarConnectionId?: string | null;
  slotIntervalMinutes?: number;
  timezone?: string;
  displayOrder?: number;
  metadata?: string;
}

export interface UpdateReservationResourceInput {
  name?: string;
  description?: string | null;
  defaultDurationMinutes?: number;
  defaultCapacity?: number;
  defaultLineCapacity?: number | null;
  defaultExternalCapacity?: number | null;
  defaultBufferCapacity?: number;
  googleCalendarConnectionId?: string | null;
  slotIntervalMinutes?: number;
  timezone?: string;
  isActive?: boolean;
  displayOrder?: number;
  metadata?: string;
}

export interface CreateReservationMenuInput {
  id?: string;
  resourceId: string;
  name: string;
  description?: string | null;
  durationMinutes?: number;
  unitType?: 'person' | 'group' | 'seat' | 'table';
  minPeople?: number;
  maxPeople?: number | null;
  priceAdult?: number | null;
  priceChild?: number | null;
  priceInfant?: number | null;
  priceUnderThree?: number | null;
  capacityCountAdult?: boolean;
  capacityCountChild?: boolean;
  capacityCountInfant?: boolean;
  capacityCountUnderThree?: boolean;
  formFields?: string;
  displayOrder?: number;
  metadata?: string;
}

export interface UpdateReservationMenuInput {
  name?: string;
  description?: string | null;
  durationMinutes?: number;
  unitType?: 'person' | 'group' | 'seat' | 'table';
  minPeople?: number;
  maxPeople?: number | null;
  priceAdult?: number | null;
  priceChild?: number | null;
  priceInfant?: number | null;
  priceUnderThree?: number | null;
  capacityCountAdult?: boolean;
  capacityCountChild?: boolean;
  capacityCountInfant?: boolean;
  capacityCountUnderThree?: boolean;
  formFields?: string;
  isActive?: boolean;
  displayOrder?: number;
  metadata?: string;
}

export interface CreateReservationScheduleInput {
  id?: string;
  resourceId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  slotIntervalMinutes?: number;
  defaultCapacity?: number;
  defaultLineCapacity?: number | null;
  defaultExternalCapacity?: number | null;
  defaultBufferCapacity?: number;
}

export interface UpdateReservationScheduleInput {
  dayOfWeek?: number;
  startTime?: string;
  endTime?: string;
  slotIntervalMinutes?: number;
  defaultCapacity?: number;
  defaultLineCapacity?: number | null;
  defaultExternalCapacity?: number | null;
  defaultBufferCapacity?: number;
  isActive?: boolean;
}

export type UpdateReservationMasterResult<T> =
  | { ok: true; item: T }
  | { ok: false; reason: 'not_found' | 'invalid_capacity' | 'invalid_schedule' | 'invalid_people' };

export interface GenerateReservationSlotsInput {
  resourceId: string;
  dateFrom: string;
  dateTo: string;
}

export interface UpdateReservationSlotInput {
  status?: ReservationSlotStatus;
  totalCapacity?: number;
  lineCapacity?: number | null;
  externalCapacity?: number | null;
  bufferCapacity?: number;
  note?: string | null;
}

export type UpdateReservationSlotResult =
  | { ok: true; slot: ReservationSlot }
  | { ok: false; reason: 'not_found' | 'invalid_capacity' };

export interface DeleteReservationSlotsInput {
  resourceId: string;
  dateFrom: string;
  dateTo: string;
}

export interface DeleteReservationSlotsResult {
  deletedCount: number;
  skippedCount: number;
}

export interface CreateReservationInput {
  id?: string;
  lineAccountId?: string | null;
  userId?: string | null;
  friendId?: string | null;
  resourceId: string;
  menuId: string;
  slotId: string;
  source?: ReservationSource;
  capacityChannel?: CapacityChannel;
  externalReservationId?: string | null;
  dedupeKey?: string | null;
  status?: Extract<ReservationStatus, 'pending' | 'confirmed'>;
  adultCount?: number;
  childCount?: number;
  infantCount?: number;
  underThreeCount?: number;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  formData?: string;
  metadata?: string;
  actorType?: ReservationActorType;
  actorId?: string | null;
}

export type CreateReservationResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; reason: 'not_found' | 'inactive' | 'invalid_slot' | 'invalid_people' | 'slot_not_available' };

export interface UpdateReservationStatusInput {
  status: ReservationStatus;
  reason?: string | null;
  actorType?: ReservationActorType;
  actorId?: string | null;
}

export type UpdateReservationStatusResult =
  | { ok: true; reservation: Reservation; changed: boolean }
  | { ok: false; reason: 'not_found' | 'invalid_state_transition' };

export interface ImportExternalReservationInput {
  source: ExternalReservationSource;
  eventType: ExternalReservationEventType;
  externalId?: string | null;
  dedupeKey?: string | null;
  gmailMessageId?: string | null;
  receivedAt?: string | null;
  rawText?: string | null;
  parsedPayload?: string;
  reviewReason?: string | null;
  resourceId?: string;
  menuId?: string;
  slotId?: string;
  adultCount?: number;
  childCount?: number;
  infantCount?: number;
  underThreeCount?: number;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
}

export type ImportExternalReservationResult =
  | { ok: true; status: 'imported' | 'duplicate' | 'cancelled'; reservation: Reservation }
  | { ok: true; status: 'needs_review'; source: ExternalReservationSourceRow }
  | { ok: false; reason: 'missing_dedupe_key' | 'slot_not_available' | 'invalid_reservation' };

export function nullableText(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function getReservationSlotAvailability(
  slot: ReservationSlot,
  requestedPeople = 1,
): ReservationSlotAvailability {
  const effectiveTotal = Math.max(slot.total_capacity - slot.buffer_capacity, 0);
  const remaining = Math.max(effectiveTotal - slot.reserved_count, 0);
  const lineLimit = slot.line_capacity ?? effectiveTotal;
  const externalLimit = slot.external_capacity ?? effectiveTotal;
  const lineRemaining = Math.max(Math.min(remaining, lineLimit - slot.line_reserved_count), 0);
  const externalRemaining = Math.max(Math.min(remaining, externalLimit - slot.external_reserved_count), 0);

  return {
    slot_id: slot.id,
    resource_id: slot.resource_id,
    date: slot.date,
    start_at: slot.start_at,
    end_at: slot.end_at,
    remaining_capacity: remaining,
    line_remaining_capacity: lineRemaining,
    external_remaining_capacity: externalRemaining,
    available: slot.status === 'open' && lineRemaining >= requestedPeople && remaining >= requestedPeople,
  };
}

export function calculateReservationPeople(
  menu: Pick<ReservationMenu, 'capacity_count_adult' | 'capacity_count_child' | 'capacity_count_infant' | 'capacity_count_under_three'>,
  input: { adultCount?: number; childCount?: number; infantCount?: number; underThreeCount?: number },
): { adultCount: number; childCount: number; infantCount: number; underThreeCount: number; totalPeople: number; capacityPeople: number } {
  const adultCount = Math.max(0, Math.floor(input.adultCount ?? 0));
  const childCount = Math.max(0, Math.floor(input.childCount ?? 0));
  const infantCount = Math.max(0, Math.floor(input.infantCount ?? 0));
  const underThreeCount = Math.max(0, Math.floor(input.underThreeCount ?? 0));
  const capacityCountAdult = Number.isFinite(menu.capacity_count_adult) ? menu.capacity_count_adult : 1;
  const capacityCountChild = Number.isFinite(menu.capacity_count_child) ? menu.capacity_count_child : 1;
  const capacityCountInfant = Number.isFinite(menu.capacity_count_infant) ? menu.capacity_count_infant : 1;
  const capacityCountUnderThree = Number.isFinite(menu.capacity_count_under_three) ? menu.capacity_count_under_three : 0;
  const totalPeople = adultCount + childCount + infantCount + underThreeCount;
  const configuredCapacityPeople =
    adultCount * capacityCountAdult +
    childCount * capacityCountChild +
    infantCount * capacityCountInfant +
    underThreeCount * capacityCountUnderThree;
  const capacityPeople = configuredCapacityPeople > 0 ? configuredCapacityPeople : totalPeople;

  return { adultCount, childCount, infantCount, underThreeCount, totalPeople, capacityPeople };
}

export async function getReservationResourceById(
  db: D1Database,
  id: string,
): Promise<ReservationResource | null> {
  await ensureReservationPeopleCapacitySchema(db);
  return db.prepare(`SELECT * FROM reservation_resources WHERE id = ?`).bind(id).first<ReservationResource>();
}

export async function getReservationMenuById(
  db: D1Database,
  id: string,
): Promise<ReservationMenu | null> {
  return db.prepare(`SELECT * FROM reservation_menus WHERE id = ?`).bind(id).first<ReservationMenu>();
}

export async function getReservationSlotById(
  db: D1Database,
  id: string,
): Promise<ReservationSlot | null> {
  return db.prepare(`SELECT * FROM reservation_slots WHERE id = ?`).bind(id).first<ReservationSlot>();
}

export async function getReservationById(
  db: D1Database,
  id: string,
): Promise<Reservation | null> {
  return db.prepare(
    `SELECT r.*,
            (SELECT SUM(amount) FROM reservation_items WHERE reservation_id = r.id) AS total_amount
     FROM reservations r
     WHERE r.id = ?`,
  ).bind(id).first<Reservation>();
}

export async function listReservationResources(db: D1Database): Promise<ReservationResource[]> {
  await ensureReservationPeopleCapacitySchema(db);
  const result = await db
    .prepare(`SELECT * FROM reservation_resources ORDER BY display_order ASC, created_at DESC`)
    .all<ReservationResource>();
  return result.results;
}

export async function listReservationMenus(db: D1Database, resourceId: string): Promise<ReservationMenu[]> {
  const result = await db
    .prepare(
      `SELECT * FROM reservation_menus
       WHERE resource_id = ?
       ORDER BY display_order ASC, created_at DESC`,
    )
    .bind(resourceId)
    .all<ReservationMenu>();
  return result.results;
}

export async function listReservationSchedules(db: D1Database, resourceId: string): Promise<ReservationSchedule[]> {
  const result = await db
    .prepare(
      `SELECT * FROM reservation_schedules
       WHERE resource_id = ?
       ORDER BY day_of_week ASC, start_time ASC`,
    )
    .bind(resourceId)
    .all<ReservationSchedule>();
  return result.results;
}

export async function listReservations(
  db: D1Database,
  params: {
    date?: string;
    slotId?: string;
    userId?: string;
    status?: ReservationStatus;
    source?: ReservationSource;
    limit?: number;
  } = {},
): Promise<Reservation[]> {
  const where: string[] = [];
  const values: unknown[] = [];

  if (params.date) {
    where.push('r.reservation_date = ?');
    values.push(params.date);
  }
  if (params.slotId) {
    where.push('r.slot_id = ?');
    values.push(params.slotId);
  }
  if (params.userId) {
    where.push('r.user_id = ?');
    values.push(params.userId);
  }
  if (params.status) {
    where.push('r.status = ?');
    values.push(params.status);
  }
  if (params.source) {
    where.push('r.source = ?');
    values.push(params.source);
  }

  values.push(Math.min(params.limit ?? 100, 500));
  const result = await db
    .prepare(
      `SELECT r.*,
              (SELECT SUM(amount) FROM reservation_items WHERE reservation_id = r.id) AS total_amount
       FROM reservations r
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY r.start_at ASC, r.created_at DESC
       LIMIT ?`,
    )
    .bind(...values)
    .all<Reservation>();
  return result.results;
}

export async function listExternalReservationSources(
  db: D1Database,
  params: {
    source?: ExternalReservationSource;
    parseStatus?: ExternalReservationParseStatus;
    limit?: number;
  } = {},
): Promise<ExternalReservationSourceRow[]> {
  const where: string[] = [];
  const values: unknown[] = [];

  if (params.source) {
    where.push('source = ?');
    values.push(params.source);
  }
  if (params.parseStatus) {
    where.push('parse_status = ?');
    values.push(params.parseStatus);
  }

  values.push(Math.min(params.limit ?? 100, 500));
  const result = await db
    .prepare(
      `SELECT * FROM external_reservation_sources
       ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY received_at DESC, created_at DESC
       LIMIT ?`,
    )
    .bind(...values)
    .all<ExternalReservationSourceRow>();
  return result.results;
}

export async function updateExternalReservationSourceParseStatus(
  db: D1Database,
  id: string,
  input: {
    parseStatus: ExternalReservationParseStatus;
    lastError?: string | null;
  },
): Promise<ExternalReservationSourceRow | null> {
  await db
    .prepare(
      `UPDATE external_reservation_sources
       SET parse_status = ?,
           last_error = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(input.parseStatus, input.lastError ?? null, jstNow(), id)
    .run();
  return db.prepare(`SELECT * FROM external_reservation_sources WHERE id = ?`).bind(id).first<ExternalReservationSourceRow>();
}

export async function createReservationResource(
  db: D1Database,
  input: CreateReservationResourceInput,
): Promise<ReservationResource> {
  await ensureReservationPeopleCapacitySchema(db);
  const id = input.id ?? crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO reservation_resources
         (id, line_account_id, name, description, default_duration_minutes, default_capacity,
          default_line_capacity, default_external_capacity, default_buffer_capacity,
          google_calendar_connection_id, slot_interval_minutes, timezone, is_active, display_order,
          metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.lineAccountId ?? null,
      input.name,
      input.description ?? null,
      input.defaultDurationMinutes ?? 60,
      input.defaultCapacity ?? 1,
      input.defaultLineCapacity ?? null,
      input.defaultExternalCapacity ?? null,
      input.defaultBufferCapacity ?? 0,
      input.googleCalendarConnectionId ?? null,
      input.slotIntervalMinutes ?? 60,
      input.timezone ?? 'Asia/Tokyo',
      input.displayOrder ?? 0,
      input.metadata ?? '{}',
      now,
      now,
    )
    .run();

  return (await getReservationResourceById(db, id))!;
}

export async function updateReservationResource(
  db: D1Database,
  id: string,
  input: UpdateReservationResourceInput,
): Promise<UpdateReservationMasterResult<ReservationResource>> {
  const resource = await getReservationResourceById(db, id);
  if (!resource) return { ok: false, reason: 'not_found' };

  const defaultCapacity = input.defaultCapacity ?? resource.default_capacity;
  const defaultLineCapacity = input.defaultLineCapacity === undefined ? resource.default_line_capacity : input.defaultLineCapacity;
  const defaultExternalCapacity = input.defaultExternalCapacity === undefined ? resource.default_external_capacity : input.defaultExternalCapacity;
  const defaultBufferCapacity = input.defaultBufferCapacity ?? resource.default_buffer_capacity;
  if (defaultCapacity < 1 || defaultBufferCapacity < 0 || defaultBufferCapacity > defaultCapacity) {
    return { ok: false, reason: 'invalid_capacity' };
  }
  if (defaultLineCapacity !== null && defaultLineCapacity < 0) return { ok: false, reason: 'invalid_capacity' };
  if (defaultExternalCapacity !== null && defaultExternalCapacity < 0) return { ok: false, reason: 'invalid_capacity' };

  await db
    .prepare(
      `UPDATE reservation_resources
       SET name = ?,
           description = ?,
           default_duration_minutes = ?,
           default_capacity = ?,
           default_line_capacity = ?,
           default_external_capacity = ?,
           default_buffer_capacity = ?,
           google_calendar_connection_id = ?,
           slot_interval_minutes = ?,
           timezone = ?,
           is_active = ?,
           display_order = ?,
           metadata = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.name ?? resource.name,
      input.description === undefined ? resource.description : input.description,
      input.defaultDurationMinutes ?? resource.default_duration_minutes,
      defaultCapacity,
      defaultLineCapacity,
      defaultExternalCapacity,
      defaultBufferCapacity,
      input.googleCalendarConnectionId === undefined ? resource.google_calendar_connection_id : input.googleCalendarConnectionId,
      input.slotIntervalMinutes ?? resource.slot_interval_minutes,
      input.timezone ?? resource.timezone,
      input.isActive === undefined ? resource.is_active : input.isActive ? 1 : 0,
      input.displayOrder ?? resource.display_order,
      input.metadata ?? resource.metadata,
      jstNow(),
      id,
    )
    .run();

  return { ok: true, item: (await getReservationResourceById(db, id))! };
}

export async function createReservationMenu(
  db: D1Database,
  input: CreateReservationMenuInput,
): Promise<ReservationMenu> {
  await ensureReservationPeopleCapacitySchema(db);
  const id = input.id ?? crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO reservation_menus
         (id, resource_id, name, description, duration_minutes, unit_type, min_people, max_people,
          price_adult, price_child, price_infant, price_under_three,
          capacity_count_adult, capacity_count_child, capacity_count_infant, capacity_count_under_three,
          form_fields, is_active, display_order, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.resourceId,
      input.name,
      input.description ?? null,
      input.durationMinutes ?? 60,
      input.unitType ?? 'person',
      input.minPeople ?? 1,
      input.maxPeople ?? null,
      input.priceAdult ?? null,
      input.priceChild ?? null,
      input.priceInfant ?? null,
      input.priceUnderThree ?? 0,
      input.capacityCountAdult === undefined ? 1 : input.capacityCountAdult ? 1 : 0,
      input.capacityCountChild === undefined ? 1 : input.capacityCountChild ? 1 : 0,
      input.capacityCountInfant === undefined ? 1 : input.capacityCountInfant ? 1 : 0,
      input.capacityCountUnderThree === undefined ? 0 : input.capacityCountUnderThree ? 1 : 0,
      input.formFields ?? '[]',
      input.displayOrder ?? 0,
      input.metadata ?? '{}',
      now,
      now,
    )
    .run();

  return (await getReservationMenuById(db, id))!;
}

export async function updateReservationMenu(
  db: D1Database,
  id: string,
  input: UpdateReservationMenuInput,
): Promise<UpdateReservationMasterResult<ReservationMenu>> {
  await ensureReservationPeopleCapacitySchema(db);
  const menu = await getReservationMenuById(db, id);
  if (!menu) return { ok: false, reason: 'not_found' };

  const minPeople = input.minPeople ?? menu.min_people;
  const maxPeople = input.maxPeople === undefined ? menu.max_people : input.maxPeople;
  if (minPeople < 1 || (maxPeople !== null && maxPeople < minPeople)) return { ok: false, reason: 'invalid_people' };

  await db
    .prepare(
      `UPDATE reservation_menus
       SET name = ?,
           description = ?,
           duration_minutes = ?,
           unit_type = ?,
           min_people = ?,
           max_people = ?,
           price_adult = ?,
           price_child = ?,
           price_infant = ?,
           price_under_three = ?,
           capacity_count_adult = ?,
           capacity_count_child = ?,
           capacity_count_infant = ?,
           capacity_count_under_three = ?,
           form_fields = ?,
           is_active = ?,
           display_order = ?,
           metadata = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.name ?? menu.name,
      input.description === undefined ? menu.description : input.description,
      input.durationMinutes ?? menu.duration_minutes,
      input.unitType ?? menu.unit_type,
      minPeople,
      maxPeople,
      input.priceAdult === undefined ? menu.price_adult : input.priceAdult,
      input.priceChild === undefined ? menu.price_child : input.priceChild,
      input.priceInfant === undefined ? menu.price_infant : input.priceInfant,
      input.priceUnderThree === undefined ? menu.price_under_three : input.priceUnderThree,
      input.capacityCountAdult === undefined ? menu.capacity_count_adult : input.capacityCountAdult ? 1 : 0,
      input.capacityCountChild === undefined ? menu.capacity_count_child : input.capacityCountChild ? 1 : 0,
      input.capacityCountInfant === undefined ? menu.capacity_count_infant : input.capacityCountInfant ? 1 : 0,
      input.capacityCountUnderThree === undefined ? menu.capacity_count_under_three : input.capacityCountUnderThree ? 1 : 0,
      input.formFields ?? menu.form_fields,
      input.isActive === undefined ? menu.is_active : input.isActive ? 1 : 0,
      input.displayOrder ?? menu.display_order,
      input.metadata ?? menu.metadata,
      jstNow(),
      id,
    )
    .run();

  return { ok: true, item: (await getReservationMenuById(db, id))! };
}

export async function createReservationSchedule(
  db: D1Database,
  input: CreateReservationScheduleInput,
): Promise<ReservationSchedule> {
  const id = input.id ?? crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO reservation_schedules
         (id, resource_id, day_of_week, start_time, end_time, slot_interval_minutes,
          default_capacity, default_line_capacity, default_external_capacity, default_buffer_capacity,
          is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      id,
      input.resourceId,
      input.dayOfWeek,
      input.startTime,
      input.endTime,
      input.slotIntervalMinutes ?? 60,
      input.defaultCapacity ?? 1,
      input.defaultLineCapacity ?? null,
      input.defaultExternalCapacity ?? null,
      input.defaultBufferCapacity ?? 0,
      now,
      now,
    )
    .run();

  return db.prepare(`SELECT * FROM reservation_schedules WHERE id = ?`).bind(id).first<ReservationSchedule>() as Promise<ReservationSchedule>;
}

export async function updateReservationSchedule(
  db: D1Database,
  id: string,
  input: UpdateReservationScheduleInput,
): Promise<UpdateReservationMasterResult<ReservationSchedule>> {
  const schedule = await db.prepare(`SELECT * FROM reservation_schedules WHERE id = ?`).bind(id).first<ReservationSchedule>();
  if (!schedule) return { ok: false, reason: 'not_found' };

  const dayOfWeek = input.dayOfWeek ?? schedule.day_of_week;
  const startTime = input.startTime ?? schedule.start_time;
  const endTime = input.endTime ?? schedule.end_time;
  const defaultCapacity = input.defaultCapacity ?? schedule.default_capacity;
  const defaultLineCapacity = input.defaultLineCapacity === undefined ? schedule.default_line_capacity : input.defaultLineCapacity;
  const defaultExternalCapacity = input.defaultExternalCapacity === undefined ? schedule.default_external_capacity : input.defaultExternalCapacity;
  const defaultBufferCapacity = input.defaultBufferCapacity ?? schedule.default_buffer_capacity;

  if (dayOfWeek < 0 || dayOfWeek > 6 || startTime >= endTime) return { ok: false, reason: 'invalid_schedule' };
  if (defaultCapacity < 1 || defaultBufferCapacity < 0 || defaultBufferCapacity > defaultCapacity) return { ok: false, reason: 'invalid_capacity' };
  if (defaultLineCapacity !== null && defaultLineCapacity < 0) return { ok: false, reason: 'invalid_capacity' };
  if (defaultExternalCapacity !== null && defaultExternalCapacity < 0) return { ok: false, reason: 'invalid_capacity' };

  await db
    .prepare(
      `UPDATE reservation_schedules
       SET day_of_week = ?,
           start_time = ?,
           end_time = ?,
           slot_interval_minutes = ?,
           default_capacity = ?,
           default_line_capacity = ?,
           default_external_capacity = ?,
           default_buffer_capacity = ?,
           is_active = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      dayOfWeek,
      startTime,
      endTime,
      input.slotIntervalMinutes ?? schedule.slot_interval_minutes,
      defaultCapacity,
      defaultLineCapacity,
      defaultExternalCapacity,
      defaultBufferCapacity,
      input.isActive === undefined ? schedule.is_active : input.isActive ? 1 : 0,
      jstNow(),
      id,
    )
    .run();

  return { ok: true, item: (await db.prepare(`SELECT * FROM reservation_schedules WHERE id = ?`).bind(id).first<ReservationSchedule>())! };
}

export async function generateReservationSlots(
  db: D1Database,
  input: GenerateReservationSlotsInput,
): Promise<ReservationSlot[]> {
  const schedules = (
    await db
      .prepare(`SELECT * FROM reservation_schedules WHERE resource_id = ? AND is_active = 1`)
      .bind(input.resourceId)
      .all<ReservationSchedule>()
  ).results;

  const created: ReservationSlot[] = [];
  for (const date of eachDate(input.dateFrom, input.dateTo)) {
    const dayOfWeek = dayOfWeekFromDateString(date);
    for (const schedule of schedules.filter((item) => item.day_of_week === dayOfWeek)) {
      for (const range of eachTimeRange(date, schedule.start_time, schedule.end_time, schedule.slot_interval_minutes)) {
        const id = crypto.randomUUID();
        const now = jstNow();
        await db
          .prepare(
            `INSERT OR IGNORE INTO reservation_slots
               (id, resource_id, date, start_at, end_at, total_capacity, line_capacity, external_capacity,
                buffer_capacity, reserved_count, line_reserved_count, external_reserved_count, status,
                created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, 0, 'open', ?, ?)`,
          )
          .bind(
            id,
            input.resourceId,
            date,
            range.startAt,
            range.endAt,
            schedule.default_capacity,
            schedule.default_line_capacity,
            schedule.default_external_capacity,
            schedule.default_buffer_capacity,
            now,
            now,
          )
          .run();

        const slot = await getReservationSlotById(db, id);
        if (slot) created.push(slot);
      }
    }
  }
  return created;
}

export async function listReservationSlots(
  db: D1Database,
  params: { resourceId: string; date: string },
): Promise<ReservationSlot[]> {
  const result = await db
    .prepare(`SELECT * FROM reservation_slots WHERE resource_id = ? AND date = ? ORDER BY start_at ASC`)
    .bind(params.resourceId, params.date)
    .all<ReservationSlot>();
  return result.results;
}

export async function deleteReservationSlotsByDateRange(
  db: D1Database,
  input: DeleteReservationSlotsInput,
): Promise<DeleteReservationSlotsResult> {
  const existing = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM reservation_slots
       WHERE resource_id = ?
         AND date BETWEEN ? AND ?`,
    )
    .bind(input.resourceId, input.dateFrom, input.dateTo)
    .first<{ count: number }>();

  await db
    .prepare(
      `DELETE FROM reservation_slots
       WHERE resource_id = ?
         AND date BETWEEN ? AND ?
         AND NOT EXISTS (
           SELECT 1
           FROM reservations
           WHERE reservations.slot_id = reservation_slots.id
         )`,
    )
    .bind(input.resourceId, input.dateFrom, input.dateTo)
    .run();

  const remaining = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM reservation_slots
       WHERE resource_id = ?
         AND date BETWEEN ? AND ?`,
    )
    .bind(input.resourceId, input.dateFrom, input.dateTo)
    .first<{ count: number }>();

  const beforeCount = existing?.count ?? 0;
  const skippedCount = remaining?.count ?? 0;
  return {
    deletedCount: Math.max(beforeCount - skippedCount, 0),
    skippedCount,
  };
}

export async function updateReservationSlot(
  db: D1Database,
  id: string,
  input: UpdateReservationSlotInput,
): Promise<UpdateReservationSlotResult> {
  const slot = await getReservationSlotById(db, id);
  if (!slot) return { ok: false, reason: 'not_found' };

  const totalCapacity = input.totalCapacity ?? slot.total_capacity;
  const lineCapacity = input.lineCapacity === undefined ? slot.line_capacity : input.lineCapacity;
  const externalCapacity = input.externalCapacity === undefined ? slot.external_capacity : input.externalCapacity;
  const bufferCapacity = input.bufferCapacity ?? slot.buffer_capacity;

  if (totalCapacity < 1 || totalCapacity < slot.reserved_count) return { ok: false, reason: 'invalid_capacity' };
  if (bufferCapacity < 0 || bufferCapacity > totalCapacity) return { ok: false, reason: 'invalid_capacity' };
  if (lineCapacity !== null && lineCapacity < slot.line_reserved_count) return { ok: false, reason: 'invalid_capacity' };
  if (externalCapacity !== null && externalCapacity < slot.external_reserved_count) return { ok: false, reason: 'invalid_capacity' };
  if (totalCapacity - bufferCapacity < slot.reserved_count) return { ok: false, reason: 'invalid_capacity' };

  await db
    .prepare(
      `UPDATE reservation_slots
       SET status = ?,
           total_capacity = ?,
           line_capacity = ?,
           external_capacity = ?,
           buffer_capacity = ?,
           note = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.status ?? slot.status,
      totalCapacity,
      lineCapacity,
      externalCapacity,
      bufferCapacity,
      input.note === undefined ? slot.note : input.note,
      jstNow(),
      id,
    )
    .run();

  return { ok: true, slot: (await getReservationSlotById(db, id))! };
}

export async function reserveSlotCapacity(
  db: D1Database,
  slotId: string,
  people: number,
  capacityChannel: CapacityChannel,
): Promise<boolean> {
  if (people <= 0) return false;

  const sqlByChannel: Record<CapacityChannel, string> = {
    line: `UPDATE reservation_slots
           SET reserved_count = reserved_count + ?,
               line_reserved_count = line_reserved_count + ?,
               updated_at = ?
           WHERE id = ?
             AND status = 'open'
             AND reserved_count + ? <= total_capacity - buffer_capacity
             AND line_reserved_count + ? <= COALESCE(line_capacity, total_capacity - buffer_capacity)`,
    external: `UPDATE reservation_slots
           SET reserved_count = reserved_count + ?,
               external_reserved_count = external_reserved_count + ?,
               updated_at = ?
           WHERE id = ?
             AND status = 'open'
             AND reserved_count + ? <= total_capacity - buffer_capacity
             AND external_reserved_count + ? <= COALESCE(external_capacity, total_capacity - buffer_capacity)`,
    manual: `UPDATE reservation_slots
           SET reserved_count = reserved_count + ?,
               updated_at = ?
           WHERE id = ?
             AND status = 'open'
             AND reserved_count + ? <= total_capacity - buffer_capacity`,
  };

  const statement = db.prepare(sqlByChannel[capacityChannel]);
  const result =
    capacityChannel === 'manual'
      ? await statement.bind(people, jstNow(), slotId, people).run()
      : await statement.bind(people, people, jstNow(), slotId, people, people).run();

  return (result.meta.changes ?? 0) === 1;
}

export async function releaseSlotCapacity(
  db: D1Database,
  slotId: string,
  people: number,
  capacityChannel: CapacityChannel,
): Promise<void> {
  if (people <= 0) return;

  await db
    .prepare(
      `UPDATE reservation_slots
       SET reserved_count = MAX(reserved_count - ?, 0),
           line_reserved_count = CASE WHEN ? = 'line' THEN MAX(line_reserved_count - ?, 0) ELSE line_reserved_count END,
           external_reserved_count = CASE WHEN ? = 'external' THEN MAX(external_reserved_count - ?, 0) ELSE external_reserved_count END,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(people, capacityChannel, people, capacityChannel, people, jstNow(), slotId)
    .run();
}

export async function createReservationWithCapacityCheck(
  db: D1Database,
  input: CreateReservationInput,
): Promise<CreateReservationResult> {
  await ensureReservationPeopleCapacitySchema(db);
  const [resource, menu, slot] = await Promise.all([
    getReservationResourceById(db, input.resourceId),
    getReservationMenuById(db, input.menuId),
    getReservationSlotById(db, input.slotId),
  ]);

  if (!resource || !menu || !slot) return { ok: false, reason: 'not_found' };
  if (resource.is_active !== 1 || menu.is_active !== 1) return { ok: false, reason: 'inactive' };
  if (slot.resource_id !== input.resourceId || menu.resource_id !== input.resourceId) {
    return { ok: false, reason: 'invalid_slot' };
  }
  if (slotDurationMinutes(slot) !== menu.duration_minutes) {
    return { ok: false, reason: 'invalid_slot' };
  }

  const { adultCount, childCount, infantCount, underThreeCount, totalPeople, capacityPeople } = calculateReservationPeople(menu, input);
  if (
    totalPeople <= 0 ||
    capacityPeople <= 0 ||
    totalPeople < menu.min_people ||
    (menu.max_people !== null && totalPeople > menu.max_people)
  ) {
    return { ok: false, reason: 'invalid_people' };
  }

  const capacityChannel = input.capacityChannel ?? 'line';
  if (capacityChannel === 'line' && slot.line_capacity === null && resource.default_line_capacity !== null) {
    await db
      .prepare(`UPDATE reservation_slots SET line_capacity = ?, updated_at = ? WHERE id = ? AND line_capacity IS NULL`)
      .bind(resource.default_line_capacity, jstNow(), slot.id)
      .run();
    slot.line_capacity = resource.default_line_capacity;
  }
  if (capacityChannel === 'external' && slot.external_capacity === null && resource.default_external_capacity !== null) {
    await db
      .prepare(`UPDATE reservation_slots SET external_capacity = ?, updated_at = ? WHERE id = ? AND external_capacity IS NULL`)
      .bind(resource.default_external_capacity, jstNow(), slot.id)
      .run();
    slot.external_capacity = resource.default_external_capacity;
  }
  const reserved = await reserveSlotCapacity(db, slot.id, capacityPeople, capacityChannel);
  if (!reserved) return { ok: false, reason: 'slot_not_available' };

  const id = input.id ?? crypto.randomUUID();
  const now = jstNow();
  const status = input.status ?? 'confirmed';
  const externalReservationId = nullableText(input.externalReservationId);
  const dedupeKey = nullableText(input.dedupeKey);
  const title = input.customerName ? `${input.customerName} / ${menu.name}` : menu.name;

  try {
    await db
      .prepare(
        `INSERT INTO reservations
           (id, line_account_id, user_id, friend_id, slot_id, source, capacity_channel,
            external_reservation_id, dedupe_key, title, reservation_date, start_at, end_at, status,
            adult_count, child_count, infant_count, under_three_count, total_people, capacity_people, customer_name_snapshot, customer_phone_snapshot,
            customer_email_snapshot, form_data, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        input.lineAccountId ?? null,
        input.userId ?? null,
        input.friendId ?? null,
        slot.id,
        input.source ?? 'line',
        capacityChannel,
        externalReservationId,
        dedupeKey,
        title,
        slot.date,
        slot.start_at,
        slot.end_at,
        status,
        adultCount,
        childCount,
        infantCount,
        underThreeCount,
        totalPeople,
        capacityPeople,
        nullableText(input.customerName),
        nullableText(input.customerPhone),
        nullableText(input.customerEmail),
        input.formData ?? '{}',
        input.metadata ?? '{}',
        now,
        now,
      )
      .run();

    await db
      .prepare(
        `INSERT INTO reservation_items
           (id, reservation_id, menu_id, resource_id, name_snapshot, quantity, adult_count, child_count, infant_count, under_three_count,
            capacity_people, unit_price, amount, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, '{}', ?)`,
      )
      .bind(
        crypto.randomUUID(),
        id,
        menu.id,
        resource.id,
        menu.name,
        adultCount,
        childCount,
        infantCount,
        underThreeCount,
        capacityPeople,
        menu.price_adult,
        calculateAmount(menu, adultCount, childCount, infantCount, underThreeCount),
        now,
      )
      .run();

    const reservation = (await getReservationById(db, id))!;
    await createReservationEvent(db, reservation.id, 'created', input.actorType ?? 'system', input.actorId ?? null, null, reservation);
    if (input.userId) await recomputeReservationCustomerProfileStatus(db, input.userId, input.source ?? 'line');
    await recomputeReservationSystemTagsForReservation(db, reservation);
    await recordReservationUserEventBestEffort(db, reservation, 'reservation.created', '予約作成', {
      resourceId: resource.id,
      menuId: menu.id,
    });
    return { ok: true, reservation };
  } catch (error) {
    await releaseSlotCapacity(db, slot.id, capacityPeople, capacityChannel);
    throw error;
  }
}

export async function updateReservationStatus(
  db: D1Database,
  id: string,
  input: UpdateReservationStatusInput,
): Promise<UpdateReservationStatusResult> {
  const reservation = await getReservationById(db, id);
  if (!reservation) return { ok: false, reason: 'not_found' };
  if (reservation.status === input.status) {
    return { ok: true, reservation, changed: false };
  }

  if (reservation.status === 'cancelled' || reservation.status === 'completed' || reservation.status === 'no_show') {
    return { ok: false, reason: 'invalid_state_transition' };
  }

  const now = jstNow();
  if (input.status === 'cancelled') {
    await db
      .prepare(`UPDATE reservations SET status = 'cancelled', cancel_reason = ?, updated_at = ? WHERE id = ?`)
      .bind(input.reason ?? null, now, id)
      .run();
    await releaseSlotCapacity(db, reservation.slot_id, reservation.capacity_people, reservation.capacity_channel);
    const updated = (await getReservationById(db, id))!;
    await createReservationEvent(
      db,
      id,
      'cancelled',
      input.actorType ?? 'system',
      input.actorId ?? null,
      reservation,
      updated,
    );
    await createRestoreCapacityTaskIfNeeded(db, updated);
    if (updated.user_id) await recomputeReservationCustomerProfileStatus(db, updated.user_id, updated.source);
    await recomputeReservationSystemTagsForReservation(db, updated);
    await recordReservationUserEventBestEffort(db, updated, 'reservation.cancelled', '予約キャンセル', { reason: input.reason ?? null });
    return { ok: true, reservation: updated, changed: true };
  }

  if (reservation.status === 'pending' && input.status === 'confirmed') {
    await db.prepare(`UPDATE reservations SET status = 'confirmed', updated_at = ? WHERE id = ?`).bind(now, id).run();
    const updated = (await getReservationById(db, id))!;
    await createReservationEvent(db, id, 'confirmed', input.actorType ?? 'system', input.actorId ?? null, reservation, updated);
    if (updated.user_id) await recomputeReservationCustomerProfileStatus(db, updated.user_id, updated.source);
    await recomputeReservationSystemTagsForReservation(db, updated);
    await recordReservationUserEventBestEffort(db, updated, 'reservation.confirmed', '予約確定');
    return { ok: true, reservation: updated, changed: true };
  }

  if (reservation.status === 'confirmed' && input.status === 'completed') {
    await db.prepare(`UPDATE reservations SET status = 'completed', updated_at = ? WHERE id = ?`).bind(now, id).run();
    await createVisitForReservation(db, reservation);
    const updated = (await getReservationById(db, id))!;
    await createReservationEvent(db, id, 'completed', input.actorType ?? 'system', input.actorId ?? null, reservation, updated);
    if (updated.user_id) await recomputeReservationCustomerProfileStatus(db, updated.user_id, updated.source);
    await recomputeReservationSystemTagsForReservation(db, updated);
    await recordReservationUserEventBestEffort(db, updated, 'reservation.completed', '来園完了');
    return { ok: true, reservation: updated, changed: true };
  }

  if (reservation.status === 'confirmed' && input.status === 'no_show') {
    await db.prepare(`UPDATE reservations SET status = 'no_show', updated_at = ? WHERE id = ?`).bind(now, id).run();
    const updated = (await getReservationById(db, id))!;
    await createReservationEvent(db, id, 'no_show', input.actorType ?? 'system', input.actorId ?? null, reservation, updated);
    if (updated.user_id) await recomputeReservationCustomerProfileStatus(db, updated.user_id, updated.source);
    await recomputeReservationSystemTagsForReservation(db, updated);
    await recordReservationUserEventBestEffort(db, updated, 'reservation.no_show', '無断キャンセル');
    return { ok: true, reservation: updated, changed: true };
  }

  return { ok: false, reason: 'invalid_state_transition' };
}

async function recordReservationUserEventBestEffort(
  db: D1Database,
  reservation: Reservation,
  eventType: string,
  eventName: string,
  extraMetadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await recordUserEvent(db, {
      lineAccountId: reservation.line_account_id,
      friendId: reservation.friend_id,
      eventType,
      eventName,
      eventSource: reservation.source === 'jalan' || reservation.source === 'gmail' ? reservation.source : 'reservation',
      subjectType: 'reservation',
      subjectId: reservation.id,
      idempotencyKey: `${eventType}:${reservation.id}:${reservation.updated_at}`,
      metadata: {
        source: reservation.source,
        capacityChannel: reservation.capacity_channel,
        slotId: reservation.slot_id,
        date: reservation.reservation_date,
        startAt: reservation.start_at,
        endAt: reservation.end_at,
        adultCount: reservation.adult_count,
        childCount: reservation.child_count,
        infantCount: reservation.infant_count,
        underThreeCount: reservation.under_three_count,
        totalPeople: reservation.total_people,
        capacityPeople: reservation.capacity_people,
        amount: reservation.total_amount ?? null,
        status: reservation.status,
        ...extraMetadata,
      },
    });
  } catch (err) {
    console.warn('recordReservationUserEvent failed:', err);
  }
}

async function recomputeReservationSystemTagsForReservation(db: D1Database, reservation: Reservation): Promise<void> {
  if (reservation.friend_id) {
    await recomputeReservationSystemTagsForFriend(db, reservation.friend_id);
    return;
  }
  if (reservation.user_id) {
    await recomputeReservationSystemTagsForUser(db, reservation.user_id);
  }
}

export async function recomputeReservationCustomerProfileStatus(
  db: D1Database,
  userId: string,
  source: ReservationSource | 'unknown' = 'unknown',
): Promise<void> {
  const now = jstNow();
  const active = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM reservations
       WHERE user_id = ?
         AND status IN ('pending', 'confirmed')
         AND start_at >= ?`,
    )
    .bind(userId, now)
    .first<{ count: number }>();
  const visits = await db
    .prepare(`SELECT COUNT(*) AS count FROM visits WHERE user_id = ?`)
    .bind(userId)
    .first<{ count: number }>();
  const cancelled = await db
    .prepare(`SELECT COUNT(*) AS count FROM reservations WHERE user_id = ? AND status = 'cancelled'`)
    .bind(userId)
    .first<{ count: number }>();

  const status =
    (active?.count ?? 0) > 0
      ? 'reserved'
      : (visits?.count ?? 0) > 0
        ? 'visited'
        : (cancelled?.count ?? 0) > 0
          ? 'cancelled'
          : 'prospect';

  await db
    .prepare(
      `INSERT INTO reservation_customer_profiles
         (user_id, status, source, first_reserved_at, last_reserved_at, first_visited_at, last_visited_at, created_at, updated_at)
       VALUES (
         ?, ?, ?,
         (SELECT MIN(created_at) FROM reservations WHERE user_id = ?),
         (SELECT MAX(created_at) FROM reservations WHERE user_id = ?),
         (SELECT MIN(visited_at) FROM visits WHERE user_id = ?),
         (SELECT MAX(visited_at) FROM visits WHERE user_id = ?),
         ?, ?
       )
       ON CONFLICT(user_id) DO UPDATE SET
         status = excluded.status,
         source = CASE WHEN reservation_customer_profiles.source = 'unknown' THEN excluded.source ELSE reservation_customer_profiles.source END,
         first_reserved_at = excluded.first_reserved_at,
         last_reserved_at = excluded.last_reserved_at,
         first_visited_at = excluded.first_visited_at,
         last_visited_at = excluded.last_visited_at,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, status, source, userId, userId, userId, userId, now, now)
    .run();
}

export async function importExternalReservation(
  db: D1Database,
  input: ImportExternalReservationInput,
): Promise<ImportExternalReservationResult> {
  const externalId = nullableText(input.externalId);
  const dedupeKey = nullableText(input.externalId ? input.dedupeKey : input.gmailMessageId ?? input.dedupeKey);
  if (!externalId && !dedupeKey) return { ok: false, reason: 'missing_dedupe_key' };

  const existingSource = await findExternalSource(db, input.source, externalId, dedupeKey);
  const linkedReservation = existingSource?.reservation_id
    ? await getReservationById(db, existingSource.reservation_id)
    : null;
  const existingReservation = linkedReservation ?? (await findReservationByExternalKeys(db, input.source, externalId, dedupeKey));

  if (existingReservation && (input.eventType === 'created' || input.eventType === 'unknown')) {
    return {
      ok: true,
      status: existingSource ? (existingSource.parse_status === 'duplicate' ? 'duplicate' : 'imported') : 'duplicate',
      reservation: existingReservation,
    };
  }

  if (existingSource && (input.eventType === 'created' || input.eventType === 'unknown')) {
    return { ok: true, status: 'needs_review', source: existingSource };
  }

  if (input.eventType === 'updated') {
    const source = await saveExternalReservationSource(db, existingSource, {
      ...input,
      externalId,
      dedupeKey,
      reservationId: existingReservation?.id ?? null,
      parseStatus: 'needs_review',
      lastError: input.reviewReason ?? (existingReservation ? 'updated event requires manual review' : 'updated event has no matching reservation'),
    });
    return { ok: true, status: 'needs_review', source };
  }

  if (input.eventType === 'cancelled') {
    if (!existingReservation) {
      const source = await saveExternalReservationSource(db, existingSource, {
        ...input,
        externalId,
        dedupeKey,
        reservationId: null,
        parseStatus: 'needs_review',
        lastError: 'cancelled event has no matching reservation',
      });
      return { ok: true, status: 'needs_review', source };
    }

    const cancelled = await updateReservationStatus(db, existingReservation.id, {
      status: 'cancelled',
      actorType: 'gas',
      reason: 'external_cancelled',
    });
    if (!cancelled.ok) return { ok: false, reason: 'invalid_reservation' };
    await saveExternalReservationSource(db, existingSource, {
      ...input,
      externalId,
      dedupeKey,
      reservationId: cancelled.reservation.id,
      parseStatus: 'imported',
    });
    return { ok: true, status: 'cancelled', reservation: cancelled.reservation };
  }

  if (!input.resourceId || !input.menuId || !input.slotId) {
    const source = await saveExternalReservationSource(db, existingSource, {
      ...input,
      externalId,
      dedupeKey,
      reservationId: existingReservation?.id ?? null,
      parseStatus: 'needs_review',
      lastError: input.reviewReason ?? 'created event is missing resourceId/menuId/slotId',
    });
    return { ok: true, status: 'needs_review', source };
  }

  const created = await createReservationWithCapacityCheck(db, {
    resourceId: input.resourceId,
    menuId: input.menuId,
    slotId: input.slotId,
    source: input.source === 'jalan' || input.source === 'gmail' ? input.source : 'admin',
    capacityChannel: 'external',
    externalReservationId: externalId,
    dedupeKey,
    adultCount: input.adultCount ?? 0,
    childCount: input.childCount ?? 0,
    infantCount: input.infantCount ?? 0,
    underThreeCount: input.underThreeCount ?? 0,
    customerName: input.customerName,
    customerPhone: input.customerPhone,
    customerEmail: input.customerEmail,
    metadata: input.parsedPayload ?? '{}',
    actorType: 'gas',
  });

  if (!created.ok) {
    const source = await saveExternalReservationSource(db, existingSource, {
      ...input,
      externalId,
      dedupeKey,
      reservationId: null,
      parseStatus: 'needs_review',
      lastError: created.reason,
    });
    return created.reason === 'slot_not_available'
      ? { ok: false, reason: 'slot_not_available' }
      : { ok: true, status: 'needs_review', source };
  }

  await saveExternalReservationSource(db, existingSource, {
    ...input,
    externalId,
    dedupeKey,
    reservationId: created.reservation.id,
    parseStatus: 'imported',
  });
  await createReservationEvent(db, created.reservation.id, 'imported', 'gas', null, null, input.parsedPayload ?? '{}');
  return { ok: true, status: 'imported', reservation: created.reservation };
}

async function createReservationEvent(
  db: D1Database,
  reservationId: string,
  eventType: ReservationEventType,
  actorType: ReservationActorType,
  actorId: string | null,
  beforePayload: unknown,
  afterPayload: unknown,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO reservation_events
         (id, reservation_id, event_type, actor_type, actor_id, before_payload, after_payload, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      reservationId,
      eventType,
      actorType,
      actorId,
      beforePayload === null ? null : JSON.stringify(beforePayload),
      afterPayload === null ? null : typeof afterPayload === 'string' ? afterPayload : JSON.stringify(afterPayload),
      jstNow(),
    )
    .run();
}

async function createVisitForReservation(db: D1Database, reservation: Reservation): Promise<void> {
  await db
    .prepare(
      `INSERT OR IGNORE INTO visits
         (id, user_id, reservation_id, visited_at, party_size, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, '{}', ?)`,
    )
    .bind(crypto.randomUUID(), reservation.user_id, reservation.id, jstNow(), reservation.total_people, jstNow())
    .run();
}

async function createRestoreCapacityTaskIfNeeded(db: D1Database, reservation: Reservation): Promise<void> {
  const reduced = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM external_sync_tasks
       WHERE reservation_id = ?
         AND provider = 'jalan'
         AND task_type = 'reduce_capacity'
         AND status = 'done'`,
    )
    .bind(reservation.id)
    .first<{ count: number }>();

  if ((reduced?.count ?? 0) === 0) return;

  await db
    .prepare(
      `INSERT INTO external_sync_tasks
         (id, reservation_id, slot_id, provider, task_type, adjustment_count, status, note, created_at)
       VALUES (?, ?, ?, 'jalan', 'restore_capacity', ?, 'pending', ?, ?)`,
    )
    .bind(
      crypto.randomUUID(),
      reservation.id,
      reservation.slot_id,
      reservation.capacity_people,
      'Restore external capacity after LINE reservation cancellation',
      jstNow(),
    )
    .run();
}

async function findReservationByExternalKeys(
  db: D1Database,
  source: ExternalReservationSource,
  externalId: string | null,
  dedupeKey: string | null,
): Promise<Reservation | null> {
  if (externalId) {
    const reservation = await db
      .prepare(`SELECT * FROM reservations WHERE source = ? AND external_reservation_id = ?`)
      .bind(source, externalId)
      .first<Reservation>();
    if (reservation) return reservation;
  }
  if (dedupeKey) {
    return db
      .prepare(`SELECT * FROM reservations WHERE source = ? AND dedupe_key = ?`)
      .bind(source, dedupeKey)
      .first<Reservation>();
  }
  return null;
}

async function findExternalSource(
  db: D1Database,
  source: ExternalReservationSource,
  externalId: string | null,
  dedupeKey: string | null,
): Promise<ExternalReservationSourceRow | null> {
  if (externalId) {
    const row = await db
      .prepare(`SELECT * FROM external_reservation_sources WHERE source = ? AND external_id = ?`)
      .bind(source, externalId)
      .first<ExternalReservationSourceRow>();
    if (row) return row;
  }
  if (dedupeKey) {
    return db
      .prepare(`SELECT * FROM external_reservation_sources WHERE source = ? AND dedupe_key = ?`)
      .bind(source, dedupeKey)
      .first<ExternalReservationSourceRow>();
  }
  return null;
}

async function createExternalReservationSource(
  db: D1Database,
  input: ImportExternalReservationInput & {
    externalId: string | null;
    dedupeKey: string | null;
    reservationId: string | null;
    parseStatus: ExternalReservationParseStatus;
    lastError?: string | null;
  },
): Promise<ExternalReservationSourceRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO external_reservation_sources
         (id, source, event_type, external_id, dedupe_key, reservation_id, raw_text, parsed_payload,
          parse_status, received_at, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.source,
      input.eventType,
      input.externalId,
      input.dedupeKey,
      input.reservationId,
      input.rawText ?? null,
      input.parsedPayload ?? '{}',
      input.parseStatus,
      input.receivedAt ?? now,
      input.lastError ?? null,
      now,
      now,
    )
    .run();

  return (await db.prepare(`SELECT * FROM external_reservation_sources WHERE id = ?`).bind(id).first<ExternalReservationSourceRow>())!;
}

async function saveExternalReservationSource(
  db: D1Database,
  existingSource: ExternalReservationSourceRow | null,
  input: ImportExternalReservationInput & {
    externalId: string | null;
    dedupeKey: string | null;
    reservationId: string | null;
    parseStatus: ExternalReservationParseStatus;
    lastError?: string | null;
  },
): Promise<ExternalReservationSourceRow> {
  if (!existingSource) {
    return createExternalReservationSource(db, input);
  }

  const now = jstNow();
  await db
    .prepare(
      `UPDATE external_reservation_sources
       SET event_type = ?,
           reservation_id = ?,
           raw_text = ?,
           parsed_payload = ?,
           parse_status = ?,
           received_at = ?,
           last_error = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.eventType,
      input.reservationId,
      input.rawText ?? existingSource.raw_text,
      input.parsedPayload ?? existingSource.parsed_payload,
      input.parseStatus,
      input.receivedAt ?? existingSource.received_at ?? now,
      input.lastError ?? null,
      now,
      existingSource.id,
    )
    .run();

  return (await db
    .prepare(`SELECT * FROM external_reservation_sources WHERE id = ?`)
    .bind(existingSource.id)
    .first<ExternalReservationSourceRow>())!;
}

function calculateAmount(menu: ReservationMenu, adultCount: number, childCount: number, infantCount: number, underThreeCount: number): number | null {
  if (menu.price_adult === null && menu.price_child === null && menu.price_infant === null && menu.price_under_three === null) return null;
  return (
    (menu.price_adult ?? 0) * adultCount +
    (menu.price_child ?? 0) * childCount +
    (menu.price_infant ?? 0) * infantCount +
    (menu.price_under_three ?? 0) * underThreeCount
  );
}

function slotDurationMinutes(slot: ReservationSlot): number {
  return Math.round((new Date(slot.end_at).getTime() - new Date(slot.start_at).getTime()) / 60_000);
}

function dayOfWeekFromDateString(date: string): number {
  const [year, month, day] = date.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function eachDate(dateFrom: string, dateTo: string): string[] {
  const dates: string[] = [];
  const current = new Date(`${dateFrom}T00:00:00+09:00`);
  const end = new Date(`${dateTo}T00:00:00+09:00`);
  while (current.getTime() <= end.getTime()) {
    dates.push(formatDateJst(current));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function eachTimeRange(
  date: string,
  startTime: string,
  endTime: string,
  intervalMinutes: number,
): { startAt: string; endAt: string }[] {
  const ranges: { startAt: string; endAt: string }[] = [];
  const end = minutesFromTime(endTime);
  for (let start = minutesFromTime(startTime); start + intervalMinutes <= end; start += intervalMinutes) {
    ranges.push({
      startAt: `${date}T${timeFromMinutes(start)}:00+09:00`,
      endAt: `${date}T${timeFromMinutes(start + intervalMinutes)}:00+09:00`,
    });
  }
  return ranges;
}

function minutesFromTime(time: string): number {
  const [hours, minutes] = time.split(':').map((value) => Number.parseInt(value, 10));
  return hours * 60 + minutes;
}

function timeFromMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

function formatDateJst(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60_000);
  return jst.toISOString().slice(0, 10);
}
