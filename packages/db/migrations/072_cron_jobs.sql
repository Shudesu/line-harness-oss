-- P1 修正 (2026-06-07): cron job 最終実行時刻トラッキング
--
-- 問題: scheduled() 内の 6h ジョブ (booking-expirer, event-booking-expirer,
--   fingerprint-purger) は `if (event.cron === '0 */6 * * *')` で
--   ガードされていた。しかし wrangler.toml の crons は
--   ["*/5 * * * *", "0 */6 * * *"] で 0/6/12/18 JST に dual-fire し、
--   067_cron_locks の mutex は **どちらか一方の isolate だけ** を勝たせる。
--   勝った isolate の event.cron が '*/5 * * * *' だった場合、
--   6h ジョブが **永久に走らない** 可能性があった。
--   (Cloudflare スケジューラの fire 順序は非決定的)
--
-- 対策: event.cron 文字列ガードを廃止し、ジョブごとに last_run_at を
--   テーブルに記録する。毎 tick で「6 時間経過したか?」を確認し、
--   経過していれば実行 + last_run_at を更新する。
--   これで *5min* / *6h* どちらの cron が claim 勝ちでも、
--   6 時間以上ジョブが眠れば次の tick で確実に拾える。
--
-- job_name は PRIMARY KEY。'booking-expirer' / 'event-booking-expirer' /
-- 'fingerprint-purger' の 3 行が運用上の SSOT。
-- last_run_at は ISO8601 UTC (TEXT) で 067_cron_locks と統一。
-- last_run_duration_ms / last_success は観測用 (将来の health-check 用に開けておく)。

CREATE TABLE IF NOT EXISTS cron_jobs (
  job_name TEXT PRIMARY KEY,
  last_run_at TEXT NOT NULL,
  last_run_duration_ms INTEGER,
  last_success INTEGER DEFAULT 1
);
