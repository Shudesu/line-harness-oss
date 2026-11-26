import { Hono, type Context } from 'hono';
import {
  getFriendByLineUserId,
  getAffiliateByFriendId,
  createAffiliate,
  createAffiliateLink,
  listAffiliateLinks,
  countAffiliateLinks,
  generateRefSlug,
  getLineAccounts,
  getAffiliateLinkStats,
  listAffiliateOffers,
  enrollAffiliateInOffer,
  getMileageSummaryForFriend,
  getMileageHistoryForFriend,
  getMileageSelfInsights,
  getMileageEarningOpportunitiesForFriend,
  type Affiliate,
  type AffiliateLink,
  type AffiliateLinkStat,
} from '@line-crm/db';
import { resolveLinkBaseUrl } from '../lib/link-base-url.js';
import { signCrossAccountToken } from '../lib/cross-account-token.js';
import type { Env } from '../index.js';

/**
 * Self-serve affiliate API for LIFF clients.
 *
 * Auth boundary: these endpoints are authenticated ONLY by a LINE access token
 * that the LIFF SDK obtains client-side. The token is verified against LINE's
 * OAuth2 + profile endpoints server-side; the resulting LINE userId is resolved
 * to a friend row, and the affiliate is resolved from THAT friend. Clients never
 * pass an affiliate_id — it is always derived server-side from the verified
 * token, so one affiliate can never read or mutate another's data.
 *
 * authMiddleware skips `/api/liff/*` (staff auth), so verification lives here.
 */
const affiliateSelfRoutes = new Hono<Env>();

/** Max self-issued links per affiliate. The 21st issuance is a 400. */
const MAX_SELF_LINKS = 20;

type ResolvedFriend = { id: string; display_name: string; user_id: string | null };

/**
 * Verify a LINE access token and resolve the backing friend row.
 *
 * Returns a discriminated result so callers can pick the right HTTP status in
 * a single pass:
 *   - 'invalid_token' → 401 (token could not be verified against LINE)
 *   - 'no_friend'     → 404 (token verified, but no friend row exists)
 *   - 'ok'            → proceed with the resolved friend
 */
async function resolveFriendFromLineToken(
  env: Env['Bindings'],
  accessToken: string,
): Promise<
  | { status: 'invalid_token' }
  | { status: 'no_friend' }
  | { status: 'ok'; friend: ResolvedFriend }
> {
  const db = env.DB;
  const v = await fetch(
    'https://api.line.me/oauth2/v2.1/verify?access_token=' +
      encodeURIComponent(accessToken),
  );
  if (!v.ok) return { status: 'invalid_token' };

  // The verify response carries the LINE Login channel (`client_id`) that
  // minted this token. Reject any token issued by a channel this deployment
  // does not own — otherwise a token from an unrelated LINE Login app whose
  // user happens to share a lineUserId could impersonate an affiliate.
  // Allowed channels = env default + every DB account's login channel, mirroring
  // the multi-account verification pattern in liff.ts.
  const verifyBody = await v
    .json<{ client_id?: string }>()
    .catch((): { client_id?: string } => ({}));
  const tokenClientId = verifyBody.client_id;
  if (!tokenClientId) return { status: 'invalid_token' };

  const allowedChannelIds = new Set<string>();
  if (env.LINE_LOGIN_CHANNEL_ID) allowedChannelIds.add(env.LINE_LOGIN_CHANNEL_ID);
  const dbAccounts = await getLineAccounts(db);
  for (const acct of dbAccounts) {
    if (acct.login_channel_id) allowedChannelIds.add(acct.login_channel_id);
  }
  if (!allowedChannelIds.has(tokenClientId)) return { status: 'invalid_token' };

  const prof = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!prof.ok) return { status: 'invalid_token' };

  const { userId } = await prof.json<{ userId: string }>();
  if (!userId) return { status: 'invalid_token' };

  const friend = await getFriendByLineUserId(db, userId);
  if (!friend) return { status: 'no_friend' };
  return { status: 'ok', friend: friend as unknown as ResolvedFriend };
}

