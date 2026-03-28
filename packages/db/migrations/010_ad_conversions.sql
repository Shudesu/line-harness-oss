-- Ad conversion tracking: click IDs on ref_tracking + ad platform config + conversion logs

-- Add ad click ID columns to ref_tracking
ALTER TABLE ref_tracking ADD COLUMN fbclid TEXT;
ALTER TABLE ref_tracking ADD COLUMN gclid TEXT;
ALTER TABLE ref_tracking ADD COLUMN twclid TEXT;
ALTER TABLE ref_tracking ADD COLUMN ttclid TEXT;
ALTER TABLE ref_tracking ADD COLUMN utm_source TEXT;
ALTER TABLE ref_tracking ADD COLUMN utm_medium TEXT;
ALTER TABLE ref_tracking ADD COLUMN utm_campaign TEXT;
ALTER TABLE ref_tracking ADD COLUMN user_agent TEXT;
ALTER TABLE ref_tracking ADD COLUMN ip_address TEXT;

-- Ad platform configuration (Meta, X, Google, TikTok)
CREATE TABLE IF NOT EXISTS ad_platforms (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  display_name TEXT,
  config       TEXT NOT NULL DEFAULT '{}',
  is_active    INTEGER DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- Ad conversion send logs
CREATE TABLE IF NOT EXISTS ad_conversion_logs (
  id                  TEXT PRIMARY KEY,
  ad_platform_id      TEXT NOT NULL,
  friend_id           TEXT NOT NULL,
  conversion_point_id TEXT,
  event_name          TEXT NOT NULL,
  click_id            TEXT,
  click_id_type       TEXT,
  status              TEXT DEFAULT 'pending',
  request_body        TEXT,
  response_body       TEXT,
  error_message       TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_ad_conversion_logs_platform ON ad_conversion_logs (ad_platform_id);
CREATE INDEX IF NOT EXISTS idx_ad_conversion_logs_friend ON ad_conversion_logs (friend_id);
CREATE INDEX IF NOT EXISTS idx_ad_conversion_logs_status ON ad_conversion_logs (status);
