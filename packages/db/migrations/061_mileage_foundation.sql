-- 061_mileage_foundation.sql — generic engagement events + append-only mileage ledger
-- Additive only. Mileage is an independent Harness benefit; it is not LINE Points.

CREATE TABLE IF NOT EXISTS mileage_programs (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  name       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active'
             CHECK (status IN ('active','paused','archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO mileage_programs (id, code, name, status, created_at, updated_at)
VALUES (
  'default',
  'default',
  'Harnessマイル',
  'active',
  strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'),
  strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
);

CREATE TABLE IF NOT EXISTS engagement_events (
  id                TEXT PRIMARY KEY,
  program_id        TEXT NOT NULL REFERENCES mileage_programs(id),
  idempotency_key   TEXT NOT NULL,
  event_type        TEXT NOT NULL,
  source            TEXT NOT NULL,
  source_event_id   TEXT,
  actor_user_id     TEXT REFERENCES users(id),
  actor_friend_id   TEXT REFERENCES friends(id),
  subject_user_id   TEXT REFERENCES users(id),
  subject_friend_id TEXT REFERENCES friends(id),
  identity_provider TEXT,
  identity_subject  TEXT,
  metadata          TEXT CHECK (metadata IS NULL OR json_valid(metadata)),
  occurred_at       TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  UNIQUE (program_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_engagement_events_actor_user
  ON engagement_events(program_id, actor_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_events_actor_friend
  ON engagement_events(program_id, actor_friend_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_engagement_events_source
  ON engagement_events(source, source_event_id);

CREATE TABLE IF NOT EXISTS mileage_rules (
  id             TEXT PRIMARY KEY,
  program_id     TEXT NOT NULL REFERENCES mileage_programs(id),
  name           TEXT NOT NULL,
  event_type     TEXT NOT NULL,
  source         TEXT,
  amount         INTEGER NOT NULL CHECK (amount > 0),
  initial_status TEXT NOT NULL DEFAULT 'available'
                 CHECK (initial_status IN ('pending','available')),
  conditions     TEXT CHECK (conditions IS NULL OR json_valid(conditions)),
  is_active      INTEGER NOT NULL DEFAULT 1,
  valid_from     TEXT,
  valid_until    TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mileage_rules_match
  ON mileage_rules(program_id, event_type, source, is_active);

CREATE TABLE IF NOT EXISTS mileage_ledger (
  id                    TEXT PRIMARY KEY,
  program_id            TEXT NOT NULL REFERENCES mileage_programs(id),
  beneficiary_user_id   TEXT REFERENCES users(id),
  beneficiary_friend_id TEXT REFERENCES friends(id),
  engagement_event_id   TEXT REFERENCES engagement_events(id),
  entry_type            TEXT NOT NULL
                        CHECK (entry_type IN ('grant','reversal','spend','expiration','adjustment')),
  status                TEXT NOT NULL DEFAULT 'available'
                        CHECK (status IN ('pending','available','void')),
  amount                INTEGER NOT NULL CHECK (amount != 0),
  reason                TEXT NOT NULL,
  source                TEXT NOT NULL,
  source_event_id       TEXT,
  idempotency_key       TEXT NOT NULL,
  reverses_entry_id     TEXT REFERENCES mileage_ledger(id),
  metadata              TEXT CHECK (metadata IS NULL OR json_valid(metadata)),
  occurred_at           TEXT NOT NULL,
  created_at            TEXT NOT NULL,
  UNIQUE (program_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_mileage_ledger_user
  ON mileage_ledger(program_id, beneficiary_user_id, status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_mileage_ledger_friend
  ON mileage_ledger(program_id, beneficiary_friend_id, status, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_mileage_ledger_source
  ON mileage_ledger(program_id, source, source_event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_mileage_ledger_one_reversal
  ON mileage_ledger(reverses_entry_id)
  WHERE reverses_entry_id IS NOT NULL;

-- An offer's cash reward and mileage reward are intentionally independent.
ALTER TABLE affiliate_offers ADD COLUMN reward_miles INTEGER NOT NULL DEFAULT 0;
-- SQLite/D1 rejects ALTER ADD COLUMN with both REFERENCES and a non-NULL
-- default while foreign_keys is enabled. Runtime writes always use a validated
-- mileage program; fresh databases receive the stricter FK from schema.sql.
ALTER TABLE affiliate_offers ADD COLUMN mileage_program_id TEXT NOT NULL DEFAULT 'default';
