import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @line-crm/db. index.ts pulls several helpers eagerly at module load, so
// every referenced export must exist as a stub. This suite drives the
// self-serve affiliate endpoints, so the affiliate CRUD helpers are backed by a
// tiny in-memory store to exercise idempotency / isolation / the 20-link cap
// without a real D1 binding.
const dbMocks = {
  // eager module-load deps (mirror affiliate-links-redirect.test.ts)
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  // self-serve affiliate helpers
  getFriendByLineUserId: vi.fn(),
  getAffiliateByFriendId: vi.fn(),
  createAffiliate: vi.fn(),
  createAffiliateLink: vi.fn(),
  listAffiliateLinks: vi.fn(),
  countAffiliateLinks: vi.fn(),
  getAffiliateLinkStats: vi.fn(),
  // offer-name enrichment on link responses (loadOfferNames)
  listAffiliateOffers: vi.fn().mockResolvedValue([]),
  enrollAffiliateInOffer: vi.fn(),
  getMileageSummaryForFriend: vi.fn(),
  getMileageHistoryForFriend: vi.fn(),
  getMileageSelfInsights: vi.fn(),
  getMileageEarningOpportunitiesForFriend: vi.fn(),
  generateRefSlug: vi.fn(() => 'slug00'),
  // account-settings helpers (used by resolveLinkBaseUrl via @line-crm/db)
  getLinkBaseUrl: vi.fn().mockResolvedValue(null),
};
vi.mock('@line-crm/db', () => dbMocks);

// Import after the mock so index.ts binds the mocked helpers.
const worker = (await import('../index.js')).default;

const DB = {} as D1Database;

// The deployment's LINE Login channel. resolveFriendFromLineToken now requires
// the verify response's client_id to be in the allowed set (env default + DB
// account login channels), so tokens minted by any other channel are rejected.
const LOGIN_CHANNEL_ID = '2000000000';

const env = {
  DB,
  LIFF_URL: 'https://liff.line.me/1000000000-DefaultAA',
  WORKER_URL: 'https://worker.example.com',
  LINE_LOGIN_CHANNEL_ID: LOGIN_CHANNEL_ID,
  LINE_CHANNEL_SECRET: 'wallet-link-secret',
} as unknown as import('../index.js').Env['Bindings'];

function call(path: string, init?: RequestInit) {
  return worker.fetch(
    new Request(`https://worker.example.com${path}`, init),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

// ── LINE API fetch mock ───────────────────────────────────────────────────────
// A valid access token maps to a LINE userId. The verify endpoint 200s for any
// known token; the profile endpoint returns the mapped userId. Unknown tokens
// 401 at the verify step so resolveFriendFromLineToken returns null.
const TOKEN_TO_USER: Record<string, string> = {
  'tok-alice': 'U-alice',
  'tok-bob': 'U-bob',
};

function installLineFetchMock(clientId: string = LOGIN_CHANNEL_ID) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();

      if (url.startsWith('https://api.line.me/oauth2/v2.1/verify')) {
        const token = new URL(url).searchParams.get('access_token') || '';
        if (TOKEN_TO_USER[token]) {
          return new Response(JSON.stringify({ client_id: clientId, expires_in: 100 }), {
            status: 200,
          });
        }
        return new Response('invalid', { status: 400 });
      }

      if (url === 'https://api.line.me/v2/profile') {
        const auth = (init?.headers as Record<string, string>)?.Authorization || '';
        const token = auth.replace(/^Bearer /, '');
        const userId = TOKEN_TO_USER[token];
        if (!userId) return new Response('unauthorized', { status: 401 });
        return new Response(JSON.stringify({ userId, displayName: 'ignored' }), {
          status: 200,
        });
      }

      return new Response('not found', { status: 404 });
    }),
  );
}

// ── in-memory affiliate store backing the db mocks ────────────────────────────
type AffRow = { id: string; name: string; code: string; commission_rate: number; is_active: number; created_at: string; friend_id: string };
type LinkRow = { id: string; affiliate_id: string; ref_code: string; label: string | null; line_account_id: string | null; is_active: number; created_at: string; click_count: number };

let affiliatesByFriend: Map<string, AffRow>;
let linksByAffiliate: Map<string, LinkRow[]>;
let statsByAffiliate: Map<string, Map<string, { friendAdds: number; conversions: number; conversionsPending: number; conversionsApproved: number }>>;
let slugCounter: number;

const FRIENDS: Record<string, { id: string; display_name: string; user_id: string }> = {
  'U-alice': { id: 'friend-alice', display_name: 'Alice', user_id: 'user-alice' },
  'U-bob': { id: 'friend-bob', display_name: 'Bob', user_id: 'user-bob' },
};

