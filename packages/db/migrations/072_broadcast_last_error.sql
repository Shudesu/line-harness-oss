-- Migration 072: LINE プランクォータ監視 + 配信失敗理由の記録
--
-- 2026-09-01 の一斉配信事故 (2アカウントがクォータ不足で全滅・どこにも
-- 表示されず誰も気づけなかった) への恒久対応。cron 監視 (ban-monitor) と
-- 送信前ガード (services/broadcast.ts) がクォータ不足を検知し、
-- notifications へ記録 + outgoing webhook で通知する。
-- 071 (line_account_id 列の追加) の後に適用されること — 下のインデックスが
-- その列を参照する。

-- broadcasts.last_error: 直近の送信失敗理由 (クォータ不足ガード等)。
-- 送信開始・送信成功で NULL に戻る。
ALTER TABLE broadcasts ADD COLUMN last_error TEXT;

CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications (status);
CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at);
-- クォータ通知の月次 dedup 判定 (event_type + line_account_id + created_at) 用
CREATE INDEX IF NOT EXISTS idx_notifications_event_account ON notifications (event_type, line_account_id, created_at);
