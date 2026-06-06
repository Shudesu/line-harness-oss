CREATE TABLE IF NOT EXISTS rich_menu_assets (
  rich_menu_id TEXT PRIMARY KEY,
  line_account_id TEXT,
  image_key TEXT NOT NULL,
  image_url TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rich_menu_assets_account ON rich_menu_assets (line_account_id);
