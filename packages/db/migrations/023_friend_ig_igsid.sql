-- IG cross-platform UUID linkage with Instagram Harness
-- friends.ig_igsid stores the Instagram-Scoped User ID of the corresponding
-- IG follower. Set when a tracked link click carries `?ig=<IGSID>`.

ALTER TABLE friends ADD COLUMN ig_igsid TEXT;
CREATE INDEX IF NOT EXISTS idx_friends_ig_igsid ON friends (ig_igsid);
