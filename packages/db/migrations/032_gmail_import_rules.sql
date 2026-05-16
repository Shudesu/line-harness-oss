CREATE TABLE IF NOT EXISTS gmail_import_rules (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES google_calendar_connections (id) ON DELETE CASCADE,
  source_name TEXT NOT NULL DEFAULT 'jalan' CHECK (source_name IN ('jalan')),
  name TEXT NOT NULL,
  from_email TEXT,
  query TEXT,
  unprocessed_label_id TEXT NOT NULL,
  processed_label_id TEXT NOT NULL,
  review_label_id TEXT NOT NULL,
  failed_label_id TEXT NOT NULL,
  resource_id TEXT REFERENCES reservation_resources (id) ON DELETE SET NULL,
  menu_id TEXT REFERENCES reservation_menus (id) ON DELETE SET NULL,
  max_results INTEGER NOT NULL DEFAULT 10 CHECK (max_results BETWEEN 1 AND 50),
  is_active INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

CREATE INDEX IF NOT EXISTS idx_gmail_import_rules_active
  ON gmail_import_rules (is_active, source_name);

CREATE TABLE IF NOT EXISTS gmail_import_runs (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES gmail_import_rules (id) ON DELETE CASCADE,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'partial_failed', 'failed')),
  fetched_count INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_gmail_import_runs_rule
  ON gmail_import_runs (rule_id, started_at);
