-- Groq/LLM 回答キャッシュ（canonical 質問のみ・TTL 72h）
CREATE TABLE IF NOT EXISTS llm_response_cache (
  id TEXT PRIMARY KEY,
  question_hash TEXT NOT NULL,
  question_normalized TEXT NOT NULL,
  answer TEXT NOT NULL,
  line_account_id TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_llm_response_cache_lookup
  ON llm_response_cache (question_hash, line_account_id, expires_at);
