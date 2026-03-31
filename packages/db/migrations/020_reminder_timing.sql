-- Add L-Step/UTAGE-style timing configuration to reminder_steps
-- Also fix CHECK constraint to allow all message types

CREATE TABLE IF NOT EXISTS reminder_steps_new (
  id              TEXT PRIMARY KEY,
  reminder_id     TEXT NOT NULL REFERENCES reminders (id) ON DELETE CASCADE,
  offset_minutes  INTEGER NOT NULL,
  timing_type     TEXT NOT NULL DEFAULT 'relative',
  days_offset     INTEGER,
  send_hour       INTEGER,
  send_minute     INTEGER DEFAULT 0,
  message_type    TEXT NOT NULL,
  message_content TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO reminder_steps_new (id, reminder_id, offset_minutes, timing_type, message_type, message_content, created_at)
  SELECT id, reminder_id, offset_minutes, 'relative', message_type, message_content, created_at
  FROM reminder_steps;

DROP TABLE reminder_steps;

ALTER TABLE reminder_steps_new RENAME TO reminder_steps;

CREATE INDEX IF NOT EXISTS idx_reminder_steps_reminder_id ON reminder_steps (reminder_id);
