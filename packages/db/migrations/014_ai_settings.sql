-- 014_ai_settings.sql
-- AI自動応答設定テーブル
-- Issue #33: 汎用AI自動応答ミドルウェア

CREATE TABLE IF NOT EXISTS ai_settings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  key         TEXT NOT NULL UNIQUE,   -- 設定キー (e.g. 'enabled', 'system_prompt')
  value       TEXT NOT NULL,          -- 設定値
  updated_at  TEXT NOT NULL
);

-- デフォルト: AI自動応答 OFF
INSERT OR IGNORE INTO ai_settings (key, value, updated_at)
VALUES ('enabled', 'false', datetime('now'));
