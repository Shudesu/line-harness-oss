CREATE TABLE IF NOT EXISTS staff_calendar_connections (
  id TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL UNIQUE,
  google_calendar_id TEXT NOT NULL DEFAULT 'primary',
  refresh_token TEXT NOT NULL,
  access_token TEXT,
  access_token_expires_at TEXT,
  sync_events INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);
