-- Add configurable post-submission message to forms
ALTER TABLE forms ADD COLUMN on_submit_message_type TEXT CHECK (on_submit_message_type IN ('text', 'flex')) DEFAULT NULL;
ALTER TABLE forms ADD COLUMN on_submit_message_content TEXT DEFAULT NULL;
