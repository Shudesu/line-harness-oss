-- Add reward_template_id to tracked_links so the post-form-submit reward
-- message can be customized per campaign (overrides form's on_submit_message_*).
ALTER TABLE tracked_links ADD COLUMN reward_template_id TEXT REFERENCES message_templates (id) ON DELETE SET NULL;
