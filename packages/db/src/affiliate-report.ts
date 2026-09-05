import { ATTRIBUTION_WINDOW_DAYS } from './affiliate-attribution.js';

// =============================================================================
// Affiliate Report v2 + Journey aggregation (ASP)
// =============================================================================
//
// Set-based aggregation for affiliate reporting and per-friend journeys. These
// mirror the last-touch rules of resolveAffiliateAttribution (see that file's
// header), expressed as JOINs so a report never fans a friend list back into an
// `IN (?, ?, …)` bind list (D1 caps bind vars at ~100; see
// feedback-d1-no-large-in-clauses).
//
// Timestamp comparison note (Task 4 boundary-bug lesson):
//   ref_tracking.created_at / friends.created_at can be JST ISO (+09:00) or a
//   SQLite datetime('now') space-separated UTC string. Raw string comparison
//   mixes formats and produces boundary errors. Every window / ordering check
//   below uses julianday() so it compares real instants regardless of format.

// ── friendAdds: attributed-at-add-time last-touch ────────────────────────────
//
// A friend "belongs" to an affiliate for the friendAdds metric when, at the
// friend's created_at instant, the winning last-touch (newest eligible touch
// within the 90-day window, self-clicks excluded) maps to that affiliate.
//
// Expressed set-based: the friend's own newest eligible touch (by julianday)
// within [created_at - 90d, created_at] whose ref_code maps to an affiliate,
// excluding self-clicks. A correlated subquery picks that winning ref_code per
// friend; we then group by the winning affiliate.
//
// This fragment references `friends f` from the outer query.
//
// Exported so the all-affiliates aggregate (getAffiliateReport in affiliates.ts)
// resolves each friend's winning affiliate with the *identical* expression: a
// single pass over friends, grouped by winner, so the list view's friend_adds
// column matches the per-affiliate report exactly.
export const FRIEND_ADD_WINNER_SUBQUERY = `
  SELECT al2.affiliate_id
    FROM ref_tracking rt2
    JOIN affiliate_links al2 ON al2.ref_code = rt2.ref_code
    JOIN affiliates a2 ON a2.id = al2.affiliate_id
   WHERE rt2.friend_id = f.id
     AND julianday(rt2.created_at) >= julianday(f.created_at) - ${ATTRIBUTION_WINDOW_DAYS}
     AND julianday(rt2.created_at) <= julianday(f.created_at)
     AND (a2.friend_id IS NULL OR a2.friend_id != rt2.friend_id)
   ORDER BY julianday(rt2.created_at) DESC
   LIMIT 1
`;

export interface AffiliateReportV2 {
  affiliateId: string;
  affiliateName: string;
  code: string;
  commissionRate: number;
  /** ref_tracking touches whose ref_code maps to one of this affiliate's links. */
  clicks: number;
  /** Denormalized click_count summed across the affiliate's links (redirect hits). */
  linkClicks: number;
  /** Friends whose add-time last-touch attribution is this affiliate. */
  friendAdds: number;
  /**
   * Conversions attributed to this affiliate (conversion_events snapshot),
   * EXCLUDING rejected CVs. = conversionsPending + conversionsApproved.
   */
  conversions: number;
  /** Attributed CVs still awaiting review (approval_status pending OR NULL). */
  conversionsPending: number;
  /** Attributed CVs approved by a reviewer. */
  conversionsApproved: number;
  /** Attributed CVs rejected by a reviewer (excluded from headline conversions/revenue). */
  conversionsRejected: number;
  /** Conversion count broken down by conversion point (rejected excluded). */
  conversionsByPoint: Array<{ conversionPointId: string; name: string; count: number; value: number }>;
  /** Sum of conversion point values across non-rejected attributed conversions. */
  revenue: number;
  /** revenue * commissionRate. */
  estimatedCommission: number;
  /**
   * Confirmed reward: SUM over APPROVED attributed CVs of the offer reward_amount
   * resolved via attributed_ref_code → affiliate_links.offer_id → affiliate_offers.
   * Approved CVs through offer-less links contribute 0 (no reward configured).
   */
  confirmedReward: number;
  /** Per-offer breakdown for approved/pending CVs + confirmed reward. */
  byOffer: Array<{
    offerId: string;
    offerName: string;
    rewardAmount: number;
    conversionsApproved: number;
    conversionsPending: number;
    confirmedReward: number;
  }>;
  /** Attributed friends sharing an identity_key within this affiliate (>=2). */
  duplicateFlags: Array<{ friendId: string; identityKey: string }>;
}

