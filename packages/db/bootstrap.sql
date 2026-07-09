-- Generated from schema.sql + migrations by scripts/generate-bootstrap.mjs.
-- Do not edit manually. Run `pnpm --dir packages/db generate:bootstrap`.
CREATE TABLE account_health_logs (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL,
  error_code      INTEGER,
  error_count     INTEGER NOT NULL DEFAULT 0,
  check_period    TEXT NOT NULL,
  risk_level      TEXT NOT NULL DEFAULT 'normal' CHECK (risk_level IN ('normal', 'warning', 'danger')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE account_migrations (
  id               TEXT PRIMARY KEY,
  from_account_id  TEXT NOT NULL,
  to_account_id    TEXT NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'failed')),
  migrated_count   INTEGER NOT NULL DEFAULT 0,
  total_count      INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  completed_at     TEXT
);

CREATE TABLE account_settings (
  id              TEXT PRIMARY KEY,
  line_account_id TEXT NOT NULL,
  key             TEXT NOT NULL,
  value           TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE(line_account_id, key)
);

CREATE TABLE ad_conversion_logs (
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

CREATE TABLE ad_platforms (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  display_name TEXT,
  config       TEXT NOT NULL DEFAULT '{}',
  is_active    INTEGER DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE admin_users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE affiliate_clicks (
  id           TEXT PRIMARY KEY,
  affiliate_id TEXT NOT NULL REFERENCES affiliates (id) ON DELETE CASCADE,
  url          TEXT,
  ip_address   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE affiliate_links (
  id              TEXT PRIMARY KEY,
  affiliate_id    TEXT NOT NULL REFERENCES affiliates (id),
  ref_code        TEXT NOT NULL UNIQUE,
  label           TEXT,
  line_account_id TEXT REFERENCES line_accounts (id),
  offer_id        TEXT REFERENCES affiliate_offers (id),
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  click_count     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE affiliate_offers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  reward_amount   INTEGER NOT NULL DEFAULT 0,
  line_account_id TEXT REFERENCES line_accounts (id),
  tag_id          TEXT REFERENCES tags (id),
  scenario_id     TEXT REFERENCES scenarios (id),
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL
);

CREATE TABLE affiliates (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  code            TEXT NOT NULL UNIQUE,
  commission_rate REAL NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  friend_id       TEXT REFERENCES friends (id),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE auto_replies (
  id               TEXT PRIMARY KEY,
  keyword          TEXT NOT NULL,
  match_type       TEXT NOT NULL CHECK (match_type IN ('exact', 'contains')) DEFAULT 'exact',
  response_type    TEXT NOT NULL DEFAULT 'text',
  response_content TEXT NOT NULL,
  template_id      TEXT REFERENCES templates(id) ON DELETE SET NULL,
  line_account_id  TEXT DEFAULT NULL,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE automation_logs (
  id             TEXT PRIMARY KEY,
  automation_id  TEXT NOT NULL REFERENCES automations (id) ON DELETE CASCADE,
  friend_id      TEXT REFERENCES friends (id) ON DELETE SET NULL,
  event_data     TEXT,
  actions_result TEXT,
  status         TEXT NOT NULL DEFAULT 'success' CHECK (status IN ('success', 'partial', 'failed')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE automations (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  event_type  TEXT NOT NULL,
  conditions  TEXT NOT NULL DEFAULT '{}',
  actions     TEXT NOT NULL DEFAULT '[]',
  is_active   INTEGER NOT NULL DEFAULT 1,
  priority    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, line_account_id TEXT);

CREATE TABLE booking_idempotency_keys (
  key              TEXT PRIMARY KEY,
  line_account_id  TEXT NOT NULL,
  friend_id        TEXT NOT NULL,
  response_status  INTEGER NOT NULL,
  response_body    TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  expires_at       TEXT NOT NULL                  -- UTC ISO8601
);

CREATE TABLE booking_reminders (
  id            TEXT PRIMARY KEY,
  booking_id    TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('day_before','hours_before')),
  scheduled_at  TEXT NOT NULL,                                -- UTC ISO8601
  sent_at       TEXT,                                         -- UTC ISO8601
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','failed_permanent','cancelled')),
  retry_count   INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  FOREIGN KEY (booking_id) REFERENCES bookings(id)
);

CREATE TABLE bookings (
  id                      TEXT PRIMARY KEY,
  line_account_id         TEXT NOT NULL,
  friend_id               TEXT NOT NULL,        -- friends.id
  staff_id                TEXT NOT NULL,
  menu_id                 TEXT NOT NULL,
  starts_at               TEXT NOT NULL,        -- UTC ISO8601 (Z)
  ends_at                 TEXT NOT NULL,        -- UTC ISO8601 (Z)
  block_ends_at           TEXT NOT NULL,        -- ends_at + buffer_after。衝突判定
  status                  TEXT NOT NULL CHECK (status IN ('requested','confirmed','rejected','expired','cancelled','completed','no_show')),
  customer_note           TEXT,
  internal_note           TEXT,
  price_at_booking        INTEGER NOT NULL,
  requested_at            TEXT NOT NULL,        -- UTC ISO8601
  decided_at              TEXT,                 -- UTC ISO8601
  decided_by_staff_id     TEXT,
  external_event_id       TEXT,                 -- Phase 3 余地 (Google Calendar)
  external_calendar_id    TEXT,                 -- Phase 3 余地
  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id),
  FOREIGN KEY (friend_id) REFERENCES friends(id),
  FOREIGN KEY (staff_id) REFERENCES staff(id),
  FOREIGN KEY (menu_id) REFERENCES menus(id)
);

CREATE TABLE broadcast_insights (
  id                  TEXT PRIMARY KEY,
  broadcast_id        TEXT NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  delivered           INTEGER,
  unique_impression   INTEGER,
  unique_click        INTEGER,
  unique_media_played INTEGER,
  open_rate           REAL,
  click_rate          REAL,
  raw_response        TEXT,
  status              TEXT NOT NULL CHECK (status IN ('pending', 'ready', 'failed')),
  retry_count         INTEGER NOT NULL DEFAULT 0,
  fetched_at          TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE "broadcasts" (
  id                 TEXT PRIMARY KEY,
  title              TEXT NOT NULL,
  message_type       TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex')),
  message_content    TEXT NOT NULL,
  target_type        TEXT NOT NULL CHECK (target_type IN ('all', 'tag', 'segment', 'multi-account-dedup')) DEFAULT 'all',
  target_tag_id      TEXT REFERENCES tags (id) ON DELETE SET NULL,
  status             TEXT NOT NULL CHECK (status IN ('draft', 'scheduled', 'sending', 'sent')) DEFAULT 'draft',
  scheduled_at       TEXT,
  sent_at            TEXT,
  total_count        INTEGER NOT NULL DEFAULT 0,
  success_count      INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  line_account_id    TEXT,
  alt_text           TEXT,
  line_request_id    TEXT,
  aggregation_unit   TEXT,
  batch_offset       INTEGER NOT NULL DEFAULT 0,
  segment_conditions TEXT,
  account_ids        TEXT CHECK (account_ids IS NULL OR json_valid(account_ids)),
  dedup_priority     TEXT CHECK (dedup_priority IS NULL OR json_valid(dedup_priority)),
  failed_account_ids TEXT CHECK (failed_account_ids IS NULL OR json_valid(failed_account_ids))
, dedup_progress TEXT, batch_lock_at TEXT, track_links INTEGER NOT NULL DEFAULT 1);

CREATE TABLE calendar_bookings (
  id             TEXT PRIMARY KEY,
  connection_id  TEXT NOT NULL REFERENCES google_calendar_connections (id) ON DELETE CASCADE,
  friend_id      TEXT REFERENCES friends (id) ON DELETE SET NULL,
  event_id       TEXT,
  title          TEXT NOT NULL,
  start_at       TEXT NOT NULL,
  end_at         TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'completed')),
  metadata       TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE chats (
  id            TEXT PRIMARY KEY,
  friend_id     TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  operator_id   TEXT REFERENCES operators (id) ON DELETE SET NULL,
  status        TEXT NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'in_progress', 'resolved')),
  notes         TEXT,
  last_message_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, line_account_id TEXT);

CREATE TABLE conversion_events (
  id                   TEXT PRIMARY KEY,
  conversion_point_id  TEXT NOT NULL REFERENCES conversion_points (id) ON DELETE CASCADE,
  friend_id            TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  user_id              TEXT,
  affiliate_code       TEXT,
  metadata             TEXT,
  affiliate_id         TEXT REFERENCES affiliates (id),
  attributed_ref_code  TEXT,
  approval_status      TEXT CHECK (approval_status IN ('pending','approved','rejected')),
  approved_at          TEXT,
  created_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE conversion_points (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  event_type TEXT NOT NULL,
  value      REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE entry_routes (
  id          TEXT PRIMARY KEY,
  ref_code    TEXT UNIQUE NOT NULL,
  name        TEXT NOT NULL,
  tag_id      TEXT REFERENCES tags (id) ON DELETE SET NULL,
  scenario_id TEXT REFERENCES scenarios (id) ON DELETE SET NULL,
  redirect_url TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
, pool_id TEXT REFERENCES traffic_pools (id) ON DELETE SET NULL, intro_template_id TEXT REFERENCES message_templates (id) ON DELETE SET NULL, run_account_friend_add_scenarios INTEGER NOT NULL DEFAULT 1);

CREATE TABLE event_booking_idempotency_keys (
  key              TEXT PRIMARY KEY,
  line_account_id  TEXT NOT NULL,
  friend_id        TEXT NOT NULL,
  response_status  INTEGER NOT NULL,
  response_body    TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  expires_at       TEXT NOT NULL
);

CREATE TABLE event_booking_reminders (
  id            TEXT PRIMARY KEY,
  booking_id    TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('day_before','hours_before')),
  scheduled_at  TEXT NOT NULL,
  sent_at       TEXT,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','failed_permanent','cancelled')),
  retry_count   INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  FOREIGN KEY (booking_id) REFERENCES event_bookings(id)
);

CREATE TABLE event_bookings (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL,
  event_id              TEXT NOT NULL,
  slot_id               TEXT NOT NULL,
  friend_id             TEXT NOT NULL,
  status                TEXT NOT NULL CHECK (status IN ('requested','confirmed','rejected','cancelled','expired','no_show','attended')),
  customer_note         TEXT,
  internal_note         TEXT,
  requested_at          TEXT NOT NULL,
  decided_at            TEXT,
  decided_by_staff_id   TEXT,
  cancelled_at          TEXT,
  cancelled_by          TEXT CHECK (cancelled_by IN ('friend','admin','system')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')), identity_key TEXT,
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id),
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (slot_id) REFERENCES event_slots(id),
  FOREIGN KEY (friend_id) REFERENCES friends(id)
);

CREATE TABLE event_slots (
  id          TEXT PRIMARY KEY,
  event_id    TEXT NOT NULL,
  starts_at   TEXT NOT NULL,
  ends_at     TEXT NOT NULL,
  capacity    INTEGER,
  is_active   INTEGER NOT NULL DEFAULT 1,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  deleted_at  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE TABLE events (
  id                            TEXT PRIMARY KEY,
  line_account_id               TEXT NOT NULL,
  name                          TEXT NOT NULL,
  venue_name                    TEXT,
  venue_url                     TEXT,
  image_url                     TEXT,
  description                   TEXT,
  description_centered          INTEGER NOT NULL DEFAULT 0,
  max_bookings_per_friend       INTEGER,
  requires_approval             INTEGER NOT NULL DEFAULT 0,
  cancel_deadline_hours_before  INTEGER,
  reminder_day_before_enabled   INTEGER NOT NULL DEFAULT 1,
  reminder_hours_before         INTEGER,
  is_published                  INTEGER NOT NULL DEFAULT 0,
  folder_id                     TEXT,
  sort_order                    INTEGER NOT NULL DEFAULT 0,
  deleted_at                    TEXT,
  created_at                    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at                    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')), target_type TEXT NOT NULL DEFAULT 'single'
  CHECK (target_type IN ('single', 'multi-account-dedup')), account_ids TEXT
  CHECK (account_ids IS NULL OR json_valid(account_ids)), dedup_priority TEXT
  CHECK (dedup_priority IS NULL OR json_valid(dedup_priority)), failed_account_ids TEXT
  CHECK (failed_account_ids IS NULL OR json_valid(failed_account_ids)), confirmation_message_extra TEXT, reminder_message_extra TEXT, og_title TEXT, og_description TEXT, og_image_url TEXT,
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id)
);

CREATE TABLE form_opens (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL,
  friend_id TEXT,
  friend_name TEXT,
  opened_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE form_submissions (
  id TEXT PRIMARY KEY,
  form_id TEXT NOT NULL REFERENCES forms (id) ON DELETE CASCADE,
  friend_id TEXT REFERENCES friends (id) ON DELETE SET NULL,
  data TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE forms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  fields TEXT NOT NULL DEFAULT '[]',
  on_submit_tag_id TEXT REFERENCES tags (id) ON DELETE SET NULL,
  on_submit_scenario_id TEXT REFERENCES scenarios (id) ON DELETE SET NULL,
  save_to_metadata INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  submit_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, on_submit_message_type TEXT CHECK (on_submit_message_type IN ('text', 'flex')) DEFAULT NULL, on_submit_message_content TEXT DEFAULT NULL, on_submit_webhook_url TEXT, on_submit_webhook_headers TEXT, on_submit_webhook_fail_message TEXT, og_title TEXT, og_description TEXT, og_image_url TEXT);

CREATE TABLE friend_reminder_deliveries (
  id                TEXT PRIMARY KEY,
  friend_reminder_id TEXT NOT NULL REFERENCES friend_reminders (id) ON DELETE CASCADE,
  reminder_step_id  TEXT NOT NULL REFERENCES reminder_steps (id) ON DELETE CASCADE,
  delivered_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (friend_reminder_id, reminder_step_id)
);

CREATE TABLE friend_reminders (
  id              TEXT PRIMARY KEY,
  friend_id       TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  reminder_id     TEXT NOT NULL REFERENCES reminders (id) ON DELETE CASCADE,
  target_date     TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE "friend_scenarios" (
  id                 TEXT PRIMARY KEY,
  friend_id          TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  scenario_id        TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
  current_step_order INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL CHECK (status IN ('active', 'paused', 'completed', 'delivering')) DEFAULT 'active',
  started_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  next_delivery_at   TEXT,
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE friend_scores (
  id              TEXT PRIMARY KEY,
  friend_id       TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  scoring_rule_id TEXT REFERENCES scoring_rules (id) ON DELETE SET NULL,
  score_change    INTEGER NOT NULL,
  reason          TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE friend_tags (
  friend_id   TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  tag_id      TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (friend_id, tag_id)
);

CREATE TABLE friends (
  id               TEXT PRIMARY KEY,
  line_user_id     TEXT UNIQUE NOT NULL,
  display_name     TEXT,
  picture_url      TEXT,
  status_message   TEXT,
  is_following     INTEGER NOT NULL DEFAULT 1,
  user_id          TEXT,
  ig_igsid         TEXT,
  score            INTEGER NOT NULL DEFAULT 0,
  last_ref_code    TEXT,
  last_ref_at      TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, ref_code TEXT, metadata TEXT NOT NULL DEFAULT '{}', line_account_id TEXT REFERENCES line_accounts(id), first_tracked_link_id TEXT REFERENCES tracked_links (id) ON DELETE SET NULL);

CREATE TABLE google_calendar_connections (
  id            TEXT PRIMARY KEY,
  calendar_id   TEXT NOT NULL,
  access_token  TEXT,
  refresh_token TEXT,
  api_key       TEXT,
  auth_type     TEXT NOT NULL DEFAULT 'api_key',
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE incoming_webhooks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  source_type TEXT NOT NULL DEFAULT 'custom',
  secret      TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE line_accounts (
  id                     TEXT PRIMARY KEY,
  channel_id             TEXT NOT NULL UNIQUE,
  name                   TEXT NOT NULL,
  channel_access_token   TEXT NOT NULL,
  channel_secret         TEXT NOT NULL,
  is_active              INTEGER NOT NULL DEFAULT 1,
  country                TEXT,
  role                   TEXT,
  display_order          INTEGER NOT NULL DEFAULT 0,
  og_site_name           TEXT,
  og_default_image_url   TEXT,
  og_default_description TEXT,
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, login_channel_id TEXT, login_channel_secret TEXT, liff_id TEXT, token_expires_at TEXT);

CREATE TABLE link_clicks (
  id TEXT PRIMARY KEY,
  tracked_link_id TEXT NOT NULL REFERENCES tracked_links (id) ON DELETE CASCADE,
  friend_id TEXT REFERENCES friends (id) ON DELETE SET NULL,
  clicked_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE menus (
  id                    TEXT PRIMARY KEY,
  line_account_id       TEXT NOT NULL,
  name                  TEXT NOT NULL,
  category_label        TEXT,
  description           TEXT,
  duration_minutes      INTEGER NOT NULL,
  buffer_after_minutes  INTEGER NOT NULL DEFAULT 0,
  base_price            INTEGER NOT NULL,
  sort_order            INTEGER NOT NULL DEFAULT 0,
  is_active             INTEGER NOT NULL DEFAULT 1,
  deleted_at            TEXT,
  auto_tag_id           TEXT,                  -- 予約申込時に friend に自動付与するタグ
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id),
  FOREIGN KEY (auto_tag_id) REFERENCES tags(id) ON DELETE SET NULL
);

CREATE TABLE message_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  message_type TEXT NOT NULL CHECK (message_type IN ('text', 'flex')),
  message_content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE messages_log (
  id               TEXT PRIMARY KEY,
  friend_id        TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  direction        TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  message_type     TEXT NOT NULL,
  content          TEXT NOT NULL,
  broadcast_id     TEXT REFERENCES broadcasts (id) ON DELETE SET NULL,
  scenario_step_id TEXT REFERENCES scenario_steps (id) ON DELETE SET NULL,
  template_id_at_send TEXT,
  delivery_type    TEXT CHECK (delivery_type IN ('push', 'reply', 'test')),
  source           TEXT,
  line_account_id  TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE notification_rules (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  conditions   TEXT NOT NULL DEFAULT '{}',
  channels     TEXT NOT NULL DEFAULT '["webhook"]',
  is_active    INTEGER NOT NULL DEFAULT 1,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE notifications (
  id              TEXT PRIMARY KEY,
  rule_id         TEXT REFERENCES notification_rules (id) ON DELETE SET NULL,
  event_type      TEXT NOT NULL,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  channel         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  metadata        TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE operators (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL DEFAULT 'operator' CHECK (role IN ('admin', 'operator')),
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE outgoing_webhooks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  url         TEXT NOT NULL,
  event_types TEXT NOT NULL DEFAULT '[]',
  secret      TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE pool_accounts (
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES traffic_pools(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pool_id, line_account_id)
);

CREATE TABLE ref_tracking (
  id              TEXT PRIMARY KEY,
  ref_code        TEXT NOT NULL,
  friend_id       TEXT REFERENCES friends (id) ON DELETE CASCADE,
  entry_route_id  TEXT REFERENCES entry_routes (id) ON DELETE SET NULL,
  source_url      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
, fbclid TEXT, gclid TEXT, twclid TEXT, ttclid TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, user_agent TEXT, ip_address TEXT);

CREATE TABLE reminder_steps (
  id              TEXT PRIMARY KEY,
  reminder_id     TEXT NOT NULL REFERENCES reminders (id) ON DELETE CASCADE,
  offset_minutes  INTEGER NOT NULL,
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex')),
  message_content TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE reminders (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, line_account_id TEXT);

CREATE TABLE rich_menu_areas (
  id              TEXT PRIMARY KEY,
  page_id         TEXT NOT NULL REFERENCES rich_menu_pages(id) ON DELETE CASCADE,
  bounds_x        INTEGER NOT NULL,
  bounds_y        INTEGER NOT NULL,
  bounds_width    INTEGER NOT NULL,
  bounds_height   INTEGER NOT NULL,
  action_type     TEXT NOT NULL CHECK (action_type IN ('uri','message','postback','richmenuswitch')),
  action_data     TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE rich_menu_groups (
  id                 TEXT PRIMARY KEY,
  account_id         TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  chat_bar_text      TEXT NOT NULL,
  size               TEXT NOT NULL CHECK (size IN ('large','compact')),
  default_page_id    TEXT,
  is_default_for_all INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  publishing_at      TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE rich_menu_pages (
  id                 TEXT PRIMARY KEY,
  group_id           TEXT NOT NULL REFERENCES rich_menu_groups(id) ON DELETE CASCADE,
  order_index        INTEGER NOT NULL,
  name               TEXT NOT NULL,
  alias_id           TEXT NOT NULL,
  line_richmenu_id   TEXT,
  image_r2_key       TEXT,
  image_content_type TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (group_id, order_index)
);

CREATE TABLE scenario_steps (
  id              TEXT PRIMARY KEY,
  scenario_id     TEXT NOT NULL REFERENCES scenarios (id) ON DELETE CASCADE,
  step_order      INTEGER NOT NULL,
  delay_minutes   INTEGER NOT NULL DEFAULT 0,
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex')),
  message_content TEXT NOT NULL,
  offset_days     INTEGER,
  offset_minutes  INTEGER,
  delivery_time   TEXT,
  template_id     TEXT REFERENCES templates(id) ON DELETE SET NULL,
  on_reach_tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')), condition_type TEXT, condition_value TEXT, next_step_on_false INTEGER,
  UNIQUE (scenario_id, step_order)
);

CREATE TABLE scenarios (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN ('friend_add', 'tag_added', 'manual')),
  trigger_tag_id  TEXT REFERENCES tags (id) ON DELETE SET NULL,
  is_active       INTEGER NOT NULL DEFAULT 1,
  delivery_mode   TEXT NOT NULL DEFAULT 'relative' CHECK (delivery_mode IN ('relative', 'elapsed', 'absolute_time')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
, line_account_id TEXT);

CREATE TABLE scoring_rules (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  event_type  TEXT NOT NULL,
  score_value INTEGER NOT NULL,
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE staff (
  id                       TEXT PRIMARY KEY,
  line_account_id          TEXT NOT NULL,
  name                     TEXT NOT NULL,
  display_name             TEXT NOT NULL,
  role                     TEXT,
  profile_image_url        TEXT,
  bio                      TEXT,
  sort_order               INTEGER NOT NULL DEFAULT 0,
  is_designation_optional  INTEGER NOT NULL DEFAULT 0,
  is_active                INTEGER NOT NULL DEFAULT 1,
  deleted_at               TEXT,
  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  FOREIGN KEY (line_account_id) REFERENCES line_accounts(id)
);

CREATE TABLE staff_members (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'staff')),
  api_key    TEXT UNIQUE NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE staff_menus (
  staff_id                  TEXT NOT NULL,
  menu_id                   TEXT NOT NULL,
  is_offered                INTEGER NOT NULL DEFAULT 1,
  override_duration_minutes INTEGER,
  override_price            INTEGER,
  PRIMARY KEY (staff_id, menu_id),
  FOREIGN KEY (staff_id) REFERENCES staff(id),
  FOREIGN KEY (menu_id) REFERENCES menus(id)
);

CREATE TABLE staff_shifts (
  id          TEXT PRIMARY KEY,
  staff_id    TEXT NOT NULL,
  work_date   TEXT NOT NULL,    -- YYYY-MM-DD (JST)
  start_time  TEXT NOT NULL,    -- HH:MM (JST)
  end_time    TEXT NOT NULL,    -- HH:MM (JST)
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (staff_id, work_date),
  FOREIGN KEY (staff_id) REFERENCES staff(id)
);

CREATE TABLE stripe_events (
  id               TEXT PRIMARY KEY,
  stripe_event_id  TEXT NOT NULL UNIQUE,
  event_type       TEXT NOT NULL,
  friend_id        TEXT REFERENCES friends (id) ON DELETE SET NULL,
  amount           REAL,
  currency         TEXT,
  metadata         TEXT,
  processed_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE tags (
  id         TEXT PRIMARY KEY,
  name       TEXT UNIQUE NOT NULL,
  color      TEXT NOT NULL DEFAULT '#3B82F6',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE templates (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL DEFAULT 'general',
  message_type    TEXT NOT NULL CHECK (message_type IN ('text', 'image', 'flex', 'carousel')),
  message_content TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE TABLE tracked_links (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  original_url TEXT NOT NULL,
  tag_id TEXT REFERENCES tags (id) ON DELETE SET NULL,
  scenario_id TEXT REFERENCES scenarios (id) ON DELETE SET NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  click_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
, intro_template_id TEXT REFERENCES message_templates (id) ON DELETE SET NULL, reward_template_id TEXT REFERENCES message_templates (id) ON DELETE SET NULL, og_title TEXT, og_description TEXT, og_image_url TEXT, line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL, short_code TEXT);

CREATE TABLE traffic_pools (
  id TEXT PRIMARY KEY,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  active_account_id TEXT NOT NULL REFERENCES line_accounts(id),
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE update_history (
  id                          TEXT PRIMARY KEY,
  started_at                  INTEGER NOT NULL,
  completed_at                INTEGER,
  from_version                TEXT NOT NULL,
  to_version                  TEXT NOT NULL,
  status                      TEXT NOT NULL CHECK (status IN ('running','success','failed','rolled_back')),
  snapshot_worker_url         TEXT,
  snapshot_admin_deployment   TEXT,
  snapshot_liff_deployment    TEXT,
  events_jsonl                TEXT NOT NULL DEFAULT '',
  error                       TEXT,
  rollback_of                 TEXT REFERENCES update_history(id),
  rollback_expires_at         INTEGER
);

CREATE TABLE users (
  id           TEXT PRIMARY KEY,
  email        TEXT,
  phone        TEXT,
  external_id  TEXT,
  display_name TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX idx_ad_conversion_logs_friend ON ad_conversion_logs (friend_id);

CREATE INDEX idx_ad_conversion_logs_platform ON ad_conversion_logs (ad_platform_id);

CREATE INDEX idx_ad_conversion_logs_status ON ad_conversion_logs (status);

CREATE INDEX idx_affiliate_clicks_affiliate ON affiliate_clicks (affiliate_id);

CREATE INDEX idx_affiliate_links_affiliate ON affiliate_links (affiliate_id);

CREATE INDEX idx_affiliate_links_offer ON affiliate_links (offer_id);

CREATE UNIQUE INDEX idx_affiliates_friend ON affiliates (friend_id) WHERE friend_id IS NOT NULL;

CREATE INDEX idx_auto_replies_template_id ON auto_replies(template_id);

CREATE INDEX idx_automation_logs_automation ON automation_logs (automation_id);

CREATE INDEX idx_automations_active ON automations (is_active);

CREATE INDEX idx_automations_event ON automations (event_type);

CREATE INDEX idx_bookings_account_status_starts ON bookings (line_account_id, status, starts_at);

CREATE INDEX idx_bookings_friend_starts ON bookings (friend_id, starts_at DESC);

CREATE INDEX idx_bookings_staff_overlap ON bookings (staff_id, status, starts_at, block_ends_at);

CREATE INDEX idx_broadcast_insights_broadcast_id ON broadcast_insights(broadcast_id);

CREATE INDEX idx_broadcast_insights_status ON broadcast_insights(status);

CREATE INDEX idx_broadcasts_status ON broadcasts (status);

CREATE INDEX idx_calendar_bookings_friend ON calendar_bookings (friend_id);

CREATE INDEX idx_calendar_bookings_start ON calendar_bookings (start_at);

CREATE UNIQUE INDEX idx_chats_friend_unique ON chats (friend_id);

CREATE INDEX idx_chats_operator ON chats (operator_id);

CREATE INDEX idx_chats_status ON chats (status);

CREATE INDEX idx_conversion_events_affiliate ON conversion_events (affiliate_code);

CREATE INDEX idx_conversion_events_friend ON conversion_events (friend_id);

CREATE INDEX idx_conversion_events_point ON conversion_events (conversion_point_id);

CREATE INDEX idx_entry_routes_pool ON entry_routes (pool_id);

CREATE INDEX idx_entry_routes_ref ON entry_routes (ref_code);

CREATE INDEX idx_event_booking_idempotency_expires ON event_booking_idempotency_keys (expires_at);

CREATE INDEX idx_event_booking_reminders_status_scheduled ON event_booking_reminders (status, scheduled_at);

CREATE INDEX idx_event_bookings_account_status_event ON event_bookings (line_account_id, status, event_id);

CREATE INDEX idx_event_bookings_friend_requested ON event_bookings (friend_id, requested_at DESC);

CREATE INDEX idx_event_bookings_identity_status
  ON event_bookings (event_id, identity_key, status);

CREATE INDEX idx_event_bookings_slot_status ON event_bookings (slot_id, status);

CREATE INDEX idx_event_slots_event_starts ON event_slots (event_id, starts_at);

CREATE INDEX idx_events_account_published_sort ON events (line_account_id, is_published, sort_order);

CREATE INDEX idx_form_opens_form ON form_opens (form_id, opened_at);

CREATE INDEX idx_form_submissions_form ON form_submissions (form_id);

CREATE INDEX idx_form_submissions_friend ON form_submissions (friend_id);

CREATE INDEX idx_friend_reminders_friend ON friend_reminders (friend_id);

CREATE INDEX idx_friend_reminders_status ON friend_reminders (status);

CREATE INDEX idx_friend_scenarios_friend_id ON friend_scenarios (friend_id);

CREATE INDEX idx_friend_scenarios_next_delivery_at ON friend_scenarios (next_delivery_at);

CREATE INDEX idx_friend_scenarios_status ON friend_scenarios (status);

CREATE UNIQUE INDEX idx_friend_scenarios_unique ON friend_scenarios (friend_id, scenario_id) WHERE status != 'completed';

CREATE INDEX idx_friend_scores_created ON friend_scores (created_at);

CREATE INDEX idx_friend_scores_friend ON friend_scores (friend_id);

CREATE INDEX idx_friend_tags_tag_id ON friend_tags (tag_id);

CREATE INDEX idx_friends_ig_igsid ON friends (ig_igsid);

CREATE INDEX idx_friends_line_user_id ON friends (line_user_id);

CREATE INDEX idx_friends_user_id ON friends (user_id);

CREATE INDEX idx_health_logs_account ON account_health_logs (line_account_id);

CREATE INDEX idx_idempotency_expires ON booking_idempotency_keys (expires_at);

CREATE INDEX idx_line_accounts_display_order
  ON line_accounts (display_order, created_at);

CREATE INDEX idx_link_clicks_friend ON link_clicks (friend_id);

CREATE INDEX idx_link_clicks_link ON link_clicks (tracked_link_id);

CREATE INDEX idx_menus_account_sort ON menus (line_account_id, sort_order);

CREATE INDEX idx_messages_log_broadcast_id ON messages_log(broadcast_id);

CREATE INDEX idx_messages_log_created_at ON messages_log (created_at);

CREATE INDEX idx_messages_log_friend_direction_created ON messages_log (friend_id, direction, created_at);

CREATE INDEX idx_messages_log_friend_id ON messages_log (friend_id);

CREATE INDEX idx_messages_log_friend_source ON messages_log (friend_id, source);

CREATE INDEX idx_notifications_created ON notifications (created_at);

CREATE INDEX idx_notifications_status ON notifications (status);

CREATE INDEX idx_ref_tracking_friend ON ref_tracking (friend_id);

CREATE INDEX idx_ref_tracking_friend_created ON ref_tracking(friend_id, created_at);

CREATE INDEX idx_ref_tracking_ref    ON ref_tracking (ref_code);

CREATE INDEX idx_ref_tracking_ref_created ON ref_tracking(ref_code, created_at);

CREATE INDEX idx_reminder_steps_reminder ON reminder_steps (reminder_id);

CREATE INDEX idx_reminders_status_scheduled ON booking_reminders (status, scheduled_at);

CREATE INDEX idx_rich_menu_areas_page     ON rich_menu_areas(page_id);

CREATE INDEX idx_rich_menu_groups_account ON rich_menu_groups(account_id, status);

CREATE INDEX idx_rich_menu_pages_group    ON rich_menu_pages(group_id, order_index);

CREATE INDEX idx_scenario_steps_scenario_id ON scenario_steps (scenario_id);

CREATE INDEX idx_shifts_staff_date ON staff_shifts (staff_id, work_date);

CREATE INDEX idx_staff_account_sort ON staff (line_account_id, sort_order);

CREATE UNIQUE INDEX idx_staff_members_api_key ON staff_members(api_key);

CREATE INDEX idx_staff_members_role ON staff_members(role);

CREATE INDEX idx_stripe_events_friend ON stripe_events (friend_id);

CREATE INDEX idx_stripe_events_type ON stripe_events (event_type);

CREATE INDEX idx_templates_category ON templates (category);

CREATE UNIQUE INDEX idx_tracked_links_short_code
  ON tracked_links (short_code) WHERE short_code IS NOT NULL;

CREATE INDEX idx_update_history_started ON update_history(started_at DESC);

CREATE INDEX idx_users_email ON users (email);

CREATE INDEX idx_users_external_id ON users (external_id);

CREATE INDEX idx_users_phone ON users (phone);
