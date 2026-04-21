-- messages_log に source カラム追加
-- user: webhook 受信
-- broadcast: broadcast 経由 outgoing
-- scenario: scenario step 経由 outgoing
-- auto_reply: auto_reply 経由 outgoing
-- reminder: reminder 経由 outgoing
-- manual: API/UI からの手動 push（人間の返信）
-- 既存データは direction/broadcast_id/scenario_step_id/delivery_type から推定して backfill
ALTER TABLE messages_log ADD COLUMN source TEXT;

-- Backfill: 既存レコードを推定値で埋める
UPDATE messages_log SET source = 'user' WHERE direction = 'incoming';
UPDATE messages_log SET source = 'broadcast' WHERE direction = 'outgoing' AND broadcast_id IS NOT NULL;
-- broadcasts.ts の test-send は broadcast_id を NULL で記録するが、delivery_type='test' で識別できる
UPDATE messages_log SET source = 'broadcast' WHERE direction = 'outgoing' AND delivery_type = 'test' AND source IS NULL;
UPDATE messages_log SET source = 'scenario' WHERE direction = 'outgoing' AND scenario_step_id IS NOT NULL AND source IS NULL;
UPDATE messages_log SET source = 'auto_reply' WHERE direction = 'outgoing' AND delivery_type = 'reply' AND source IS NULL;
-- 残った NULL は manual と reminder の区別不可、manual に倒す（放置救済の判定で多少の誤検知リスクあるが、既存データだけ）
UPDATE messages_log SET source = 'manual' WHERE source IS NULL AND direction = 'outgoing';

CREATE INDEX IF NOT EXISTS idx_messages_log_friend_source ON messages_log (friend_id, source);
CREATE INDEX IF NOT EXISTS idx_messages_log_friend_direction_created ON messages_log (friend_id, direction, created_at);
