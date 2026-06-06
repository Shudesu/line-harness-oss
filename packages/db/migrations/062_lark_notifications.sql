-- Phase 3-F1: Lark 連携通知設定
--
-- 用途: hyhome Harness の各種イベント (友だち追加・ブロック・フォーム回答・未返信) を
-- Lark の指定チャットに自動通知する。
-- 前田さん/hyhome は社内コミュニケーション全般を Lark で運用しているため、
-- L-TRACK や ELMe の管理画面を毎回開かずに Lark 上でハンドリングできるようにする。
--
-- 設計:
-- - line_accounts 単位で設定 (account 別に通知先を分けられる、例: みな@qNG7n2 と かしゆう用OA を別チャットへ)
-- - event_type で何を通知するか指定
-- - target_type = 'chat' (グループチャット open_chat_id) or 'user' (個人IM open_id)
-- - template_text を Handlebars 風プレースホルダ {{friend_name}} {{form_name}} 等で柔軟に
-- - is_enabled で個別に ON/OFF (段階的移行に対応)
-- - 失敗は lark_notification_logs に最近 200 件保持 (PII は本文に含めない設計)

CREATE TABLE IF NOT EXISTS lark_notifications (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN (
    'friend_added',
    'friend_blocked',
    'form_submitted',
    'unread_timeout',
    'daily_summary'
  )),
  target_type     TEXT NOT NULL CHECK (target_type IN ('chat', 'user', 'email')),
  target_id       TEXT NOT NULL,  -- open_chat_id / open_id / email
  -- 通知本文テンプレ (省略時はデフォルト文言)
  template_text   TEXT,
  -- form_submitted の時にどのフォームに絞るか (NULL = 全フォーム)
  filter_form_id  TEXT,
  -- unread_timeout で何分応答無しなら通知するか (デフォルト 30 分)
  unread_threshold_minutes INTEGER NOT NULL DEFAULT 30,
  is_enabled      INTEGER NOT NULL DEFAULT 1,
  memo            TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_lark_notifications_account_event
  ON lark_notifications (line_account_id, event_type, is_enabled);

CREATE TABLE IF NOT EXISTS lark_notification_logs (
  id                  TEXT PRIMARY KEY,
  lark_notification_id TEXT NOT NULL REFERENCES lark_notifications(id) ON DELETE CASCADE,
  status              TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'timeout', 'skipped')),
  http_status         INTEGER,
  duration_ms         INTEGER,
  error_message       TEXT,
  -- 何のイベントで発火したかだけ、本文は保存しない
  trigger_summary     TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_lark_notification_logs_notif
  ON lark_notification_logs (lark_notification_id, created_at DESC);
