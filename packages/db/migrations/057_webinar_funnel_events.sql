CREATE TABLE IF NOT EXISTS webinar_funnel_events (
  id               TEXT PRIMARY KEY,
  webinar_id       TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  friend_id        TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  session_start_at INTEGER NOT NULL,
  event_type       TEXT NOT NULL CHECK (event_type IN (
    'cta_impression',
    'cta_click',
    'form_open',
    'form_start',
    'field_complete',
    'submit_attempt',
    'submit_success',
    'submit_error'
  )),
  cta_id           TEXT NOT NULL DEFAULT '',
  form_id          TEXT NOT NULL DEFAULT '',
  field_name       TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 同じ人・同じ回・同じ段階は1件だけにして、再入場や連打で数値を膨らませない。
CREATE UNIQUE INDEX IF NOT EXISTS idx_webinar_funnel_events_unique
  ON webinar_funnel_events (
    webinar_id, friend_id, session_start_at, event_type, cta_id, form_id, field_name
  );

CREATE INDEX IF NOT EXISTS idx_webinar_funnel_events_webinar_created
  ON webinar_funnel_events (webinar_id, created_at);
