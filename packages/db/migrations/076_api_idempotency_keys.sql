-- New table only. No existing table is altered, so re-applying is a no-op.
--
-- Claim-first store for API requests sent with an Idempotency-Key header.
-- The key and a hash of the request are written BEFORE any side effect, so a
-- concurrent or repeated request can be told apart from a new one.
-- Rows exist only for keyed requests and are kept:
--   - one row per keyed API request (scope = the route's namespace); a
--     completed key replays its response for as long as the row exists
--   - one row per delivered outgoing webhook of such a request
--     (scope = `event-webhook:...`, completed-only marker: no hash, no token,
--     no response)
-- Timestamps are epoch milliseconds.
CREATE TABLE IF NOT EXISTS api_idempotency_keys (
  scope           TEXT NOT NULL,
  key             TEXT NOT NULL,
  request_hash    TEXT NOT NULL,
  claim_token     TEXT NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('processing', 'completed')),
  response_status INTEGER,
  response_body   TEXT,
  locked_until    INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (scope, key)
);
