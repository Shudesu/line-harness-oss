-- Booking: recurring weekly availability + per-staff Google Calendar sync.
-- Existing dated staff_shifts remain available as explicit per-date overrides.

CREATE TABLE IF NOT EXISTS staff_availability_rules (
  id          TEXT PRIMARY KEY,
  staff_id    TEXT NOT NULL,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- 0=Sun
  start_time  TEXT NOT NULL,                                   -- HH:MM JST
  end_time    TEXT NOT NULL,                                   -- HH:MM JST
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (staff_id, weekday),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);

CREATE INDEX IF NOT EXISTS idx_staff_availability_rules_staff
  ON staff_availability_rules (staff_id, weekday, is_active);

ALTER TABLE google_calendar_connections ADD COLUMN line_account_id TEXT;
ALTER TABLE google_calendar_connections ADD COLUMN staff_id TEXT;
ALTER TABLE google_calendar_connections ADD COLUMN last_verified_at TEXT;
ALTER TABLE google_calendar_connections ADD COLUMN last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_google_calendar_connections_staff
  ON google_calendar_connections (line_account_id, staff_id, is_active);

CREATE UNIQUE INDEX IF NOT EXISTS uq_google_calendar_connections_active_staff
  ON google_calendar_connections (staff_id)
  WHERE staff_id IS NOT NULL AND is_active = 1;
