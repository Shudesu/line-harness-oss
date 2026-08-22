-- Per-account coexistence policy for installations that share one LINE
-- Messaging API channel with an existing L-Step workspace.
--
-- System tags are intentionally normal tags: operators can inspect them in
-- the existing friend/tag UI, while the policy gives the Worker stable IDs
-- for automatic classification and broadcast exclusion.
CREATE TABLE IF NOT EXISTS line_coexistence_policies (
  line_account_id TEXT PRIMARY KEY REFERENCES line_accounts(id) ON DELETE CASCADE,
  harness_tag_id  TEXT NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
  lstep_tag_id    TEXT NOT NULL REFERENCES tags(id) ON DELETE RESTRICT,
  cutover_at      TEXT NOT NULL,
  is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  CHECK (harness_tag_id != lstep_tag_id)
);

CREATE INDEX IF NOT EXISTS idx_line_coexistence_policies_active
  ON line_coexistence_policies(is_active, line_account_id);
