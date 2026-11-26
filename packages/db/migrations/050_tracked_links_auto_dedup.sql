-- 050: Dedup auto-generated tracked links
--
-- auto-track used to mint a brand-new tracked_links row (`auto: <url>`) on every
-- delivery — cron step delivery per friend×step, every-click immediate push per
-- re-click — so the same original_url piled up thousands of rows and click
-- analytics scattered across one-shot links.
--
-- tracked_links.dedup_key — set ONLY for auto-generated links, as
--   COALESCE(line_account_id, '') || '|' || original_url
-- so each (account, url) pair owns exactly one auto link. Manually created
-- links keep dedup_key NULL and are never deduped.

ALTER TABLE tracked_links ADD COLUMN dedup_key TEXT;

-- Backfill: give the newest existing auto row per (account, url) the key so it
-- gets reused (preserving its click history) instead of minting one more row.
-- Idempotent on replay: rows already keyed are excluded, and the NOT EXISTS
-- guard skips keys claimed since the previous run.
UPDATE tracked_links
SET dedup_key = COALESCE(line_account_id, '') || '|' || original_url
WHERE id IN (
  SELECT id FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY COALESCE(line_account_id, '') || '|' || original_url
             ORDER BY created_at DESC, id DESC
           ) AS rn
    FROM tracked_links
    WHERE name LIKE 'auto: %' AND dedup_key IS NULL
  ) WHERE rn = 1
)
AND NOT EXISTS (
  SELECT 1 FROM tracked_links keyed
  WHERE keyed.dedup_key = COALESCE(tracked_links.line_account_id, '') || '|' || tracked_links.original_url
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tracked_links_dedup_key
  ON tracked_links (dedup_key) WHERE dedup_key IS NOT NULL;
