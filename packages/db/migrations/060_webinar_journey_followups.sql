-- Webinar journey follow-ups beyond the existing CTA-abandon sequence.
-- Additive-only: keep webinar_followups (058) untouched and store the new
-- journey stages separately so production history and retry keys are preserved.

ALTER TABLE webinar_followup_configs
  ADD COLUMN stage_enabled_at TEXT;
ALTER TABLE webinar_followup_configs
  ADD COLUMN picker_delay_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE webinar_followup_configs
  ADD COLUMN no_show_delay_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE webinar_followup_configs
  ADD COLUMN booking_delay_minutes INTEGER NOT NULL DEFAULT 30;
ALTER TABLE webinar_followup_configs
  ADD COLUMN booking_second_delay_minutes INTEGER NOT NULL DEFAULT 1440;
ALTER TABLE webinar_followup_configs
  ADD COLUMN booking_menu_id TEXT;
ALTER TABLE webinar_followup_configs
  ADD COLUMN booking_url TEXT;

-- The server records this when an authenticated friend is actually shown the
-- session picker. One row per friend/webinar keeps page reloads from inflating it.
CREATE TABLE IF NOT EXISTS webinar_picker_opens (
  id              TEXT PRIMARY KEY,
  webinar_id      TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  friend_id       TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  opened_at       TEXT NOT NULL,
  UNIQUE (webinar_id, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_webinar_picker_opens_opened
  ON webinar_picker_opens (webinar_id, opened_at);

CREATE TABLE IF NOT EXISTS webinar_journey_followups (
  id          TEXT PRIMARY KEY,
  webinar_id  TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  friend_id   TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN (
    'picker_no_registration',
    'registered_no_show',
    'submitted_no_booking_30m',
    'submitted_no_booking_24h'
  )),
  retry_key   TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  sent_at     TEXT,
  last_error  TEXT,
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (webinar_id, friend_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_webinar_journey_followups_status
  ON webinar_journey_followups (status, updated_at);
