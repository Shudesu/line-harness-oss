import { jstNow } from './utils.js';
import type { Affiliate } from './affiliates.js';
// =============================================================================
// Affiliate Links — ASP ref-code CRUD + slug generation
// =============================================================================

export interface AffiliateLink {
  id: string;
  affiliate_id: string;
  ref_code: string;
  label: string | null;
  line_account_id: string | null;
  is_active: number;
  created_at: string;
  click_count: number;
  /** Offer this link belongs to (ASP Phase 2). NULL = 汎用リンク. */
  offer_id: string | null;
}

// ── slug generation ──────────────────────────────────────────────────────────

const BASE62_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/**
 * Generate a base62 slug of the given length using crypto.getRandomValues.
 * Default length is 6 (standard). Pass 8 for the extended fallback.
 */
export function generateRefSlug(length = 6): string {
  const bytes = new Uint8Array(length * 2); // over-allocate to reduce modulo bias
  crypto.getRandomValues(bytes);
  let result = '';
  let i = 0;
  while (result.length < length) {
    // Use rejection sampling to avoid modulo bias (62 is not a power of 2)
    const byte = bytes[i % bytes.length];
    i++;
    if (byte < 248) {
      // 248 = floor(256 / 62) * 62 — anything >= 248 is biased, skip it
      result += BASE62_CHARS[byte % 62];
    }
    // Refresh bytes if we run out (very unlikely for length <= 8)
    if (i >= bytes.length && result.length < length) {
      crypto.getRandomValues(bytes);
      i = 0;
    }
  }
  return result;
}

// ── createAffiliateLink ──────────────────────────────────────────────────────

export interface CreateAffiliateLinkInput {
  affiliateId: string;
  label?: string | null;
  lineAccountId?: string | null;
  /** Offer to scope this link to (ASP Phase 2). Omit for a 汎用リンク. */
  offerId?: string | null;
}

/**
 * Insert an affiliate link row with a unique base62 ref_code.
 *
 * Collision retry strategy:
 *  - Attempt 1..3: 6-char slug
 *  - Attempt 4+  : 8-char slug (virtually collision-free)
 *
 * The optional `_slugGen` parameter allows tests to inject a deterministic
 * generator without touching the public signature behaviour.
 */
export async function createAffiliateLink(
  db: D1Database,
  input: CreateAffiliateLinkInput,
  _slugGen: (len: number) => string = generateRefSlug,
): Promise<AffiliateLink> {
  const id = crypto.randomUUID();
  const now = jstNow();

  let attempt = 0;
  while (true) {
    attempt++;
    const len = attempt <= 3 ? 6 : 8;
    const refCode = _slugGen(len);

    try {
      await db
        .prepare(
          `INSERT INTO affiliate_links
             (id, affiliate_id, ref_code, label, line_account_id, offer_id, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        )
        .bind(
          id,
          input.affiliateId,
          refCode,
          input.label ?? null,
          input.lineAccountId ?? null,
          input.offerId ?? null,
          now,
        )
        .run();

      // Insert succeeded — fetch and return the row
      return (await db
        .prepare(`SELECT * FROM affiliate_links WHERE id = ?`)
        .bind(id)
        .first<AffiliateLink>())!;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/UNIQUE constraint failed/i.test(msg)) {
        // Collision — retry with a new slug
        continue;
      }
      throw err;
    }
  }
}

// ── getAffiliateLinkByRefCode ────────────────────────────────────────────────

export async function getAffiliateLinkByRefCode(
  db: D1Database,
  refCode: string,
): Promise<AffiliateLink | null> {
  return db
    .prepare(`SELECT * FROM affiliate_links WHERE ref_code = ?`)
    .bind(refCode)
    .first<AffiliateLink>();
}

// ── listAffiliateLinks ───────────────────────────────────────────────────────

export async function listAffiliateLinks(
  db: D1Database,
  affiliateId: string,
): Promise<AffiliateLink[]> {
  const result = await db
    .prepare(
      `SELECT * FROM affiliate_links WHERE affiliate_id = ? ORDER BY created_at DESC`,
    )
    .bind(affiliateId)
    .all<AffiliateLink>();
  return result.results;
}

// ── countAffiliateLinks ──────────────────────────────────────────────────────

export async function countAffiliateLinks(
  db: D1Database,
  affiliateId: string,
): Promise<number> {
  const row = await db
    .prepare(`SELECT COUNT(*) AS cnt FROM affiliate_links WHERE affiliate_id = ?`)
    .bind(affiliateId)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
}

// ── incrementAffiliateLinkClick ──────────────────────────────────────────────

export async function incrementAffiliateLinkClick(
  db: D1Database,
  refCode: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE affiliate_links SET click_count = click_count + 1 WHERE ref_code = ?`,
    )
    .bind(refCode)
    .run();
}

// ── getAffiliateByFriendId ───────────────────────────────────────────────────

export async function getAffiliateByFriendId(
  db: D1Database,
  friendId: string,
): Promise<Affiliate | null> {
  return db
    .prepare(`SELECT * FROM affiliates WHERE friend_id = ?`)
    .bind(friendId)
    .first<Affiliate>();
}
