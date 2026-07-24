-- Durable provider receipt ledger for idempotent runtime push messages.
-- Provider identifiers stay inside the per-instance D1 database and are
-- exposed only through the authenticated runtime readback endpoint.
CREATE TABLE IF NOT EXISTS provider_message_dispatches (
  id                        TEXT PRIMARY KEY,
  client_request_id         TEXT NOT NULL UNIQUE,
  request_hash              TEXT NOT NULL,
  conversation_ref          TEXT NOT NULL,
  friend_id                 TEXT NOT NULL REFERENCES friends(id),
  account_scope_fingerprint TEXT NOT NULL,
  status                    TEXT NOT NULL CHECK (
    status IN (
      'dispatching',
      'provider_accepted',
      'failed_terminal',
      'reconciliation_required'
    )
  ),
  release_version           TEXT NOT NULL,
  worker_hash               TEXT NOT NULL,
  provider_http_status      INTEGER,
  provider_request_id       TEXT,
  accepted_request_id       TEXT,
  provider_message_ids      TEXT,
  receipt_hash              TEXT,
  dispatch_started_at       TEXT,
  provider_accepted_at      TEXT,
  created_at                TEXT NOT NULL,
  updated_at                TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_provider_message_dispatches_status
  ON provider_message_dispatches(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_provider_message_dispatches_conversation
  ON provider_message_dispatches(conversation_ref, created_at);
