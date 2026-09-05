-- 051: Auto-webinar (疑似ライブ配信)
--
-- webinars.schedule_json: 開催ルールの JSON 配列 (JST 固定)
--   [{"type":"daily","time":"20:00"},
--    {"type":"weekly","days":[6],"time":"10:00"},
--    {"type":"once","at":"2026-08-01T20:00:00+09:00"}]
-- webinars.cta_json: {"label":"今すぐ申し込む","url":"https://...","showAtSeconds":5400}
-- webinars.video_prefix: R2 key prefix (例 webinars/my-seminar)。配下に master.m3u8
-- session_start_at: セッション開始時刻 epoch 秒。friend×セッションで視聴行が1行

CREATE TABLE IF NOT EXISTS webinars (
  id TEXT PRIMARY KEY,
  account_id TEXT REFERENCES line_accounts(id),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','active','archived')),
  video_prefix TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  schedule_json TEXT NOT NULL DEFAULT '[]',
  cta_json TEXT,
  tag_on_attend TEXT,
  tag_on_cta_click TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webinar_comments (
  id TEXT PRIMARY KEY,
  webinar_id TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  at_seconds INTEGER NOT NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webinar_comments_webinar
  ON webinar_comments (webinar_id, at_seconds);

CREATE TABLE IF NOT EXISTS webinar_viewers (
  id TEXT PRIMARY KEY,
  webinar_id TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends(id),
  session_start_at INTEGER NOT NULL,
  joined_at TEXT NOT NULL,
  last_position_seconds INTEGER NOT NULL DEFAULT 0,
  cta_clicked_at TEXT,
  UNIQUE (webinar_id, friend_id, session_start_at)
);
CREATE INDEX IF NOT EXISTS idx_webinar_viewers_webinar
  ON webinar_viewers (webinar_id, session_start_at);

CREATE TABLE IF NOT EXISTS webinar_user_comments (
  id TEXT PRIMARY KEY,
  webinar_id TEXT NOT NULL REFERENCES webinars(id) ON DELETE CASCADE,
  friend_id TEXT NOT NULL REFERENCES friends(id),
  session_start_at INTEGER NOT NULL,
  at_seconds INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_webinar_user_comments_webinar
  ON webinar_user_comments (webinar_id, created_at);