export interface AffiliateReportOptions {
  startDate?: string;
  endDate?: string;
  /**
   * The canonical IDENTITY_KEY_SQL fragment (from the worker's lib/identity-key).
   * Passed in so packages/db stays decoupled from apps/worker while reusing the
   * exact same duplicate-detection expression. Must reference `friends.*`.
   */
  identityKeySql: string;
}

/**
 * Compute the v2 affiliate report for a single affiliate. Returns null when the
 * affiliate does not exist.
 */
export async function getAffiliateReportV2(
  db: D1Database,
  affiliateId: string,
  opts: AffiliateReportOptions,
): Promise<AffiliateReportV2 | null> {
  const affiliate = await db
    .prepare(`SELECT id, name, code, commission_rate FROM affiliates WHERE id = ?`)
    .bind(affiliateId)
    .first<{ id: string; name: string; code: string; commission_rate: number }>();
  if (!affiliate) return null;

  const { startDate, endDate, identityKeySql } = opts;

  // ── clicks: ref_tracking touches on this affiliate's links ─────────────────
  const clickConds: string[] = ['al.affiliate_id = ?'];
  const clickBinds: unknown[] = [affiliateId];
  if (startDate) {
    clickConds.push('julianday(rt.created_at) >= julianday(?)');
    clickBinds.push(startDate);
  }
  if (endDate) {
    clickConds.push('julianday(rt.created_at) <= julianday(?)');
    clickBinds.push(endDate);
  }
  const clicksRow = await db
    .prepare(
      `SELECT COUNT(*) AS clicks
         FROM ref_tracking rt
         JOIN affiliate_links al ON al.ref_code = rt.ref_code
        WHERE ${clickConds.join(' AND ')}`,
    )
    .bind(...clickBinds)
    .first<{ clicks: number }>();

  // ── linkClicks: denormalized click_count on the affiliate's links ──────────
  const linkClicksRow = await db
    .prepare(
      `SELECT COALESCE(SUM(click_count), 0) AS link_clicks
         FROM affiliate_links WHERE affiliate_id = ?`,
    )
    .bind(affiliateId)
    .first<{ link_clicks: number }>();

  // ── friendAdds: friends whose add-time last-touch is this affiliate ────────
  // Correlated subquery resolves each friend's winning affiliate at their
  // created_at; the outer WHERE keeps only friends won by this affiliate.
  // friends.created_at date filter (if given) bounds which adds are counted.
  const friendAddConds: string[] = [`(${FRIEND_ADD_WINNER_SUBQUERY}) = ?`];
  const friendAddBinds: unknown[] = [affiliateId];
  if (startDate) {
    friendAddConds.push('julianday(f.created_at) >= julianday(?)');
    friendAddBinds.push(startDate);
  }
  if (endDate) {
    friendAddConds.push('julianday(f.created_at) <= julianday(?)');
    friendAddBinds.push(endDate);
  }
  const friendAddsRow = await db
    .prepare(
      `SELECT COUNT(*) AS friend_adds
         FROM friends f
        WHERE ${friendAddConds.join(' AND ')}`,
    )
    .bind(...friendAddBinds)
    .first<{ friend_adds: number }>();

  // ── conversions + conversionsByPoint + revenue + approval breakdown ─────────
  // conversion_events already snapshots affiliate_id at CV time, so we only read
  // that column (no re-attribution). Joined to conversion_points for value/name.
  //
  // Approval semantics (ASP Phase 2):
  //   - approval_status NULL is a historical attributed row → treated as pending.
  //   - headline conversions/revenue/conversionsByPoint EXCLUDE rejected CVs.
  //   - conversionsPending / conversionsApproved / conversionsRejected report the
  //     approval-status breakdown of the attributed CVs.
  //
  // A single normalized status expression is reused everywhere so NULL == pending
  // is applied consistently.
  const STATUS_EXPR = `COALESCE(ce.approval_status, 'pending')`;

  const cvConds: string[] = ['ce.affiliate_id = ?'];
  const cvBinds: unknown[] = [affiliateId];
  if (startDate) {
    cvConds.push('julianday(ce.created_at) >= julianday(?)');
    cvBinds.push(startDate);
  }
  if (endDate) {
    cvConds.push('julianday(ce.created_at) <= julianday(?)');
    cvBinds.push(endDate);
  }
  const cvWhere = cvConds.join(' AND ');

  // conversionsByPoint + revenue: non-rejected only.
  const byPoint = await db
    .prepare(
      `SELECT cp.id AS conversion_point_id,
              cp.name AS name,
              COUNT(*) AS count,
              COALESCE(SUM(cp.value), 0) AS value
         FROM conversion_events ce
         JOIN conversion_points cp ON cp.id = ce.conversion_point_id
        WHERE ${cvWhere} AND ${STATUS_EXPR} != 'rejected'
        GROUP BY cp.id, cp.name
        ORDER BY count DESC`,
    )
    .bind(...cvBinds)
    .all<{ conversion_point_id: string; name: string; count: number; value: number }>();

  const conversionsByPoint = byPoint.results.map((r) => ({
    conversionPointId: r.conversion_point_id,
    name: r.name,
    count: r.count,
    value: r.value,
  }));
  const revenue = conversionsByPoint.reduce((s, p) => s + p.value, 0);
  const estimatedCommission = revenue * affiliate.commission_rate;

  // approval breakdown: one grouped pass over the attributed CVs.
  const statusRows = await db
    .prepare(
      `SELECT ${STATUS_EXPR} AS status, COUNT(*) AS count
         FROM conversion_events ce
        WHERE ${cvWhere}
        GROUP BY ${STATUS_EXPR}`,
    )
    .bind(...cvBinds)
    .all<{ status: string; count: number }>();

  let conversionsPending = 0;
  let conversionsApproved = 0;
  let conversionsRejected = 0;
  for (const r of statusRows.results) {
    if (r.status === 'approved') conversionsApproved = r.count;
    else if (r.status === 'rejected') conversionsRejected = r.count;
    else conversionsPending += r.count; // 'pending' (incl. coalesced NULL)
  }
  // headline conversions excludes rejected.
  const conversions = conversionsPending + conversionsApproved;

  // confirmedReward + byOffer: JOIN approved CVs → link → offer, SUM reward_amount.
  // JOIN-based (no IN fan-out). Approved CVs whose link has no offer resolve to a
  // NULL offer row → contribute 0 and never appear in byOffer (LEFT JOIN would
  // add an off.id IS NULL bucket we don't want).
  //
  // confirmedReward is computed as the byOffer sum so both stay consistent.
  const offerRows = await db
    .prepare(
      `SELECT off.id AS offer_id,
              off.name AS offer_name,
              off.reward_amount AS reward_amount,
              SUM(CASE WHEN ${STATUS_EXPR} = 'approved' THEN 1 ELSE 0 END) AS approved,
              SUM(CASE WHEN ${STATUS_EXPR} = 'pending' THEN 1 ELSE 0 END) AS pending
         FROM conversion_events ce
         JOIN affiliate_links al ON al.ref_code = ce.attributed_ref_code
         JOIN affiliate_offers off ON off.id = al.offer_id
        WHERE ${cvWhere} AND ${STATUS_EXPR} != 'rejected'
        GROUP BY off.id, off.name, off.reward_amount
        ORDER BY approved DESC, off.name ASC`,
    )
    .bind(...cvBinds)
    .all<{ offer_id: string; offer_name: string; reward_amount: number; approved: number; pending: number }>();

  const byOffer = offerRows.results.map((r) => ({
    offerId: r.offer_id,
    offerName: r.offer_name,
    rewardAmount: r.reward_amount,
    conversionsApproved: r.approved,
    conversionsPending: r.pending,
    confirmedReward: r.approved * r.reward_amount,
  }));
  const confirmedReward = byOffer.reduce((s, o) => s + o.confirmedReward, 0);

  // ── duplicateFlags: attributed friends sharing an identity_key ─────────────
  // "Attributed friend" here = friend whose add-time last-touch is this
  // affiliate (same winner subquery as friendAdds). Among those, flag every
  // friend whose identity_key is shared by >=2 friends in the set.
  // No IN(?) fan-out: the shared-key set is a self-JOIN-free windowless GROUP BY
  // subquery, joined back to the base set.
  const dupRows = await db
    .prepare(
      `WITH attributed AS (
         SELECT friends.id AS friend_id, (${identityKeySql}) AS identity_key
           FROM friends
          WHERE (
            SELECT al2.affiliate_id
              FROM ref_tracking rt2
              JOIN affiliate_links al2 ON al2.ref_code = rt2.ref_code
              JOIN affiliates a2 ON a2.id = al2.affiliate_id
             WHERE rt2.friend_id = friends.id
               AND julianday(rt2.created_at) >= julianday(friends.created_at) - ${ATTRIBUTION_WINDOW_DAYS}
               AND julianday(rt2.created_at) <= julianday(friends.created_at)
               AND (a2.friend_id IS NULL OR a2.friend_id != rt2.friend_id)
             ORDER BY julianday(rt2.created_at) DESC
             LIMIT 1
          ) = ?
       ),
       dup_keys AS (
         SELECT identity_key FROM attributed
          GROUP BY identity_key HAVING COUNT(*) >= 2
       )
       SELECT a.friend_id, a.identity_key
         FROM attributed a
         JOIN dup_keys d ON d.identity_key = a.identity_key
        ORDER BY a.identity_key, a.friend_id`,
    )
    .bind(affiliateId)
    .all<{ friend_id: string; identity_key: string }>();

  const duplicateFlags = dupRows.results.map((r) => ({
    friendId: r.friend_id,
    identityKey: r.identity_key,
  }));

  return {
    affiliateId: affiliate.id,
    affiliateName: affiliate.name,
    code: affiliate.code,
    commissionRate: affiliate.commission_rate,
    clicks: clicksRow?.clicks ?? 0,
    linkClicks: linkClicksRow?.link_clicks ?? 0,
    friendAdds: friendAddsRow?.friend_adds ?? 0,
    conversions,
    conversionsPending,
    conversionsApproved,
    conversionsRejected,
    conversionsByPoint,
    revenue,
    estimatedCommission,
    confirmedReward,
    byOffer,
    duplicateFlags,
  };
}

