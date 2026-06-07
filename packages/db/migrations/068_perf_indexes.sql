-- Phase: パフォーマンス P1 修正 - 必須 INDEX 追加
--
-- 背景: dashboard-stats / friends 一覧 / reports-analytics / friends-export 等で
-- seq scan が発生していた。50万行規模で 30s wall を超える事象が観測されたため、
-- ホットパスに対応する複合 INDEX を一括で導入する。
--
-- いずれも IF NOT EXISTS なので冪等。

-- friends 一覧 + アカウント別ソート
CREATE INDEX IF NOT EXISTS idx_friends_account_created
  ON friends (line_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_friends_account_following
  ON friends (line_account_id, is_following, created_at DESC);

-- messages_log の日付範囲集計 (dashboard-stats / reports-analytics 用)
CREATE INDEX IF NOT EXISTS idx_messages_log_direction_created
  ON messages_log (direction, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_log_account_created
  ON messages_log (line_account_id, created_at);

-- link_clicks 最新クリック取得 (friends-export 相関サブクエリ用)
CREATE INDEX IF NOT EXISTS idx_link_clicks_friend_clicked
  ON link_clicks (friend_id, clicked_at DESC);
CREATE INDEX IF NOT EXISTS idx_ref_tracking_friend_created
  ON ref_tracking (friend_id, created_at DESC);

-- friend_tags の assigned_at (reports-analytics/by-tag 用)
CREATE INDEX IF NOT EXISTS idx_friend_tags_assigned_at
  ON friend_tags (assigned_at);

-- scenarios の trigger フィルタ (webhook follow フロー)
CREATE INDEX IF NOT EXISTS idx_scenarios_trigger_active_account
  ON scenarios (trigger_type, is_active, line_account_id);

-- chats の最新ステータス取得用 (friends 詳細の相関サブクエリ)
CREATE INDEX IF NOT EXISTS idx_chats_friend_created
  ON chats (friend_id, created_at DESC);

-- broadcasts の cron 走査用
CREATE INDEX IF NOT EXISTS idx_broadcasts_status_sent_at
  ON broadcasts (status, sent_at)
  WHERE status IN ('sending', 'scheduled');

-- stripe_purchases 集計
CREATE INDEX IF NOT EXISTS idx_stripe_purchases_friend_purchased
  ON stripe_purchases (friend_id, purchased_at DESC);
