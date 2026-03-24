-- Migration 008: Multi-account support
-- Run: wrangler d1 execute line-crm --file=packages/db/migrations/008_multi_account.sql --remote

-- Add line_account_id to friends (track which account each friend belongs to)
ALTER TABLE friends ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id);

-- Add line_account_id to scenarios, broadcasts, reminders, automations, chats
ALTER TABLE scenarios ADD COLUMN line_account_id TEXT;
ALTER TABLE broadcasts ADD COLUMN line_account_id TEXT;
ALTER TABLE reminders ADD COLUMN line_account_id TEXT;
ALTER TABLE automations ADD COLUMN line_account_id TEXT;
ALTER TABLE chats ADD COLUMN line_account_id TEXT;

-- Add LINE Login credentials to line_accounts for multi-account OAuth
ALTER TABLE line_accounts ADD COLUMN login_channel_id TEXT;
ALTER TABLE line_accounts ADD COLUMN login_channel_secret TEXT;
ALTER TABLE line_accounts ADD COLUMN liff_id TEXT;
