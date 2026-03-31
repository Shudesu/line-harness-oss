-- Add segment support to broadcasts
-- SQLite does not support ALTER CHECK, so recreate the table with expanded constraint

CREATE TABLE IF NOT EXISTS broadcasts_new (
  id              TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  message_type    TEXT NOT NULL,
  message_content TEXT NOT NULL,
  target_type     TEXT NOT NULL DEFAULT 'all',
  target_tag_id   TEXT REFERENCES tags (id) ON DELETE SET NULL,
  target_segment_id TEXT,
  status          TEXT NOT NULL DEFAULT 'draft',
  scheduled_at    TEXT,
  sent_at         TEXT,
  total_count     INTEGER NOT NULL DEFAULT 0,
  success_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours')),
  line_account_id TEXT
);

INSERT INTO broadcasts_new
  SELECT id, title, message_type, message_content, target_type, target_tag_id, NULL, status, scheduled_at, sent_at, total_count, success_count, created_at, line_account_id
  FROM broadcasts;

DROP TABLE broadcasts;

ALTER TABLE broadcasts_new RENAME TO broadcasts;
