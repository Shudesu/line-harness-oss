-- 062_mileage_admin_and_activity_rules.sql
-- Promote the unused lead-scoring surface into configurable Harness mileage.
-- Existing actions are projected once with deterministic IDs so replay is safe.

ALTER TABLE mileage_ledger
  ADD COLUMN mileage_rule_id TEXT REFERENCES mileage_rules(id);

CREATE INDEX IF NOT EXISTS idx_mileage_ledger_rule
  ON mileage_ledger(program_id, mileage_rule_id, occurred_at DESC);

INSERT OR IGNORE INTO mileage_rules
  (id, program_id, name, event_type, source, amount, initial_status,
   conditions, is_active, created_at, updated_at)
VALUES
  ('builtin-message-received', 'default', 'メッセージ送信', 'message_received', 'line', 1,
   'available', '{"dailyCapActions":5}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('builtin-link-clicked', 'default', 'リンククリック', 'link_clicked', 'tracked_link', 2,
   'available', '{"dailyCapActions":5,"uniquePerSubjectPerDay":true}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('builtin-form-submitted', 'default', 'フォーム送信', 'form_submitted', 'form', 10,
   'available', '{"uniquePerSubject":true}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('builtin-booking-created', 'default', '予約', 'booking_created', NULL, 20,
   'available', NULL, 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'));

-- Incoming LINE messages. All actions are retained for activity analytics;
-- mileage grants are capped at the first five per identity per calendar day.
INSERT OR IGNORE INTO engagement_events
  (id, program_id, idempotency_key, event_type, source, source_event_id,
   actor_user_id, actor_friend_id, metadata, occurred_at, created_at)
SELECT 'history-message-' || ml.id, 'default', 'history:message:' || ml.id,
       'message_received', 'line', ml.id, f.user_id, ml.friend_id,
       json_object('messageType', ml.message_type, 'backfilled', 1),
       ml.created_at, ml.created_at
  FROM messages_log ml
  JOIN friends f ON f.id = ml.friend_id
 WHERE ml.direction = 'incoming';

WITH ranked_messages AS (
  SELECT ml.id, ml.friend_id, f.user_id, ml.created_at,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE('user:' || f.user_id, 'friend:' || ml.friend_id),
                        substr(ml.created_at, 1, 10)
           ORDER BY ml.created_at, ml.id
         ) AS daily_rank
    FROM messages_log ml
    JOIN friends f ON f.id = ml.friend_id
   WHERE ml.direction = 'incoming'
)
INSERT OR IGNORE INTO mileage_ledger
  (id, program_id, beneficiary_user_id, beneficiary_friend_id,
   engagement_event_id, mileage_rule_id, entry_type, status, amount, reason,
   source, source_event_id, idempotency_key, metadata, occurred_at, created_at)
SELECT 'history-mile-message-' || id, 'default', user_id, friend_id,
       'history-message-' || id, 'builtin-message-received', 'grant', 'available', 1,
       'メッセージ送信', 'line', id, 'history-mile:message:' || id,
       '{"backfilled":true}', created_at, created_at
  FROM ranked_messages
 WHERE daily_rank <= 5;

-- Tracked-link clicks. Anonymous clicks remain analytics-only. Identified clicks
-- award once per link/day, up to five distinct links per identity/day.
INSERT OR IGNORE INTO engagement_events
  (id, program_id, idempotency_key, event_type, source, source_event_id,
   actor_user_id, actor_friend_id, metadata, occurred_at, created_at)
SELECT 'history-link-' || lc.id, 'default', 'history:link:' || lc.id,
       'link_clicked', 'tracked_link', lc.id, f.user_id, lc.friend_id,
       json_object('trackedLinkId', lc.tracked_link_id, 'backfilled', 1),
       lc.clicked_at, lc.clicked_at
  FROM link_clicks lc
  LEFT JOIN friends f ON f.id = lc.friend_id;

WITH deduped_links AS (
  SELECT lc.id, lc.tracked_link_id, lc.friend_id, f.user_id, lc.clicked_at,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE('user:' || f.user_id, 'friend:' || lc.friend_id),
                        lc.tracked_link_id, substr(lc.clicked_at, 1, 10)
           ORDER BY lc.clicked_at, lc.id
         ) AS same_link_rank
    FROM link_clicks lc
    JOIN friends f ON f.id = lc.friend_id
),
ranked_links AS (
  SELECT *,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE('user:' || user_id, 'friend:' || friend_id),
                        substr(clicked_at, 1, 10)
           ORDER BY clicked_at, id
         ) AS daily_rank
    FROM deduped_links
   WHERE same_link_rank = 1
)
INSERT OR IGNORE INTO mileage_ledger
  (id, program_id, beneficiary_user_id, beneficiary_friend_id,
   engagement_event_id, mileage_rule_id, entry_type, status, amount, reason,
   source, source_event_id, idempotency_key, metadata, occurred_at, created_at)
