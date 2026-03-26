-- Session management for web dashboard auth
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  api_key_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_api_key_hash ON sessions(api_key_hash);
