-- 014_credit_score.sql
-- 信用スコア（キャンセルペナルティ）

-- friends テーブルに信用スコアカラム追加
ALTER TABLE friends ADD COLUMN credit_score INTEGER NOT NULL DEFAULT 10;
ALTER TABLE friends ADD COLUMN total_completed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE friends ADD COLUMN total_cancelled INTEGER NOT NULL DEFAULT 0;
ALTER TABLE friends ADD COLUMN no_show_count INTEGER NOT NULL DEFAULT 0;

-- キャンセル履歴テーブル
CREATE TABLE IF NOT EXISTS cancellation_log (
  id             TEXT PRIMARY KEY,
  booking_id     TEXT NOT NULL REFERENCES calendar_bookings (id) ON DELETE CASCADE,
  friend_id      TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  job_id         TEXT REFERENCES jobs (id) ON DELETE SET NULL,
  cancel_type    TEXT NOT NULL CHECK (cancel_type IN ('early', 'late', 'day_of', 'no_show')),
  hours_before   REAL,
  score_change   INTEGER NOT NULL,
  score_after    INTEGER NOT NULL,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_cancellation_log_friend ON cancellation_log (friend_id);
