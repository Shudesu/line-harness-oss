import { jstNow } from './utils.js';
import { createAffiliateLink } from './affiliate-links.js';
import type { AffiliateLink } from './affiliate-links.js';
import { ensureDefaultMileageProgram } from './mileage.js';
// =============================================================================
// Affiliate Offers (案件) — ASP Phase 2
// =============================================================================
//
// An "offer" is a fixed-reward campaign an affiliate can join. Joining ("enroll")
// issues an offer-scoped affiliate_link (idempotent per affiliate×offer). The
// offer may carry a tag + scenario applied to friends who arrive via its links.

export interface AffiliateOffer {
  id: string;
  name: string;
  description: string | null;
  reward_amount: number;
  reward_miles: number;
  mileage_program_id: string;
  line_account_id: string | null;
  tag_id: string | null;
  scenario_id: string | null;
  is_active: number;
  created_at: string;
}

// ── CRUD ─────────────────────────────────────────────────────────────────

export interface CreateAffiliateOfferInput {
  name: string;
  description?: string | null;
  /** Fixed reward per conversion, in yen. Defaults to 0. */
  rewardAmount?: number;
  /** Harness miles granted when the conversion is approved. Defaults to 0. */
  rewardMiles?: number;
  mileageProgramId?: string;
  lineAccountId?: string | null;
  tagId?: string | null;
  scenarioId?: string | null;
}

