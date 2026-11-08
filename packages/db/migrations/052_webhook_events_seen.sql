-- LINE が送り直した知らせ（同じ webhookEventId）を2回処理しないための覚え。7日で消す。
-- Worker が使うときに無ければ同じ表を作る（services/webhook-dedupe.ts）ので、本番に手で流さなくても動く。
CREATE TABLE IF NOT EXISTS webhook_events_seen (
  id          TEXT PRIMARY KEY,
  received_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_seen_received ON webhook_events_seen (received_at);
