-- Migration 046: Strict account scoping for friends and tags.
-- Rebuilds friends/tags to remove legacy single-column UNIQUE constraints:
--   friends.line_user_id UNIQUE  -> unique per (line_user_id, line_account_id)
--   tags.name UNIQUE             -> unique per (line_account_id, name)
-- Existing rows are preserved. Existing NULL line_account_id rows stay NULL.

PRAGMA foreign_keys = OFF;
PRAGMA defer_foreign_keys = ON;
PRAGMA legacy_alter_table = ON;

DROP INDEX IF EXISTS idx_friends_line_user_account_unique;
DROP INDEX IF EXISTS idx_friends_line_user_null_account_unique;
DROP INDEX IF EXISTS idx_friends_line_user_id;
DROP INDEX IF EXISTS idx_friends_account;
DROP INDEX IF EXISTS idx_friends_user_id;
DROP INDEX IF EXISTS idx_friends_ig_igsid;

ALTER TABLE friends RENAME TO friends_old_041;

CREATE TABLE friends (
  id                    TEXT PRIMARY KEY,
  line_user_id          TEXT NOT NULL,
  display_name          TEXT,
  picture_url           TEXT,
  status_message        TEXT,
  is_following          INTEGER NOT NULL DEFAULT 1,
  line_account_id       TEXT REFERENCES line_accounts (id) ON DELETE SET NULL,
  user_id               TEXT,
  ig_igsid              TEXT,
  score                 INTEGER NOT NULL DEFAULT 0,
  metadata              TEXT NOT NULL DEFAULT '{}',
  ref_code              TEXT,
  first_tracked_link_id TEXT REFERENCES tracked_links (id) ON DELETE SET NULL,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO friends (
  id, line_user_id, display_name, picture_url, status_message, is_following,
  line_account_id, user_id, ig_igsid, score, metadata, ref_code,
  first_tracked_link_id, created_at, updated_at
)
SELECT
  id, line_user_id, display_name, picture_url, status_message, is_following,
  line_account_id, user_id, ig_igsid, score, metadata, ref_code,
  first_tracked_link_id, created_at, updated_at
FROM friends_old_041;

DROP TABLE friends_old_041;

CREATE INDEX IF NOT EXISTS idx_friends_line_user_id ON friends (line_user_id);
CREATE INDEX IF NOT EXISTS idx_friends_account ON friends (line_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_friends_line_user_account_unique ON friends (line_user_id, line_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_friends_line_user_null_account_unique ON friends (line_user_id) WHERE line_account_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_friends_user_id ON friends (user_id);
CREATE INDEX IF NOT EXISTS idx_friends_ig_igsid ON friends (ig_igsid);

DROP INDEX IF EXISTS idx_tags_account;
DROP INDEX IF EXISTS idx_tags_account_name_unique;
DROP INDEX IF EXISTS idx_tags_null_account_name_unique;

ALTER TABLE tags RENAME TO tags_old_041;

CREATE TABLE tags (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  color           TEXT NOT NULL DEFAULT '#3B82F6',
  line_account_id TEXT REFERENCES line_accounts (id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO tags (id, name, color, line_account_id, created_at)
SELECT id, name, color, NULL, created_at
FROM tags_old_041;

DROP TABLE tags_old_041;

CREATE INDEX IF NOT EXISTS idx_tags_account ON tags (line_account_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_account_name_unique ON tags (line_account_id, name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_null_account_name_unique ON tags (name) WHERE line_account_id IS NULL;

PRAGMA foreign_keys = ON;