export async function createAffiliateOffer(
  db: D1Database,
  input: CreateAffiliateOfferInput,
): Promise<AffiliateOffer> {
  const id = crypto.randomUUID();
  const now = jstNow();
  if (!input.mileageProgramId || input.mileageProgramId === 'default') {
    await ensureDefaultMileageProgram(db);
  }

  await db
    .prepare(
      `INSERT INTO affiliate_offers
         (id, name, description, reward_amount, reward_miles, mileage_program_id,
          line_account_id, tag_id, scenario_id, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .bind(
      id,
      input.name,
      input.description ?? null,
      input.rewardAmount ?? 0,
      input.rewardMiles ?? 0,
      input.mileageProgramId ?? 'default',
      input.lineAccountId ?? null,
      input.tagId ?? null,
      input.scenarioId ?? null,
      now,
    )
    .run();

  return (await getAffiliateOfferById(db, id))!;
}

export async function getAffiliateOfferById(
  db: D1Database,
  id: string,
): Promise<AffiliateOffer | null> {
  return db
    .prepare(`SELECT * FROM affiliate_offers WHERE id = ?`)
    .bind(id)
    .first<AffiliateOffer>();
}

export async function listAffiliateOffers(
  db: D1Database,
  opts: { activeOnly?: boolean } = {},
): Promise<AffiliateOffer[]> {
  const where = opts.activeOnly ? `WHERE is_active = 1` : '';
  const result = await db
    .prepare(`SELECT * FROM affiliate_offers ${where} ORDER BY created_at DESC`)
    .all<AffiliateOffer>();
  return result.results;
}

export type UpdateAffiliateOfferInput = Partial<
  Pick<
    AffiliateOffer,
    | 'name'
    | 'description'
    | 'reward_amount'
    | 'reward_miles'
    | 'mileage_program_id'
    | 'line_account_id'
    | 'tag_id'
    | 'scenario_id'
    | 'is_active'
  >
>;

export async function updateAffiliateOffer(
  db: D1Database,
  id: string,
  updates: UpdateAffiliateOfferInput,
): Promise<AffiliateOffer | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  const set = (col: keyof UpdateAffiliateOfferInput) => {
    if (updates[col] !== undefined) {
      fields.push(`${col} = ?`);
      values.push(updates[col]);
    }
  };
  set('name');
  set('description');
  set('reward_amount');
  set('reward_miles');
  set('mileage_program_id');
  set('line_account_id');
  set('tag_id');
  set('scenario_id');
  set('is_active');

  if (fields.length === 0) return getAffiliateOfferById(db, id);

  values.push(id);
  await db
    .prepare(`UPDATE affiliate_offers SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return getAffiliateOfferById(db, id);
}

// ── enroll (idempotent per affiliate×offer) ────────────────────────────────

export interface EnrollAffiliateInOfferInput {
  affiliateId: string;
  offerId: string;
}

/**
 * Enroll an affiliate in an offer, returning their offer-scoped link.
 *
 * Idempotent: if the affiliate already has a link for this offer, that link is
 * returned unchanged (`existing: true`). Otherwise a fresh link is issued with
 * offer_id set and label = offer.name (`existing: false`).
 *
 * There is no (affiliate_id, offer_id) UNIQUE constraint, so this uses the same
 * read-then-create + re-check pattern as the self-register endpoint (single LIFF
 * user operating on their own affiliate, so concurrent double-enroll is not a
 * concern in practice). The post-create re-check collapses a rare race to the
 * earliest-created row.
 */
export async function enrollAffiliateInOffer(
  db: D1Database,
  input: EnrollAffiliateInOfferInput,
): Promise<{ link: AffiliateLink; existing: boolean }> {
  const existing = await findOfferLink(db, input.affiliateId, input.offerId);
  if (existing) return { link: existing, existing: true };

  const offer = await getAffiliateOfferById(db, input.offerId);
  if (!offer) throw new Error('offer not found');

  const created = await createAffiliateLink(db, {
    affiliateId: input.affiliateId,
    label: offer.name,
    lineAccountId: offer.line_account_id ?? null,
    offerId: input.offerId,
  });

  // Re-check for the earliest link in case a concurrent enroll created one first.
  const winner = await findOfferLink(db, input.affiliateId, input.offerId);
  if (winner && winner.id !== created.id) {
    return { link: winner, existing: true };
  }
  return { link: created, existing: false };
}

async function findOfferLink(
  db: D1Database,
  affiliateId: string,
  offerId: string,
): Promise<AffiliateLink | null> {
  return db
    .prepare(
      `SELECT * FROM affiliate_links
        WHERE affiliate_id = ? AND offer_id = ?
        ORDER BY created_at ASC, id ASC
        LIMIT 1`,
    )
    .bind(affiliateId, offerId)
    .first<AffiliateLink>();
}

// ── approval ───────────────────────────────────────────────────────────────

/**
 * Approve or reject an affiliate-attributed conversion event.
 *
 * Only affiliate-attributed rows (affiliate_id IS NOT NULL) are meaningful; the
 * UPDATE is guarded on that so non-attributed rows never gain a status. Stamps
 * approved_at with the decision time (for both approve and reject).
 *
 * The WHERE clause includes `approval_status IS NULL OR approval_status != ?`
 * so re-setting the same status is a no-op (changes = 0) — this prevents
 * double-approval notifications when an admin double-clicks.
 *
 * @returns
 *   - `true`          — row was updated (status changed)
 *   - `'already_set'` — row exists and attributed but status was already this value
 *   - `false`         — row not found or not affiliate-attributed
 */
export async function setConversionApproval(
  db: D1Database,
  eventId: string,
  status: 'approved' | 'rejected',
): Promise<boolean | 'already_set'> {
  const now = jstNow();
  const result = await db
    .prepare(
      `UPDATE conversion_events
          SET approval_status = ?, approved_at = ?
        WHERE id = ? AND affiliate_id IS NOT NULL
          AND (approval_status IS NULL OR approval_status != ?)`,
    )
    .bind(status, now, eventId, status)
    .run();
  if ((result.meta?.changes ?? 0) > 0) return true;

  // Distinguish no-op (same status already set) from truly missing/non-attributed.
  const existing = await db
    .prepare(
      `SELECT 1 FROM conversion_events WHERE id = ? AND affiliate_id IS NOT NULL AND approval_status = ?`,
    )
    .bind(eventId, status)
    .first<{ 1: number }>();
  return existing ? 'already_set' : false;
}

/** Resolved attribution detail for an affiliate-attributed conversion event. */
export interface ConversionApprovalNotifyInfo {
  affiliateId: string;
  /** Offer name resolved via attributed_ref_code → link.offer_id, or null. */
  offerName: string | null;
  /** Fixed reward for the offer (0 when offer-less). */
  rewardAmount: number;
}

/**
 * Fetch the info needed to push an approval notification to the attributed
 * affiliate: the affiliate id, and (via attributed_ref_code → affiliate_link →
 * offer) the offer name + fixed reward amount.
 *
 * Returns null when the event is missing or not affiliate-attributed. When the
 * attribution is offer-less (generic link), `offerName` is null and
 * `rewardAmount` is 0.
 */
export async function getConversionApprovalNotifyInfo(
  db: D1Database,
  eventId: string,
): Promise<ConversionApprovalNotifyInfo | null> {
  const row = await db
    .prepare(
      `SELECT ce.affiliate_id AS affiliate_id,
              off.name AS offer_name,
              off.reward_amount AS reward_amount
         FROM conversion_events ce
         LEFT JOIN affiliate_links al ON al.ref_code = ce.attributed_ref_code
         LEFT JOIN affiliate_offers off ON off.id = al.offer_id
        WHERE ce.id = ? AND ce.affiliate_id IS NOT NULL`,
    )
    .bind(eventId)
    .first<{
      affiliate_id: string;
      offer_name: string | null;
      reward_amount: number | null;
    }>();
  if (!row) return null;
  return {
    affiliateId: row.affiliate_id,
    offerName: row.offer_name,
    rewardAmount: row.reward_amount ?? 0,
  };
}
