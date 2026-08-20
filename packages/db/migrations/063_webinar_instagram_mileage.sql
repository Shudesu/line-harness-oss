-- 063_webinar_instagram_mileage.sql
-- Project webinar and linked Instagram engagement into Harness mileage.
-- Existing webinar activity and completed IG->LINE links are backfilled once.

INSERT OR IGNORE INTO mileage_rules
  (id, program_id, name, event_type, source, amount, initial_status,
   conditions, is_active, created_at, updated_at)
VALUES
  ('builtin-webinar-watch-5m', 'default', 'ウェビナー5分視聴',
   'webinar_watch_5m', 'webinar', 5, 'available',
   '{"uniquePerSubject":true}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('builtin-webinar-watch-15m', 'default', 'ウェビナー15分視聴',
   'webinar_watch_15m', 'webinar', 10, 'available',
   '{"uniquePerSubject":true}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('builtin-webinar-completed', 'default', 'ウェビナー90%視聴完了',
   'webinar_completed', 'webinar', 30, 'available',
   '{"uniquePerSubject":true}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('builtin-webinar-cta-clicked', 'default', 'ウェビナーCTAクリック',
   'webinar_cta_clicked', 'webinar', 10, 'available',
   '{"uniquePerSubject":true}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('builtin-instagram-dm-received', 'default', 'Instagram DM',
   'instagram_dm_received', 'instagram', 2, 'available',
   '{"dailyCapActions":5}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('builtin-instagram-comment-created', 'default', 'Instagramコメント',
   'instagram_comment_created', 'instagram', 3, 'available',
   '{"dailyCapActions":5}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('builtin-instagram-story-mentioned', 'default', 'Instagramストーリーズメンション',
   'instagram_story_mentioned', 'instagram', 5, 'available',
   '{"dailyCapActions":3}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('builtin-instagram-line-returned', 'default', 'InstagramからLINEへ帰還',
   'instagram_line_returned', 'instagram', 15, 'available',
   '{"uniquePerSubject":true}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'));

-- One historic event/grant per canonical identity and webinar milestone.
-- A viewer can attend multiple sessions, but mileage rewards commitment to the
-- webinar itself and therefore uses the earliest qualifying session only.
WITH qualifying AS (
  SELECT v.*, f.user_id, w.duration_seconds,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE('user:' || f.user_id, 'friend:' || v.friend_id), v.webinar_id
           ORDER BY v.joined_at, v.id
         ) AS identity_rank
    FROM webinar_viewers v
    JOIN friends f ON f.id = v.friend_id
    JOIN webinars w ON w.id = v.webinar_id
   WHERE v.last_position_seconds >= 300
)
INSERT OR IGNORE INTO engagement_events
  (id, program_id, idempotency_key, event_type, source, source_event_id,
   actor_user_id, actor_friend_id, metadata, occurred_at, created_at)
SELECT 'history-webinar-5m-' || id, 'default', 'history:webinar:5m:' || id,
       'webinar_watch_5m', 'webinar', webinar_id || ':' || friend_id || ':5m',
       user_id, friend_id,
       json_object('webinarId', webinar_id, 'positionSeconds', last_position_seconds, 'backfilled', 1),
       datetime(joined_at, '+300 seconds'), datetime(joined_at, '+300 seconds')
  FROM qualifying WHERE identity_rank = 1;

INSERT OR IGNORE INTO mileage_ledger
  (id, program_id, beneficiary_user_id, beneficiary_friend_id,
   engagement_event_id, mileage_rule_id, entry_type, status, amount, reason,
   source, source_event_id, idempotency_key, metadata, occurred_at, created_at)
SELECT 'history-mile-webinar-5m-' || ee.id, 'default', ee.actor_user_id, ee.actor_friend_id,
       ee.id, 'builtin-webinar-watch-5m', 'grant', 'available', 5,
       'ウェビナー5分視聴', 'webinar', ee.source_event_id,
       'history-mile:webinar:5m:' || ee.id, '{"backfilled":true}', ee.occurred_at, ee.created_at
  FROM engagement_events ee
 WHERE ee.id LIKE 'history-webinar-5m-%';