// ── Per-link stats (self API) ────────────────────────────────────────────────

/** Per-link performance counters keyed by ref_code. */
export interface AffiliateLinkStat {
  friendAdds: number;
  /**
   * Non-rejected attributed conversions on this link = conversionsApproved +
   * conversionsPending. Kept as the pre-approval `conversions` key for backward
   * compatibility (rejected CVs are now excluded).
   */
  conversions: number;
  /** Attributed CVs on this link still awaiting review (pending OR NULL status). */
  conversionsPending: number;
  /** Attributed CVs on this link approved by a reviewer. */
  conversionsApproved: number;
}

/**
 * Per-ref_code friendAdds + conversions for a single affiliate, returned as a
 * Map keyed by ref_code. Links with no activity are simply absent from the map
 * (callers default those to 0).
 *
 * Semantics are chosen so per-link sums reconcile with the per-affiliate report:
 *
 *   - conversions: grouped from conversion_events by attributed_ref_code, scoped
 *     to this affiliate via the affiliate_id snapshot. (getAffiliateReportV2's
 *     conversions counts the same rows, just without the per-ref_code grouping.)
 *
 *   - friendAdds: resolved with the IDENTICAL add-time last-touch winner logic as
 *     the per-affiliate friendAdds — a friend belongs to the affiliate when its
 *     winning ref_code maps to one of the affiliate's links. We reuse the winner
 *     subquery (which returns affiliate_id) to keep only friends won by THIS
 *     affiliate, then a parallel subquery yields that same winner's ref_code so we
 *     can COUNT per ref_code. Summing this map's friendAdds equals the
 *     per-affiliate friendAdds exactly (same winner, same window, same self-click
 *     exclusion).
 */
