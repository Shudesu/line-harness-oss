-- 074_friends_legacy_null_unique.sql
--
-- 目的: 070 で導入した UNIQUE (line_user_id, line_account_id) は
--       SQLite の NULLs distinct 仕様により、`(U, NULL)` を複数行 INSERT
--       させてしまう。legacy NULL line_account_id の friends で
--       line_user_id 単位の一意性を担保するための partial UNIQUE INDEX を
--       後追いで張る。
--
-- 背景: 本来は 070 の table rebuild 直後に張りたかったが、070 をすでに
--       適用した dev/staging/prod の D1 環境には migration ファイル編集が
--       届かないため、別 migration として独立させた。新規環境は 070→071
--       の順に流れるので追加 cost なし。
--
-- 注意: 既存データに `(同じ line_user_id, NULL)` のペアが複数行ある場合
--       本 INDEX 作成は失敗する。070 を経由した健全な環境では
--       旧 `line_user_id UNIQUE` のおかげで重複は無いはずだが、適用前に
--       SELECT line_user_id, COUNT(*) FROM friends
--         WHERE line_account_id IS NULL
--        GROUP BY line_user_id HAVING COUNT(*) > 1;
--       で確認推奨。

CREATE UNIQUE INDEX IF NOT EXISTS idx_friends_line_user_id_legacy_unique
  ON friends (line_user_id)
  WHERE line_account_id IS NULL;
