-- Placeholder number: assign with the API idempotency migration at merge time.
-- Retained indefinitely. A sending row is never reclaimed by a lease timeout.
-- first_started_at is the earliest possible LINE request time (epoch ms).
CREATE TABLE IF NOT EXISTS api_line_sends (
  id TEXT PRIMARY KEY,
  request_body TEXT NOT NULL,
  claim_token TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sending', 'retryable', 'completed')),
  first_started_at INTEGER NOT NULL
);
