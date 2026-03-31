-- Rich menu local metadata (mirrors LINE API state)
CREATE TABLE IF NOT EXISTS rich_menus (
  id                TEXT PRIMARY KEY,
  line_rich_menu_id TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  chat_bar_text     TEXT NOT NULL DEFAULT 'メニュー',
  size_width        INTEGER NOT NULL DEFAULT 2500,
  size_height       INTEGER NOT NULL DEFAULT 1686,
  areas_json        TEXT NOT NULL DEFAULT '[]',
  image_url         TEXT,
  is_default        INTEGER NOT NULL DEFAULT 0,
  line_account_id   TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- Tag-based rich menu assignment rules
CREATE TABLE IF NOT EXISTS rich_menu_rules (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  tag_id            TEXT NOT NULL,
  rich_menu_id      TEXT NOT NULL,
  priority          INTEGER NOT NULL DEFAULT 0,
  is_active         INTEGER NOT NULL DEFAULT 1,
  line_account_id   TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_rich_menu_rules_tag ON rich_menu_rules(tag_id);

-- Rich menu aliases for tab switching (richmenuswitch action)
CREATE TABLE IF NOT EXISTS rich_menu_aliases (
  id                TEXT PRIMARY KEY,
  alias_id          TEXT UNIQUE NOT NULL,
  rich_menu_id      TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);
