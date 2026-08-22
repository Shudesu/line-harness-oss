-- Durable LINE webhook forwarding queue.
--
-- LINE can register only one webhook endpoint. L Harness receives and verifies
-- that request, processes it locally, then forwards the exact body/signature to
-- the legacy L-Step endpoint. Persisting before the 200 response prevents a
-- temporary L-Step outage from dropping events.
CREATE TABLE IF NOT EXISTS line_webhook_forward_queue (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT REFERENCES line_accounts(id) ON DELETE SET NULL,
  raw_body          TEXT NOT NULL,
  line_signature    TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'sending', 'delivered', 'dead')),
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  next_attempt_at   TEXT NOT NULL,
  locked_until      TEXT,
  last_http_status  INTEGER,
  last_error        TEXT,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL,
  delivered_at      TEXT
);

CREATE INDEX IF NOT EXISTS idx_line_webhook_forward_due
  ON line_webhook_forward_queue(status, next_attempt_at, created_at);

CREATE INDEX IF NOT EXISTS idx_line_webhook_forward_delivered
  ON line_webhook_forward_queue(delivered_at);
