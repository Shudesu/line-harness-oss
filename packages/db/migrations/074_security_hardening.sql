-- Apply before the new Worker. Web Crypto backfill is required; see docs/SECURITY-UPGRADE.en.md.
-- NULL preserves existing staff roles; [] denies every protected operation.
ALTER TABLE staff_members ADD COLUMN api_scopes TEXT;
ALTER TABLE staff_members ADD COLUMN api_key_hash TEXT;
ALTER TABLE staff_members ADD COLUMN api_key_last4 TEXT;
ALTER TABLE staff_members ADD COLUMN api_key_created_at TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_members_api_key_hash ON staff_members(api_key_hash);
CREATE INDEX IF NOT EXISTS idx_staff_members_plaintext ON staff_members(id) WHERE api_key NOT GLOB 'hashed:*';
CREATE TABLE IF NOT EXISTS admin_sessions (
  id_hash TEXT PRIMARY KEY,
  staff_id TEXT NOT NULL,
  credential_fp TEXT NOT NULL,
  role_at_issue TEXT NOT NULL,
  auth_method TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_staff ON admin_sessions(staff_id, revoked_at, expires_at);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires ON admin_sessions(expires_at, id_hash);
ALTER TABLE admin_sessions ADD COLUMN auth_subject TEXT;

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_rate_limits_expires ON auth_rate_limits(expires_at, bucket_hash);
CREATE TABLE IF NOT EXISTS auth_audit_log (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  occurred_at INTEGER NOT NULL,
  ip TEXT NOT NULL,
  outcome TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_audit_log_time ON auth_audit_log(occurred_at, id);
