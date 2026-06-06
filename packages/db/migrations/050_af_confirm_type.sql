-- 050_af_confirm_type.sql
-- L-TRACK 互換: AF確定条件
-- 'immediate'（即時）/ '1h'（1時間後） / '3h'（3時間後） / '24h'（24時間後）
-- 友だち追加 → 指定時間経過後にCV確定 → 広告媒体へポストバック
-- L-TRACK 仕様では登録後変更不可だが、harness は柔軟性のため変更可能にする。
-- cron で時間経過後の確定処理を行う（実装は別ファイル）。

-- 注意: SQLite の ALTER TABLE は CHECK 制約を追加できないため、
-- validation は app 層（routes/tracked-links.ts の POST/PATCH）で行う。
-- 許可値: 'immediate' | '1h' | '3h' | '24h'
ALTER TABLE tracked_links ADD COLUMN af_confirm_type TEXT NOT NULL DEFAULT 'immediate';

CREATE INDEX IF NOT EXISTS idx_tracked_links_af_confirm ON tracked_links (af_confirm_type);
