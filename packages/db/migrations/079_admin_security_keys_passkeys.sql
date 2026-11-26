-- Admin security hardening: machine keys, passkeys (WebAuthn), magic links.
-- Additive and idempotent. Existing staff API keys, sessions and roles are untouched.
-- The auth_rate_limits / auth_audit_log tables from 074 are no longer written; they are left in place.

-- Machine keys (scoped keys for automation; stored as hashes)
CREATE TABLE IF NOT EXISTS machine_keys (
 id TEXT PRIMARY KEY NOT NULL,
 name TEXT NOT NULL,
 key_hash TEXT NOT NULL UNIQUE,
 key_last4 TEXT NOT NULL,
 scopes TEXT NOT NULL,
 created_by_staff_id TEXT,
 created_at INTEGER NOT NULL,
 last_used_at INTEGER,
 expires_at INTEGER,
 revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_machine_keys_created ON machine_keys(created_at DESC,id);

-- Staff e-mail lookup for identity-based sign-in
CREATE INDEX IF NOT EXISTS idx_staff_email_normalized ON staff_members(lower(trim(email)));

-- Passkeys
CREATE TABLE IF NOT EXISTS admin_passkeys (
 id TEXT PRIMARY KEY NOT NULL, staff_id TEXT NOT NULL, credential_id TEXT NOT NULL UNIQUE,
 public_key TEXT NOT NULL, sign_count INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL,
 aaguid TEXT NOT NULL, name TEXT NOT NULL, user_handle TEXT NOT NULL, context_hash TEXT NOT NULL,
 created_at INTEGER NOT NULL, last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_admin_passkeys_staff ON admin_passkeys(staff_id,id);
CREATE TABLE IF NOT EXISTS admin_webauthn_challenges (
 id TEXT PRIMARY KEY NOT NULL, challenge_hash TEXT NOT NULL, purpose TEXT NOT NULL,
 staff_id TEXT, context_hash TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_webauthn_challenge_expiry ON admin_webauthn_challenges(expires_at,id);
CREATE TRIGGER IF NOT EXISTS staff_delete_passkeys AFTER DELETE ON staff_members
BEGIN DELETE FROM admin_passkeys WHERE staff_id=OLD.id; END;
CREATE TRIGGER IF NOT EXISTS staff_disable_passkeys AFTER UPDATE OF is_active ON staff_members WHEN NEW.is_active=0
BEGIN DELETE FROM admin_passkeys WHERE staff_id=NEW.id; END;

-- Magic links
CREATE TABLE IF NOT EXISTS admin_magic_links (
 token_hash TEXT PRIMARY KEY NOT NULL,staff_id TEXT NOT NULL,email TEXT NOT NULL,
 credential_fp TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,used_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_magic_link_expiry ON admin_magic_links(expires_at,token_hash);
