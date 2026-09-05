import { describe, it, expect, vi, beforeEach } from 'vitest';

// ASP Phase 2 — offer tag/scenario auto-apply on affiliate-link friend add.
//
// Drives POST /api/liff/link (already-linked branch) so applyRefAttribution
// runs against a mocked @line-crm/db. The scenario-push branch requires heavy
// dynamic imports, so these cases exercise the tag path only (scenario_id
// NULL): the source-resolution precedence (entry_route > tracked_link > offer)
// is what Task 2 changes, and tag application is a faithful, deterministic
// witness of which source won.
const dbMocks = {
  // eager module-load deps (mirror affiliate-links-redirect.test.ts)
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  // /api/liff/link + applyRefAttribution helpers
  getFriendByLineUserId: vi.fn(),
  getFriendByLineUserIdForAccount: vi.fn(),
  getEntryRouteByRefCode: vi.fn().mockResolvedValue(null),
  getTrackedLinkById: vi.fn().mockResolvedValue(null),
  getAffiliateLinkByRefCode: vi.fn().mockResolvedValue(null),
  getAffiliateOfferById: vi.fn().mockResolvedValue(null),
  getAffiliateById: vi.fn().mockResolvedValue(null),
  addTagToFriend: vi.fn().mockResolvedValue(undefined),
  recordRefTracking: vi.fn().mockResolvedValue(undefined),
  getLineAccountByChannelId: vi.fn().mockResolvedValue(null),
  getLineAccountById: vi.fn().mockResolvedValue(null),
};
vi.mock('@line-crm/db', () => dbMocks);

// Notifier is mocked so we can assert the friend-add push is NOT fired on the
// existing-friend re-touch path (/api/liff/link never sets isNewFriend).
const notifyAffiliateFriendAdd = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/affiliate-notifier.js', () => ({ notifyAffiliateFriendAdd }));

// Ref-attribution tag attach now goes through the guarded helper (fires
// tag_added side effects only on first-time attach) — assert on this mock.
const attachTagAndFireSideEffects = vi.fn().mockResolvedValue({ added: true });
vi.mock('../services/friend-tag-attach.js', () => ({ attachTagAndFireSideEffects }));

// Import after the mock so index.ts binds the mocked helpers.
const worker = (await import('../index.js')).default;

// A stub DB: the already-linked branch of /api/liff/link only touches
// @line-crm/db helpers (all mocked) plus a couple of trivial UPDATE statements,
// so back the binding with a no-op prepared-statement chain.
const DB = {
  prepare: () => ({
    bind: () => ({
      run: async () => ({}),
      first: async () => null,
      all: async () => ({ results: [] }),
    }),
  }),
} as unknown as D1Database;

const LOGIN_CHANNEL_ID = '2000000000';

const env = {
  DB,
  LIFF_URL: 'https://liff.line.me/1000000000-DefaultAA',
  WORKER_URL: 'https://worker.example.com',
  LINE_LOGIN_CHANNEL_ID: LOGIN_CHANNEL_ID,
} as unknown as import('../index.js').Env['Bindings'];

// idToken verify mock: any non-empty token resolves to a fixed LINE userId.
function installVerifyMock() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://api.line.me/oauth2/v2.1/verify') {
        return new Response(JSON.stringify({ sub: 'U-friend', name: 'Tester' }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    }),
  );
}

