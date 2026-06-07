-- P1 修正 (2026-06-07): stripe_subscriptions の monotonic guard 列
--
-- 問題: Stripe webhook の subscription.updated と subscription.created が
--   ネットワーク経路や retry の都合で re-order されると、新しい (updated) が
--   先に DB に書かれ、後から到着した古い (created) が上書きしてしまう。
--   結果: status / current_period_end など最新状態が古い値に巻き戻る。
--
-- 対策: last_event_at TEXT 列を追加。upsert 時に
--   `WHERE id = ? AND (last_event_at IS NULL OR last_event_at < ?)`
-- の monotonic check で古いイベントを silently no-op する。
-- bind 値は Stripe event.created (unix 秒) を ISO 化したもの。

ALTER TABLE stripe_subscriptions ADD COLUMN last_event_at TEXT;
