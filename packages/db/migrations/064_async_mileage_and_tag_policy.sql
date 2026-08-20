-- 064_async_mileage_and_tag_policy.sql
-- Keep product actions fast: record engagement immediately, then project miles
-- in small scheduled batches. Tags can award a one-time amount and can also act
-- as an explicit/public membership tier for future earning-rate multipliers.

ALTER TABLE tags ADD COLUMN mileage_reward INTEGER NOT NULL DEFAULT 0
  CHECK (mileage_reward >= 0);
ALTER TABLE tags ADD COLUMN mileage_multiplier_bps INTEGER
  CHECK (mileage_multiplier_bps IS NULL OR mileage_multiplier_bps BETWEEN 1000 AND 100000);
ALTER TABLE tags ADD COLUMN mileage_multiplier_priority INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS mileage_event_queue (
  engagement_event_id  TEXT PRIMARY KEY REFERENCES engagement_events(id) ON DELETE CASCADE,
  status               TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','processing','processed','failed')),
  attempts             INTEGER NOT NULL DEFAULT 0,
  available_at         TEXT NOT NULL,
  processing_started_at TEXT,
  processed_at         TEXT,
  last_error           TEXT,
  created_at           TEXT NOT NULL,
  updated_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_mileage_event_queue_due
  ON mileage_event_queue(status, available_at, created_at);
