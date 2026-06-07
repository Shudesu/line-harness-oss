-- P1 修正 (2026-06-07): token refresh の並行実行を防ぐ楽観ロック列
--
-- 問題: scheduled cron が dual-fire (例 0:00 JST に */5 と 0 */6 が同時マッチ) すると、
--   2 つの isolate が同じ line_account を fetch → 両方 LINE token API を叩いて新 token を
--   取得 → 両方 updateLineAccount → 後勝ち。古い token を使う isolate が API 呼び出しで
--   401 になる窓ができる。
--
-- 対策: token_refresh_lock_at TEXT 列を追加し、refresh 前に
--   `UPDATE line_accounts SET token_refresh_lock_at = ?
--      WHERE id = ? AND (token_refresh_lock_at IS NULL
--                        OR datetime(token_refresh_lock_at) < datetime('now','-2 minutes'))`
-- で claim。changes=0 なら他 isolate が処理中 → skip。
-- 2 分 tolerance は scheduled handler が 5 分間隔のため、十分余裕を持ったクリア窓。

ALTER TABLE line_accounts ADD COLUMN token_refresh_lock_at TEXT;
