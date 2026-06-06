-- L-TRACK 互換: AF（友だち追加）の確定タイミングを 1h/3h/24h 遅延させるキュー
--
-- なぜ別テーブルか:
--   - 即時CV と異なり、blocked / unblock 状態をチェックしてから CV を送る
--     必要がある（ブロック離脱を除外しないと広告計測が汚染される）
--   - 1h/3h/24h の3種類を同じ cron tick で捌くため、scheduled_at で並べる
--   - 失敗時のリトライ・冪等性のため status カラムを持つ
--
-- 設計:
--   - INSERT は skip-liff-matcher で promoted=true のとき、または LIFF経由の
--     確定的紐付けで af_confirm_type が 1h/3h/24h のときに発火
--   - cron で WHERE status='pending' AND scheduled_at <= now を引いて処理
--   - 1 ref_tracking につき 1 row（UNIQUE）。重複INSERT は IGNORE で吸収
--   - status: pending → sent | failed | cancelled (blocked のため)

CREATE TABLE IF NOT EXISTS af_confirm_queue (
  id TEXT PRIMARY KEY,
  friend_id TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  tracked_link_id TEXT REFERENCES tracked_links (id) ON DELETE SET NULL,
  ref_tracking_id TEXT REFERENCES ref_tracking (id) ON DELETE SET NULL,
  af_confirm_type TEXT NOT NULL CHECK (af_confirm_type IN ('1h', '3h', '24h')),
  scheduled_at TEXT NOT NULL,          -- いつ確定処理するか (JST ISO)
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  processed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- 1 ref_tracking に対して1回だけ確定処理する
CREATE UNIQUE INDEX IF NOT EXISTS idx_af_confirm_queue_unique
  ON af_confirm_queue (ref_tracking_id)
  WHERE ref_tracking_id IS NOT NULL;

-- cron が引く対象を絞るためのインデックス
CREATE INDEX IF NOT EXISTS idx_af_confirm_queue_due
  ON af_confirm_queue (status, scheduled_at);

CREATE INDEX IF NOT EXISTS idx_af_confirm_queue_friend
  ON af_confirm_queue (friend_id);
