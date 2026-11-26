-- Public B2B inquiries captured from the-harness.com.
-- Persist before attempting email notification so transient delivery failures
-- never lose the lead.
CREATE TABLE IF NOT EXISTS media_inquiries (
  id TEXT PRIMARY KEY,
  inquiry_type TEXT NOT NULL,
  company_name TEXT NOT NULL,
  contact_name TEXT NOT NULL,
  department TEXT,
  position TEXT,
  decision_role TEXT,
  email TEXT NOT NULL,
  phone TEXT,
  company_size TEXT,
  current_tools TEXT,
  line_friend_count TEXT,
  budget TEXT,
  timeframe TEXT,
  challenge TEXT NOT NULL,
  desired_outcome TEXT,
  preferred_contact TEXT,
  source_article TEXT,
  source_url TEXT,
  referrer TEXT,
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  country TEXT,
  cf_ray TEXT,
  mail_status TEXT NOT NULL DEFAULT 'pending',
  mail_error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_media_inquiries_created
  ON media_inquiries (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_inquiries_mail_status
  ON media_inquiries (mail_status, created_at);
