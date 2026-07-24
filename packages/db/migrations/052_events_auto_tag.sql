-- 052_events_auto_tag.sql
-- events に「予約申込時に friend に自動付与するタグ」を追加。null なら付与なし。

ALTER TABLE events ADD COLUMN auto_tag_id TEXT REFERENCES tags(id) ON DELETE SET NULL;
