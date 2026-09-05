CREATE TABLE IF NOT EXISTS webinar_followup_configs (
  webinar_id          TEXT PRIMARY KEY REFERENCES webinars(id) ON DELETE CASCADE,
  enabled_at          TEXT NOT NULL,
  first_delay_minutes INTEGER NOT NULL DEFAULT 30,
  second_delay_minutes INTEGER NOT NULL DEFAULT 1440,
  is_active           INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS webinar_followups (
  id             TEXT PRIMARY KEY,
  webinar_id     TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  friend_id      TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL CHECK (kind IN ('after_30m', 'after_24h')),
  retry_key      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  sent_at        TEXT,
  last_error     TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (webinar_id, friend_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_webinar_followups_status
  ON webinar_followups (status, updated_at);
