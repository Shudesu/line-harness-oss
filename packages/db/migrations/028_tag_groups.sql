-- Tag grouping: folder-like organization for tags
CREATE TABLE IF NOT EXISTS tag_groups (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

ALTER TABLE tags ADD COLUMN group_id TEXT REFERENCES tag_groups (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tags_group_id ON tags (group_id);
