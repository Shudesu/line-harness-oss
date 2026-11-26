-- Spec 08 uses 075 here: 074 is the finalized security-hardening migration.
CREATE TABLE IF NOT EXISTS ig_link_token_uses (
  nonce TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL,
  used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ig_link_token_uses_expires ON ig_link_token_uses(expires_at);