/** Map a non-ok resolution to its JSON error response. */
function unresolvedResponse(
  c: Context<Env>,
  result: { status: 'invalid_token' } | { status: 'no_friend' },
) {
  if (result.status === 'invalid_token') {
    return c.json({ success: false, error: 'Invalid LINE access token' }, 401);
  }
  return c.json({ success: false, error: 'Friend not found' }, 404);
}

/**
 * Shape each affiliate link into the client-facing row. `stats` maps ref_code →
 * per-link counters (getAffiliateLinkStats). A link absent from the map (e.g. a
 * freshly issued link with no activity yet) defaults to zeros.
 */
function serializeLink(
  link: AffiliateLink,
  baseUrl: string,
  stats?: Map<string, AffiliateLinkStat>,
  offerNames?: Map<string, string>,
) {
  const s = stats?.get(link.ref_code);
  return {
    refCode: link.ref_code,
    label: link.label,
    url: `${baseUrl}/${link.ref_code}`,
    clickCount: link.click_count,
    friendAdds: s?.friendAdds ?? 0,
    // conversions = non-rejected total (approved + pending), kept for compat.
    conversions: s?.conversions ?? 0,
    conversionsPending: s?.conversionsPending ?? 0,
    conversionsApproved: s?.conversionsApproved ?? 0,
    offerId: link.offer_id ?? null,
    offerName: link.offer_id ? (offerNames?.get(link.offer_id) ?? null) : null,
  };
}

/**
 * Build an offerId → name lookup once per request so serializeLink can label
 * offer-scoped links without an N+1 fetch. Includes inactive offers so an
 * already-issued link's name still resolves after its offer is deactivated.
 */
async function loadOfferNames(db: D1Database): Promise<Map<string, string>> {
  const offers = await listAffiliateOffers(db, { activeOnly: false });
  return new Map(offers.map((o) => [o.id, o.name]));
}

function serializeAffiliate(aff: Affiliate) {
  return {
    id: aff.id,
    name: aff.name,
    code: aff.code,
    commissionRate: aff.commission_rate,
    isActive: Boolean(aff.is_active),
    friendId: aff.friend_id,
  };
}

/**
 * GET /api/liff/mileage/me — wallet for any verified LINE friend.
 *
 * This intentionally does not require affiliate registration. The same wallet
 * will later receive webinar, CTA, Instagram and other engagement mileage.
 */
