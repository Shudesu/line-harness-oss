-- Add `web` to reservation source CHECK constraints.
--
-- SQLite/D1 cannot ALTER an existing CHECK constraint, so this migration
-- rebuilds only the two affected tables and preserves all rows.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS reservation_customer_profiles_source_web_migration;

CREATE TABLE reservation_customer_profiles_source_web_migration (
  user_id TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'prospect'
    CHECK (status IN ('prospect', 'reserved', 'visited', 'cancelled', 'inactive')),
  source TEXT NOT NULL DEFAULT 'line'
    CHECK (source IN ('line', 'web', 'jalan', 'phone', 'gmail', 'admin', 'mcp', 'unknown')),
  memo TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  first_reserved_at TEXT,
  last_reserved_at TEXT,
  first_visited_at TEXT,
  last_visited_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO reservation_customer_profiles_source_web_migration (
  user_id, status, source, memo, metadata, first_reserved_at, last_reserved_at,
  first_visited_at, last_visited_at, created_at, updated_at
)
SELECT
  user_id, status, source, memo, metadata, first_reserved_at, last_reserved_at,
  first_visited_at, last_visited_at, created_at, updated_at
FROM reservation_customer_profiles;

DROP TABLE reservation_customer_profiles;
ALTER TABLE reservation_customer_profiles_source_web_migration RENAME TO reservation_customer_profiles;

DROP TABLE IF EXISTS reservations_source_web_migration;

CREATE TABLE reservations_source_web_migration (
  id TEXT PRIMARY KEY,
  line_account_id TEXT REFERENCES line_accounts (id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users (id) ON DELETE SET NULL,
  friend_id TEXT REFERENCES friends (id) ON DELETE SET NULL,
  slot_id TEXT NOT NULL REFERENCES reservation_slots (id) ON DELETE RESTRICT,
  source TEXT NOT NULL DEFAULT 'line'
    CHECK (source IN ('line', 'web', 'jalan', 'phone', 'gmail', 'admin', 'mcp')),
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
  under_three_count INTEGER NOT NULL DEFAULT 0 CHECK (under_three_count >= 0),
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

INSERT INTO reservations_source_web_migration (
  id, line_account_id, user_id, friend_id, slot_id, source, capacity_channel,
  external_reservation_id, dedupe_key, title, reservation_date, start_at, end_at,
  status, adult_count, child_count, infant_count, under_three_count, total_people,
  capacity_people, customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot,
  cancel_reason, form_data, metadata, created_at, updated_at
)
SELECT
  id, line_account_id, user_id, friend_id, slot_id,
  CASE
    WHEN source IN ('line', 'web', 'jalan', 'phone', 'gmail', 'admin', 'mcp') THEN source
    ELSE 'line'
  END,
  CASE
    WHEN capacity_channel IN ('line', 'external', 'manual') THEN capacity_channel
    ELSE 'line'
  END,
  external_reservation_id, dedupe_key, COALESCE(title, '予約'), reservation_date, start_at, end_at,
  CASE
    WHEN status IN ('pending', 'confirmed', 'cancelled', 'completed', 'no_show') THEN status
    ELSE 'confirmed'
  END,
  CASE WHEN adult_count >= 0 THEN adult_count ELSE 0 END,
  CASE WHEN child_count >= 0 THEN child_count ELSE 0 END,
  CASE WHEN infant_count >= 0 THEN infant_count ELSE 0 END,
  CASE WHEN under_three_count >= 0 THEN under_three_count ELSE 0 END,
  CASE
    WHEN total_people > 0 THEN total_people
    WHEN (
      CASE WHEN adult_count >= 0 THEN adult_count ELSE 0 END +
      CASE WHEN child_count >= 0 THEN child_count ELSE 0 END +
      CASE WHEN infant_count >= 0 THEN infant_count ELSE 0 END +
      CASE WHEN under_three_count >= 0 THEN under_three_count ELSE 0 END
    ) > 0 THEN (
      CASE WHEN adult_count >= 0 THEN adult_count ELSE 0 END +
      CASE WHEN child_count >= 0 THEN child_count ELSE 0 END +
      CASE WHEN infant_count >= 0 THEN infant_count ELSE 0 END +
      CASE WHEN under_three_count >= 0 THEN under_three_count ELSE 0 END
    )
    ELSE 1
  END,
  CASE
    WHEN capacity_people > 0 THEN capacity_people
    WHEN total_people > 0 THEN total_people
    WHEN (
      CASE WHEN adult_count >= 0 THEN adult_count ELSE 0 END +
      CASE WHEN child_count >= 0 THEN child_count ELSE 0 END +
      CASE WHEN infant_count >= 0 THEN infant_count ELSE 0 END +
      CASE WHEN under_three_count >= 0 THEN under_three_count ELSE 0 END
    ) > 0 THEN (
      CASE WHEN adult_count >= 0 THEN adult_count ELSE 0 END +
      CASE WHEN child_count >= 0 THEN child_count ELSE 0 END +
      CASE WHEN infant_count >= 0 THEN infant_count ELSE 0 END +
      CASE WHEN under_three_count >= 0 THEN under_three_count ELSE 0 END
    )
    ELSE 1
  END,
  customer_name_snapshot, customer_phone_snapshot, customer_email_snapshot,
  cancel_reason, COALESCE(form_data, '{}'), COALESCE(metadata, '{}'), created_at, updated_at
FROM reservations;

DROP TABLE reservations;
ALTER TABLE reservations_source_web_migration RENAME TO reservations;

CREATE INDEX IF NOT EXISTS idx_reservation_profiles_status ON reservation_customer_profiles (status);
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

PRAGMA foreign_keys = ON;
