-- 070_pinned_friends.sql
--
-- 目的: チャット一覧の「ピン留め」機能。
-- スタッフ単位で「最上部に固定したい friend」のリストを管理する。
--
-- 設計:
--   - staff_id + friend_id の複合 PK (staff ごとに同じ friend は 1 度しかピン留めできない)
--   - line_account_id を必須にして、069 と同じくマルチテナント境界を保つ
--   - pinned_at で並び順 (新しい順 = 直近ピン留めが上)
--   - 削除はサーバ側に残す (履歴用途なら別途) + 既存運用への影響なし → 物理削除で OK

CREATE TABLE IF NOT EXISTS pinned_friends (
  staff_id         TEXT NOT NULL REFERENCES staff_members(id) ON DELETE CASCADE,
  friend_id        TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
  -- Codex Round 5 Critical: line_account_id にも FK を貼って tenant 境界を DB レベルで保証する
  line_account_id  TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  pinned_at        TEXT NOT NULL,
  PRIMARY KEY (staff_id, friend_id)
);

CREATE INDEX IF NOT EXISTS idx_pinned_friends_staff
  ON pinned_friends (staff_id, pinned_at DESC);

CREATE INDEX IF NOT EXISTS idx_pinned_friends_account
  ON pinned_friends (line_account_id, staff_id);