function installStore() {
  affiliatesByFriend = new Map();
  linksByAffiliate = new Map();
  statsByAffiliate = new Map();
  slugCounter = 0;

  // Per-link stats: empty by default (fresh links → 0). Tests seed real values
  // via statsByAffiliate to assert they flow through serializeLink.
  dbMocks.getAffiliateLinkStats.mockImplementation(async (_db: unknown, affiliateId: string) => {
    return statsByAffiliate.get(affiliateId) ?? new Map();
  });

  dbMocks.getFriendByLineUserId.mockImplementation(async (_db: unknown, lineUserId: string) => {
    return FRIENDS[lineUserId] ?? null;
  });

  dbMocks.getAffiliateByFriendId.mockImplementation(async (_db: unknown, friendId: string) => {
    for (const aff of affiliatesByFriend.values()) {
      if (aff.friend_id === friendId) return aff;
    }
    return null;
  });

  dbMocks.createAffiliate.mockImplementation(
    async (_db: unknown, input: { name: string; code: string; friendId?: string }) => {
      const aff: AffRow = {
        id: `aff-${input.friendId ?? input.code}`,
        name: input.name,
        code: input.code,
        commission_rate: 0,
        is_active: 1,
        created_at: '2026-01-01 00:00:00',
        friend_id: input.friendId ?? '',
      };
      affiliatesByFriend.set(aff.id, aff);
      linksByAffiliate.set(aff.id, []);
      return aff;
    },
  );

  dbMocks.createAffiliateLink.mockImplementation(
    async (_db: unknown, input: { affiliateId: string; label?: string | null }) => {
      const link: LinkRow = {
        id: crypto.randomUUID(),
        affiliate_id: input.affiliateId,
        ref_code: `slug${String(slugCounter++).padStart(2, '0')}`,
        label: input.label ?? null,
        line_account_id: null,
        is_active: 1,
        created_at: '2026-01-01 00:00:00',
        click_count: 0,
      };
      const arr = linksByAffiliate.get(input.affiliateId) ?? [];
      arr.unshift(link);
      linksByAffiliate.set(input.affiliateId, arr);
      return link;
    },
  );

  dbMocks.listAffiliateLinks.mockImplementation(async (_db: unknown, affiliateId: string) => {
    return linksByAffiliate.get(affiliateId) ?? [];
  });

  dbMocks.countAffiliateLinks.mockImplementation(async (_db: unknown, affiliateId: string) => {
    return (linksByAffiliate.get(affiliateId) ?? []).length;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  dbMocks.getLineAccounts.mockResolvedValue([]);
  // No offers by default → serializeLink emits offerId/offerName = null.
  dbMocks.listAffiliateOffers.mockResolvedValue([]);
  dbMocks.getMileageSummaryForFriend.mockResolvedValue({
    programId: 'default',
    programName: 'Harnessマイル',
    available: 500,
    pending: 0,
    lifetimeEarned: 500,
    spent: 0,
  });
  dbMocks.getMileageHistoryForFriend.mockResolvedValue([]);
  dbMocks.getMileageSelfInsights.mockResolvedValue({
    accountCount: 2,
    rewardedActions: 12,
    referralMiles: 180,
    qualityReferralCount: 3,
    lastEarnedAt: '2026-08-09T20:00:00+09:00',
  });
  dbMocks.getMileageEarningOpportunitiesForFriend.mockResolvedValue([
    {
      id: 'webinar:webinar-1',
      type: 'webinar',
      title: 'AI活用ウェビナー',
      description: 'まず5分視聴で +5 mile',
      rewardMiles: 55,
      nextRewardMiles: 5,
      progressPercent: 0,
      ctaLabel: '今すぐ参加する',
      url: 'https://liff.line.me/123/?page=webinar&slug=ai',
    },
  ]);
  installLineFetchMock();
  installStore();
});

describe('POST /api/liff/affiliate/register — idempotency', () => {
  it('(a) registers once, then returns the SAME affiliate on repeat calls', async () => {
    const res1 = await call('/api/liff/affiliate/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice' }),
    });
    expect(res1.status).toBe(200);
    const body1 = (await res1.json()) as { affiliate: { id: string; name: string }; links: unknown[] };
    expect(body1.affiliate.name).toBe('Alice');
    // Registration auto-issues exactly one link.
    expect(body1.links).toHaveLength(1);

    // Second call must NOT create a second affiliate — same id returned.
    const res2 = await call('/api/liff/affiliate/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice' }),
    });
    expect(res2.status).toBe(200);
    const body2 = (await res2.json()) as { affiliate: { id: string } };
    expect(body2.affiliate.id).toBe(body1.affiliate.id);
    // createAffiliate called exactly once across both registrations.
    expect(dbMocks.createAffiliate).toHaveBeenCalledTimes(1);
  });
});

