-- P1 (2026-06-07): CRM forward の失敗時 retry queue。
--
-- 問題: crm-forwarder.ts は timeout / 5xx / 4xx 以外で失敗したとき、
--       単に crm_forward_logs に 'failed' / 'timeout' を残すだけで
--       payload をロストしていた。エルメ側の短時間メンテで follow event
--       が消える事故が起きた。
--
-- 設計:
--   - forward 失敗時に raw_body と signature を queue に永続化
--   - 5min cron tick で due な row を fetch して再送
--   - 指数バックオフ: 1分 → 5分 → 15分 → 1時間 → 6時間 → 24時間 (計6回)
--   - 6回失敗で DLQ 化 (crm_forward_logs に 'failed_permanent' を残す)
--
-- スケール想定: 1日 1000 webhook × 1% 失敗 = 10 row 程度。
--   24h 以上 due なものは prune で消す (logs と同様の 100件キープ運用は
--   queue では行わない; 完了/DLQ で row 自体が消える設計)。

CREATE TABLE IF NOT EXISTS crm_forward_queue (
  id              TEXT PRIMARY KEY,
  crm_forward_id  TEXT NOT NULL REFERENCES crm_forwards(id) ON DELETE CASCADE,
  -- 元の LINE webhook payload (PII 含む — log と違って必須なので保存)。
  -- LINE 側 signature 検証済の rawBody なのでバイト一致が必要。
  raw_body        TEXT NOT NULL,
  -- attach_line_signature=1 のとき crm-forwarder.ts で再計算した X-Line-Signature。
  -- 再送時は再生成せずこの値を流用する (channel_secret が rotation された場合に
  -- 旧 secret で署名済のバージョンを送るほうが安全)。
  signature       TEXT,
  -- 試行回数。0 = まだ未試行 (queue 投入直後)。指数バックオフのインデックス。
  attempt         INTEGER NOT NULL DEFAULT 0,
  -- 次回 due 時刻 (ISO 8601, JST naive)。process 側は <= now で fetch する。
  next_retry_at   TEXT NOT NULL,
  last_error      TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

-- process 側の fetch (next_retry_at <= now で attempt 順) を効率化。
CREATE INDEX IF NOT EXISTS idx_crm_forward_queue_due
  ON crm_forward_queue (next_retry_at, attempt);

-- forward_id 別に retry 状況を見たいケース (運用)
CREATE INDEX IF NOT EXISTS idx_crm_forward_queue_forward
  ON crm_forward_queue (crm_forward_id);

-- crm_forward_logs.status の CHECK 制約を拡張 ('failed_permanent' を追加)。
-- SQLite は ALTER TABLE で CHECK を変更できないので、新テーブル作成 → コピー →
-- 旧 DROP → リネームの伝統的手順を踏む。データ量が少ない (~100件 keep) ので
-- ダウンタイムは無視できる。
CREATE TABLE IF NOT EXISTS crm_forward_logs_new (
  id                TEXT PRIMARY KEY,
  crm_forward_id    TEXT NOT NULL REFERENCES crm_forwards(id) ON DELETE CASCADE,
  status            TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'timeout', 'failed_permanent')),
  http_status       INTEGER,
  duration_ms       INTEGER,
  error_message     TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now', '+9 hours'))
);

INSERT INTO crm_forward_logs_new (id, crm_forward_id, status, http_status, duration_ms, error_message, created_at)
  SELECT id, crm_forward_id, status, http_status, duration_ms, error_message, created_at
    FROM crm_forward_logs;

DROP TABLE crm_forward_logs;
ALTER TABLE crm_forward_logs_new RENAME TO crm_forward_logs;

CREATE INDEX IF NOT EXISTS idx_crm_forward_logs_forward
  ON crm_forward_logs (crm_forward_id, created_at DESC);
