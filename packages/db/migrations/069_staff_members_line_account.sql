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
-- 対応: staff_members に line_account_id を追加。
-- **Round3 仕様変更**: NULL の扱いをリスク回避のため反転する。
--   旧: NULL = 全アカウント受信 (owner 想定)
--   新: NULL = どのアカウントにも紐づかない = 受信しない（安全側にフェイル）
--       明示的に line_account_id を設定したスタッフだけが該当アカウントの通知を受け取る。
-- ios-notifier.ts の JOIN は line_account_id = ? のみで絞り込み、NULL は除外する。
--
-- 既存データ: APNS 配信前に必ず全 staff_members に line_account_id を埋める運用が必要。
-- バックフィル SQL を同 migration 内に同梱（hyhome は当面シングルアカウントなので
-- is_active = 1 の主アカウントに自動紐付け）。

ALTER TABLE staff_members ADD COLUMN line_account_id TEXT;

CREATE INDEX IF NOT EXISTS idx_staff_members_line_account
  ON staff_members (line_account_id);

-- APNs JOIN 性能のための複合インデックス（ios-notifier.ts の JOIN クエリ最適化）
CREATE INDEX IF NOT EXISTS idx_staff_members_active_account
  ON staff_members (is_active, line_account_id);

-- バックフィル: 既存 staff_members 全員を、現在 is_active=1 で最古の line_accounts に紐付ける。
-- hyhome の現運用 (シングルアカウント) ではこの 1 行で全員が主アカウントを購読する形になる。
-- 顧問先運用時は別途 UPDATE で staff の所属を明示すること。
UPDATE staff_members
   SET line_account_id = (
     SELECT id FROM line_accounts
      WHERE is_active = 1
      ORDER BY created_at ASC
      LIMIT 1
   )
 WHERE line_account_id IS NULL
   AND EXISTS (SELECT 1 FROM line_accounts WHERE is_active = 1);
