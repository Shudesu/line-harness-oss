/**
 * Layer 2: D1 integration tests — reservation invariants.
 *
 * Uses miniflare directly to get a real D1 binding. No @cloudflare/vitest-pool-workers needed.
 * Tests: capacity-safe booking, cancellation release, state transitions,
 *        external import idempotency, customer profile recomputation.
 */
import { Miniflare } from 'miniflare';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  createReservationResource,
  createReservationMenu,
  createReservationSchedule,
  generateReservationSlots,
  createReservationWithCapacityCheck,
  updateReservationStatus,
  reopenCompletedReservation,
  importExternalReservation,
  getReservationSlotById,
  deleteReservationSlotsByDateRange,
  type ReservationSlot,
  type CreateReservationInput,
} from './reservations.js';
import { getFriendTags } from './tags.js';
import { resetEventSchemaCacheForTest } from './events.js';
import { resetTagSchemaCacheForTest } from './tags.js';

// ---------------------------------------------------------------------------
// Miniflare singleton — one instance for all tests, reset DB between tests
// ---------------------------------------------------------------------------
const mf = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("ok") } }',
  d1Databases: ['DB'],
});

// ---------------------------------------------------------------------------
// Schema DDL — each statement is a single string for D1 batch execution.
// D1's exec() can struggle with multi-line statements; batch() is more reliable.
// ---------------------------------------------------------------------------
const SCHEMA_STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, phone TEXT, external_id TEXT, display_name TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS friends (id TEXT PRIMARY KEY, line_user_id TEXT UNIQUE NOT NULL, display_name TEXT, picture_url TEXT, status_message TEXT, is_following INTEGER NOT NULL DEFAULT 1, user_id TEXT, ig_igsid TEXT, score INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS tags (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, color TEXT NOT NULL DEFAULT '#3B82F6', kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('system','custom')), category TEXT, description TEXT, is_active INTEGER NOT NULL DEFAULT 1, is_locked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS friend_tags (friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, assigned_at TEXT NOT NULL DEFAULT (datetime('now')), source TEXT DEFAULT 'manual' CHECK (source IN ('manual','system','automation','reservation','tracked_link','import')), source_event_id TEXT, expires_at TEXT, metadata TEXT, PRIMARY KEY (friend_id, tag_id))`,
  `CREATE TABLE IF NOT EXISTS reservation_customer_profiles (user_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'prospect' CHECK (status IN ('prospect','reserved','visited','cancelled','inactive')), source TEXT NOT NULL DEFAULT 'line' CHECK (source IN ('line','web','jalan','phone','gmail','admin','mcp','unknown')), memo TEXT, metadata TEXT NOT NULL DEFAULT '{}', first_reserved_at TEXT, last_reserved_at TEXT, first_visited_at TEXT, last_visited_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS reservation_resources (id TEXT PRIMARY KEY, line_account_id TEXT, name TEXT NOT NULL, description TEXT, image_url TEXT, default_duration_minutes INTEGER NOT NULL DEFAULT 60, default_capacity INTEGER NOT NULL DEFAULT 1, default_line_capacity INTEGER, default_external_capacity INTEGER, default_buffer_capacity INTEGER NOT NULL DEFAULT 0, google_calendar_connection_id TEXT, slot_interval_minutes INTEGER NOT NULL DEFAULT 60, timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo', is_active INTEGER NOT NULL DEFAULT 1, display_order INTEGER NOT NULL DEFAULT 0, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS reservation_menus (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES reservation_resources (id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, duration_minutes INTEGER NOT NULL DEFAULT 60, unit_type TEXT NOT NULL DEFAULT 'person' CHECK (unit_type IN ('person','group','seat','table')), min_people INTEGER NOT NULL DEFAULT 1, max_people INTEGER, price_adult INTEGER, price_child INTEGER, price_infant INTEGER, price_under_three INTEGER, capacity_count_adult INTEGER NOT NULL DEFAULT 1 CHECK (capacity_count_adult IN (0,1)), capacity_count_child INTEGER NOT NULL DEFAULT 1 CHECK (capacity_count_child IN (0,1)), capacity_count_infant INTEGER NOT NULL DEFAULT 1 CHECK (capacity_count_infant IN (0,1)), capacity_count_under_three INTEGER NOT NULL DEFAULT 0 CHECK (capacity_count_under_three IN (0,1)), form_fields TEXT NOT NULL DEFAULT '[]', is_active INTEGER NOT NULL DEFAULT 1, display_order INTEGER NOT NULL DEFAULT 0, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS reservation_schedules (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES reservation_resources (id) ON DELETE CASCADE, day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), start_time TEXT NOT NULL, end_time TEXT NOT NULL, slot_interval_minutes INTEGER NOT NULL DEFAULT 60, default_capacity INTEGER NOT NULL DEFAULT 1, default_line_capacity INTEGER, default_external_capacity INTEGER, default_buffer_capacity INTEGER NOT NULL DEFAULT 0, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS reservation_slots (id TEXT PRIMARY KEY, resource_id TEXT NOT NULL REFERENCES reservation_resources (id) ON DELETE CASCADE, date TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL, total_capacity INTEGER NOT NULL CHECK (total_capacity >= 0), line_capacity INTEGER CHECK (line_capacity IS NULL OR line_capacity >= 0), external_capacity INTEGER CHECK (external_capacity IS NULL OR external_capacity >= 0), buffer_capacity INTEGER NOT NULL DEFAULT 0 CHECK (buffer_capacity >= 0), reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0), line_reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (line_reserved_count >= 0), external_reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (external_reserved_count >= 0), status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','sold_out','hidden')), note TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(resource_id, start_at, end_at))`,
  `CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, line_account_id TEXT, user_id TEXT, friend_id TEXT, slot_id TEXT NOT NULL REFERENCES reservation_slots (id) ON DELETE RESTRICT, source TEXT NOT NULL DEFAULT 'line' CHECK (source IN ('line','web','jalan','phone','gmail','admin','mcp')), capacity_channel TEXT NOT NULL DEFAULT 'line' CHECK (capacity_channel IN ('line','external','manual')), external_reservation_id TEXT, dedupe_key TEXT, title TEXT NOT NULL, reservation_date TEXT NOT NULL, start_at TEXT NOT NULL, end_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('pending','confirmed','cancelled','completed','no_show')), adult_count INTEGER NOT NULL DEFAULT 0 CHECK (adult_count >= 0), child_count INTEGER NOT NULL DEFAULT 0 CHECK (child_count >= 0), infant_count INTEGER NOT NULL DEFAULT 0 CHECK (infant_count >= 0), under_three_count INTEGER NOT NULL DEFAULT 0 CHECK (under_three_count >= 0), total_people INTEGER NOT NULL DEFAULT 1 CHECK (total_people > 0), capacity_people INTEGER NOT NULL DEFAULT 1 CHECK (capacity_people > 0), customer_name_snapshot TEXT, customer_phone_snapshot TEXT, customer_email_snapshot TEXT, cancel_reason TEXT, form_data TEXT NOT NULL DEFAULT '{}', metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_reservations_external_id ON reservations (source, external_reservation_id) WHERE external_reservation_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_reservations_dedupe_key ON reservations (source, dedupe_key) WHERE dedupe_key IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS reservation_items (id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL REFERENCES reservations (id) ON DELETE CASCADE, menu_id TEXT, resource_id TEXT, name_snapshot TEXT NOT NULL, quantity INTEGER NOT NULL DEFAULT 1, adult_count INTEGER NOT NULL DEFAULT 0, child_count INTEGER NOT NULL DEFAULT 0, infant_count INTEGER NOT NULL DEFAULT 0, under_three_count INTEGER NOT NULL DEFAULT 0, capacity_people INTEGER NOT NULL DEFAULT 1, unit_price INTEGER, amount INTEGER, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS reservation_events (id TEXT PRIMARY KEY, reservation_id TEXT NOT NULL REFERENCES reservations (id) ON DELETE CASCADE, event_type TEXT NOT NULL CHECK (event_type IN ('created','updated','confirmed','cancelled','completed','no_show','sync_failed','imported')), actor_type TEXT NOT NULL DEFAULT 'system' CHECK (actor_type IN ('customer','admin','gas','mcp','system')), actor_id TEXT, before_payload TEXT, after_payload TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE TABLE IF NOT EXISTS visits (id TEXT PRIMARY KEY, user_id TEXT, reservation_id TEXT, visited_at TEXT NOT NULL, party_size INTEGER, spend_amount INTEGER, memo TEXT, metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(reservation_id))`,
  `CREATE TABLE IF NOT EXISTS external_reservation_sources (id TEXT PRIMARY KEY, source TEXT NOT NULL CHECK (source IN ('jalan','gmail','phone','manual')), event_type TEXT NOT NULL DEFAULT 'unknown' CHECK (event_type IN ('created','updated','cancelled','unknown')), external_id TEXT, dedupe_key TEXT, reservation_id TEXT, raw_text TEXT, parsed_payload TEXT NOT NULL DEFAULT '{}', parse_status TEXT NOT NULL DEFAULT 'pending' CHECK (parse_status IN ('pending','parsed','imported','needs_review','failed','duplicate','ignored')), received_at TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_external_sources_external_id ON external_reservation_sources (source, external_id) WHERE external_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uniq_external_sources_dedupe_key ON external_reservation_sources (source, dedupe_key) WHERE dedupe_key IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS external_sync_tasks (id TEXT PRIMARY KEY, reservation_id TEXT, slot_id TEXT, provider TEXT NOT NULL CHECK (provider IN ('jalan','google_calendar')), task_type TEXT NOT NULL CHECK (task_type IN ('reduce_capacity','restore_capacity','create_event','cancel_event','review')), adjustment_count INTEGER, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed','skipped')), note TEXT, last_error TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), completed_at TEXT)`,
];

const DROP_TABLES = [
  'external_sync_tasks', 'external_reservation_sources', 'visits',
  'reservation_events', 'reservation_items', 'reservations',
  'reservation_slots', 'reservation_schedules', 'reservation_menus',
  'reservation_resources', 'reservation_customer_profiles', 'friend_tags', 'tags', 'friends', 'users',
];

// ---------------------------------------------------------------------------
// Constants and helpers
// ---------------------------------------------------------------------------
const RES_ID = 'res_blueberry';
const MENU_ID = 'menu_picking_60';
const SLOT_DATE = '2026-06-01';
const SLOT_START = `${SLOT_DATE}T09:00:00+09:00`;
const SLOT_END = `${SLOT_DATE}T10:00:00+09:00`;
const USER_ID = 'user_test_001';
const FRIEND_ID = 'friend_test_001';

let db: D1Database;

async function resetDb() {
  db = await mf.getD1Database('DB');
  resetEventSchemaCacheForTest(db);
  resetTagSchemaCacheForTest(db);
  // Drop in reverse dependency order
  await db.batch(DROP_TABLES.map((t) => db.prepare(`DROP TABLE IF EXISTS ${t}`)));
  // Create tables
  await db.batch(SCHEMA_STATEMENTS.map((sql) => db.prepare(sql)));
}

async function seedFixtures() {
  await db
    .prepare(`INSERT INTO users (id, display_name, phone) VALUES (?, ?, ?)`)
    .bind(USER_ID, 'Test User', '09012345678')
    .run();
  await db
    .prepare(`INSERT INTO friends (id, line_user_id, display_name, user_id) VALUES (?, ?, ?, ?)`)
    .bind(FRIEND_ID, 'Utest001', 'Test Friend', USER_ID)
    .run();
  await createReservationResource(db, {
    id: RES_ID,
    name: 'ブルーベリー摘み取り',
    defaultCapacity: 10,
    defaultLineCapacity: 5,
    defaultExternalCapacity: 5,
  });
  await createReservationMenu(db, {
    id: MENU_ID,
    resourceId: RES_ID,
    name: '摘み取り体験 60分',
    durationMinutes: 60,
    minPeople: 1,
    maxPeople: 10,
  });
}

async function insertSlot(overrides: Partial<ReservationSlot> = {}): Promise<ReservationSlot> {
  const id = overrides.id ?? crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO reservation_slots
         (id, resource_id, date, start_at, end_at, total_capacity,
          line_capacity, external_capacity, buffer_capacity,
          reserved_count, line_reserved_count, external_reserved_count,
          status, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,datetime('now'),datetime('now'))`,
    )
    .bind(
      id,
      overrides.resource_id ?? RES_ID,
      overrides.date ?? SLOT_DATE,
      overrides.start_at ?? SLOT_START,
      overrides.end_at ?? SLOT_END,
      overrides.total_capacity ?? 10,
      overrides.line_capacity ?? 5,
      overrides.external_capacity ?? 5,
      overrides.buffer_capacity ?? 0,
      overrides.reserved_count ?? 0,
      overrides.line_reserved_count ?? 0,
      overrides.external_reserved_count ?? 0,
      overrides.status ?? 'open',
    )
    .run();
  return (await getReservationSlotById(db, id))!;
}

function baseInput(slotId: string, overrides: Partial<CreateReservationInput> = {}): CreateReservationInput {
  return {
    resourceId: RES_ID,
    menuId: MENU_ID,
    slotId,
    adultCount: 2,
    childCount: 1,
    userId: USER_ID,
    customerName: '山田太郎',
    ...overrides,
  };
}

async function slotCounters(slotId: string) {
  const s = (await getReservationSlotById(db, slotId))!;
  return { reserved: s.reserved_count, line: s.line_reserved_count, ext: s.external_reserved_count };
}

// ===========================================================================
afterAll(() => mf.dispose());

describe('reservations — D1 integration', () => {
  beforeEach(async () => {
    await resetDb();
    await seedFixtures();
  });

  // =========================================================================
  // 1. Reservation creation — capacity-safe booking
  // =========================================================================
  describe('creation — capacity-safe booking', () => {
    it('reserves capacity via conditional UPDATE before creating reservation', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id));
      expect(r.ok).toBe(true);
      expect(await slotCounters(slot.id)).toEqual({ reserved: 3, line: 3, ext: 0 });
    });

    it('stores web source while consuming line capacity channel', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id, {
        source: 'web',
        capacityChannel: 'line',
      }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.reservation.source).toBe('web');
      expect(r.reservation.capacity_channel).toBe('line');
      expect(await slotCounters(slot.id)).toEqual({ reserved: 3, line: 3, ext: 0 });
    });

    it('increments external_reserved_count for capacity_channel=external', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id, {
        capacityChannel: 'external', source: 'jalan',
      }));
      expect(r.ok).toBe(true);
      expect(await slotCounters(slot.id)).toEqual({ reserved: 3, line: 0, ext: 3 });
    });

    it('increments only reserved_count for capacity_channel=manual', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id, {
        capacityChannel: 'manual', source: 'phone',
      }));
      expect(r.ok).toBe(true);
      expect(await slotCounters(slot.id)).toEqual({ reserved: 3, line: 0, ext: 0 });
    });

    it('stores adult_count, child_count, infant_count, total_people and capacity_people separately', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id, {
        adultCount: 2, childCount: 1, infantCount: 1,
      }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.reservation.adult_count).toBe(2);
      expect(r.reservation.child_count).toBe(1);
      expect(r.reservation.infant_count).toBe(1);
      expect(r.reservation.total_people).toBe(4);
      expect(r.reservation.capacity_people).toBe(4);
      expect(await slotCounters(slot.id)).toEqual({ reserved: 4, line: 4, ext: 0 });
    });

    it('uses menu capacity_count_* flags to calculate capacity_people before reserving slot capacity', async () => {
      await createReservationMenu(db, {
        id: 'menu_no_infant_capacity',
        resourceId: RES_ID,
        name: '幼児枠消費なし',
        capacityCountInfant: false,
      });
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id, {
        menuId: 'menu_no_infant_capacity',
        adultCount: 1,
        childCount: 1,
        infantCount: 1,
      }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.reservation.total_people).toBe(3);
      expect(r.reservation.capacity_people).toBe(2);
      expect(await slotCounters(slot.id)).toEqual({ reserved: 2, line: 2, ext: 0 });
    });

    it('stores under_three_count and excludes it from capacity when configured', async () => {
      await createReservationMenu(db, {
        id: 'menu_under_three_free_capacity',
        resourceId: RES_ID,
        name: '3歳以下枠消費なし',
        capacityCountUnderThree: false,
        priceAdult: 2000,
        priceChild: 1500,
        priceInfant: 1000,
        priceUnderThree: 0,
      });
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id, {
        menuId: 'menu_under_three_free_capacity',
        adultCount: 2,
        childCount: 0,
        infantCount: 1,
        underThreeCount: 1,
      }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.reservation.adult_count).toBe(2);
      expect(r.reservation.child_count).toBe(0);
      expect(r.reservation.infant_count).toBe(1);
      expect(r.reservation.under_three_count).toBe(1);
      expect(r.reservation.total_people).toBe(4);
      expect(r.reservation.capacity_people).toBe(3);
      expect(r.reservation.total_amount).toBe(5000);
      expect(await slotCounters(slot.id)).toEqual({ reserved: 3, line: 3, ext: 0 });
    });

    it('can include under_three_count in capacity when configured', async () => {
      await createReservationMenu(db, {
        id: 'menu_under_three_counts_capacity',
        resourceId: RES_ID,
        name: '3歳以下枠消費あり',
        capacityCountUnderThree: true,
      });
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id, {
        menuId: 'menu_under_three_counts_capacity',
        adultCount: 2,
        childCount: 0,
        infantCount: 1,
        underThreeCount: 1,
      }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.reservation.total_people).toBe(4);
      expect(r.reservation.capacity_people).toBe(4);
      expect(await slotCounters(slot.id)).toEqual({ reserved: 4, line: 4, ext: 0 });
    });

    it('releases reservation.capacity_people, not total_people, when cancelling', async () => {
      await createReservationMenu(db, {
        id: 'menu_no_infant_capacity_cancel',
        resourceId: RES_ID,
        name: '幼児枠消費なしキャンセル',
        capacityCountInfant: false,
      });
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id, {
        menuId: 'menu_no_infant_capacity_cancel',
        adultCount: 1,
        childCount: 1,
        infantCount: 3,
      }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(await slotCounters(slot.id)).toEqual({ reserved: 2, line: 2, ext: 0 });
      const cancelled = await updateReservationStatus(db, r.reservation.id, { status: 'cancelled' });
      expect(cancelled.ok).toBe(true);
      expect(await slotCounters(slot.id)).toEqual({ reserved: 0, line: 0, ext: 0 });
    });

    it('keeps cancellation release stable even if menu capacity_count_* flags change after booking', async () => {
      await createReservationMenu(db, {
        id: 'menu_change_after_booking',
        resourceId: RES_ID,
        name: '予約後設定変更',
        capacityCountInfant: false,
      });
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id, {
        menuId: 'menu_change_after_booking',
        adultCount: 1,
        childCount: 1,
        infantCount: 3,
      }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      await db
        .prepare(`UPDATE reservation_menus SET capacity_count_infant = 1 WHERE id = ?`)
        .bind('menu_change_after_booking')
        .run();
      const cancelled = await updateReservationStatus(db, r.reservation.id, { status: 'cancelled' });
      expect(cancelled.ok).toBe(true);
      expect(await slotCounters(slot.id)).toEqual({ reserved: 0, line: 0, ext: 0 });
    });

    it('falls back to total people when all capacity count flags are disabled', async () => {
      await createReservationMenu(db, {
        id: 'menu_zero_capacity',
        resourceId: RES_ID,
        name: '枠消費なし',
        capacityCountAdult: false,
        capacityCountChild: false,
        capacityCountInfant: false,
      });
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id, {
        menuId: 'menu_zero_capacity',
        adultCount: 1,
        childCount: 1,
        infantCount: 1,
      }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.reservation.capacity_people).toBe(3);
      expect(await slotCounters(slot.id)).toEqual({ reserved: 3, line: 3, ext: 0 });
    });

    it('rejects when total capacity exceeded', async () => {
      const slot = await insertSlot({ total_capacity: 2 });
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('slot_not_available');
    });

    it('rejects when line_capacity exceeded', async () => {
      const slot = await insertSlot({ total_capacity: 10, line_capacity: 2 });
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('slot_not_available');
    });

    it('rejects when external_capacity exceeded', async () => {
      const slot = await insertSlot({ total_capacity: 10, external_capacity: 2 });
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id, {
        capacityChannel: 'external', source: 'jalan',
      }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('slot_not_available');
    });

    it('rejects on closed slot even with remaining capacity', async () => {
      const slot = await insertSlot({ status: 'closed' });
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id, { adultCount: 1, childCount: 0 }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('slot_not_available');
    });

    it('respects buffer_capacity', async () => {
      // total=5, buffer=3 => effective=2, requesting 3 should fail
      const slot = await insertSlot({ total_capacity: 5, buffer_capacity: 3, line_capacity: 5 });
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('slot_not_available');
    });

    it('rejects when menu duration ≠ slot duration', async () => {
      await createReservationMenu(db, { id: 'menu_120', resourceId: RES_ID, name: '120分', durationMinutes: 120 });
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id, { menuId: 'menu_120' }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid_slot');
    });

    it('rejects when menu.resource_id ≠ slot.resource_id', async () => {
      await createReservationResource(db, { id: 'res_cafe', name: 'カフェ' });
      await createReservationMenu(db, { id: 'menu_cafe', resourceId: 'res_cafe', name: 'カフェ席' });
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, {
        ...baseInput(slot.id), menuId: 'menu_cafe', resourceId: 'res_cafe',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid_slot');
    });

    it('rejects when people < menu.min_people', async () => {
      await createReservationMenu(db, { id: 'menu_group', resourceId: RES_ID, name: '団体', minPeople: 5 });
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id, {
        menuId: 'menu_group', adultCount: 2, childCount: 0,
      }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid_people');
    });

    it('rejects when people > menu.max_people', async () => {
      await createReservationMenu(db, { id: 'menu_small', resourceId: RES_ID, name: '少人数', maxPeople: 2 });
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id, { menuId: 'menu_small' }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('invalid_people');
    });

    it('derives reservation_date/start_at/end_at from slot', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.reservation.reservation_date).toBe(SLOT_DATE);
      expect(r.reservation.start_at).toBe(SLOT_START);
      expect(r.reservation.end_at).toBe(SLOT_END);
    });

    it('creates a reservation_event with type=created', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id));
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const ev = await db
        .prepare(`SELECT event_type FROM reservation_events WHERE reservation_id = ?`)
        .bind(r.reservation.id).first<{ event_type: string }>();
      expect(ev?.event_type).toBe('created');
    });
  });

  // =========================================================================
  // 2. Cancellation — capacity release invariants
  // =========================================================================
  describe('cancellation — capacity release', () => {
    it('releases capacity: confirmed → cancelled', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id));
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const c = await updateReservationStatus(db, r.reservation.id, { status: 'cancelled', reason: 'test' });
      expect(c.ok).toBe(true);
      if (!c.ok) return;
      expect(c.changed).toBe(true);
      expect(await slotCounters(slot.id)).toEqual({ reserved: 0, line: 0, ext: 0 });
    });

    it('releases capacity: pending → cancelled', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id, { status: 'pending' }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      await updateReservationStatus(db, r.reservation.id, { status: 'cancelled' });
      expect(await slotCounters(slot.id)).toEqual({ reserved: 0, line: 0, ext: 0 });
    });

    it('releases correct channel: capacity_channel=line (source=admin)', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id, {
        capacityChannel: 'line', source: 'admin',
      }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      await updateReservationStatus(db, r.reservation.id, { status: 'cancelled' });
      expect(await slotCounters(slot.id)).toEqual({ reserved: 0, line: 0, ext: 0 });
    });

    it('releases correct channel: capacity_channel=external (source=jalan)', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id, {
        capacityChannel: 'external', source: 'jalan',
      }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      await updateReservationStatus(db, r.reservation.id, { status: 'cancelled' });
      expect(await slotCounters(slot.id)).toEqual({ reserved: 0, line: 0, ext: 0 });
    });

    it('cancelled → cancelled is idempotent no-op — no double release', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id));
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      // First cancel
      await updateReservationStatus(db, r.reservation.id, { status: 'cancelled' });
      expect(await slotCounters(slot.id)).toEqual({ reserved: 0, line: 0, ext: 0 });

      // Second cancel — must be no-op
      const c2 = await updateReservationStatus(db, r.reservation.id, { status: 'cancelled' });
      expect(c2.ok).toBe(true);
      if (!c2.ok) return;
      expect(c2.changed).toBe(false);
      expect(await slotCounters(slot.id)).toEqual({ reserved: 0, line: 0, ext: 0 });
    });

    it('completed → cancelled is rejected — no capacity release', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id));
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      await updateReservationStatus(db, r.reservation.id, { status: 'completed' });
      const c = await updateReservationStatus(db, r.reservation.id, { status: 'cancelled' });
      expect(c.ok).toBe(false);
      if (!c.ok) expect(c.reason).toBe('invalid_state_transition');
      // Capacity unchanged (still occupied)
      expect(await slotCounters(slot.id)).toEqual({ reserved: 3, line: 3, ext: 0 });
    });

    it('no_show → cancelled is rejected — no capacity release', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id));
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      await updateReservationStatus(db, r.reservation.id, { status: 'no_show' });
      const c = await updateReservationStatus(db, r.reservation.id, { status: 'cancelled' });
      expect(c.ok).toBe(false);
      if (!c.ok) expect(c.reason).toBe('invalid_state_transition');
      expect(await slotCounters(slot.id)).toEqual({ reserved: 3, line: 3, ext: 0 });
    });
  });

  // =========================================================================
  // 3. State transitions
  // =========================================================================
  describe('state transitions', () => {
    it('pending → confirmed does NOT change capacity', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id, { status: 'pending' }));
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const before = await slotCounters(slot.id);
      const c = await updateReservationStatus(db, r.reservation.id, { status: 'confirmed' });
      expect(c.ok).toBe(true);
      if (!c.ok) return;
      expect(c.changed).toBe(true);
      expect(c.reservation.status).toBe('confirmed');
      expect(await slotCounters(slot.id)).toEqual(before); // unchanged
    });

    it('confirmed → completed creates visit, does NOT release capacity', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id));
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const c = await updateReservationStatus(db, r.reservation.id, { status: 'completed' });
      expect(c.ok).toBe(true);
      if (!c.ok) return;
      expect(c.reservation.status).toBe('completed');

      const visit = await db
        .prepare(`SELECT * FROM visits WHERE reservation_id = ?`)
        .bind(r.reservation.id).first();
      expect(visit).toBeTruthy();
      expect(await slotCounters(slot.id)).toEqual({ reserved: 3, line: 3, ext: 0 });
    });

    it('reopens accidental completed reservation to confirmed and removes visit', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id));
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const completed = await updateReservationStatus(db, r.reservation.id, { status: 'completed' });
      expect(completed.ok).toBe(true);

      const reopened = await reopenCompletedReservation(db, r.reservation.id, {
        reason: 'accidental_discord_tap',
        actorType: 'admin',
        actorId: 'test',
      });
      expect(reopened.ok).toBe(true);
      if (!reopened.ok) return;
      expect(reopened.reservation.status).toBe('confirmed');
      expect(reopened.deletedVisits).toBe(1);
      expect(await slotCounters(slot.id)).toEqual({ reserved: 3, line: 3, ext: 0 });

      const visit = await db
        .prepare(`SELECT * FROM visits WHERE reservation_id = ?`)
        .bind(r.reservation.id).first();
      expect(visit).toBeNull();
    });

    it('confirmed → no_show does NOT release capacity', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id));
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      await updateReservationStatus(db, r.reservation.id, { status: 'no_show' });
      expect(await slotCounters(slot.id)).toEqual({ reserved: 3, line: 3, ext: 0 });
    });

    it('cancelled → confirmed is rejected (must create new reservation)', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id));
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      await updateReservationStatus(db, r.reservation.id, { status: 'cancelled' });
      const c = await updateReservationStatus(db, r.reservation.id, { status: 'confirmed' });
      expect(c.ok).toBe(false);
      if (!c.ok) expect(c.reason).toBe('invalid_state_transition');
    });
  });

  // =========================================================================
  // 4. External import — idempotency
  // =========================================================================
  describe('external import', () => {
    it('imports jalan reservation via external channel', async () => {
      const slot = await insertSlot();
      const r = await importExternalReservation(db, {
        source: 'jalan', eventType: 'created', externalId: 'jalan_12345',
        resourceId: RES_ID, menuId: MENU_ID, slotId: slot.id,
        adultCount: 2, childCount: 0, customerName: '佐藤花子',
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.status).toBe('imported');
      expect(await slotCounters(slot.id)).toEqual({ reserved: 2, line: 0, ext: 2 });
    });

    it('same externalId re-import is idempotent — returns existing, no capacity double-count', async () => {
      const slot = await insertSlot();
      const r1 = await importExternalReservation(db, {
        source: 'jalan', eventType: 'created', externalId: 'jalan_99',
        resourceId: RES_ID, menuId: MENU_ID, slotId: slot.id,
        adultCount: 1, childCount: 0,
      });
      expect(r1.ok).toBe(true);
      if (!r1.ok) return;
      const firstId = r1.status === 'imported' ? r1.reservation.id : null;

      const r2 = await importExternalReservation(db, {
        source: 'jalan', eventType: 'created', externalId: 'jalan_99',
        resourceId: RES_ID, menuId: MENU_ID, slotId: slot.id,
        adultCount: 1, childCount: 0,
      });
      expect(r2.ok).toBe(true);
      if (!r2.ok) return;
      // Returns existing reservation (idempotent success) — status is 'imported' because
      // the external_reservation_sources row was saved with parse_status='imported'
      expect(r2.status).toBe('imported');
      if (r2.status === 'imported') {
        expect(r2.reservation.id).toBe(firstId); // same reservation
      }
      // Capacity must NOT double
      expect(await slotCounters(slot.id)).toEqual({ reserved: 1, line: 0, ext: 1 });
    });

    it('eventType=cancelled after prior import cancels existing reservation and releases capacity once', async () => {
      const slot = await insertSlot();
      const imported = await importExternalReservation(db, {
        source: 'jalan', eventType: 'created', externalId: 'jalan_cancel_imported',
        resourceId: RES_ID, menuId: MENU_ID, slotId: slot.id,
        adultCount: 2, childCount: 0,
      });
      expect(imported.ok).toBe(true);
      if (!imported.ok || imported.status !== 'imported') return;
      expect(await slotCounters(slot.id)).toEqual({ reserved: 2, line: 0, ext: 2 });

      const cancelled = await importExternalReservation(db, {
        source: 'jalan', eventType: 'cancelled', externalId: 'jalan_cancel_imported',
      });
      expect(cancelled.ok).toBe(true);
      if (!cancelled.ok) return;
      expect(cancelled.status).toBe('cancelled');
      if (cancelled.status !== 'cancelled') return;
      expect(cancelled.reservation.id).toBe(imported.reservation.id);
      expect(cancelled.reservation.status).toBe('cancelled');
      expect(await slotCounters(slot.id)).toEqual({ reserved: 0, line: 0, ext: 0 });

      const cancelledAgain = await importExternalReservation(db, {
        source: 'jalan', eventType: 'cancelled', externalId: 'jalan_cancel_imported',
      });
      expect(cancelledAgain.ok).toBe(true);
      if (!cancelledAgain.ok) return;
      expect(cancelledAgain.status).toBe('cancelled');
      expect(await slotCounters(slot.id)).toEqual({ reserved: 0, line: 0, ext: 0 });
    });

    it('eventType=updated after prior import becomes needs_review and does not change reservation capacity', async () => {
      const slot = await insertSlot();
      const imported = await importExternalReservation(db, {
        source: 'jalan', eventType: 'created', externalId: 'jalan_update_imported',
        resourceId: RES_ID, menuId: MENU_ID, slotId: slot.id,
        adultCount: 2, childCount: 0,
      });
      expect(imported.ok).toBe(true);
      if (!imported.ok || imported.status !== 'imported') return;
      expect(await slotCounters(slot.id)).toEqual({ reserved: 2, line: 0, ext: 2 });

      const updated = await importExternalReservation(db, {
        source: 'jalan', eventType: 'updated', externalId: 'jalan_update_imported',
        adultCount: 5, childCount: 0,
      });
      expect(updated.ok).toBe(true);
      if (!updated.ok) return;
      expect(updated.status).toBe('needs_review');
      expect(await slotCounters(slot.id)).toEqual({ reserved: 2, line: 0, ext: 2 });

      const source = await db
        .prepare(`SELECT event_type, parse_status, reservation_id FROM external_reservation_sources WHERE external_id = ?`)
        .bind('jalan_update_imported')
        .first<{ event_type: string; parse_status: string; reservation_id: string | null }>();
      expect(source?.event_type).toBe('updated');
      expect(source?.parse_status).toBe('needs_review');
      expect(source?.reservation_id).toBe(imported.reservation.id);
    });

    it('eventType=cancelled cancels existing reservation (no prior import source)', async () => {
      // Simulate: reservation created directly (not via importExternalReservation),
      // then a cancel event arrives via external import.
      // This tests the cancel path without findExternalSource returning early.
      const slot = await insertSlot();
      const created = await createReservationWithCapacityCheck(db, baseInput(slot.id, {
        capacityChannel: 'external', source: 'jalan',
        externalReservationId: 'jalan_cancel_direct',
      }));
      expect(created.ok).toBe(true);
      expect(await slotCounters(slot.id)).toEqual({ reserved: 3, line: 0, ext: 3 });

      const c = await importExternalReservation(db, {
        source: 'jalan', eventType: 'cancelled', externalId: 'jalan_cancel_direct',
      });
      expect(c.ok).toBe(true);
      if (!c.ok) return;
      expect(c.status).toBe('cancelled');
      expect(await slotCounters(slot.id)).toEqual({ reserved: 0, line: 0, ext: 0 });
    });

    it('eventType=updated without prior import source → needs_review, no capacity change', async () => {
      // Reservation created directly (not via importExternalReservation),
      // so no external_reservation_sources row exists yet.
      const slot = await insertSlot();
      await createReservationWithCapacityCheck(db, baseInput(slot.id, {
        capacityChannel: 'external', source: 'jalan',
        externalReservationId: 'jalan_upd_direct',
      }));
      expect(await slotCounters(slot.id)).toEqual({ reserved: 3, line: 0, ext: 3 });

      const r = await importExternalReservation(db, {
        source: 'jalan', eventType: 'updated', externalId: 'jalan_upd_direct',
        adultCount: 5,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.status).toBe('needs_review');
      // Capacity unchanged — updated event must NOT modify reservation
      expect(await slotCounters(slot.id)).toEqual({ reserved: 3, line: 0, ext: 3 });
    });

    it('created re-import can recover an existing needs_review source without matching reservation', async () => {
      const slot = await insertSlot();
      const reviewed = await importExternalReservation(db, {
        source: 'jalan',
        eventType: 'updated',
        externalId: 'jalan_low_stock_reparse',
        adultCount: 4,
      });
      expect(reviewed.ok).toBe(true);
      if (!reviewed.ok) return;
      expect(reviewed.status).toBe('needs_review');

      const imported = await importExternalReservation(db, {
        source: 'jalan',
        eventType: 'created',
        externalId: 'jalan_low_stock_reparse',
        resourceId: RES_ID,
        menuId: MENU_ID,
        slotId: slot.id,
        adultCount: 4,
        childCount: 0,
        customerName: '低残数メール再取込',
      });

      expect(imported.ok).toBe(true);
      if (!imported.ok) return;
      expect(imported.status).toBe('imported');
      expect(await slotCounters(slot.id)).toEqual({ reserved: 4, line: 0, ext: 4 });

      const source = await db
        .prepare(`SELECT event_type, parse_status, reservation_id, last_error FROM external_reservation_sources WHERE external_id = ?`)
        .bind('jalan_low_stock_reparse')
        .first<{ event_type: string; parse_status: string; reservation_id: string | null; last_error: string | null }>();
      expect(source?.event_type).toBe('created');
      expect(source?.parse_status).toBe('imported');
      expect(source?.reservation_id).toBe(imported.reservation.id);
      expect(source?.last_error).toBeNull();
    });

    it('rejects import when both externalId and dedupeKey are empty', async () => {
      const r = await importExternalReservation(db, {
        source: 'jalan', eventType: 'created', externalId: '', dedupeKey: '',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe('missing_dedupe_key');
    });

    it('uses gmailMessageId as dedupeKey when externalId is absent', async () => {
      const slot = await insertSlot();
      // externalId is undefined (not provided) → gmailMessageId is used as dedupeKey
      const r = await importExternalReservation(db, {
        source: 'jalan', eventType: 'created',
        gmailMessageId: 'gmail-msg-001',
        resourceId: RES_ID, menuId: MENU_ID, slotId: slot.id,
        adultCount: 1, childCount: 0,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      if (r.status !== 'imported') return;
      expect(r.reservation.external_reservation_id).toBeNull();
      // Re-import with same gmailMessageId should be idempotent
      const r2 = await importExternalReservation(db, {
        source: 'jalan', eventType: 'created',
        gmailMessageId: 'gmail-msg-001',
        resourceId: RES_ID, menuId: MENU_ID, slotId: slot.id,
        adultCount: 1, childCount: 0,
      });
      expect(r2.ok).toBe(true);
      // Capacity must NOT double
      expect(await slotCounters(slot.id)).toEqual({ reserved: 1, line: 0, ext: 1 });
    });
  });

  // =========================================================================
  // 5. Slot generation
  // =========================================================================
  describe('slot generation', () => {
    it('generates 6 slots for 9:00-15:00 / 60min on matching day_of_week', async () => {
      // 2026-06-01 is Monday (1)
      await createReservationSchedule(db, {
        resourceId: RES_ID, dayOfWeek: 1,
        startTime: '09:00', endTime: '15:00',
        slotIntervalMinutes: 60,
        defaultCapacity: 10, defaultLineCapacity: 5, defaultExternalCapacity: 5,
      });
      const slots = await generateReservationSlots(db, {
        resourceId: RES_ID, dateFrom: '2026-06-01', dateTo: '2026-06-01',
      });
      expect(slots).toHaveLength(6);
      expect(slots[0].start_at).toContain('09:00');
      expect(slots[5].start_at).toContain('14:00');
      expect(slots[5].end_at).toContain('15:00');
    });

    it('generates 0 slots for non-matching day_of_week', async () => {
      await createReservationSchedule(db, {
        resourceId: RES_ID, dayOfWeek: 1, // Monday
        startTime: '09:00', endTime: '15:00',
      });
      // 2026-06-02 is Tuesday
      const slots = await generateReservationSlots(db, {
        resourceId: RES_ID, dateFrom: '2026-06-02', dateTo: '2026-06-02',
      });
      expect(slots).toHaveLength(0);
    });
  });

  // =========================================================================
  // 6. Slot deletion
  // =========================================================================
  describe('slot deletion', () => {
    it('deletes slots blocked only by cancelled reservations', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id));
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      const cancelled = await updateReservationStatus(db, r.reservation.id, {
        status: 'cancelled',
        actorType: 'admin',
      });
      expect(cancelled.ok).toBe(true);

      const result = await deleteReservationSlotsByDateRange(db, {
        resourceId: RES_ID,
        dateFrom: SLOT_DATE,
        dateTo: SLOT_DATE,
      });

      expect(result.deletedCount).toBe(1);
      expect(result.skippedCount).toBe(0);
      await expect(getReservationSlotById(db, slot.id)).resolves.toBeNull();
      const reservation = await db.prepare(`SELECT id FROM reservations WHERE id = ?`).bind(r.reservation.id).first();
      expect(reservation).toBeNull();
    });

    it('keeps slots with active reservations', async () => {
      const slot = await insertSlot();
      const r = await createReservationWithCapacityCheck(db, baseInput(slot.id));
      expect(r.ok).toBe(true);

      const result = await deleteReservationSlotsByDateRange(db, {
        resourceId: RES_ID,
        dateFrom: SLOT_DATE,
        dateTo: SLOT_DATE,
      });

      expect(result.deletedCount).toBe(0);
      expect(result.skippedCount).toBe(1);
      await expect(getReservationSlotById(db, slot.id)).resolves.not.toBeNull();
    });
  });

  // =========================================================================
  // 7. Customer profile recomputation
  // =========================================================================
  describe('customer profile recomputation', () => {
    it('sets profile to reserved after booking', async () => {
      const slot = await insertSlot();
      await createReservationWithCapacityCheck(db, baseInput(slot.id));
      const p = await db
        .prepare(`SELECT status FROM reservation_customer_profiles WHERE user_id = ?`)
        .bind(USER_ID).first<{ status: string }>();
      expect(p?.status).toBe('reserved');
    });

    it('stays reserved when one of multiple bookings is cancelled', async () => {
      const s1 = await insertSlot({ id: 'slot-a' });
      const s2 = await insertSlot({
        id: 'slot-b',
        start_at: `${SLOT_DATE}T10:00:00+09:00`,
        end_at: `${SLOT_DATE}T11:00:00+09:00`,
      });
      const r1 = await createReservationWithCapacityCheck(db, baseInput(s1.id, { adultCount: 1, childCount: 0 }));
      const r2 = await createReservationWithCapacityCheck(db, baseInput(s2.id, { adultCount: 1, childCount: 0 }));
      expect(r1.ok && r2.ok).toBe(true);
      if (!r1.ok) return;

      await updateReservationStatus(db, r1.reservation.id, { status: 'cancelled' });
      const p = await db
        .prepare(`SELECT status FROM reservation_customer_profiles WHERE user_id = ?`)
        .bind(USER_ID).first<{ status: string }>();
      expect(p?.status).toBe('reserved');
    });
  });

  // =========================================================================
  // 7. System tags for reservation state
  // =========================================================================
  describe('reservation system tags', () => {
    it('assigns active reservation system tags after booking', async () => {
      const slot = await insertSlot();
      const result = await createReservationWithCapacityCheck(db, baseInput(slot.id, { friendId: FRIEND_ID }));
      expect(result.ok).toBe(true);

      const tags = await getFriendTags(db, FRIEND_ID);
      const names = tags.map((tag) => tag.name);
      expect(names).toContain('sys:予約あり');
      expect(names).toContain('sys:予約確定');
      expect(names).toContain('sys:今季予約あり');
    });

    it('removes active reservation tags once cancelled and keeps cancellation history', async () => {
      const slot = await insertSlot();
      const result = await createReservationWithCapacityCheck(db, baseInput(slot.id, { friendId: FRIEND_ID }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      await updateReservationStatus(db, result.reservation.id, { status: 'cancelled' });

      const tags = await getFriendTags(db, FRIEND_ID);
      const names = tags.map((tag) => tag.name);
      expect(names).not.toContain('sys:予約あり');
      expect(names).not.toContain('sys:予約確定');
      expect(names).toContain('sys:キャンセル経験あり');
    });

    it('adds visited tag after first completed reservation without marking repeater', async () => {
      const slot = await insertSlot();
      const result = await createReservationWithCapacityCheck(db, baseInput(slot.id, { friendId: FRIEND_ID }));
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const completed = await updateReservationStatus(db, result.reservation.id, { status: 'completed' });
      expect(completed.ok).toBe(true);

      const tags = await getFriendTags(db, FRIEND_ID);
      const names = tags.map((tag) => tag.name);
      expect(names).toContain('sys:来園済み');
      expect(names).not.toContain('sys:リピーター');
    });

    it('adds repeater tag after second completed reservation', async () => {
      const slot1 = await insertSlot();
      const slot2 = await insertSlot({
        id: 'slot_second_visit',
        start_at: `${SLOT_DATE}T10:00:00+09:00`,
        end_at: `${SLOT_DATE}T11:00:00+09:00`,
      });
      const first = await createReservationWithCapacityCheck(db, baseInput(slot1.id, { friendId: FRIEND_ID }));
      const second = await createReservationWithCapacityCheck(db, baseInput(slot2.id, { friendId: FRIEND_ID }));
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      if (!first.ok || !second.ok) return;

      await updateReservationStatus(db, first.reservation.id, { status: 'completed' });
      await updateReservationStatus(db, second.reservation.id, { status: 'completed' });

      const tags = await getFriendTags(db, FRIEND_ID);
      const names = tags.map((tag) => tag.name);
      expect(names).toContain('sys:来園済み');
      expect(names).toContain('sys:リピーター');
    }, 15000);
  });
});