WITH qualifying AS (
  SELECT v.*, f.user_id,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE('user:' || f.user_id, 'friend:' || v.friend_id), v.webinar_id
           ORDER BY v.joined_at, v.id
         ) AS identity_rank
    FROM webinar_viewers v
    JOIN friends f ON f.id = v.friend_id
   WHERE v.last_position_seconds >= 900
)
INSERT OR IGNORE INTO engagement_events
  (id, program_id, idempotency_key, event_type, source, source_event_id,
   actor_user_id, actor_friend_id, metadata, occurred_at, created_at)
SELECT 'history-webinar-15m-' || id, 'default', 'history:webinar:15m:' || id,
       'webinar_watch_15m', 'webinar', webinar_id || ':' || friend_id || ':15m',
       user_id, friend_id,
       json_object('webinarId', webinar_id, 'positionSeconds', last_position_seconds, 'backfilled', 1),
       datetime(joined_at, '+900 seconds'), datetime(joined_at, '+900 seconds')
  FROM qualifying WHERE identity_rank = 1;

INSERT OR IGNORE INTO mileage_ledger
  (id, program_id, beneficiary_user_id, beneficiary_friend_id,
   engagement_event_id, mileage_rule_id, entry_type, status, amount, reason,
   source, source_event_id, idempotency_key, metadata, occurred_at, created_at)
SELECT 'history-mile-webinar-15m-' || ee.id, 'default', ee.actor_user_id, ee.actor_friend_id,
       ee.id, 'builtin-webinar-watch-15m', 'grant', 'available', 10,
       'ウェビナー15分視聴', 'webinar', ee.source_event_id,
       'history-mile:webinar:15m:' || ee.id, '{"backfilled":true}', ee.occurred_at, ee.created_at
  FROM engagement_events ee
 WHERE ee.id LIKE 'history-webinar-15m-%';

WITH qualifying AS (
  SELECT v.*, f.user_id, w.duration_seconds,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE('user:' || f.user_id, 'friend:' || v.friend_id), v.webinar_id
           ORDER BY v.joined_at, v.id
         ) AS identity_rank
    FROM webinar_viewers v
    JOIN friends f ON f.id = v.friend_id
    JOIN webinars w ON w.id = v.webinar_id
   WHERE w.duration_seconds > 0
     AND v.last_position_seconds >= CAST(w.duration_seconds * 0.9 AS INTEGER)
)
INSERT OR IGNORE INTO engagement_events
  (id, program_id, idempotency_key, event_type, source, source_event_id,
   actor_user_id, actor_friend_id, metadata, occurred_at, created_at)
SELECT 'history-webinar-complete-' || id, 'default', 'history:webinar:complete:' || id,
       'webinar_completed', 'webinar', webinar_id || ':' || friend_id || ':complete',
       user_id, friend_id,
       json_object('webinarId', webinar_id, 'positionSeconds', last_position_seconds,
                   'durationSeconds', duration_seconds, 'completionThreshold', 0.9, 'backfilled', 1),
       datetime(joined_at, '+' || CAST(duration_seconds * 0.9 AS INTEGER) || ' seconds'),
       datetime(joined_at, '+' || CAST(duration_seconds * 0.9 AS INTEGER) || ' seconds')
  FROM qualifying WHERE identity_rank = 1;

INSERT OR IGNORE INTO mileage_ledger
  (id, program_id, beneficiary_user_id, beneficiary_friend_id,
   engagement_event_id, mileage_rule_id, entry_type, status, amount, reason,
   source, source_event_id, idempotency_key, metadata, occurred_at, created_at)