SELECT 'history-mile-link-' || id, 'default', user_id, friend_id,
       'history-link-' || id, 'builtin-link-clicked', 'grant', 'available', 2,
       'リンククリック', 'tracked_link', id, 'history-mile:link:' || id,
       json_object('trackedLinkId', tracked_link_id, 'backfilled', 1), clicked_at, clicked_at
  FROM ranked_links
 WHERE daily_rank <= 5;

-- Forms award once per form and identity, even if a user resubmits.
INSERT OR IGNORE INTO engagement_events
  (id, program_id, idempotency_key, event_type, source, source_event_id,
   actor_user_id, actor_friend_id, metadata, occurred_at, created_at)
SELECT 'history-form-' || fs.id, 'default', 'history:form:' || fs.id,
       'form_submitted', 'form', fs.id, f.user_id, fs.friend_id,
       json_object('formId', fs.form_id, 'subjectKey', fs.form_id, 'backfilled', 1),
       fs.created_at, fs.created_at
  FROM form_submissions fs
  LEFT JOIN friends f ON f.id = fs.friend_id;

WITH ranked_forms AS (
  SELECT fs.id, fs.form_id, fs.friend_id, f.user_id, fs.created_at,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE('user:' || f.user_id, 'friend:' || fs.friend_id), fs.form_id
           ORDER BY fs.created_at, fs.id
         ) AS subject_rank
    FROM form_submissions fs
    JOIN friends f ON f.id = fs.friend_id
)
INSERT OR IGNORE INTO mileage_ledger
  (id, program_id, beneficiary_user_id, beneficiary_friend_id,
   engagement_event_id, mileage_rule_id, entry_type, status, amount, reason,
   source, source_event_id, idempotency_key, metadata, occurred_at, created_at)
SELECT 'history-mile-form-' || id, 'default', user_id, friend_id,
       'history-form-' || id, 'builtin-form-submitted', 'grant', 'available', 10,
       'フォーム送信', 'form', id,
       'history-mile:form:' || COALESCE('user:' || user_id, 'friend:' || friend_id) || ':' || form_id,
       json_object('formId', form_id, 'subjectKey', form_id, 'backfilled', 1), created_at, created_at
  FROM ranked_forms
 WHERE subject_rank = 1;

-- Salon and event reservations share one rule and remain separately auditable.
INSERT OR IGNORE INTO engagement_events
  (id, program_id, idempotency_key, event_type, source, source_event_id,
   actor_user_id, actor_friend_id, metadata, occurred_at, created_at)
SELECT 'history-booking-' || b.id, 'default', 'history:booking:' || b.id,
       'booking_created', 'booking', b.id, f.user_id, b.friend_id,
       json_object('bookingType', 'salon', 'backfilled', 1), b.created_at, b.created_at
  FROM bookings b
  JOIN friends f ON f.id = b.friend_id
 WHERE b.status IN ('requested', 'confirmed', 'completed');

INSERT OR IGNORE INTO mileage_ledger
  (id, program_id, beneficiary_user_id, beneficiary_friend_id,
   engagement_event_id, mileage_rule_id, entry_type, status, amount, reason,
   source, source_event_id, idempotency_key, metadata, occurred_at, created_at)
SELECT 'history-mile-booking-' || b.id, 'default', f.user_id, b.friend_id,
       'history-booking-' || b.id, 'builtin-booking-created', 'grant', 'available', 20,
       '予約', 'booking', b.id, 'history-mile:booking:' || b.id,
       '{"bookingType":"salon","backfilled":true}', b.created_at, b.created_at
  FROM bookings b
  JOIN friends f ON f.id = b.friend_id
 WHERE b.status IN ('requested', 'confirmed', 'completed');

INSERT OR IGNORE INTO engagement_events
  (id, program_id, idempotency_key, event_type, source, source_event_id,
   actor_user_id, actor_friend_id, metadata, occurred_at, created_at)
SELECT 'history-event-booking-' || b.id, 'default', 'history:event-booking:' || b.id,
       'booking_created', 'event_booking', b.id, f.user_id, b.friend_id,
       json_object('bookingType', 'event', 'eventId', b.event_id, 'backfilled', 1),
       b.created_at, b.created_at
  FROM event_bookings b
  JOIN friends f ON f.id = b.friend_id
 WHERE b.status IN ('requested', 'confirmed', 'attended');

INSERT OR IGNORE INTO mileage_ledger
  (id, program_id, beneficiary_user_id, beneficiary_friend_id,
   engagement_event_id, mileage_rule_id, entry_type, status, amount, reason,
   source, source_event_id, idempotency_key, metadata, occurred_at, created_at)
SELECT 'history-mile-event-booking-' || b.id, 'default', f.user_id, b.friend_id,
       'history-event-booking-' || b.id, 'builtin-booking-created', 'grant', 'available', 20,
       'イベント予約', 'event_booking', b.id, 'history-mile:event-booking:' || b.id,
       json_object('bookingType', 'event', 'eventId', b.event_id, 'backfilled', 1),
       b.created_at, b.created_at
  FROM event_bookings b
  JOIN friends f ON f.id = b.friend_id
 WHERE b.status IN ('requested', 'confirmed', 'attended');
