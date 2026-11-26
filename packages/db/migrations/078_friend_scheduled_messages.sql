-- 友だち1人宛ての予約送信（1:1 scheduled message）。追加のみ（既存テーブルは変更しない）。
-- send_at は UTC epoch ミリ秒。status: pending → sending（cron が行を確保）→ sent / failed、
-- pending のうちは cancelled にできる。sending のまま残った行は二重送信を避けるため
-- 自動再送せず failed（送信結果不明）にする。
CREATE TABLE IF NOT EXISTS friend_scheduled_messages (
  id               TEXT PRIMARY KEY,
  friend_id        TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  line_account_id  TEXT,
  message_type     TEXT NOT NULL DEFAULT 'text',
  content          TEXT NOT NULL,
  alt_text         TEXT,
  track_links      INTEGER NOT NULL DEFAULT 1,
  send_at          INTEGER NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'sending', 'sent', 'cancelled', 'failed')),
  created_by       TEXT,
  claim_token      TEXT,
  claimed_at       INTEGER,
  sent_at          TEXT,
  cancelled_at     TEXT,
  cancelled_by     TEXT,
  error            TEXT,
  message_id       TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_friend_scheduled_messages_due
  ON friend_scheduled_messages (status, send_at);
CREATE INDEX IF NOT EXISTS idx_friend_scheduled_messages_friend
  ON friend_scheduled_messages (friend_id, send_at);
