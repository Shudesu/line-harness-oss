-- 046: Link tracking controls
--
-- 1. tracked_links.line_account_id — which LINE account a tracked link belongs to.
--    /t/:linkId uses this to redirect LINE in-app clicks to the *owning* account's
--    LIFF for user identification. Without it, all links redirect to the global
--    env.LIFF_URL (account ①), so friends of other accounts hit an unfamiliar
--    consent screen and attribution breaks.
--    NULL = legacy/unowned link → falls back to scenario lookup, then env.LIFF_URL.
--
-- 2. broadcasts.track_links — per-broadcast toggle for automatic URL shortening
--    (auto-track). 1 = wrap URLs with /t/ tracking links (existing behavior),
--    0 = send message content as-is (no /t/ conversion, no text→flex rewrite).

ALTER TABLE tracked_links ADD COLUMN line_account_id TEXT REFERENCES line_accounts(id) ON DELETE SET NULL;
ALTER TABLE broadcasts ADD COLUMN track_links INTEGER NOT NULL DEFAULT 1;
