-- LINE の rich menu 作成時に、トークを開いた直後からメニューを展開するかを保持する。
-- 既存メニューは従来動作 (false) を維持する。
ALTER TABLE rich_menu_groups ADD COLUMN selected INTEGER NOT NULL DEFAULT 0;