export async function getAffiliateLinkStats(
  db: D1Database,
  affiliateId: string,
): Promise<Map<string, AffiliateLinkStat>> {
  const stats = new Map<string, AffiliateLinkStat>();
  const ensure = (refCode: string): AffiliateLinkStat => {
    let s = stats.get(refCode);
    if (!s) {
      s = { friendAdds: 0, conversions: 0, conversionsPending: 0, conversionsApproved: 0 };
      stats.set(refCode, s);
    }
    return s;
  };

  // conversions per link: attributed_ref_code grouped, scoped by affiliate_id
  // snapshot. NULL attributed_ref_code rows (attributed by id but without a
  // ref_code) can't map to a link, so they're excluded from the per-link view.
  //
  // Approval-aware: rejected CVs are excluded from every count. `conversions`
  // is the non-rejected total (approved + pending) for backward compatibility;
  // NULL approval_status is treated as pending (historical rows).
  const cvRows = await db
    .prepare(
      `SELECT attributed_ref_code AS ref_code,
              SUM(CASE WHEN COALESCE(approval_status, 'pending') = 'approved' THEN 1 ELSE 0 END) AS approved,
              SUM(CASE WHEN COALESCE(approval_status, 'pending') = 'pending' THEN 1 ELSE 0 END) AS pending
         FROM conversion_events
        WHERE affiliate_id = ? AND attributed_ref_code IS NOT NULL
        GROUP BY attributed_ref_code`,
    )
    .bind(affiliateId)
    .all<{ ref_code: string; approved: number; pending: number }>();
  for (const r of cvRows.results) {
    const s = ensure(r.ref_code);
    s.conversionsApproved = r.approved;
    s.conversionsPending = r.pending;
    s.conversions = r.approved + r.pending;
  }

  // friendAdds per link: same winner logic as per-affiliate friendAdds, but we
  // bucket by the WINNING ref_code. The outer WHERE keeps only friends whose
  // winning affiliate is this one (FRIEND_ADD_WINNER_SUBQUERY), and the parallel
  // subquery re-resolves that winner's ref_code to GROUP BY.
  const faRows = await db
    .prepare(
      `SELECT winner_ref_code AS ref_code, COUNT(*) AS friend_adds
         FROM (
           SELECT (
             SELECT rt2.ref_code
               FROM ref_tracking rt2
               JOIN affiliate_links al2 ON al2.ref_code = rt2.ref_code
               JOIN affiliates a2 ON a2.id = al2.affiliate_id
              WHERE rt2.friend_id = f.id
                AND julianday(rt2.created_at) >= julianday(f.created_at) - ${ATTRIBUTION_WINDOW_DAYS}
                AND julianday(rt2.created_at) <= julianday(f.created_at)
                AND (a2.friend_id IS NULL OR a2.friend_id != rt2.friend_id)
              ORDER BY julianday(rt2.created_at) DESC
              LIMIT 1
           ) AS winner_ref_code
             FROM friends f
            WHERE (${FRIEND_ADD_WINNER_SUBQUERY}) = ?
         )
        WHERE winner_ref_code IS NOT NULL
        GROUP BY winner_ref_code`,
    )
    .bind(affiliateId)
    .all<{ ref_code: string; friend_adds: number }>();
  for (const r of faRows.results) {
    ensure(r.ref_code).friendAdds = r.friend_adds;
  }

  return stats;
}

