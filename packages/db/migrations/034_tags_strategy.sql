-- Tags strategy compatibility.
-- Adds system/custom tag metadata and friend tag assignment provenance.

ALTER TABLE tags ADD COLUMN kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('system', 'custom'));
ALTER TABLE tags ADD COLUMN category TEXT;
ALTER TABLE tags ADD COLUMN description TEXT;
ALTER TABLE tags ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tags ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tags ADD COLUMN updated_at TEXT;

ALTER TABLE friend_tags ADD COLUMN source TEXT DEFAULT 'manual' CHECK (source IN ('manual', 'system', 'automation', 'reservation', 'tracked_link', 'import'));
ALTER TABLE friend_tags ADD COLUMN source_event_id TEXT;
ALTER TABLE friend_tags ADD COLUMN expires_at TEXT;
ALTER TABLE friend_tags ADD COLUMN metadata TEXT;
