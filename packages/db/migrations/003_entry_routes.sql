-- Entry routes: map ref codes to tags + scenarios
CREATE TABLE IF NOT EXISTS entry_routes (
  id          TEXT PRIMARY KEY,
  ref_code    TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  tag_id      TEXT REFERENCES tags (id) ON DELETE SET NULL,
  scenario_id TEXT REFERENCES scenarios (id) ON DELETE SET NULL,
  redirect_url TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_entry_routes_ref ON entry_routes (ref_code);

-- Ref tracking log
CREATE TABLE IF NOT EXISTS ref_tracking (
  id              TEXT PRIMARY KEY,
  ref_code        TEXT NOT NULL,
  friend_id       TEXT REFERENCES friends (id) ON DELETE CASCADE,
  entry_route_id  TEXT REFERENCES entry_routes (id) ON DELETE SET NULL,
  source_url      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ref_tracking_ref    ON ref_tracking (ref_code);
CREATE INDEX IF NOT EXISTS idx_ref_tracking_friend ON ref_tracking (friend_id);

-- Add ref_code column to friends
ALTER TABLE friends ADD COLUMN ref_code TEXT;
