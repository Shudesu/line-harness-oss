-- 監査 H1 対応: CRM forward (外部 CRM Webhook 転送) 設定
--
-- 用途: harness が LINE webhook を受信したら、設定された外部 CRM (エルメ等) にも
-- 同じ payload を転送する。エルメ → harness 移行中の並行運用に使う。
--
-- 設計:
-- - line_accounts ごとに 0〜N 個の forward 先を登録できる
-- - forward 先ごとに enabled / disabled が切り替え可能 (段階移行用)
-- - 失敗ログは crm_forward_logs に最近100件だけ保持 (デバッグ用)
-- - LINE の 3秒応答制限を守るため、webhook handler では waitUntil() で非同期化

CREATE TABLE IF NOT EXISTS crm_forwards (
  id                TEXT PRIMARY KEY,
  line_account_id   TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  webhook_url       TEXT NOT NULL,
  is_enabled        INTEGER NOT NULL DEFAULT 1,
  -- LINE 公式 webhook の channel_secret を使って X-Line-Signature を付与するか
  -- (エルメ等の forward 先が LINE 公式 webhook 互換のとき必要)
  attach_line_signature INTEGER NOT NULL DEFAULT 1,
  -- 失敗時のリトライ上限
  max_retries       INTEGER NOT NULL DEFAULT 0,
  -- メモ
  memo              TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now', '+9 hours')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_crm_forwards_account
  ON crm_forwards (line_account_id, is_enabled);

CREATE TABLE IF NOT EXISTS crm_forward_logs (
  id                TEXT PRIMARY KEY,
  crm_forward_id    TEXT NOT NULL REFERENCES crm_forwards(id) ON DELETE CASCADE,
  status            TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'timeout')),
  http_status       INTEGER,
  duration_ms       INTEGER,
  error_message     TEXT,
  -- payload は保存しない (PII 漏洩防止、必要なら別途デバッグログで)
  created_at        TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_crm_forward_logs_forward
  ON crm_forward_logs (crm_forward_id, created_at DESC);
