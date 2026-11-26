-- 056: Webinar session registrations (セッション選択メニューの予約)
--
-- 視聴者が「どの回に参加するか」を選ぶと1行入る。session_start_at は
-- webinar_viewers と同じくセッション開始 epoch 秒。開始5分前までに cron が
-- 視聴リンクをプッシュし notified_at を刻む (未通知 = NULL)。
-- 052-054 は OSS PR 割当、055 は webinar_ctas 使用済みのため 056。

CREATE TABLE IF NOT EXISTS webinar_registrations (
  id TEXT PRIMARY KEY,
  webinar_id TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends(id),
  session_start_at INTEGER NOT NULL,
  notified_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (webinar_id, friend_id, session_start_at)
);
CREATE INDEX IF NOT EXISTS idx_webinar_regs_due
  ON webinar_registrations (notified_at, session_start_at);
CREATE INDEX IF NOT EXISTS idx_webinar_regs_friend
  ON webinar_registrations (webinar_id, friend_id);
