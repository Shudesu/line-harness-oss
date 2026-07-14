-- Groq 日次使用量（無料枠監視・fail-closed 安全弁）
CREATE TABLE IF NOT EXISTS groq_usage_daily (
  id TEXT PRIMARY KEY,
  line_account_id TEXT,
  usage_date TEXT NOT NULL,
  groq_calls INTEGER NOT NULL DEFAULT 0,
  cache_hits INTEGER NOT NULL DEFAULT 0,
  escalations INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_groq_usage_daily_account_date
  ON groq_usage_daily (line_account_id, usage_date);
