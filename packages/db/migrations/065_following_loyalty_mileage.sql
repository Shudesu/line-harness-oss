-- 065_following_loyalty_mileage.sql
-- Reward the relationship itself: registration and uninterrupted follow tenure.
-- Historical LINE block/unblock timestamps were not stored, so currently
-- following legacy rows start from created_at without guessing a penalty.

ALTER TABLE friends ADD COLUMN first_followed_at TEXT;
ALTER TABLE friends ADD COLUMN current_follow_started_at TEXT;
ALTER TABLE friends ADD COLUMN last_followed_at TEXT;
ALTER TABLE friends ADD COLUMN last_unfollowed_at TEXT;
ALTER TABLE friends ADD COLUMN unfollow_count INTEGER NOT NULL DEFAULT 0;

UPDATE friends
   SET first_followed_at = COALESCE(first_followed_at, created_at),
       current_follow_started_at = CASE
         WHEN is_following = 1 THEN COALESCE(current_follow_started_at, created_at)
         ELSE NULL
       END,
       last_followed_at = COALESCE(last_followed_at, created_at),
       last_unfollowed_at = CASE
         WHEN is_following = 0 THEN COALESCE(last_unfollowed_at, updated_at)
         ELSE last_unfollowed_at
       END,
       unfollow_count = CASE
         WHEN is_following = 0 AND unfollow_count = 0 THEN 1
         ELSE unfollow_count
       END;

CREATE INDEX IF NOT EXISTS idx_friends_follow_tenure
  ON friends(is_following, current_follow_started_at);

INSERT OR IGNORE INTO mileage_rules
  (id, program_id, name, event_type, source, amount, initial_status,
   conditions, is_active, created_at, updated_at)
VALUES
  ('builtin-friend-registered', 'default', '友だち登録', 'friend_registered', 'line_relationship', 5,
   'available', '{"ignoreMultiplier":true}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('builtin-following-7d', 'default', '継続フォロー7日', 'friend_following_7d', 'line_relationship', 10,
   'available', '{"ignoreMultiplier":true}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('builtin-following-30d', 'default', '継続フォロー30日', 'friend_following_30d', 'line_relationship', 20,
   'available', '{"ignoreMultiplier":true}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('builtin-following-90d', 'default', '継続フォロー90日', 'friend_following_90d', 'line_relationship', 50,
   'available', '{"ignoreMultiplier":true}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('builtin-following-180d', 'default', '継続フォロー180日', 'friend_following_180d', 'line_relationship', 100,
   'available', '{"ignoreMultiplier":true}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ('builtin-following-365d', 'default', '継続フォロー1年', 'friend_following_365d', 'line_relationship', 200,
   'available', '{"ignoreMultiplier":true}', 1,
   strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'), strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'));
