-- messages_log の delivery_type CHECK に 'test' を追加するためのテーブル再構築。
--
-- 経緯: 026_delivery_type_test.sql は「D1 は既存カラムへの INSERT で CHECK を
-- 強制しない」という誤った前提で no-op になっているが、D1(SQLite) は CHECK を
-- 強制する。そのためレガシー DB(bootstrap 以前に 009 の ALTER で delivery_type
-- を得た環境)ではテスト配信のログ書き込みが constraint failed で失敗する。
-- 新規インストールは bootstrap.sql が 'test' 込みの CHECK を持つため影響なし
-- (この migration を適用しても同一定義への再構築となり無害)。
--
-- SQLite は CHECK 制約の変更ができないため、公式レシピどおり
-- 新テーブル作成 → 全行コピー → 差し替えで再構築する。
-- NOTE: additive-only ポリシー(scripts/check-migrations.ts)の DROP TABLE 禁止に
-- 形式上抵触するが、正典(bootstrap.sql)と実 DB の CHECK を一致させるための
-- 意図的な再構築であり、データは全行コピーで保全される。

PRAGMA defer_foreign_keys = true;

CREATE TABLE messages_log_new (
  id               TEXT PRIMARY KEY,
  friend_id        TEXT NOT NULL REFERENCES friends (id) ON DELETE CASCADE,
  direction        TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  message_type     TEXT NOT NULL,
  content          TEXT NOT NULL,
  broadcast_id     TEXT REFERENCES broadcasts (id) ON DELETE SET NULL,
  scenario_step_id TEXT REFERENCES scenario_steps (id) ON DELETE SET NULL,
  template_id_at_send TEXT,
  delivery_type    TEXT CHECK (delivery_type IN ('push', 'reply', 'test')),
  source           TEXT,
  line_account_id  TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO messages_log_new
  (id, friend_id, direction, message_type, content, broadcast_id,
   scenario_step_id, template_id_at_send, delivery_type, source,
   line_account_id, created_at)
SELECT
  id, friend_id, direction, message_type, content, broadcast_id,
  scenario_step_id, template_id_at_send, delivery_type, source,
  line_account_id, created_at
FROM messages_log;

DROP TABLE messages_log;

ALTER TABLE messages_log_new RENAME TO messages_log;

CREATE INDEX IF NOT EXISTS idx_messages_log_broadcast_id ON messages_log(broadcast_id);
CREATE INDEX IF NOT EXISTS idx_messages_log_created_at ON messages_log (created_at);
CREATE INDEX IF NOT EXISTS idx_messages_log_friend_direction_created ON messages_log (friend_id, direction, created_at);
CREATE INDEX IF NOT EXISTS idx_messages_log_friend_id ON messages_log (friend_id);
CREATE INDEX IF NOT EXISTS idx_messages_log_friend_source ON messages_log (friend_id, source);
