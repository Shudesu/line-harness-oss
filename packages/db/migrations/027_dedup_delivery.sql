-- Migration 027: Fix duplicate delivery bug
-- Adds 'delivering' status, UNIQUE constraint, and cleans up duplicate enrollments

-- Step 1: Clean up duplicate non-completed friend_scenarios (keep the most progressed per friend+scenario)
-- completed rows are allowed to coexist (re-enrollment after completion is valid)
DELETE FROM friend_scenarios
WHERE status != 'completed' AND id NOT IN (
  SELECT id FROM (
    SELECT id, ROW_NUMBER() OVER (
      PARTITION BY friend_id, scenario_id
      ORDER BY
        CASE status WHEN 'active' THEN 0 WHEN 'delivering' THEN 0 ELSE 1 END,
        current_step_order DESC,
        started_at ASC
    ) AS rn
    FROM friend_scenarios
    WHERE status != 'completed'
  ) WHERE rn = 1
);

-- Step 2: Add partial UNIQUE index to prevent future duplicates (allows re-enrollment after completion)
CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_scenarios_unique
ON friend_scenarios (friend_id, scenario_id) WHERE status != 'completed';

-- Step 3: Allow 'delivering' status (D1/SQLite does not support ALTER CHECK,
-- but the CHECK constraint is only enforced on INSERT/UPDATE, and we handle
-- status transitions in application code. The schema.sql is updated for new installs.)
-- For existing installs, we need to recreate the table to update the CHECK constraint.
-- However, this is risky for production data. Instead, we drop and recreate the CHECK
-- by creating a new table, copying data, and swapping.

-- Actually, SQLite CHECK constraints cannot be altered. Since we control all writes
-- via application code, and D1 enforces CHECK on INSERT/UPDATE, we need to work around this.
-- Option: just remove the old CHECK and add a new one via table recreation.
-- For safety, we'll use a simpler approach: the application code already handles
-- 'delivering' status, and SQLite will reject it with the old CHECK.
-- So we MUST recreate the table.

CREATE TABLE friend_scenarios_new (
  id                 TEXT PRIMARY KEY,
  friend_id          TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  scenario_id        TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
  current_step_order INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'delivering')) DEFAULT 'active',
  started_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  next_delivery_at   TEXT,
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO friend_scenarios_new SELECT * FROM friend_scenarios;

DROP TABLE friend_scenarios;

ALTER TABLE friend_scenarios_new RENAME TO friend_scenarios;

-- Recreate indexes
CREATE INDEX IF NOT EXISTS idx_friend_scenarios_next_delivery_at ON friend_scenarios (next_delivery_at);
CREATE INDEX IF NOT EXISTS idx_friend_scenarios_status ON friend_scenarios (status);
CREATE INDEX IF NOT EXISTS idx_friend_scenarios_friend_id ON friend_scenarios (friend_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_friend_scenarios_unique ON friend_scenarios (friend_id, scenario_id) WHERE status != 'completed';
