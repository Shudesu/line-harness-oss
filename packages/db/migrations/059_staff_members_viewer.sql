-- L-TRACK 互換: staff_members.role に 'viewer' (閲覧専用) を追加
--
-- 目的:
-- 顧問先・代理店・外部パートナーに「読み取り専用」アクセスを提供できるようにする。
-- viewer = GET 系全許可、POST/PATCH/DELETE 系全拒否 (role-guard で 403)
--
-- SQLite の CHECK 制約は ALTER TABLE で変更できないため、テーブル再作成。
-- staff_members のデータは少量 (運用メンバー数人) なので再作成のコストは無視できる。

CREATE TABLE IF NOT EXISTS staff_members_v2 (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  email      TEXT,
  role       TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'staff', 'viewer')),
  api_key    TEXT UNIQUE NOT NULL,
  is_active  INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

INSERT INTO staff_members_v2
  (id, name, email, role, api_key, is_active, created_at, updated_at)
SELECT id, name, email, role, api_key, is_active, created_at, updated_at
  FROM staff_members;

DROP TABLE staff_members;
ALTER TABLE staff_members_v2 RENAME TO staff_members;

CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_members_api_key ON staff_members (api_key);
CREATE INDEX IF NOT EXISTS idx_staff_members_role ON staff_members (role);
