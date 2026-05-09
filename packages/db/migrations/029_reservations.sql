-- Reservation system core tables.
-- Keep inventory changes in application helpers: reserve slot first, then create reservation.

CREATE TABLE IF NOT EXISTS reservation_customer_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'prospect'
    CHECK (status IN ('prospect', 'reserved', 'visited', 'cancelled', 'inactive')),
  source TEXT NOT NULL DEFAULT 'line'
    CHECK (source IN ('line', 'jalan', 'phone', 'gmail', 'admin', 'mcp', 'unknown')),
  memo TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  first_reserved_at TEXT,
  last_reserved_at TEXT,
  first_visited_at TEXT,
  last_visited_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE IF NOT EXISTS reservation_resources (
  id TEXT PRIMARY KEY,
  line_account_id TEXT REFERENCES line_accounts (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  description TEXT,
  default_duration_minutes INTEGER NOT NULL DEFAULT 60,
  default_capacity INTEGER NOT NULL DEFAULT 1,
  default_line_capacity INTEGER,
  default_external_capacity INTEGER,
  default_buffer_capacity INTEGER NOT NULL DEFAULT 0,
  slot_interval_minutes INTEGER NOT NULL DEFAULT 60,
  timezone TEXT NOT NULL DEFAULT 'Asia/Tokyo',
  is_active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE IF NOT EXISTS reservation_menus (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES reservation_resources (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  unit_type TEXT NOT NULL DEFAULT 'person'
    CHECK (unit_type IN ('person', 'group', 'seat', 'table')),
  min_people INTEGER NOT NULL DEFAULT 1,
  max_people INTEGER,
  price_adult INTEGER,
  price_child INTEGER,
  price_infant INTEGER,
  capacity_count_adult INTEGER NOT NULL DEFAULT 1 CHECK (capacity_count_adult IN (0, 1)),
  capacity_count_child INTEGER NOT NULL DEFAULT 1 CHECK (capacity_count_child IN (0, 1)),
  capacity_count_infant INTEGER NOT NULL DEFAULT 1 CHECK (capacity_count_infant IN (0, 1)),
  form_fields TEXT NOT NULL DEFAULT '[]',
  is_active INTEGER NOT NULL DEFAULT 1,
  display_order INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE IF NOT EXISTS reservation_schedules (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES reservation_resources (id) ON DELETE CASCADE,
  day_of_week INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  slot_interval_minutes INTEGER NOT NULL DEFAULT 60,
  default_capacity INTEGER NOT NULL DEFAULT 1,
  default_line_capacity INTEGER,
  default_external_capacity INTEGER,
  default_buffer_capacity INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE IF NOT EXISTS reservation_slots (
  id TEXT PRIMARY KEY,
  resource_id TEXT NOT NULL REFERENCES reservation_resources (id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  total_capacity INTEGER NOT NULL CHECK (total_capacity >= 0),
  line_capacity INTEGER CHECK (line_capacity IS NULL OR line_capacity >= 0),
  external_capacity INTEGER CHECK (external_capacity IS NULL OR external_capacity >= 0),
  buffer_capacity INTEGER NOT NULL DEFAULT 0 CHECK (buffer_capacity >= 0),
  reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  line_reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (line_reserved_count >= 0),
  external_reserved_count INTEGER NOT NULL DEFAULT 0 CHECK (external_reserved_count >= 0),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'closed', 'sold_out', 'hidden')),
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE(resource_id, start_at, end_at)
);

CREATE TABLE IF NOT EXISTS reservation_blackouts (
  id TEXT PRIMARY KEY,
  resource_id TEXT REFERENCES reservation_resources (id) ON DELETE CASCADE,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  line_account_id TEXT REFERENCES line_accounts (id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  friend_id TEXT REFERENCES friends (id) ON DELETE SET NULL,
  slot_id TEXT NOT NULL REFERENCES reservation_slots (id) ON DELETE RESTRICT,
  source TEXT NOT NULL DEFAULT 'line'
    CHECK (source IN ('line', 'jalan', 'phone', 'gmail', 'admin', 'mcp')),
  capacity_channel TEXT NOT NULL DEFAULT 'line'
    CHECK (capacity_channel IN ('line', 'external', 'manual')),
  external_reservation_id TEXT,
  dedupe_key TEXT,
  title TEXT NOT NULL,
  reservation_date TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  adult_count INTEGER NOT NULL DEFAULT 0 CHECK (adult_count >= 0),
  child_count INTEGER NOT NULL DEFAULT 0 CHECK (child_count >= 0),
  infant_count INTEGER NOT NULL DEFAULT 0 CHECK (infant_count >= 0),
  total_people INTEGER NOT NULL DEFAULT 1 CHECK (total_people > 0),
  capacity_people INTEGER NOT NULL DEFAULT 1 CHECK (capacity_people > 0),
  customer_name_snapshot TEXT,
  customer_phone_snapshot TEXT,
  customer_email_snapshot TEXT,
  cancel_reason TEXT,
  form_data TEXT NOT NULL DEFAULT '{}',
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE IF NOT EXISTS reservation_items (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations (id) ON DELETE CASCADE,
  menu_id TEXT REFERENCES reservation_menus (id) ON DELETE SET NULL,
  resource_id TEXT REFERENCES reservation_resources (id) ON DELETE SET NULL,
  name_snapshot TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  adult_count INTEGER NOT NULL DEFAULT 0,
  child_count INTEGER NOT NULL DEFAULT 0,
  infant_count INTEGER NOT NULL DEFAULT 0,
  capacity_people INTEGER NOT NULL DEFAULT 1,
  unit_price INTEGER,
  amount INTEGER,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE IF NOT EXISTS reservation_events (
  id TEXT PRIMARY KEY,
  reservation_id TEXT NOT NULL REFERENCES reservations (id) ON DELETE CASCADE,
  event_type TEXT NOT NULL
    CHECK (event_type IN ('created', 'updated', 'confirmed', 'cancelled', 'completed', 'no_show', 'sync_failed', 'imported')),
  actor_type TEXT NOT NULL DEFAULT 'system'
    CHECK (actor_type IN ('customer', 'admin', 'gas', 'mcp', 'system')),
  actor_id TEXT,
  before_payload TEXT,
  after_payload TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  reservation_id TEXT REFERENCES reservations (id) ON DELETE SET NULL,
  visited_at TEXT NOT NULL,
  party_size INTEGER,
  spend_amount INTEGER,
  memo TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE(reservation_id)
);

CREATE TABLE IF NOT EXISTS external_reservation_sources (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('jalan', 'gmail', 'phone', 'manual')),
  event_type TEXT NOT NULL DEFAULT 'unknown'
    CHECK (event_type IN ('created', 'updated', 'cancelled', 'unknown')),
  external_id TEXT,
  dedupe_key TEXT,
  reservation_id TEXT REFERENCES reservations (id) ON DELETE SET NULL,
  raw_text TEXT,
  parsed_payload TEXT NOT NULL DEFAULT '{}',
  parse_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (parse_status IN ('pending', 'parsed', 'imported', 'needs_review', 'failed', 'duplicate', 'ignored')),
  received_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE IF NOT EXISTS external_sync_tasks (
  id TEXT PRIMARY KEY,
  reservation_id TEXT REFERENCES reservations (id) ON DELETE CASCADE,
  slot_id TEXT REFERENCES reservation_slots (id) ON DELETE SET NULL,
  provider TEXT NOT NULL CHECK (provider IN ('jalan', 'google_calendar')),
  task_type TEXT NOT NULL CHECK (task_type IN ('reduce_capacity', 'restore_capacity', 'create_event', 'cancel_event', 'review')),
  adjustment_count INTEGER,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'done', 'failed', 'skipped')),
  note TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_reservation_profiles_status ON reservation_customer_profiles (status);
CREATE INDEX IF NOT EXISTS idx_reservation_resources_account ON reservation_resources (line_account_id);
CREATE INDEX IF NOT EXISTS idx_reservation_menus_resource ON reservation_menus (resource_id, is_active, display_order);
CREATE INDEX IF NOT EXISTS idx_reservation_schedules_resource ON reservation_schedules (resource_id, day_of_week);
CREATE INDEX IF NOT EXISTS idx_reservation_slots_resource_date ON reservation_slots (resource_id, date, start_at);
CREATE INDEX IF NOT EXISTS idx_reservation_slots_status ON reservation_slots (status);
CREATE INDEX IF NOT EXISTS idx_reservations_date ON reservations (reservation_date, status);
CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations (user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_slot ON reservations (slot_id, status);
CREATE INDEX IF NOT EXISTS idx_reservations_source_external ON reservations (source, external_reservation_id);
CREATE INDEX IF NOT EXISTS idx_reservations_source_dedupe ON reservations (source, dedupe_key);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_reservations_external_id
  ON reservations (source, external_reservation_id)
  WHERE external_reservation_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_reservations_dedupe_key
  ON reservations (source, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reservation_events_reservation ON reservation_events (reservation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_external_sources_external ON external_reservation_sources (source, external_id);
CREATE INDEX IF NOT EXISTS idx_external_sources_dedupe ON external_reservation_sources (source, dedupe_key);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_external_sources_external_id
  ON external_reservation_sources (source, external_id)
  WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_external_sources_dedupe_key
  ON external_reservation_sources (source, dedupe_key)
  WHERE dedupe_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_external_sync_tasks_status ON external_sync_tasks (provider, status, created_at);
