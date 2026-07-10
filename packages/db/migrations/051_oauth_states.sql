CREATE TABLE IF NOT EXISTS oauth_states (
  id TEXT PRIMARY KEY,
  nonce TEXT NOT NULL UNIQUE,
  staff_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);

CREATE INDEX IF NOT EXISTS idx_oauth_states_expires_at ON oauth_states(expires_at);
