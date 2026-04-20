-- Migration 024: webhook_dedupe テーブル新設
--
-- 目的: LINE Webhook の再送・重複配信による二重処理を防ぐ (5幕イニシエーション Bug 1 対策)
-- 参照: strategic_brief__mizukagami_5act_bugfix__20260420_234703.md
--
-- 動作:
--   1. Webhook 受信時、各 event の webhookEventId を dedup key として
--      INSERT OR IGNORE
--   2. changes() == 0 の場合は既処理 → スキップ
--   3. 古い entry は cron (*/5 * * * *) で 30 分以上前のものを削除

CREATE TABLE IF NOT EXISTS webhook_dedupe (
  event_id    TEXT PRIMARY KEY,
  received_at TEXT NOT NULL
);

-- received_at の昇順索引 — cron cleanup で古い entry を範囲削除する際に使用
CREATE INDEX IF NOT EXISTS idx_webhook_dedupe_received_at
  ON webhook_dedupe (received_at);
