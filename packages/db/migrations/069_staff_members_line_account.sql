-- 069_staff_members_line_account.sql
--
-- 目的: マルチテナント PII 漏洩リスクの根本解消。
--
-- 背景:
-- ios-notifier.ts の getDeviceTokensForAccount(db, lineAccountId) が
-- void lineAccountId で全テナント iOS token に fan-out する設計欠陥があった。
-- 顧問先 staff トークンが登録されると、別 LINE アカウントの友だち追加通知が
-- 全社に漏れる致命的な PII 漏洩経路。
--
-- 対応: staff_members に line_account_id を追加。NULL = 全アカウント受信 (owner 想定)、
-- 値あり = その line_account_id 配下のイベントのみ受信。
-- ios-notifier.ts は JOIN で絞り込み、APNS_ENABLED gate を安全に解除可能になる。
--
-- 既存データ: hyhome は当面シングルアカウント運用のため、NULL のままで挙動互換。
-- 顧問先追加時に該当 staff の line_account_id を埋めて隔離する。

ALTER TABLE staff_members ADD COLUMN line_account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_staff_members_line_account
  ON staff_members (line_account_id);