// ── Journey (single friend) ──────────────────────────────────────────────────

export type JourneyEventType = 'touch' | 'friend_add' | 'form' | 'conversion';

export interface JourneyEvent {
  at: string;
  type: JourneyEventType;
  refCode?: string;
  affiliateId?: string;
  label?: string;
  detail?: string;
}

/**
 * Time-ordered (ascending) journey for one friend: ref_tracking touches,
 * the friend_add moment, form submissions, and conversions. A single UNION ALL
 * over the four sources ordered by julianday() so mixed timestamp formats sort
 * by true instant.
 */
export async function getFriendJourney(
  db: D1Database,
  friendId: string,
): Promise<JourneyEvent[]> {
  const friend = await db
    .prepare(`SELECT id FROM friends WHERE id = ?`)
    .bind(friendId)
    .first<{ id: string }>();
  if (!friend) return [];

  const rows = await db
    .prepare(
      `SELECT at, type, ref_code, affiliate_id, label, detail FROM (
         -- touches
         SELECT rt.created_at AS at, 'touch' AS type, rt.ref_code AS ref_code,
                al.affiliate_id AS affiliate_id, NULL AS label, rt.source_url AS detail
           FROM ref_tracking rt
           LEFT JOIN affiliate_links al ON al.ref_code = rt.ref_code
          WHERE rt.friend_id = ?
         UNION ALL
         -- friend add
         SELECT f.created_at AS at, 'friend_add' AS type, NULL AS ref_code,
                NULL AS affiliate_id, NULL AS label, NULL AS detail
           FROM friends f WHERE f.id = ?
         UNION ALL
         -- form submissions
         SELECT fs.created_at AS at, 'form' AS type, NULL AS ref_code,
                NULL AS affiliate_id, fo.name AS label, NULL AS detail
           FROM form_submissions fs
           LEFT JOIN forms fo ON fo.id = fs.form_id
          WHERE fs.friend_id = ?
         UNION ALL
         -- conversions
         SELECT ce.created_at AS at, 'conversion' AS type, ce.attributed_ref_code AS ref_code,
                ce.affiliate_id AS affiliate_id, cp.name AS label, NULL AS detail
           FROM conversion_events ce
           LEFT JOIN conversion_points cp ON cp.id = ce.conversion_point_id
          WHERE ce.friend_id = ?
       )
       ORDER BY julianday(at) ASC, type ASC`,
    )
    .bind(friendId, friendId, friendId, friendId)
    .all<{
      at: string;
      type: JourneyEventType;
      ref_code: string | null;
      affiliate_id: string | null;
      label: string | null;
      detail: string | null;
    }>();

  return rows.results.map((r) => {
    const ev: JourneyEvent = { at: r.at, type: r.type };
    if (r.ref_code != null) ev.refCode = r.ref_code;
    if (r.affiliate_id != null) ev.affiliateId = r.affiliate_id;
    if (r.label != null) ev.label = r.label;
    if (r.detail != null) ev.detail = r.detail;
    return ev;
  });
}

