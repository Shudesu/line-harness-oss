-- 050_organizations.sql — cross-account customer ledger: organizations bundle
-- multiple line_accounts under one entity for LTV rollups across LINE OAs.
-- Additive only (idempotent under the benign duplicate-column / already-exists filter).

CREATE TABLE IF NOT EXISTS organizations (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours'))
);

-- NULL = account not yet assigned to an organization (backward compatible default).
ALTER TABLE line_accounts ADD COLUMN organization_id TEXT REFERENCES organizations(id);
CREATE INDEX IF NOT EXISTS idx_line_accounts_organization ON line_accounts(organization_id);
