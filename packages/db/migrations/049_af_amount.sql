-- 049_af_amount.sql
-- L-TRACK 互換: AF単価（円・固定額）
-- affiliates.commission_rate は率（0.0-1.0）だが、
-- L-TRACK は固定額（例: 1000円/CV）の運用が多いため、tracked_links に直接持つ。
-- 友だち追加確定時のレポート計算に使う。

ALTER TABLE tracked_links ADD COLUMN af_amount INTEGER;
