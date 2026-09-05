-- 049: Short codes for tracked links
--
-- tracked_links.short_code — 7-char base62 code so message links can be short:
--   https://<short-domain>/t/Ab3xY9k   (instead of /t/<36-char-uuid>)
-- /t/:linkId resolves both forms (UUID for legacy links, short_code for new ones).
-- Codes are generated at creation time; existing rows keep NULL and continue to
-- resolve by UUID only.

ALTER TABLE tracked_links ADD COLUMN short_code TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_links_short_code
  ON tracked_links (short_code) WHERE short_code IS NOT NULL;
