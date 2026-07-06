-- LINE Harness plugin-restaurant — D1 schema
-- Apply: pnpm db:apply (remote) / pnpm db:apply:local

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 会員（LINE友だち1人 = 1会員）
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,                       -- UUID
  line_user_id TEXT NOT NULL UNIQUE,         -- LINE userId (LIFFで取得)
  friend_id TEXT,                            -- LINE Harness friends.id（解決後キャッシュ）
  member_no TEXT NOT NULL UNIQUE,            -- 会員番号（表示用: R-000123）
  display_name TEXT,
  birthday TEXT,                             -- 'MM-DD' or 'YYYY-MM-DD'
  stamp_count INTEGER NOT NULL DEFAULT 0,    -- 現在のカードのスタンプ数
  total_visits INTEGER NOT NULL DEFAULT 0,
  last_visit_at TEXT,                        -- ISO 8601 (UTC)
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_members_last_visit ON members (last_visit_at);
CREATE INDEX IF NOT EXISTS idx_members_birthday ON members (birthday);

-- 来店（スタンプ）履歴
CREATE TABLE IF NOT EXISTS visits (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  visited_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL CHECK (source IN ('store_code', 'staff', 'reservation')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_visits_member ON visits (member_id);
CREATE INDEX IF NOT EXISTS idx_visits_visited_at ON visits (visited_at);

-- 特典（スタンプ満了・誕生日などで発行されるクーポン）
CREATE TABLE IF NOT EXISTS rewards (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,                 -- 消込用コード（例: RW-8F3K2A）
  kind TEXT NOT NULL DEFAULT 'stamp' CHECK (kind IN ('stamp', 'birthday', 'winback', 'manual')),
  status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'redeemed', 'expired')),
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  redeemed_at TEXT,
  expires_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_rewards_member ON rewards (member_id);
CREATE INDEX IF NOT EXISTS idx_rewards_status ON rewards (status);

-- 予約
CREATE TABLE IF NOT EXISTS reservations (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  name TEXT NOT NULL,                        -- 予約名（代表者）
  phone TEXT,
  party_size INTEGER NOT NULL,
  reserved_at TEXT NOT NULL,                 -- 来店日時 ISO 8601 (UTC)
  note TEXT,
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('confirmed', 'cancelled', 'seated', 'no_show')),
  remind_day_before_sent INTEGER NOT NULL DEFAULT 0,
  remind_same_day_sent INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reservations_member ON reservations (member_id);
CREATE INDEX IF NOT EXISTS idx_reservations_reserved_at ON reservations (reserved_at);
CREATE INDEX IF NOT EXISTS idx_reservations_status ON reservations (status);

-- キャンペーンクーポン（全員向け共通コード・複数回消込可）
CREATE TABLE IF NOT EXISTS campaign_coupons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                        -- 例: 雨の日限定10%OFF
  code TEXT NOT NULL UNIQUE,                 -- 共通コード（例: CP-AB3K2M）
  discount_text TEXT,                        -- 例: 10%OFF
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,                           -- 'YYYY-MM-DD HH:MM:SS' (UTC)
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_campaign_coupons_status ON campaign_coupons (status);

-- 共通クーポンの消込記録（誰が使ったか＝来店判定に使う。member_idは任意）
CREATE TABLE IF NOT EXISTS campaign_redemptions (
  id TEXT PRIMARY KEY,
  coupon_id TEXT NOT NULL REFERENCES campaign_coupons (id) ON DELETE CASCADE,
  member_id TEXT REFERENCES members (id) ON DELETE SET NULL,
  redeemed_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_campaign_redemptions_coupon ON campaign_redemptions (coupon_id);
CREATE INDEX IF NOT EXISTS idx_campaign_redemptions_member ON campaign_redemptions (member_id);

-- 遅延送信キュー（来店2時間後のGoogleレビュー依頼など）
CREATE TABLE IF NOT EXISTS pending_notifications (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                        -- 'review_ask'
  send_at TEXT NOT NULL,                     -- 'YYYY-MM-DD HH:MM:SS' (UTC)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_pending_notifications_due ON pending_notifications (status, send_at);

-- テイクアウトメニュー
CREATE TABLE IF NOT EXISTS takeout_menu_items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price INTEGER NOT NULL,                    -- 税込・円
  description TEXT,
  is_available INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- テイクアウト注文
CREATE TABLE IF NOT EXISTS takeout_orders (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  order_no TEXT NOT NULL UNIQUE,             -- 表示用（例: T-012）当日連番
  items TEXT NOT NULL,                       -- JSON: [{id,name,price,qty}]
  total INTEGER NOT NULL,                    -- 円
  pickup_at TEXT NOT NULL,                   -- 受取日時 'YYYY-MM-DD HH:MM:SS' (UTC)
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'ready', 'completed', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_takeout_orders_member ON takeout_orders (member_id);
CREATE INDEX IF NOT EXISTS idx_takeout_orders_pickup ON takeout_orders (pickup_at);
CREATE INDEX IF NOT EXISTS idx_takeout_orders_status ON takeout_orders (status);

-- 自動配信の重複防止ログ（誕生日は年1回・呼び戻しは期間1回など）
CREATE TABLE IF NOT EXISTS message_log (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members (id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                        -- 'birthday' | 'winback' | 'reward' | 'reservation_*'
  dedupe_key TEXT NOT NULL UNIQUE,           -- 例: 'birthday:2026:<member_id>'
  sent_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_message_log_member ON message_log (member_id);
