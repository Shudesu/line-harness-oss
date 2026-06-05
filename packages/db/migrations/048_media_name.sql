-- 048_media_name.sql
-- L-TRACK 互換: メディア概念（媒体管理グループ）
-- 例: 'Meta', 'Google', 'TikTok', 'X', 'Instagram' など、トラックの所属媒体を識別。
-- L-TRACK のメディア機能のシンプル実装（別テーブルにせず、文字列カラムで持つ）。
-- L-TRACK レベルの厳密な管理が必要になったら別テーブル化する。

ALTER TABLE tracked_links ADD COLUMN media_name TEXT;

CREATE INDEX IF NOT EXISTS idx_tracked_links_media ON tracked_links (media_name) WHERE media_name IS NOT NULL;
