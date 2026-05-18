-- Generic user events and event-to-tag rules.

CREATE TABLE IF NOT EXISTS user_events (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT,
  friend_id       TEXT REFERENCES friends (id) ON DELETE SET NULL,
  line_user_id    TEXT,
  event_type      TEXT NOT NULL,
  event_name      TEXT,
  event_source    TEXT NOT NULL DEFAULT 'system'
    CHECK (event_source IN ('line', 'liff', 'web', 'reservation', 'jalan', 'gmail', 'tracked_link', 'broadcast', 'automation', 'system')),
  subject_type    TEXT,
  subject_id      TEXT,
  occurred_at     TEXT NOT NULL,
  received_at     TEXT NOT NULL,
  session_id      TEXT,
  request_id      TEXT,
  idempotency_key TEXT,
  metadata        TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_user_events_friend_time ON user_events (friend_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_user_events_type_time ON user_events (event_type, occurred_at);
CREATE INDEX IF NOT EXISTS idx_user_events_subject ON user_events (subject_type, subject_id);
CREATE INDEX IF NOT EXISTS idx_user_events_line_account ON user_events (line_account_id, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_user_events_idempotency_key
  ON user_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS event_definitions (
  id          TEXT PRIMARY KEY,
  event_type  TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  category    TEXT NOT NULL,
  description TEXT,
  is_system   INTEGER NOT NULL DEFAULT 0,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE IF NOT EXISTS event_tag_rules (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  event_type TEXT NOT NULL,
  conditions TEXT NOT NULL DEFAULT '{}',
  action     TEXT NOT NULL CHECK (action IN ('add_tag', 'remove_tag')),
  tag_id     TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  priority   INTEGER NOT NULL DEFAULT 0,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_event_tag_rules_event ON event_tag_rules (event_type, is_active, priority);
