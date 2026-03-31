-- Migration 013: AI Auto-Reply Feature

CREATE TABLE IF NOT EXISTS ai_reply_config (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT UNIQUE,
  is_enabled        INTEGER NOT NULL DEFAULT 0,
  ai_model          TEXT NOT NULL DEFAULT 'claude-haiku',
  system_prompt     TEXT NOT NULL DEFAULT 'あなたは親切なカスタマーサポート担当です。自然な日本語で簡潔に回答してください。',
  delay_min_minutes INTEGER NOT NULL DEFAULT 10,
  delay_max_minutes INTEGER NOT NULL DEFAULT 30,
  max_context_messages INTEGER NOT NULL DEFAULT 20,
  max_tokens        INTEGER NOT NULL DEFAULT 500,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_reply_queue (
  id                TEXT PRIMARY KEY,
  friend_id         TEXT NOT NULL,
  line_account_id   TEXT,
  incoming_message  TEXT NOT NULL,
  ai_response       TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending',
  scheduled_send_at TEXT NOT NULL,
  sent_at           TEXT,
  error_message     TEXT,
  created_at        TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_reply_queue_due ON ai_reply_queue (status, scheduled_send_at);
CREATE INDEX IF NOT EXISTS idx_ai_reply_queue_friend ON ai_reply_queue (friend_id, status);
