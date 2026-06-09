-- 073_friends_multi_account_unique.sql
--
-- 目的: friends の UNIQUE (line_user_id) を UNIQUE (line_user_id, line_account_id)
--       に変更する。
--
-- 背景: friends.line_user_id に **単一 UNIQUE** が張られていたため、同じ LINE
--       ユーザーが Account A と Account B 両方を follow すると行が collapse し、
--       後勝ちで一方の scenario / broadcast / タグが全消失する事故が発生する。
--       multi-account 環境では「LINE user × account」で 1 行が正しい粒度。
--
-- 注意: SQLite は ALTER TABLE で UNIQUE 制約を削除できないので **table rebuild**
--       (新テーブル作成 → INSERT SELECT → DROP → RENAME) を行う。DROP TABLE と
--       RENAME を含むため additive-only 原則の例外。事前に dev D1 で必ず検証し、
--       本番は前田さんが手動で apply する想定。
--
-- 既存カラム (bootstrap.sql 545-555 を SSOT として参照):
--   id, line_user_id, display_name, picture_url, status_message,
--   is_following, user_id, ig_igsid, score, created_at, updated_at,
--   ref_code, metadata, line_account_id, first_tracked_link_id
--
-- 既存インデックス (068_perf_indexes.sql まで集約):
--   idx_friends_line_user_id        ON (line_user_id)
--   idx_friends_user_id             ON (user_id)
--   idx_friends_ig_igsid            ON (ig_igsid)
--   idx_friends_account_created     ON (line_account_id, created_at DESC)
--   idx_friends_account_following   ON (line_account_id, is_following, created_at DESC)

CREATE TABLE friends_new (
  id                    TEXT PRIMARY KEY,
  line_user_id          TEXT NOT NULL,
  display_name          TEXT,
  picture_url           TEXT,
  status_message        TEXT,
  is_following          INTEGER NOT NULL DEFAULT 1,
  user_id               TEXT,
  ig_igsid              TEXT,
  score                 INTEGER NOT NULL DEFAULT 0,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  ref_code              TEXT,
  metadata              TEXT NOT NULL DEFAULT '{}',
  line_account_id       TEXT REFERENCES line_accounts(id),
  first_tracked_link_id TEXT REFERENCES tracked_links (id) ON DELETE SET NULL,
  -- 新 UNIQUE: マルチアカウント環境では「LINE user × account」で 1 行が正しい粒度。
  -- ただし SQLite の UNIQUE は NULL を distinct 扱いする (NULLs distinct) ため、
  -- (lineUser, NULL) は本制約では重複と判定されず、複数行 INSERT が可能になる。
  -- legacy NULL 行を line_user_id 単位で 1 行に collapse する partial UNIQUE INDEX は
  -- 074_friends_legacy_null_unique.sql で別途張る (本 migration の編集は既適用環境に
  -- 届かないため独立 migration として切り出している)。
  UNIQUE (line_user_id, line_account_id)
);

-- 列順を schema.sql と揃えて INSERT する。
INSERT INTO friends_new (
  id, line_user_id, display_name, picture_url, status_message,
  is_following, user_id, ig_igsid, score, created_at, updated_at,
  ref_code, metadata, line_account_id, first_tracked_link_id
)
SELECT
  id, line_user_id, display_name, picture_url, status_message,
  is_following, user_id, ig_igsid, score, created_at, updated_at,
  ref_code, metadata, line_account_id, first_tracked_link_id
FROM friends;

DROP TABLE friends;
ALTER TABLE friends_new RENAME TO friends;

-- インデックス再作成 (旧 friends で張られていた全 index を再現)
-- 注: idx_friends_line_user_id は単独 line_user_id ルックアップ (legacy 互換用)
-- としてそのまま維持する。新しい複合 UNIQUE が (line_user_id, line_account_id)
-- なので line_user_id だけでの探索もこの index でカバーされる。
CREATE INDEX IF NOT EXISTS idx_friends_line_user_id      ON friends (line_user_id);
CREATE INDEX IF NOT EXISTS idx_friends_user_id           ON friends (user_id);
CREATE INDEX IF NOT EXISTS idx_friends_ig_igsid          ON friends (ig_igsid);
CREATE INDEX IF NOT EXISTS idx_friends_account_created   ON friends (line_account_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_friends_account_following ON friends (line_account_id, is_following, created_at DESC);

-- NOTE: NULLs distinct 対策の partial UNIQUE INDEX は、本 migration を編集して
-- 追記しても「既に 070 を適用した dev/staging/prod の D1 には届かない」ため、
-- 別 migration 074_friends_legacy_null_unique.sql に分離している。
