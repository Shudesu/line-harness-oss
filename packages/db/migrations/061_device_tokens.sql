-- iOS/Android アプリの APNs/FCM トークン管理
--
-- staff_members 1人につき複数デバイス (iPhone + iPad など) を登録できる。
-- 通知配信時はこのテーブルを引いて APNs/FCM に push する。
-- token を一意キーにすることで、アプリ再起動時の token 更新を upsert で扱う。

CREATE TABLE IF NOT EXISTS device_tokens (
  id            TEXT PRIMARY KEY,
  staff_id      TEXT NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  token         TEXT NOT NULL UNIQUE,
  platform      TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  bundle_id     TEXT NOT NULL,
  environment   TEXT NOT NULL CHECK (environment IN ('production', 'sandbox')),
  device_name   TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  last_seen_at  TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_device_tokens_staff
  ON device_tokens (staff_id, is_active);

CREATE INDEX IF NOT EXISTS idx_device_tokens_platform
  ON device_tokens (platform, environment, is_active);