// ── Journeys (per affiliate, cursor-paginated) ───────────────────────────────

export interface AffiliateJourneySummary {
  friendId: string;
  displayName: string | null;
  addedAt: string;
  refCode: string | null;
  touchCount: number;
  formCount: number;
  conversionCount: number;
  lastEventAt: string;
}

export interface AffiliateJourneysPage {
  items: AffiliateJourneySummary[];
  nextCursor: { beforeAt: string; beforeId: string } | null;
}

/**
 * Per-affiliate friend journey summaries, newest add first, cursor-paginated on
 * the (added_at, friend_id) composite cursor — same scheme as GET /api/chats.
 * Offset paging is avoided because concurrent new adds would shift rows and drop
 * items across pages.
 *
 * "Attributed friend" = friend whose add-time last-touch is this affiliate
 * (identical winner subquery as friendAdds).
 */
export async function getAffiliateJourneys(
  db: D1Database,
  affiliateId: string,
  opts: { limit?: number; beforeAt?: string; beforeId?: string } = {},
): Promise<AffiliateJourneysPage> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const useCursor = Boolean(opts.beforeAt && opts.beforeId);

  const binds: unknown[] = [affiliateId];
  let cursorClause = '';
  if (useCursor) {
    // (added_at, friend_id) strictly-before cursor, compared by real instant.
    cursorClause = `AND (
      julianday(f.created_at) < julianday(?)
      OR (julianday(f.created_at) = julianday(?) AND f.id < ?)
    )`;
    binds.push(opts.beforeAt, opts.beforeAt, opts.beforeId);
  }
  // fetch limit+1 to detect whether another page exists
  binds.push(limit + 1);

  const rows = await db
    .prepare(
      `WITH attributed AS (
         SELECT f.id AS friend_id, f.display_name AS display_name, f.created_at AS added_at,
                (
                  SELECT rt2.ref_code
                    FROM ref_tracking rt2
                    JOIN affiliate_links al2 ON al2.ref_code = rt2.ref_code
                    JOIN affiliates a2 ON a2.id = al2.affiliate_id
                   WHERE rt2.friend_id = f.id
                     AND julianday(rt2.created_at) >= julianday(f.created_at) - ${ATTRIBUTION_WINDOW_DAYS}
                     AND julianday(rt2.created_at) <= julianday(f.created_at)
                     AND (a2.friend_id IS NULL OR a2.friend_id != rt2.friend_id)
                   ORDER BY julianday(rt2.created_at) DESC
                   LIMIT 1
                ) AS ref_code
           FROM friends f
          WHERE (
            SELECT al3.affiliate_id
              FROM ref_tracking rt3
              JOIN affiliate_links al3 ON al3.ref_code = rt3.ref_code
              JOIN affiliates a3 ON a3.id = al3.affiliate_id
             WHERE rt3.friend_id = f.id
               AND julianday(rt3.created_at) >= julianday(f.created_at) - ${ATTRIBUTION_WINDOW_DAYS}
               AND julianday(rt3.created_at) <= julianday(f.created_at)
               AND (a3.friend_id IS NULL OR a3.friend_id != rt3.friend_id)
             ORDER BY julianday(rt3.created_at) DESC
             LIMIT 1
          ) = ?
            ${cursorClause}
       )
       SELECT
         at.friend_id,
         at.display_name,
         at.added_at,
         at.ref_code,
         (SELECT COUNT(*) FROM ref_tracking rt WHERE rt.friend_id = at.friend_id) AS touch_count,
         (SELECT COUNT(*) FROM form_submissions fs WHERE fs.friend_id = at.friend_id) AS form_count,
         (SELECT COUNT(*) FROM conversion_events ce WHERE ce.friend_id = at.friend_id) AS conversion_count,
         -- newest event across all sources, as an ISO string, chosen by real instant
         (SELECT ev_at FROM (
            SELECT at.added_at AS ev_at
            UNION ALL SELECT rt.created_at FROM ref_tracking rt WHERE rt.friend_id = at.friend_id
            UNION ALL SELECT fs.created_at FROM form_submissions fs WHERE fs.friend_id = at.friend_id
            UNION ALL SELECT ce.created_at FROM conversion_events ce WHERE ce.friend_id = at.friend_id
          ) ORDER BY julianday(ev_at) DESC LIMIT 1) AS last_event_at
       FROM attributed at
       ORDER BY julianday(at.added_at) DESC, at.friend_id DESC
       LIMIT ?`,
    )
    .bind(...binds)
    .all<{
      friend_id: string;
      display_name: string | null;
      added_at: string;
      ref_code: string | null;
      touch_count: number;
      form_count: number;
      conversion_count: number;
      last_event_at: string;
    }>();

  const results = rows.results;
  const hasMore = results.length > limit;
  const page = hasMore ? results.slice(0, limit) : results;

  const items: AffiliateJourneySummary[] = page.map((r) => ({
    friendId: r.friend_id,
    displayName: r.display_name,
    addedAt: r.added_at,
    refCode: r.ref_code,
    touchCount: r.touch_count,
    formCount: r.form_count,
    conversionCount: r.conversion_count,
    lastEventAt: r.last_event_at,
  }));

  const nextCursor =
    hasMore && page.length > 0
      ? { beforeAt: page[page.length - 1].added_at, beforeId: page[page.length - 1].friend_id }
      : null;

  return { items, nextCursor };
}

