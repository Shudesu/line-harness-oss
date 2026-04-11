-- Add intro_template_id to tracked_links for per-campaign push message customization
ALTER TABLE tracked_links ADD COLUMN intro_template_id TEXT REFERENCES message_templates (id) ON DELETE SET NULL;
