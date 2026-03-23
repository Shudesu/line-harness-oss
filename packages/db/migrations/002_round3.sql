-- ============================================================
-- Round 3 マイグレーション: 全10機能
-- ============================================================

-- ============================================================
-- 1. Webhook IN/OUT (外部連携)
-- ============================================================

-- 受信Webhook登録
CREATE TABLE IF NOT EXISTS incoming_webhooks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'custom',  -- stripe, google_calendar, custom
  secret      TEXT,                             -- 署名検証用シークレット
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 送信Webhook登録
CREATE TABLE IF NOT EXISTS outgoing_webhooks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,                    -- 送信先URL
  event_types TEXT NOT NULL DEFAULT '[]',       -- JSON配列: ["friend_add","tag_change","cv_fire"]
  secret      TEXT,                             -- HMAC署名用シークレット
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ============================================================
-- 2. Google Calendar 連携
-- ============================================================
CREATE TABLE IF NOT EXISTS google_calendar_connections (
  id            TEXT PRIMARY KEY,
  calendar_id   TEXT NOT NULL,
  access_token  TEXT,
  refresh_token TEXT,
  api_key       TEXT,
  auth_type     TEXT NOT NULL DEFAULT 'api_key',  -- oauth, api_key
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS calendar_bookings (
  id             TEXT PRIMARY KEY,
  connection_id  TEXT NOT NULL REFERENCES google_calendar_connections (id) ON DELETE CASCADE,
  friend_id      TEXT REFERENCES friends (id) ON DELETE SET NULL,
  event_id       TEXT,                           -- Google Calendar イベントID
  title          TEXT NOT NULL,
  start_at       TEXT NOT NULL,
  end_at         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed')),
  metadata       TEXT,                           -- JSON
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_calendar_bookings_friend ON calendar_bookings (friend_id);
CREATE INDEX IF NOT EXISTS idx_calendar_bookings_start ON calendar_bookings (start_at);

-- ============================================================
-- 3. リマインダ配信 (Reminder/Countdown)
-- ============================================================
CREATE TABLE IF NOT EXISTS reminders (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- リマインダのステップ（何日前/何時間前に何を送るか）
CREATE TABLE IF NOT EXISTS reminder_steps (
  id              TEXT PRIMARY KEY,
  reminder_id     TEXT NOT NULL REFERENCES reminders (id) ON DELETE CASCADE,
  offset_minutes  INTEGER NOT NULL,              -- 負数: 前（-1440 = 1日前）、正数: 後
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex')),
  message_content TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_reminder_steps_reminder ON reminder_steps (reminder_id);

-- 友だちごとのリマインダ登録（ターゲット日付）
CREATE TABLE IF NOT EXISTS friend_reminders (
  id              TEXT PRIMARY KEY,
  friend_id       TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  reminder_id     TEXT NOT NULL REFERENCES reminders (id) ON DELETE CASCADE,
  target_date     TEXT NOT NULL,                  -- ターゲット日時 (ISO 8601)
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_friend_reminders_status ON friend_reminders (status);
CREATE INDEX IF NOT EXISTS idx_friend_reminders_friend ON friend_reminders (friend_id);

-- リマインダ配信ログ（どのステップが送信済みか追跡）
CREATE TABLE IF NOT EXISTS friend_reminder_deliveries (
  id                TEXT PRIMARY KEY,
  friend_reminder_id TEXT NOT NULL REFERENCES friend_reminders (id) ON DELETE CASCADE,
  reminder_step_id  TEXT NOT NULL REFERENCES reminder_steps (id) ON DELETE CASCADE,
  delivered_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (friend_reminder_id, reminder_step_id)
);

-- ============================================================
-- 4. スコアリング (Lead Scoring)
-- ============================================================
CREATE TABLE IF NOT EXISTS scoring_rules (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  event_type  TEXT NOT NULL,                     -- url_click, form_submit, purchase, message_received, tag_added, etc.
  score_value INTEGER NOT NULL,                  -- 加算スコア（負数も可）
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 友だちスコア履歴
CREATE TABLE IF NOT EXISTS friend_scores (
  id              TEXT PRIMARY KEY,
  friend_id       TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  scoring_rule_id TEXT REFERENCES scoring_rules (id) ON DELETE SET NULL,
  score_change    INTEGER NOT NULL,
  reason          TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_friend_scores_friend ON friend_scores (friend_id);
CREATE INDEX IF NOT EXISTS idx_friend_scores_created ON friend_scores (created_at);

-- friendsテーブルにスコアキャッシュ列追加
ALTER TABLE friends ADD COLUMN score INTEGER NOT NULL DEFAULT 0;

-- ============================================================
-- 5. テンプレート管理 (Template)
-- ============================================================
CREATE TABLE IF NOT EXISTS templates (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'general',
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex', 'carousel')),
  message_content TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_templates_category ON templates (category);

-- ============================================================
-- 6. オペレーター/マルチユーザーチャット
-- ============================================================
CREATE TABLE IF NOT EXISTS operators (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chats (
  id            TEXT PRIMARY KEY,
  friend_id     TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  operator_id   TEXT REFERENCES operators (id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'in_progress', 'resolved')),
  notes         TEXT,
  last_message_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_chats_friend ON chats (friend_id);
CREATE INDEX IF NOT EXISTS idx_chats_operator ON chats (operator_id);
CREATE INDEX IF NOT EXISTS idx_chats_status ON chats (status);

-- ============================================================
-- 7. 通知機能 (Notification System)
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_rules (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  event_type   TEXT NOT NULL,                    -- friend_add, keyword_match, high_score, form_submit, cv_fire
  conditions   TEXT NOT NULL DEFAULT '{}',       -- JSON: 閾値等の条件
  channels     TEXT NOT NULL DEFAULT '["webhook"]', -- JSON配列: ["webhook","email","dashboard"]
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id              TEXT PRIMARY KEY,
  rule_id         TEXT REFERENCES notification_rules (id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  channel         TEXT NOT NULL,                 -- webhook, email, dashboard
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  metadata        TEXT,                          -- JSON
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications (status);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at);

-- ============================================================
-- 8. Stripe決済連携
-- ============================================================
CREATE TABLE IF NOT EXISTS stripe_events (
  id               TEXT PRIMARY KEY,
  stripe_event_id  TEXT NOT NULL UNIQUE,         -- Stripe Event ID (冪等性)
  event_type       TEXT NOT NULL,                -- payment_intent.succeeded, customer.subscription.*
  friend_id        TEXT REFERENCES friends (id) ON DELETE SET NULL,
  amount           REAL,
  currency         TEXT,
  metadata         TEXT,                         -- JSON
  processed_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_stripe_events_friend ON stripe_events (friend_id);
CREATE INDEX IF NOT EXISTS idx_stripe_events_type ON stripe_events (event_type);

-- ============================================================
-- 9. BAN検知 & リカバリ
-- ============================================================

-- アカウントヘルスログ
CREATE TABLE IF NOT EXISTS account_health_logs (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL,
  error_code      INTEGER,
  error_count     INTEGER NOT NULL DEFAULT 0,
  check_period    TEXT NOT NULL,                 -- チェック期間 (ISO 8601)
  risk_level      TEXT NOT NULL DEFAULT 'normal' CHECK (risk_level IN ('normal', 'warning', 'danger')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_health_logs_account ON account_health_logs (line_account_id);

-- アカウント移行履歴
CREATE TABLE IF NOT EXISTS account_migrations (
  id               TEXT PRIMARY KEY,
  from_account_id  TEXT NOT NULL,
  to_account_id    TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  migrated_count   INTEGER NOT NULL DEFAULT 0,
  total_count      INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at     TEXT
);

-- ============================================================
-- 10. アクション自動化 (IF-THEN ルール)
-- ============================================================
CREATE TABLE IF NOT EXISTS automations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  event_type  TEXT NOT NULL,                     -- friend_add, tag_change, score_threshold, cv_fire, message_received, calendar_booked
  conditions  TEXT NOT NULL DEFAULT '{}',        -- JSON: イベント条件
  actions     TEXT NOT NULL DEFAULT '[]',        -- JSON配列: [{type:"add_tag",params:{tagId:"..."}}, ...]
  is_active   INTEGER NOT NULL DEFAULT 1,
  priority    INTEGER NOT NULL DEFAULT 0,        -- 実行順序
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_automations_event ON automations (event_type);
CREATE INDEX IF NOT EXISTS idx_automations_active ON automations (is_active);

-- 自動化実行ログ
CREATE TABLE IF NOT EXISTS automation_logs (
  id             TEXT PRIMARY KEY,
  automation_id  TEXT NOT NULL REFERENCES automations (id) ON DELETE CASCADE,
  friend_id      TEXT REFERENCES friends (id) ON DELETE SET NULL,
  event_data     TEXT,                           -- JSON: トリガーイベントデータ
  actions_result TEXT,                           -- JSON: 各アクションの実行結果
  status         TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'partial', 'failed')),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_automation_logs_automation ON automation_logs (automation_id);