// ── Conversion approval queue (admin) ────────────────────────────────────────

export interface ConversionApprovalRow {
  eventId: string;
  createdAt: string;
  friendId: string;
  friendName: string | null;
  affiliateId: string;
  affiliateName: string | null;
  /** Offer name resolved via attributed_ref_code → link.offer_id, if any. */
  offerName: string | null;
  conversionPointName: string | null;
  /** Conversion point value at report time (fixed reward is offer-side; this is the CV point value). */
  value: number | null;
  approvalStatus: 'pending' | 'approved' | 'rejected';
  /**
   * True when this event's friend shares an identity_key with ANOTHER
   * affiliate-attributed conversion friend of the SAME affiliate — the Phase 1
   * duplicate heuristic reapplied per affiliate. Fraud-review signal only.
   */
  duplicateFlag: boolean;
}

/**
 * List affiliate-attributed conversion events for the admin approval queue,
 * filtered by approval_status. Only rows with a non-NULL affiliate_id are in
 * scope (the approval flow never applies to organic CVs).
 *
 * duplicateFlag reuses the Phase 1 identity_key heuristic, scoped per affiliate:
 * a friend is flagged when their identity_key is shared by >=2 distinct friends
 * among the affiliate's attributed conversions. The identityKeySql fragment is
 * injected by the worker (same decoupling as getAffiliateReportV2) and must
 * reference `friends.*`.
 */
