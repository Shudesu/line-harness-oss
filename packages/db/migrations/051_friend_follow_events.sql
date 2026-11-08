-- 友だち追加（ブロック解除を含む）・ブロックの日時の記録（KIDOUインターンの「数字」タブ用）
-- friends には is_following しか残らず、いつブロックしたかが分からないため。
-- Worker が使うときに無ければ同じ表を作る（services/intern-stats.ts）ので、本番に手で流さなくても動く。
CREATE TABLE IF NOT EXISTS friend_follow_events (
  id              TEXT PRIMARY KEY,
  friend_id       TEXT NOT NULL,
  line_account_id TEXT,
  event           TEXT NOT NULL CHECK (event IN ('follow', 'unfollow')),
  occurred_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_friend_follow_events_account ON friend_follow_events (line_account_id, event, occurred_at);
CREATE INDEX IF NOT EXISTS idx_friend_follow_events_friend ON friend_follow_events (friend_id, event);
