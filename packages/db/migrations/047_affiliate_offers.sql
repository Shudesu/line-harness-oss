-- 047_affiliate_offers.sql — ASP Phase 2: offers (案件) + conversion approval flow
-- Additive only (idempotent under the benign duplicate-column / already-exists filter).

CREATE TABLE IF NOT EXISTS affiliate_offers (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,
  description     TEXT,
  reward_amount   INTEGER NOT NULL DEFAULT 0,   -- 円/成約（固定額）
  line_account_id TEXT REFERENCES line_accounts(id),
  tag_id          TEXT REFERENCES tags(id),
  scenario_id     TEXT REFERENCES scenarios(id),
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL
);

-- Each affiliate_link may belong to an offer (case 案件リンク). NULL = 汎用リンク.
ALTER TABLE affiliate_links ADD COLUMN offer_id TEXT REFERENCES affiliate_offers(id);
CREATE INDEX IF NOT EXISTS idx_affiliate_links_offer ON affiliate_links(offer_id);

-- Approval flow: only affiliate-attributed CVs carry a status. Non-attributed CVs stay NULL.
ALTER TABLE conversion_events ADD COLUMN approval_status TEXT
  CHECK (approval_status IN ('pending','approved','rejected'));
ALTER TABLE conversion_events ADD COLUMN approved_at TEXT;

-- Backfill: existing affiliate-attributed CVs predate the approval flow and would
-- otherwise sit at NULL. Report code treats NULL as pending, but we materialize
-- 'pending' so the approval queue surfaces them. Idempotent (re-runs match nothing).
UPDATE conversion_events
   SET approval_status = 'pending'
 WHERE affiliate_id IS NOT NULL
   AND approval_status IS NULL;
