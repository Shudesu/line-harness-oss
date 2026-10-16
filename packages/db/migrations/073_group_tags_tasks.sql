-- Migration 073: LINE group registry + group tags + group tasks
--
-- 背景: LINE グループ (source.type === 'group') を保持するテーブルが存在せず、
-- グループ単位のタグ付け / タスク管理ができなかった。
--
-- 設計方針:
--   * タグは既存 `tags` を再利用する。グループ専用のタグ表は作らない
--     (friend_tags と同じ形の join テーブルを1枚足すだけ)。
--   * 追加のみ。既存テーブルの行は UPDATE / DELETE しない。
--   * tasks の列は最小限 (件名 / 状態 / 期限 / 担当 / グループ / 作成・更新日)。
--     使われない列はノイズになるので増やさない。

-- ============================================================
-- LINE グループ登録簿
-- id は LINE の groupId をそのまま使う (webhook の upsert で埋まる)。
-- name は LINE の group summary API が取れたときだけ入る (取れないことがある)。
-- ============================================================
CREATE TABLE IF NOT EXISTS line_groups (
  id              TEXT PRIMARY KEY,
  account_id      TEXT REFERENCES line_accounts (id) ON DELETE SET NULL,
  name            TEXT,
  status          TEXT NOT NULL DEFAULT 'joined' CHECK (status IN ('joined', 'left')),
  message_count   INTEGER NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  last_message_at TEXT,
  joined_at       TEXT,
  left_at         TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_line_groups_account
  ON line_groups (account_id, status);
CREATE INDEX IF NOT EXISTS idx_line_groups_last_message
  ON line_groups (last_message_at DESC);

-- ============================================================
-- Group <-> Tag join (friend_tags と同じ形)
-- ============================================================
CREATE TABLE IF NOT EXISTS group_tags (
  group_id    TEXT NOT NULL REFERENCES line_groups (id) ON DELETE CASCADE,
  tag_id      TEXT NOT NULL REFERENCES tags (id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  PRIMARY KEY (group_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_group_tags_tag_id ON group_tags (tag_id);

-- ============================================================
-- グループ単位のタスク
-- group_id は NULL 可 (グループに紐づかない単発タスクを許す)。
-- due_date は 'YYYY-MM-DD' (時刻を持たない) — 期限順ソートは文字列順で正しく並ぶ。
-- ============================================================
CREATE TABLE IF NOT EXISTS tasks (
  id         TEXT PRIMARY KEY,
  group_id   TEXT REFERENCES line_groups (id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
  due_date   TEXT,
  assignee   TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- 期限順一覧 (状態で絞り込み + 期限昇順) を1本のインデックスで賄う。
CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON tasks (status, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_group      ON tasks (group_id, status);
