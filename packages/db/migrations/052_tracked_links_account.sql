-- 052_tracked_links_account.sql
-- L-TRACK 互換: multi-account 境界
-- tracked_links に line_account_id を追加。skip_liff モードの時間窓マッチングで
-- 別アカウントのクリックに friend を紐付けないよう、tracked_link 単位でアカウント境界を保つ。
-- NULL は「アカウント未指定（後方互換）」を意味し、既存リンクが壊れないようにする。

ALTER TABLE tracked_links ADD COLUMN line_account_id TEXT REFERENCES line_accounts (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tracked_links_line_account ON tracked_links (line_account_id) WHERE line_account_id IS NOT NULL;