describe('GET /api/liff/mileage/me — generic wallet', () => {
  it('returns mileage without requiring affiliate registration', async () => {
    const res = await call('/api/liff/mileage/me?lineAccessToken=tok-alice&limit=10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mileage: { available: number };
      history: unknown[];
      insights: { accountCount: number; referralMiles: number; qualityReferralCount: number };
      opportunities: Array<{ type: string; rewardMiles: number; ctaLabel: string }>;
    };
    expect(body.mileage.available).toBe(500);
    expect(body.insights).toMatchObject({
      accountCount: 2,
      referralMiles: 180,
      qualityReferralCount: 3,
    });
    expect(body.opportunities[0]).toMatchObject({
      type: 'webinar',
      rewardMiles: 55,
      ctaLabel: '今すぐ参加する',
    });
    expect(dbMocks.getMileageSummaryForFriend).toHaveBeenCalledWith(DB, 'friend-alice');
    expect(dbMocks.getMileageHistoryForFriend).toHaveBeenCalledWith(
      DB,
      'friend-alice',
      { limit: 10 },
    );
    expect(dbMocks.getMileageSelfInsights).toHaveBeenCalledWith(DB, 'friend-alice');
    expect(dbMocks.getMileageEarningOpportunitiesForFriend).toHaveBeenCalledWith(
      DB,
      'friend-alice',
    );
    expect(dbMocks.getAffiliateByFriendId).not.toHaveBeenCalled();
  });

  it('signs cross-account friend-add missions for the verified wallet owner', async () => {
    dbMocks.getMileageEarningOpportunitiesForFriend.mockResolvedValueOnce([
      {
        id: 'friend-add:account-2',
        type: 'friend_add',
        title: '公式②を友だち追加',
        description: '友だち追加で +5 mile',
        rewardMiles: 5,
        nextRewardMiles: 5,
        progressPercent: 0,
        ctaLabel: '友だち追加する',
        url: 'https://liff.line.me/2000000000-Second/?page=affiliate',
        targetAccountId: 'account-2',
      },
    ]);

    const res = await call('/api/liff/mileage/me?lineAccessToken=tok-alice');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { opportunities: Array<{ url: string }> };
    const missionUrl = new URL(body.opportunities[0].url);
    expect(missionUrl.searchParams.get('crossAccountToken')).toMatch(/^v1\./u);
  });
});

describe('GET /api/liff/affiliate/me — cross-affiliate isolation', () => {
  it('(b) a token only ever surfaces its own affiliate data', async () => {
    // Register alice + bob.
    await call('/api/liff/affiliate/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice' }),
    });
    await call('/api/liff/affiliate/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-bob' }),
    });

    const resAlice = await call('/api/liff/affiliate/me?lineAccessToken=tok-alice');
    const alice = (await resAlice.json()) as { affiliate: { name: string; friendId?: string }; links: unknown[] };
    expect(alice.affiliate.name).toBe('Alice');

    const resBob = await call('/api/liff/affiliate/me?lineAccessToken=tok-bob');
    const bob = (await resBob.json()) as { affiliate: { name: string } };
    expect(bob.affiliate.name).toBe('Bob');

    // Alice's payload must never leak Bob's affiliate id (no shared identity).
    expect(JSON.stringify(alice)).not.toContain('friend-bob');
    expect(JSON.stringify(bob)).not.toContain('friend-alice');
  });

  it('me response shape carries refCode/label/url/clickCount/friendAdds/conversions', async () => {
    const reg = await call('/api/liff/affiliate/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice' }),
    });
    const regBody = (await reg.json()) as {
      affiliate: { id: string };
      links: Array<{ refCode: string }>;
    };
    const affId = regBody.affiliate.id;
    const refCode = regBody.links[0].refCode;

    // Seed real per-link stats for this affiliate's link; getAffiliateLinkStats
    // (mocked) surfaces them, and serializeLink must emit the real values.
    statsByAffiliate.set(affId, new Map([[refCode, { friendAdds: 3, conversions: 2, conversionsPending: 1, conversionsApproved: 1 }]]));

    const res = await call('/api/liff/affiliate/me?lineAccessToken=tok-alice');
    const body = (await res.json()) as {
      links: Array<{ refCode: string; label: string | null; url: string; clickCount: number; friendAdds: number; conversions: number; conversionsPending: number; conversionsApproved: number }>;
    };
    expect(body.links).toHaveLength(1);
    const link = body.links[0];
    expect(typeof link.refCode).toBe('string');
    expect(link.url).toBe(`https://worker.example.com/r/${link.refCode}`);
    expect(link.clickCount).toBe(0);
    // Real per-link aggregates now flow through (no longer placeholders).
    expect(link.friendAdds).toBe(3);
    expect(link.conversions).toBe(2);
    expect(link.conversionsPending).toBe(1);
    expect(link.conversionsApproved).toBe(1);
  });

  it('a link with no stats entry defaults friendAdds/conversions to 0', async () => {
    await call('/api/liff/affiliate/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice' }),
    });
    // No statsByAffiliate seeding → getAffiliateLinkStats returns empty map.
    const res = await call('/api/liff/affiliate/me?lineAccessToken=tok-alice');
    const body = (await res.json()) as {
      links: Array<{ friendAdds: number; conversions: number }>;
    };
    expect(body.links[0].friendAdds).toBe(0);
    expect(body.links[0].conversions).toBe(0);
  });
});

