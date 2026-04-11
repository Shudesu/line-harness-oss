-- 013_broadcast_insights.sql

-- Add columns to broadcasts table
ALTER TABLE broadcasts ADD COLUMN line_request_id TEXT;
ALTER TABLE broadcasts ADD COLUMN aggregation_unit TEXT;

-- Create broadcast_insights table
CREATE TABLE IF NOT EXISTS broadcast_insights (
  id                  TEXT PRIMARY KEY,
  broadcast_id        TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  delivered           INTEGER,
  unique_impression   INTEGER,
  unique_click        INTEGER,
  unique_media_played INTEGER,
  open_rate           REAL,
  click_rate          REAL,
  raw_response        TEXT,
  status              TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  retry_count         INTEGER NOT NULL DEFAULT 0,
  fetched_at          TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_broadcast_insights_broadcast_id ON broadcast_insights(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_broadcast_insights_status ON broadcast_insights(status);
