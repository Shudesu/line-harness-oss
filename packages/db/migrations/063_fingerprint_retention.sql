-- Phase 1-H: fingerprint データの保存期限管理
--
-- 背景:
-- 認証スキップモード (skip_liff) で広告クリック → 友だち追加を突合するために、
-- link_clicks に user_agent / ip_address / ua_fingerprint を保存している。
-- これらは個人特定可能情報 (PII) なので、無期限保存は GDPR / 個人情報保護法的に NG。
--
-- 対応:
-- 1. fingerprint_retention_audit テーブルに削除ジョブの履歴を残す
-- 2. account_settings の 'fingerprint_consent' / 'fingerprint_retention_days' で運用ポリシー管理
-- 3. cron で N日 (デフォルト 90日) 経過分を NULL クリア (レコード自体は CV 集計に必要なので残す)

CREATE TABLE IF NOT EXISTS fingerprint_retention_audit (
  id            TEXT PRIMARY KEY,
  ran_at        TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  retention_days INTEGER NOT NULL,
  scanned_rows  INTEGER NOT NULL,
  cleared_rows  INTEGER NOT NULL,
  trigger       TEXT NOT NULL CHECK (trigger IN ('cron', 'manual', 'consent_revoked')),
  notes         TEXT
);

CREATE INDEX IF NOT EXISTS idx_fingerprint_retention_audit_ran
  ON fingerprint_retention_audit (ran_at DESC);
