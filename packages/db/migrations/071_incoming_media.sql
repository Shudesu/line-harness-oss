-- Private ledger for image messages fetched from the LINE Content API.
-- R2 object keys are never accepted from callers; authenticated retrieval
-- resolves the object exclusively through this account-scoped row.
CREATE TABLE IF NOT EXISTS incoming_media (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  line_message_id   TEXT NOT NULL,
  source_type       TEXT NOT NULL CHECK (source_type IN ('user', 'group', 'room')),
  source_id         TEXT NOT NULL,
  sender_user_id    TEXT,
  r2_key            TEXT NOT NULL,
  mime_type         TEXT,
  byte_size         INTEGER,
  sha256            TEXT,
  status            TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'stored', 'failed')),
  stored_at         TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  UNIQUE (line_account_id, line_message_id)
);

CREATE INDEX IF NOT EXISTS idx_incoming_media_status_updated
  ON incoming_media(status, updated_at);