function link(ref: string) {
  return worker.fetch(
    new Request('https://worker.example.com/api/liff/link', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'tok', ref }),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

describe('POST /api/liff/link — offer tag/scenario on affiliate-link friend add', () => {
  beforeEach(() => {
  dbMocks.getFriendByLineUserIdForAccount.mockImplementation(
    (...args: unknown[]) => dbMocks.getFriendByLineUserId(...(args as [unknown, unknown])),
  );
    vi.clearAllMocks();
    installVerifyMock();
    // Already-linked friend: user_id set so applyRefAttribution runs without
    // needing user-creation plumbing.
    dbMocks.getFriendByLineUserId.mockResolvedValue({
      id: 'F-1',
      line_account_id: null,
      user_id: 'U-uuid',
    });
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);
    dbMocks.getTrackedLinkById.mockResolvedValue(null);
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue(null);
    dbMocks.getAffiliateOfferById.mockResolvedValue(null);
  });

  it('applies the offer tag when the ref is an offer-scoped affiliate link', async () => {
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue({
      id: 'AL-1',
      ref_code: 'aff-offer',
      offer_id: 'OFF-1',
    });
    dbMocks.getAffiliateOfferById.mockResolvedValue({
      id: 'OFF-1',
      tag_id: 'TAG-offer',
      scenario_id: null,
      is_active: 1,
    });

    const res = await link('aff-offer');
    expect(res.status).toBe(200);

    expect(dbMocks.getAffiliateOfferById).toHaveBeenCalledWith(
      expect.anything(),
      'OFF-1',
    );
    expect(attachTagAndFireSideEffects).toHaveBeenCalledWith(
      expect.anything(),
      'F-1',
      'TAG-offer',
      expect.anything(),
    );
  });

  it('applies nothing for a generic affiliate link (offer_id NULL)', async () => {
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue({
      id: 'AL-2',
      ref_code: 'aff-generic',
      offer_id: null,
    });

    const res = await link('aff-generic');
    expect(res.status).toBe(200);

    // No offer lookup, no tag application — current behavior unchanged.
    expect(dbMocks.getAffiliateOfferById).not.toHaveBeenCalled();
    expect(attachTagAndFireSideEffects).not.toHaveBeenCalled();
  });

  it('skips tag application when the offer is inactive (is_active = 0)', async () => {
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue({
      id: 'AL-3',
      ref_code: 'aff-paused',
      offer_id: 'OFF-2',
    });
    dbMocks.getAffiliateOfferById.mockResolvedValue({
      id: 'OFF-2',
      tag_id: 'TAG-paused',
      scenario_id: null,
      is_active: 0,
    });

    const res = await link('aff-paused');
    expect(res.status).toBe(200);

    // Offer is fetched but tag must NOT be applied — inactive offers are null-treated.
    expect(dbMocks.getAffiliateOfferById).toHaveBeenCalledWith(
      expect.anything(),
      'OFF-2',
    );
    expect(attachTagAndFireSideEffects).not.toHaveBeenCalled();
  });

  it('does NOT fire the friend-add notification on an existing-friend re-touch', async () => {
    // /api/liff/link is a re-touch entry point (friend already exists), so the
    // affiliate must never be notified — even for an affiliate offer link.
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue({
      id: 'AL-1',
      affiliate_id: 'AFF-1',
      ref_code: 'aff-offer',
      offer_id: 'OFF-1',
    });
    dbMocks.getAffiliateOfferById.mockResolvedValue({
      id: 'OFF-1',
      name: '案件A',
      tag_id: null,
      scenario_id: null,
      is_active: 1,
    });
    dbMocks.getAffiliateById.mockResolvedValue({ id: 'AFF-1', friend_id: 'F-other' });

    const res = await link('aff-offer');
    expect(res.status).toBe(200);
    expect(notifyAffiliateFriendAdd).not.toHaveBeenCalled();
  });

  it('keeps entry_route behavior: offer is never consulted on an entry_route hit', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue({
      id: 'ER-1',
      tag_id: 'TAG-route',
      scenario_id: null,
      run_account_friend_add_scenarios: 1,
    });

    const res = await link('route-ref');
    expect(res.status).toBe(200);

    // entry_route wins: affiliate link / offer resolution is skipped entirely.
    expect(dbMocks.getAffiliateLinkByRefCode).not.toHaveBeenCalled();
    expect(dbMocks.getAffiliateOfferById).not.toHaveBeenCalled();
    expect(attachTagAndFireSideEffects).toHaveBeenCalledWith(
      expect.anything(),
      'F-1',
      'TAG-route',
      expect.anything(),
    );
  });
});
