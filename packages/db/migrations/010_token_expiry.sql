-- Migration 009: Track token expiration for auto-refresh
-- Run: wrangler d1 execute line-crm --file=packages/db/migrations/009_token_expiry.sql --remote

ALTER TABLE line_accounts ADD COLUMN token_expires_at TEXT;
-- ISO8601 timestamp (JST). NULL = unknown expiry (legacy tokens).
-- Auto-refresh service will populate this on next refresh cycle.