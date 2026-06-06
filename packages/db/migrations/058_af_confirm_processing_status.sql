-- L-TRACK 互換 Codex指摘 High 対応:
-- af_confirm_queue.status に 'processing' を追加し、claim 動作を有効化する。
-- SQLite では CHECK 制約は ALTER TABLE で変更できないため、テーブル再作成。

CREATE TABLE IF NOT EXISTS af_confirm_queue_v2 (
  id TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  tracked_link_id TEXT REFERENCES tracked_links (id) ON DELETE SET NULL,
  ref_tracking_id TEXT REFERENCES ref_tracking (id) ON DELETE SET NULL,
  af_confirm_type TEXT NOT NULL CHECK (af_confirm_type IN ('1h', '3h', '24h')),
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO af_confirm_queue_v2
  (id, friend_id, tracked_link_id, ref_tracking_id, af_confirm_type, scheduled_at, status, attempts, last_error, processed_at, created_at)
SELECT
  id, friend_id, tracked_link_id, ref_tracking_id, af_confirm_type, scheduled_at, status, attempts, last_error, processed_at, created_at
  FROM af_confirm_queue;

DROP TABLE af_confirm_queue;
ALTER TABLE af_confirm_queue_v2 RENAME TO af_confirm_queue;

CREATE UNIQUE INDEX IF NOT EXISTS idx_af_confirm_queue_unique
  ON af_confirm_queue (ref_tracking_id)
  WHERE ref_tracking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_af_confirm_queue_due
  ON af_confirm_queue (status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_af_confirm_queue_friend
  ON af_confirm_queue (friend_id);
