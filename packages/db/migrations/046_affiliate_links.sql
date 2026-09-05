-- 046_affiliate_links.sql — ASP: affiliate self-serve links + last-touch attribution
ALTER TABLE affiliates ADD COLUMN friend_id TEXT REFERENCES friends(id);
-- One affiliate per friend (partial unique — NULL friend_id stays unconstrained,
-- so admin-created affiliates without a backing friend are unaffected). This is
-- the structural guarantee behind the idempotent self-register endpoint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_affiliates_friend ON affiliates(friend_id) WHERE friend_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS affiliate_links (
  id              TEXT PRIMARY KEY,
  affiliate_id    TEXT NOT NULL REFERENCES affiliates(id),
  ref_code        TEXT NOT NULL UNIQUE,
  label           TEXT,
  line_account_id TEXT REFERENCES line_accounts(id),
  is_active       INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  click_count     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_affiliate_links_affiliate ON affiliate_links(affiliate_id);

ALTER TABLE friends ADD COLUMN last_ref_code TEXT;
ALTER TABLE friends ADD COLUMN last_ref_at TEXT;

ALTER TABLE conversion_events ADD COLUMN affiliate_id TEXT REFERENCES affiliates(id);
ALTER TABLE conversion_events ADD COLUMN attributed_ref_code TEXT;

CREATE INDEX IF NOT EXISTS idx_ref_tracking_friend_created ON ref_tracking(friend_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ref_tracking_ref_created ON ref_tracking(ref_code, created_at);
