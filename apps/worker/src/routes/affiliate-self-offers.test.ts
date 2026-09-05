import { describe, it, expect, vi, beforeEach } from 'vitest';

// Route-level test for the LIFF offer surface:
//   GET  /api/liff/affiliate/offers            (active offers + enrolled state)
//   POST /api/liff/affiliate/offers/:id/enroll (idempotent, inactive → 404)
// Auth is a LINE access token verified against a fetch mock; the db layer is
// mocked with an in-memory offer + link store so we can exercise idempotency and
// the inactive-offer 404 without a real D1 binding.
const dbMocks = {
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  getAffiliateByFriendId: vi.fn(),
  createAffiliate: vi.fn(),
  createAffiliateLink: vi.fn(),
  listAffiliateLinks: vi.fn(),
  countAffiliateLinks: vi.fn(),
  getAffiliateLinkStats: vi.fn().mockResolvedValue(new Map()),
  generateRefSlug: vi.fn(() => 'slug00'),
  getLinkBaseUrl: vi.fn().mockResolvedValue(null),
  listAffiliateOffers: vi.fn(),
  enrollAffiliateInOffer: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const worker = (await import('../index.js')).default;

const DB = {} as D1Database;
const LOGIN_CHANNEL_ID = '2000000000';
const env = {
  DB,
  LIFF_URL: 'https://liff.line.me/1000000000-DefaultAA',
  WORKER_URL: 'https://worker.example.com',
  LINE_LOGIN_CHANNEL_ID: LOGIN_CHANNEL_ID,
} as unknown as import('../index.js').Env['Bindings'];

function call(path: string, init?: RequestInit) {
  return worker.fetch(
    new Request(`https://worker.example.com${path}`, init),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

const TOKEN_TO_USER: Record<string, string> = { 'tok-alice': 'U-alice' };
const FRIENDS: Record<string, { id: string; display_name: string }> = {
  'U-alice': { id: 'friend-alice', display_name: 'Alice' },
};
const AFFILIATE = {
  id: 'aff-alice',
  name: 'Alice',
  code: 'aliceco',
  commission_rate: 0,
  is_active: 1,
  friend_id: 'friend-alice',
};

function installLineFetchMock() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.startsWith('https://api.line.me/oauth2/v2.1/verify')) {
        const token = new URL(url).searchParams.get('access_token') || '';
        if (TOKEN_TO_USER[token]) {
          return new Response(JSON.stringify({ client_id: LOGIN_CHANNEL_ID }), { status: 200 });
        }
        return new Response('invalid', { status: 400 });
      }
      if (url === 'https://api.line.me/v2/profile') {
        const auth = (init?.headers as Record<string, string>)?.Authorization || '';
        const token = auth.replace(/^Bearer /, '');
        const userId = TOKEN_TO_USER[token];
        if (!userId) return new Response('unauthorized', { status: 401 });
        return new Response(JSON.stringify({ userId }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }),
  );
}

type LinkRow = {
  id: string;
  affiliate_id: string;
  ref_code: string;
  label: string | null;
  line_account_id: string | null;
  is_active: number;
  created_at: string;
  click_count: number;
  offer_id: string | null;
};

const ACTIVE_OFFER = {
  id: 'off-active',
  name: '案件A',
  description: 'desc',
  reward_amount: 1000,
  line_account_id: null,
  tag_id: null,
  scenario_id: null,
  is_active: 1,
  created_at: '2026-01-01 00:00:00',
};

let links: LinkRow[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  installLineFetchMock();
  links = [];

  dbMocks.getLineAccounts.mockResolvedValue([]);
  dbMocks.getFriendByLineUserId.mockImplementation(async (_db: unknown, uid: string) => FRIENDS[uid] ?? null);
  dbMocks.getAffiliateByFriendId.mockImplementation(async (_db: unknown, fid: string) =>
    fid === AFFILIATE.friend_id ? AFFILIATE : null,
  );
  dbMocks.listAffiliateLinks.mockImplementation(async () => [...links]);
  dbMocks.countAffiliateLinks.mockImplementation(async () => links.length);
  dbMocks.createAffiliateLink.mockImplementation(
    async (_db: unknown, input: { affiliateId: string; label?: string | null; offerId?: string | null }) => {
      const link: LinkRow = {
        id: crypto.randomUUID(),
        affiliate_id: input.affiliateId,
        ref_code: `lnk${links.length}`,
        label: input.label ?? null,
        line_account_id: null,
        is_active: 1,
        created_at: '2026-01-01 00:00:00',
        click_count: 0,
        offer_id: input.offerId ?? null,
      };
      links.unshift(link);
      return link;
    },
  );
  dbMocks.getAffiliateLinkStats.mockResolvedValue(new Map());
  // Only the active offer is returned by activeOnly listing.
  dbMocks.listAffiliateOffers.mockResolvedValue([ACTIVE_OFFER]);
  dbMocks.enrollAffiliateInOffer.mockImplementation(
    async (_db: unknown, input: { affiliateId: string; offerId: string }) => {
      const found = links.find((l) => l.offer_id === input.offerId);
      if (found) return { link: found, existing: true };
      const link: LinkRow = {
        id: crypto.randomUUID(),
        affiliate_id: input.affiliateId,
        ref_code: `off${links.length}`,
        label: ACTIVE_OFFER.name,
        line_account_id: null,
        is_active: 1,
        created_at: '2026-01-01 00:00:00',
        click_count: 0,
        offer_id: input.offerId,
      };
      links.unshift(link);
      return { link, existing: false };
    },
  );
});