affiliateSelfRoutes.get('/api/liff/mileage/me', async (c) => {
  try {
    const token = c.req.query('lineAccessToken');
    if (!token) {
      return c.json({ success: false, error: 'lineAccessToken is required' }, 400);
    }

    const resolved = await resolveFriendFromLineToken(c.env, token);
    if (resolved.status !== 'ok') return unresolvedResponse(c, resolved);

    const requestedLimit = Number.parseInt(c.req.query('limit') ?? '', 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(100, Math.max(1, requestedLimit))
      : 20;
    const [mileage, history, insights, rawOpportunities] = await Promise.all([
      getMileageSummaryForFriend(c.env.DB, resolved.friend.id),
      getMileageHistoryForFriend(c.env.DB, resolved.friend.id, { limit }),
      getMileageSelfInsights(c.env.DB, resolved.friend.id),
      getMileageEarningOpportunitiesForFriend(c.env.DB, resolved.friend.id),
    ]);
    const opportunities = await Promise.all(rawOpportunities.map(async (opportunity) => {
      if (opportunity.type !== 'friend_add'
          || opportunity.completed
          || !opportunity.targetAccountId
          || !resolved.friend.user_id) {
        return opportunity;
      }
      const token = await signCrossAccountToken(c.env.LINE_CHANNEL_SECRET, {
        userId: resolved.friend.user_id,
        targetAccountId: opportunity.targetAccountId,
      });
      const separator = opportunity.url.includes('?') ? '&' : '?';
      return { ...opportunity, url: `${opportunity.url}${separator}crossAccountToken=${encodeURIComponent(token)}` };
    }));
    return c.json({ success: true, mileage, history, insights, opportunities });
  } catch (err) {
    console.error('GET /api/liff/mileage/me error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * POST /api/liff/affiliate/register — idempotent self-registration.
 * Body: { lineAccessToken }. If already registered, returns the existing
 * affiliate + links. On first registration, auto-issues one link.
 */
affiliateSelfRoutes.post('/api/liff/affiliate/register', async (c) => {
  try {
    const body = await c.req
      .json<{ lineAccessToken?: string }>()
      .catch((): { lineAccessToken?: string } => ({}));
    const token = body.lineAccessToken;
    if (!token) {
      return c.json({ success: false, error: 'lineAccessToken is required' }, 400);
    }

    const db = c.env.DB;
    const resolved = await resolveFriendFromLineToken(c.env, token);
    if (resolved.status !== 'ok') {
      return unresolvedResponse(c, resolved);
    }
    const friend = resolved.friend;

    const existing = await getAffiliateByFriendId(db, friend.id);
    if (existing) {
      const links = await listAffiliateLinks(db, existing.id);
      const baseUrl = await resolveLinkBaseUrl(db, c.env);
      const stats = await getAffiliateLinkStats(db, existing.id);
      const offerNames = await loadOfferNames(db);
      return c.json({
        affiliate: serializeAffiliate(existing),
        links: links.map((l) => serializeLink(l, baseUrl, stats, offerNames)),
      });
    }

    let affiliate: Affiliate;
    try {
      affiliate = await createAffiliate(db, {
        name: friend.display_name || 'Affiliate',
        code: generateRefSlug(),
        friendId: friend.id,
      });
    } catch (createErr) {
      // Concurrent double-register: two requests both passed the getAffiliateBy-
      // FriendId check, then raced the INSERT. The UNIQUE(friend_id) index makes
      // the loser throw — recover by returning the winner's row so register stays
      // idempotent even under a race. Re-throw anything that isn't the expected
      // uniqueness collision.
      const raced = await getAffiliateByFriendId(db, friend.id);
      if (!raced) throw createErr;
      const links = await listAffiliateLinks(db, raced.id);
      const baseUrl = await resolveLinkBaseUrl(db, c.env);
      const stats = await getAffiliateLinkStats(db, raced.id);
      const offerNames = await loadOfferNames(db);
      return c.json({
        affiliate: serializeAffiliate(raced),
        links: links.map((l) => serializeLink(l, baseUrl, stats, offerNames)),
      });
    }
    // Auto-issue the first link on registration.
    const firstLink = await createAffiliateLink(db, { affiliateId: affiliate.id });
    const baseUrl = await resolveLinkBaseUrl(db, c.env);
    return c.json({
      affiliate: serializeAffiliate(affiliate),
      links: [serializeLink(firstLink, baseUrl)],
    });
  } catch (err) {
    console.error('POST /api/liff/affiliate/register error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/liff/affiliate/me?lineAccessToken= — return the caller's affiliate
 * profile + links. 404 if the caller is a friend but not yet registered.
 */
affiliateSelfRoutes.get('/api/liff/affiliate/me', async (c) => {
  try {
    const token = c.req.query('lineAccessToken');
    if (!token) {
      return c.json({ success: false, error: 'lineAccessToken is required' }, 400);
    }

    const db = c.env.DB;
    const resolved = await resolveFriendFromLineToken(c.env, token);
    if (resolved.status !== 'ok') {
      return unresolvedResponse(c, resolved);
    }
    const friend = resolved.friend;

    const affiliate = await getAffiliateByFriendId(db, friend.id);
    if (!affiliate) {
      return c.json({ success: false, error: 'Not registered as an affiliate' }, 404);
    }

    const links = await listAffiliateLinks(db, affiliate.id);
    const baseUrl = await resolveLinkBaseUrl(db, c.env);
    const stats = await getAffiliateLinkStats(db, affiliate.id);
    const offerNames = await loadOfferNames(db);
    return c.json({
      affiliate: serializeAffiliate(affiliate),
      links: links.map((l) => serializeLink(l, baseUrl, stats, offerNames)),
    });
  } catch (err) {
    console.error('GET /api/liff/affiliate/me error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * POST /api/liff/affiliate/links — issue a new self-serve link.
 * Body: { lineAccessToken, label?, offerId? }. Enforces the 20-link cap
 * (21st → 400).
 *
 * When `offerId` is supplied the new link is scoped to that offer, which powers
 * the "この案件用のリンクを追加" action on each offer card. The offer must be
 * active (404 otherwise) and the caller must already be enrolled in it — i.e.
 * have at least one existing link for that offer (400 「先に案件に参加してください」
 * otherwise). Offer-scoped links carry the offer's line_account_id so their
 * attribution matches the enroll-issued link.
 *
 * Omitting `offerId` keeps the existing generic-link behaviour untouched.
 */
affiliateSelfRoutes.post('/api/liff/affiliate/links', async (c) => {
  try {
    const body = await c.req
      .json<{ lineAccessToken?: string; label?: string | null; offerId?: string | null }>()
      .catch((): { lineAccessToken?: string; label?: string | null; offerId?: string | null } => ({}));
    const token = body.lineAccessToken;
    if (!token) {
      return c.json({ success: false, error: 'lineAccessToken is required' }, 400);
    }

    const db = c.env.DB;
    const resolved = await resolveFriendFromLineToken(c.env, token);
    if (resolved.status !== 'ok') {
      return unresolvedResponse(c, resolved);
    }
    const friend = resolved.friend;

    const affiliate = await getAffiliateByFriendId(db, friend.id);
    if (!affiliate) {
      return c.json({ success: false, error: 'Not registered as an affiliate' }, 404);
    }

    const count = await countAffiliateLinks(db, affiliate.id);
    if (count >= MAX_SELF_LINKS) {
      return c.json(
        { success: false, error: `Link limit reached (max ${MAX_SELF_LINKS})` },
        400,
      );
    }

    // offerId is optional. When present, gate issuance on an active offer the
    // caller has already joined so an offer-scoped link can never be minted for
    // an offer the affiliate isn't participating in (or one that's been hidden).
    const offerId = typeof body.offerId === 'string' && body.offerId ? body.offerId : null;
    let offerLineAccountId: string | null = null;
    if (offerId) {
      const activeOffers = await listAffiliateOffers(db, { activeOnly: true });
      const offer = activeOffers.find((o) => o.id === offerId);
      if (!offer) {
        return c.json({ success: false, error: 'Offer not found' }, 404);
      }
      const existingLinks = await listAffiliateLinks(db, affiliate.id);
      const enrolled = existingLinks.some((l) => l.offer_id === offerId);
      if (!enrolled) {
        return c.json({ success: false, error: '先に案件に参加してください' }, 400);
      }
      offerLineAccountId = offer.line_account_id ?? null;
    }

    const label = typeof body.label === 'string' ? body.label : null;
    const link = await createAffiliateLink(db, {
      affiliateId: affiliate.id,
      label,
      offerId,
      lineAccountId: offerLineAccountId,
    });
    const baseUrl = await resolveLinkBaseUrl(db, c.env);
    const offerNames = offerId ? await loadOfferNames(db) : undefined;
    return c.json({ link: serializeLink(link, baseUrl, undefined, offerNames) });
  } catch (err) {
    console.error('POST /api/liff/affiliate/links error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * GET /api/liff/affiliate/offers?lineAccessToken= — list active offers with the
 * caller's participation state. For enrolled offers, the caller's offer-scoped
 * refCode + url are returned so the LIFF page can show "あなたの◯◯案件用リンク".
 *
 * The caller must be a registered affiliate (404 otherwise) — offers are only
 * meaningful once you have an affiliate identity to attach links to.
 */
affiliateSelfRoutes.get('/api/liff/affiliate/offers', async (c) => {
  try {
    const token = c.req.query('lineAccessToken');
    if (!token) {
      return c.json({ success: false, error: 'lineAccessToken is required' }, 400);
    }

    const db = c.env.DB;
    const resolved = await resolveFriendFromLineToken(c.env, token);
    if (resolved.status !== 'ok') {
      return unresolvedResponse(c, resolved);
    }
    const friend = resolved.friend;

    const affiliate = await getAffiliateByFriendId(db, friend.id);
    if (!affiliate) {
      return c.json({ success: false, error: 'Not registered as an affiliate' }, 404);
    }

    const offers = await listAffiliateOffers(db, { activeOnly: true });
    const links = await listAffiliateLinks(db, affiliate.id);
    const baseUrl = await resolveLinkBaseUrl(db, c.env);

    // Map offerId → the earliest link for this affiliate scoped to that offer.
    // listAffiliateLinks orders newest-first, so iterate in reverse to keep the
    // oldest (matching enroll's earliest-wins idempotency).
    const linkByOffer = new Map<string, AffiliateLink>();
    for (let i = links.length - 1; i >= 0; i--) {
      const l = links[i];
      if (l.offer_id) linkByOffer.set(l.offer_id, l);
    }

    const data = offers.map((o) => {
      const link = linkByOffer.get(o.id);
      return {
        id: o.id,
        name: o.name,
        description: o.description,
        rewardAmount: o.reward_amount,
        rewardMiles: o.reward_miles ?? 0,
        enrolled: Boolean(link),
        refCode: link ? link.ref_code : null,
        url: link ? `${baseUrl}/${link.ref_code}` : null,
      };
    });

    return c.json({ offers: data });
  } catch (err) {
    console.error('GET /api/liff/affiliate/offers error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * POST /api/liff/affiliate/offers/:id/enroll — join an offer, issuing an
 * offer-scoped link. Idempotent per affiliate×offer (re-enroll returns the
 * existing link). Inactive/unknown offers → 404.
 * Body: { lineAccessToken }.
 */
affiliateSelfRoutes.post('/api/liff/affiliate/offers/:id/enroll', async (c) => {
  try {
    const body = await c.req
      .json<{ lineAccessToken?: string }>()
      .catch((): { lineAccessToken?: string } => ({}));
    const token = body.lineAccessToken;
    if (!token) {
      return c.json({ success: false, error: 'lineAccessToken is required' }, 400);
    }

    const db = c.env.DB;
    const resolved = await resolveFriendFromLineToken(c.env, token);
    if (resolved.status !== 'ok') {
      return unresolvedResponse(c, resolved);
    }
    const friend = resolved.friend;

    const affiliate = await getAffiliateByFriendId(db, friend.id);
    if (!affiliate) {
      return c.json({ success: false, error: 'Not registered as an affiliate' }, 404);
    }

    // Guard on active offers only. Enrolling in a hidden/inactive offer must not
    // be possible from the self-serve LIFF surface. (enrollAffiliateInOffer
    // itself throws on a truly-missing offer; the activeOnly list is the gate.)
    const activeOffers = await listAffiliateOffers(db, { activeOnly: true });
    const offer = activeOffers.find((o) => o.id === c.req.param('id'));
    if (!offer) {
      return c.json({ success: false, error: 'Offer not found' }, 404);
    }

    const { link } = await enrollAffiliateInOffer(db, {
      affiliateId: affiliate.id,
      offerId: offer.id,
    });
    const baseUrl = await resolveLinkBaseUrl(db, c.env);
    const offerNames = new Map([[offer.id, offer.name]]);
    return c.json({
      offerId: offer.id,
      link: serializeLink(link, baseUrl, undefined, offerNames),
    });
  } catch (err) {
    console.error('POST /api/liff/affiliate/offers/:id/enroll error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { affiliateSelfRoutes };
