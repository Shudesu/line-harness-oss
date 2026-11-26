-- 毎分ジョブ (シナリオ配信) が期限到来分だけを索引で引けるようにする。
-- getFriendScenariosDueForDelivery は next_delivery_at を julianday() で比較する
-- (Z / +09:00 混在の時刻表記を同じ時刻軸で比べるため)。この式インデックスが
-- 無いと、active な friend_scenarios を毎分全件読むことになる。
-- julianday(<列>) は 'now' を含まないので決定的で、式インデックスに使える。
-- (status, ...) の複合にしているのは、既存の idx_friend_scenarios_status より
-- 確実に優先させるため (status 等価 + 期限の範囲で絞れる)。
CREATE INDEX IF NOT EXISTS idx_friend_scenarios_due_epoch
  ON friend_scenarios (status, julianday(next_delivery_at));