describe('GET /api/liff/affiliate/offers', () => {
  it('lists active offers with enrolled=false before joining', async () => {
    const res = await call('/api/liff/affiliate/offers?lineAccessToken=tok-alice');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      offers: Array<{ id: string; enrolled: boolean; refCode: string | null; url: string | null }>;
    };
    expect(body.offers).toHaveLength(1);
    expect(body.offers[0].id).toBe('off-active');
    expect(body.offers[0].enrolled).toBe(false);
    expect(body.offers[0].refCode).toBeNull();
    expect(body.offers[0].url).toBeNull();
  });

  it('shows enrolled=true + refCode/url once joined', async () => {
    await call('/api/liff/affiliate/offers/off-active/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice' }),
    });
    const res = await call('/api/liff/affiliate/offers?lineAccessToken=tok-alice');
    const body = (await res.json()) as {
      offers: Array<{ enrolled: boolean; refCode: string | null; url: string | null }>;
    };
    expect(body.offers[0].enrolled).toBe(true);
    expect(body.offers[0].refCode).toBe('off0');
    expect(body.offers[0].url).toBe('https://worker.example.com/r/off0');
  });

  it('404s a caller who is not a registered affiliate', async () => {
    dbMocks.getAffiliateByFriendId.mockResolvedValue(null);
    const res = await call('/api/liff/affiliate/offers?lineAccessToken=tok-alice');
    expect(res.status).toBe(404);
  });
});

describe('POST /api/liff/affiliate/offers/:id/enroll', () => {
  it('is idempotent — re-enroll returns the same link', async () => {
    const first = await call('/api/liff/affiliate/offers/off-active/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice' }),
    });
    expect(first.status).toBe(200);
    const b1 = (await first.json()) as { link: { refCode: string; offerName: string | null } };
    expect(b1.link.refCode).toBe('off0');
    expect(b1.link.offerName).toBe('案件A');

    const second = await call('/api/liff/affiliate/offers/off-active/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice' }),
    });
    const b2 = (await second.json()) as { link: { refCode: string } };
    expect(b2.link.refCode).toBe('off0');
    // Only one link ever created for this affiliate×offer.
    expect(links.filter((l) => l.offer_id === 'off-active')).toHaveLength(1);
  });

  it('404s an inactive/unknown offer without enrolling', async () => {
    const res = await call('/api/liff/affiliate/offers/off-inactive/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice' }),
    });
    expect(res.status).toBe(404);
    expect(dbMocks.enrollAffiliateInOffer).not.toHaveBeenCalled();
  });

  it('401s an invalid token', async () => {
    const res = await call('/api/liff/affiliate/offers/off-active/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-nope' }),
    });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/liff/affiliate/links — offer-scoped issuance', () => {
  it('issues an offer-scoped link once enrolled, carrying offerId + offerName', async () => {
    // Enroll first so the caller has a link for the offer.
    await call('/api/liff/affiliate/offers/off-active/enroll', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice' }),
    });

    const res = await call('/api/liff/affiliate/links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice', label: 'X用', offerId: 'off-active' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      link: { label: string | null; offerId: string | null; offerName: string | null };
    };
    expect(body.link.label).toBe('X用');
    expect(body.link.offerId).toBe('off-active');
    expect(body.link.offerName).toBe('案件A');
    // The new link was created with the offer scope, not a generic link.
    expect(links.some((l) => l.offer_id === 'off-active' && l.label === 'X用')).toBe(true);
  });

  it('404s an offerId that is inactive/unknown without creating a link', async () => {
    const res = await call('/api/liff/affiliate/links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice', offerId: 'off-inactive' }),
    });
    expect(res.status).toBe(404);
    expect(dbMocks.createAffiliateLink).not.toHaveBeenCalled();
  });

  it('400s when the caller has not yet enrolled in the offer', async () => {
    // No enroll → no existing link for off-active → issuance is refused.
    const res = await call('/api/liff/affiliate/links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice', offerId: 'off-active' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('先に案件に参加してください');
    expect(dbMocks.createAffiliateLink).not.toHaveBeenCalled();
  });

  it('still issues a generic link when offerId is omitted', async () => {
    const res = await call('/api/liff/affiliate/links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lineAccessToken: 'tok-alice', label: '汎用' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { link: { offerId: string | null; label: string | null } };
    expect(body.link.offerId).toBeNull();
    expect(body.link.label).toBe('汎用');
  });
});
