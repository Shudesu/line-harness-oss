CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY, friend_id TEXT NOT NULL, plan_id TEXT NOT NULL,
  plan TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', session_id TEXT, url TEXT,
  subscription_id TEXT UNIQUE, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  CHECK(status IN ('pending','active','canceled'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_open_purchase ON purchases(friend_id, plan_id) WHERE status IN ('pending','active');
CREATE TABLE IF NOT EXISTS stripe_jobs (
  id TEXT PRIMARY KEY, type TEXT NOT NULL, object_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','done')),
  attempts INTEGER NOT NULL DEFAULT 0, error TEXT,
  payload TEXT
);