SELECT 'history-mile-webinar-complete-' || ee.id, 'default', ee.actor_user_id, ee.actor_friend_id,
       ee.id, 'builtin-webinar-completed', 'grant', 'available', 30,
       'ウェビナー90%視聴完了', 'webinar', ee.source_event_id,
       'history-mile:webinar:complete:' || ee.id, '{"backfilled":true}', ee.occurred_at, ee.created_at
  FROM engagement_events ee
 WHERE ee.id LIKE 'history-webinar-complete-%';

WITH qualifying AS (
  SELECT v.*, f.user_id,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE('user:' || f.user_id, 'friend:' || v.friend_id), v.webinar_id
           ORDER BY v.cta_clicked_at, v.id
         ) AS identity_rank
    FROM webinar_viewers v
    JOIN friends f ON f.id = v.friend_id
   WHERE v.cta_clicked_at IS NOT NULL
)
INSERT OR IGNORE INTO engagement_events
  (id, program_id, idempotency_key, event_type, source, source_event_id,
   actor_user_id, actor_friend_id, metadata, occurred_at, created_at)
SELECT 'history-webinar-cta-' || id, 'default', 'history:webinar:cta:' || id,
       'webinar_cta_clicked', 'webinar', webinar_id || ':' || friend_id || ':primary',
       user_id, friend_id,
       json_object('webinarId', webinar_id, 'ctaId', 'primary', 'backfilled', 1),
       cta_clicked_at, cta_clicked_at
  FROM qualifying WHERE identity_rank = 1;

INSERT OR IGNORE INTO mileage_ledger
  (id, program_id, beneficiary_user_id, beneficiary_friend_id,
   engagement_event_id, mileage_rule_id, entry_type, status, amount, reason,
   source, source_event_id, idempotency_key, metadata, occurred_at, created_at)
SELECT 'history-mile-webinar-cta-' || ee.id, 'default', ee.actor_user_id, ee.actor_friend_id,
       ee.id, 'builtin-webinar-cta-clicked', 'grant', 'available', 10,
       'ウェビナーCTAクリック', 'webinar', ee.source_event_id,
       'history-mile:webinar:cta:' || ee.id, '{"backfilled":true}', ee.occurred_at, ee.created_at
  FROM engagement_events ee
 WHERE ee.id LIKE 'history-webinar-cta-%';

-- Existing completed IG -> LINE identity links. First matching friend per
-- canonical identity/IGSID receives the historic return grant.
WITH linked AS (
  SELECT f.*,
         ROW_NUMBER() OVER (
           PARTITION BY COALESCE('user:' || f.user_id, 'friend:' || f.id), f.ig_igsid
           ORDER BY f.created_at, f.id
         ) AS identity_rank
    FROM friends f
   WHERE f.ig_igsid IS NOT NULL AND f.ig_igsid <> ''
)
INSERT OR IGNORE INTO engagement_events
  (id, program_id, idempotency_key, event_type, source, source_event_id,
   actor_user_id, actor_friend_id, identity_provider, identity_subject,
   metadata, occurred_at, created_at)
SELECT 'history-instagram-return-' || id, 'default', 'history:instagram:return:' || id,
       'instagram_line_returned', 'instagram', id || ':' || ig_igsid,
       user_id, id, 'instagram', ig_igsid,
       json_object('igsid', ig_igsid, 'backfilled', 1), created_at, created_at
  FROM linked WHERE identity_rank = 1;

INSERT OR IGNORE INTO mileage_ledger
  (id, program_id, beneficiary_user_id, beneficiary_friend_id,
   engagement_event_id, mileage_rule_id, entry_type, status, amount, reason,
   source, source_event_id, idempotency_key, metadata, occurred_at, created_at)
SELECT 'history-mile-instagram-return-' || ee.id, 'default', ee.actor_user_id, ee.actor_friend_id,
       ee.id, 'builtin-instagram-line-returned', 'grant', 'available', 15,
       'InstagramからLINEへ帰還', 'instagram', ee.source_event_id,
       'history-mile:instagram:return:' || ee.id, '{"backfilled":true}', ee.occurred_at, ee.created_at
  FROM engagement_events ee
 WHERE ee.id LIKE 'history-instagram-return-%';