describe('POST /api/liff/affiliate/links — 20-link cap', () => {
  it('(c) the 21st self-issued link is rejected with 400', async () => {
    await call('/api/liff/affiliate/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice' }),
    });
    // Registration already issued 1 link → 19 more brings us to 20 exactly.
    for (let i = 0; i < 19; i++) {
      const r = await call('/api/liff/affiliate/links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ lineAccessToken: 'tok-alice', label: `L${i}` }),
      });
      expect(r.status).toBe(200);
    }
    // 20 links now exist. The 21st must be refused.
    const over = await call('/api/liff/affiliate/links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice', label: 'over' }),
    });
    expect(over.status).toBe(400);
  });
});

describe('LINE token verification', () => {
  it('(d) an invalid token yields 401 on every endpoint', async () => {
    const reg = await call('/api/liff/affiliate/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-nope' }),
    });
    expect(reg.status).toBe(401);

    const me = await call('/api/liff/affiliate/me?lineAccessToken=tok-nope');
    expect(me.status).toBe(401);

    const links = await call('/api/liff/affiliate/links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-nope' }),
    });
    expect(links.status).toBe(401);

    // A friend that never added the bot (verified but no friend row) → 404,
    // and crucially never creates an affiliate.
    dbMocks.getFriendByLineUserId.mockImplementationOnce(async () => null);
    const ghost = await call('/api/liff/affiliate/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice' }),
    });
    expect(ghost.status).toBe(404);
  });

  it('(d2) a token minted by a foreign LINE Login channel is rejected with 401', async () => {
    // verify 200s (token is real) but reports a client_id this deployment does
    // not own. Without the client_id gate, its lineUserId would resolve to a
    // local friend and let an unrelated app impersonate an affiliate.
    installLineFetchMock('9999999999');

    const reg = await call('/api/liff/affiliate/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice' }),
    });
    expect(reg.status).toBe(401);
    // Crucially, no affiliate is ever created from a foreign-channel token.
    expect(dbMocks.createAffiliate).not.toHaveBeenCalled();

    const me = await call('/api/liff/affiliate/me?lineAccessToken=tok-alice');
    expect(me.status).toBe(401);
  });

  it('(d3) accepts a token whose client_id matches a DB account login channel', async () => {
    // Env default channel does NOT match; a DB line_account's login_channel_id
    // does. Mirrors liff.ts allowing multi-account login channels.
    installLineFetchMock('3000000000');
    dbMocks.getLineAccounts.mockResolvedValue([
      { login_channel_id: '3000000000' } as unknown as never,
    ]);

    const reg = await call('/api/liff/affiliate/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice' }),
    });
    expect(reg.status).toBe(200);
  });
});

describe('POST /api/liff/affiliate/register — concurrent double-register', () => {
  it('(e) a UNIQUE(friend_id) violation on INSERT recovers the existing affiliate', async () => {
    // Simulate the race: getAffiliateByFriendId returns null on the pre-check
    // (first call), createAffiliate throws the UNIQUE violation the losing
    // request would hit, and the post-catch getAffiliateByFriendId returns the
    // row the winning request already committed. Register must stay idempotent.
    const winner: AffRow = {
      id: 'aff-winner',
      name: 'Alice',
      code: 'wincode',
      commission_rate: 0,
      is_active: 1,
      created_at: '2026-01-01 00:00:00',
      friend_id: 'friend-alice',
    };
    linksByAffiliate.set(winner.id, []);

    // Pre-check: not found yet (this request thinks it's first).
    dbMocks.getAffiliateByFriendId.mockResolvedValueOnce(null);
    // INSERT races and loses.
    dbMocks.createAffiliate.mockRejectedValueOnce(
      new Error('D1_ERROR: UNIQUE constraint failed: affiliates.friend_id'),
    );
    // Post-catch recovery: the winner's committed row is now visible.
    dbMocks.getAffiliateByFriendId.mockResolvedValueOnce(winner);

    const res = await call('/api/liff/affiliate/register', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { affiliate: { id: string } };
    expect(body.affiliate.id).toBe('aff-winner');
    // The loser must NOT auto-issue a second first-link.
    expect(dbMocks.createAffiliateLink).not.toHaveBeenCalled();
  });
});
