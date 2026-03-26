-- Migration 010: Add FUGUE bridge shadow event log
-- Run: wrangler d1 execute line-crm --file=packages/db/migrations/010_fugue_bridge.sql --remote

CREATE TABLE IF NOT EXISTS fugue_shadow_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  user_id_hash TEXT NOT NULL,
  source_type TEXT DEFAULT 'user',
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  processing_ms INTEGER DEFAULT 0,
  phase INTEGER NOT NULL DEFAULT 2,
  mode TEXT NOT NULL DEFAULT 'shadow',
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_fugue_shadow_events_type
  ON fugue_shadow_events(event_type);

CREATE INDEX IF NOT EXISTS idx_fugue_shadow_events_received
  ON fugue_shadow_events(received_at);
