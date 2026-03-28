-- Add delivery_type column to messages_log to distinguish push vs reply messages
ALTER TABLE messages_log ADD COLUMN delivery_type TEXT CHECK (delivery_type IN ('push', 'reply'));
