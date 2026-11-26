-- The v0.23.1 health check reads the latest state for each LINE account every
-- five minutes. The previous line_account_id-only index still had to scan and
-- sort the account's full history before returning LIMIT 1.
CREATE INDEX IF NOT EXISTS idx_health_logs_account_created_at
  ON account_health_logs (line_account_id, created_at DESC);

-- The composite index covers lookups by line_account_id as its leftmost
-- prefix, so retaining the old index would only add write and storage cost.
DROP INDEX IF EXISTS idx_health_logs_account;
