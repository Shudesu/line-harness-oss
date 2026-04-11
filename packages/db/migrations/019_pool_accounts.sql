CREATE TABLE IF NOT EXISTS pool_accounts (
  id TEXT PRIMARY KEY,
  pool_id TEXT NOT NULL REFERENCES traffic_pools(id) ON DELETE CASCADE,
  line_account_id TEXT NOT NULL REFERENCES line_accounts(id) ON DELETE CASCADE,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(pool_id, line_account_id)
);

-- Migrate existing active_account_id to pool_accounts
INSERT OR IGNORE INTO pool_accounts (id, pool_id, line_account_id, is_active, created_at)
SELECT
  lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(2)) || '-' || hex(randomblob(6))),
  tp.id,
  tp.active_account_id,
  1,
  datetime('now')
FROM traffic_pools tp
WHERE tp.active_account_id IS NOT NULL;
