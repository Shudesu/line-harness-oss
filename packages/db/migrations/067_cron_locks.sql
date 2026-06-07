-- P1 修正 (2026-06-07): cron tick mutex
--
-- 問題: wrangler.toml の crons = ["*/5 * * * *", "0 */6 * * *"] は
--   0:00 / 6:00 / 12:00 / 18:00 JST に **両方マッチ** する。
--   Cloudflare の scheduled() は 2 並列 isolate で同時に走り、
--   - reminder の二重送信
--   - token refresh の二重実行
--   - friends.metadata の write race
--   といった全ての cron 系 race を悪化させる。
--
-- 対策: scheduled() 冒頭で同一分 (YYYY-MM-DD HH:MM JST) を slot とした
--   `INSERT OR IGNORE INTO cron_locks(slot_minute) VALUES (?)` で claim。
--   changes=0 なら別 isolate が claim 済み → early return。
--   1 時間以上前の lock は別途 cleanup (実装側で都度 DELETE)。
--
-- slot_minute は PRIMARY KEY のため、INSERT OR IGNORE が atomic な dedupe を
-- 提供する。TEXT で 'YYYY-MM-DD HH:MM' 形式 (16 文字) の前提。

CREATE TABLE IF NOT EXISTS cron_locks (
  slot_minute TEXT PRIMARY KEY,
  claimed_at TEXT NOT NULL
);
