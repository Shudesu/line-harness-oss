-- ============================================================
-- User Profiles — プロフィール（応募時の本人情報）
-- ============================================================
CREATE TABLE IF NOT EXISTS user_profiles (
  id                 TEXT PRIMARY KEY,
  friend_id          TEXT UNIQUE NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  real_name          TEXT NOT NULL,
  real_name_kana     TEXT,
  phone              TEXT,
  qualification_type TEXT,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_user_profiles_friend ON user_profiles (friend_id);

-- ============================================================
-- User Documents — 書類アップロード（R2保存）
-- ============================================================
CREATE TABLE IF NOT EXISTS user_documents (
  id          TEXT PRIMARY KEY,
  friend_id   TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL CHECK (doc_type IN ('id_card', 'qualification_cert')),
  r2_key      TEXT NOT NULL DEFAULT '',
  file_name   TEXT,
  status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_user_documents_friend ON user_documents (friend_id);

-- ============================================================
-- Favorite Nurseries — お気に入り園
-- ============================================================
CREATE TABLE IF NOT EXISTS favorite_nurseries (
  id           TEXT PRIMARY KEY,
  friend_id    TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  nursery_name TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  UNIQUE (friend_id, nursery_name)
);

CREATE INDEX IF NOT EXISTS idx_favorite_nurseries_friend ON favorite_nurseries (friend_id);
