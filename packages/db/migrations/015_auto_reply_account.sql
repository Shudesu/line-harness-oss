-- Add line_account_id to auto_replies for multi-account support
ALTER TABLE auto_replies ADD COLUMN line_account_id TEXT DEFAULT NULL;
