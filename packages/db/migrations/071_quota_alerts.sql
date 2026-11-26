-- Migration 071: notifications / notification_rules に line_account_id 列を追加
-- (072 のクォータ通知が使う。072_broadcast_last_error.sql とセットで
--  2026-09-01 の一斉配信事故への恒久対応)
--
-- 両テーブルの line_account_id は本番 DB には out-of-band で追加済みだが
-- migration 履歴には存在しない (002 の CREATE には無い)。この migration は
-- 「列が無い環境 (OSS の既存インストール等)」に列を足すためのもの。
--
-- ⚠️ 本番 (private prod) では列が既に存在するため、この ADD COLUMN は
-- duplicate column エラーになる。CI (deploy-worker.yml) はファイル単位で
-- 適用するので、本番の _migrations には本ファイルを適用済みとして事前マーク
-- してある (INSERT INTO _migrations — 2026-09-02 実施)。update-engine
-- (OSS セルフアップデート) はステートメント単位で適用し duplicate column を
-- benign skip するため対処不要。
--
-- 当初案はテーブル再構築 (RENAME ベース) で JST デフォルトや status CHECK ごと
-- 両環境を揃えるものだったが、update-engine の安全スプリッタが RENAME TO /
-- DROP TABLE を拒否するため (packages/update-engine/src/migrations.ts)、その形は
-- OSS セルフアップデートを適用不能にする。additive-only ポリシー
-- (scripts/check-migrations.ts, カットオフ 041) にも反する。スキーマの正規形は
-- 新規環境の bootstrap.sql / schema.sql 側で担保し、既存環境は列追加のみに
-- 留める (コードは常に値を明示 bind するためデフォルト差異の影響は無い。
-- notifications.status の CHECK は 002 時点から pending/sent/failed で同一)。

ALTER TABLE notifications ADD COLUMN line_account_id TEXT;
ALTER TABLE notification_rules ADD COLUMN line_account_id TEXT;