export async function getConversionApprovalQueue(
  db: D1Database,
  opts: {
    status: 'pending' | 'approved' | 'rejected';
    identityKeySql: string;
    limit?: number;
    offset?: number;
  },
): Promise<ConversionApprovalRow[]> {
  const { status, identityKeySql } = opts;
  const limit = opts.limit ?? 200;
  const offset = opts.offset ?? 0;

  // dup_keys: identity_keys shared by >=2 distinct attributed-conversion friends
  // WITHIN the same affiliate. Computed over the whole attributed-CV set (not
  // filtered by status) so the flag is stable regardless of which queue tab the
  // reviewer is on. No IN(?) fan-out — a GROUP BY subquery joined back per row.
  const result = await db
    .prepare(
      `WITH attributed_cv AS (
         SELECT DISTINCT ce.affiliate_id AS affiliate_id,
                friends.id AS friend_id,
                (${identityKeySql}) AS identity_key
           FROM conversion_events ce
           JOIN friends ON friends.id = ce.friend_id
          WHERE ce.affiliate_id IS NOT NULL
       ),
       dup_keys AS (
         SELECT affiliate_id, identity_key
           FROM attributed_cv
          GROUP BY affiliate_id, identity_key
         HAVING COUNT(*) >= 2
       )
       SELECT
         ce.id AS event_id,
         ce.created_at AS created_at,
         ce.friend_id AS friend_id,
         friends.display_name AS friend_name,
         ce.affiliate_id AS affiliate_id,
         a.name AS affiliate_name,
         off.name AS offer_name,
         cp.name AS conversion_point_name,
         cp.value AS value,
         ce.approval_status AS approval_status,
         (${identityKeySql}) AS identity_key,
         CASE WHEN dk.identity_key IS NOT NULL THEN 1 ELSE 0 END AS duplicate_flag
       FROM conversion_events ce
       JOIN friends ON friends.id = ce.friend_id
       LEFT JOIN affiliates a ON a.id = ce.affiliate_id
       LEFT JOIN conversion_points cp ON cp.id = ce.conversion_point_id
       LEFT JOIN affiliate_links al ON al.ref_code = ce.attributed_ref_code
       LEFT JOIN affiliate_offers off ON off.id = al.offer_id
       LEFT JOIN dup_keys dk
              ON dk.affiliate_id = ce.affiliate_id
             AND dk.identity_key = (${identityKeySql})
      WHERE ce.affiliate_id IS NOT NULL
        AND ce.approval_status = ?
      ORDER BY julianday(ce.created_at) DESC, ce.id DESC
      LIMIT ? OFFSET ?`,
    )
    .bind(status, limit, offset)
    .all<{
      event_id: string;
      created_at: string;
      friend_id: string;
      friend_name: string | null;
      affiliate_id: string;
      affiliate_name: string | null;
      offer_name: string | null;
      conversion_point_name: string | null;
      value: number | null;
      approval_status: 'pending' | 'approved' | 'rejected';
      duplicate_flag: number;
    }>();

  return result.results.map((r) => ({
    eventId: r.event_id,
    createdAt: r.created_at,
    friendId: r.friend_id,
    friendName: r.friend_name,
    affiliateId: r.affiliate_id,
    affiliateName: r.affiliate_name,
    offerName: r.offer_name,
    conversionPointName: r.conversion_point_name,
    value: r.value,
    approvalStatus: r.approval_status,
    duplicateFlag: r.duplicate_flag === 1,
  }));
}
