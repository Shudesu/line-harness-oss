-- Account-scoped, read-only credentials for private incoming LINE evidence.
-- Only a SHA-256 digest is stored. The bearer secret must remain outside D1.
CREATE TABLE IF NOT EXISTS incoming_media_service_credentials (
  id                TEXT PRIMARY KEY
                    CHECK (length(id) = 32 AND id NOT GLOB '*[^0-9a-f]*'),
  line_account_id   TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  scope             TEXT NOT NULL DEFAULT 'incoming_media_read'
                    CHECK (scope = 'incoming_media_read'),
  token_sha256      TEXT NOT NULL UNIQUE
                    CHECK (length(token_sha256) = 64 AND token_sha256 NOT GLOB '*[^0-9a-f]*'),
  label             TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  not_before        TEXT NOT NULL,
  expires_at        TEXT NOT NULL,
  revoked_at        TEXT,
  created_at        TEXT NOT NULL,
  CHECK (not_before < expires_at)
);

CREATE INDEX IF NOT EXISTS idx_incoming_media_service_credentials_account_active
  ON incoming_media_service_credentials(line_account_id, revoked_at, expires_at);
