-- Migration 011: unified_profiles テーブル (PPAL Identity Hub)
-- NO TRIGGER: app layer handles updated_at via jstNow() in all INSERT/UPDATE statements
-- (apps/worker/src/routes/liff.ts, webhook.ts パターン参照)
-- D1 SQLite では AFTER/BEFORE UPDATE trigger が再帰崩壊するため trigger は使用しない

CREATE TABLE IF NOT EXISTS unified_profiles (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  line_uid         TEXT UNIQUE NOT NULL,
  teachable_id     INTEGER,
  teachable_email  TEXT,
  discord_id       TEXT,
  discord_username TEXT,
  -- JSON array of Discord role IDs; NULL = not linked, [] = linked but no roles
  discord_roles    TEXT CHECK(discord_roles IS NULL OR json_valid(discord_roles)),
  -- linked_at: NULL = no external account linked yet; populated on first link
  linked_at        TEXT,
  -- created_at / updated_at: DEFAULT is UTC (datetime('now')).
  -- App layer MUST always pass explicit JST values via jstNow() on INSERT/UPDATE.
  -- The DEFAULT serves as a safety fallback only and should not be relied upon.
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes for cross-system reverse lookups
CREATE INDEX IF NOT EXISTS idx_unified_profiles_teachable_id ON unified_profiles(teachable_id);
CREATE INDEX IF NOT EXISTS idx_unified_profiles_discord_id   ON unified_profiles(discord_id);
