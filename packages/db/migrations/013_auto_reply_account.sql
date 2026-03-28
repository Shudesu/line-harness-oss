-- Add line_account_id to auto_replies for multi-account support
-- (webhook.ts already queries this column; this migration adds it to existing DBs)
ALTER TABLE auto_replies ADD COLUMN line_account_id TEXT;
