import { describe, it, expect, vi, beforeEach } from 'vitest';

// /r/:ref?account= resolution + /auth/line mobile routing for ?account= links.
//
// Admin-issued friend-add links moved from /auth/line?account= (which forced
// the OAuth web-login detour on mobile) to /r/dashboard?account=. These tests
// pin both halves:
//   - /r resolves ?account= to that account's LIFF (priority: entry_route
//     pool > account > pool fallback)
//   - /auth/line?account= on mobile goes LIFF-direct; only uid-carrying
//     links keep OAuth (uid linking exists solely in /auth/callback)

const dbMocks = {
  // eager module-load deps
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  // route deps
  getFriendByLineUserId: vi.fn(),
  upsertFriend: vi.fn(),
  createUser: vi.fn().mockResolvedValue({ id: 'U-uuid' }),
  getUserByEmail: vi.fn().mockResolvedValue(null),
  linkFriendToUser: vi.fn().mockResolvedValue(undefined),
  getEntryRouteByRefCode: vi.fn().mockResolvedValue(null),
  recordRefTracking: vi.fn().mockResolvedValue(undefined),
  getTrackedLinkById: vi.fn().mockResolvedValue(null),
  getMessageTemplateById: vi.fn().mockResolvedValue(null),
  getAffiliateLinkByRefCode: vi.fn().mockResolvedValue(null),
  getAffiliateOfferById: vi.fn().mockResolvedValue(null),
  getAffiliateById: vi.fn().mockResolvedValue(null),
  addTagToFriend: vi.fn().mockResolvedValue(undefined),
  getLineAccountByChannelId: vi.fn().mockResolvedValue(null),
  getLineAccountById: vi.fn().mockResolvedValue(null),
  getScenarios: vi.fn().mockResolvedValue([]),
  enrollFriendInScenario: vi.fn().mockResolvedValue(null),
  getTrafficPoolBySlug: vi.fn().mockResolvedValue(null),
  getTrafficPoolById: vi.fn().mockResolvedValue(null),
  getRandomPoolAccount: vi.fn().mockResolvedValue(null),
  getPoolAccounts: vi.fn().mockResolvedValue([]),
  incrementAffiliateLinkClick: vi.fn().mockResolvedValue(undefined),
  jstNow: () => '2026-08-20 00:00:00',
};
vi.mock('@line-crm/db', () => dbMocks);

const pushImmediateFirstStep = vi.fn().mockResolvedValue(true);
vi.mock('../services/immediate-first-step.js', () => ({ pushImmediateFirstStep }));

const worker = (await import('../index.js')).default;

const DB = {
  prepare: () => ({
    bind: () => ({
      run: async () => ({ meta: { changes: 0 } }),
      first: async () => null,
      all: async () => ({ results: [] }),
    }),
  }),
} as unknown as D1Database;

const env = {
  DB,
  WORKER_URL: 'https://worker.example.com',
  LINE_CHANNEL_ACCESS_TOKEN: 'env-token',
  LIFF_URL: 'https://liff.line.me/1000000000-DefaultAA',
  LINE_LOGIN_CHANNEL_ID: '2000000000',
  LINE_LOGIN_CHANNEL_SECRET: 'login-secret',
} as unknown as import('../index.js').Env['Bindings'];

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

function get(path: string, ua = MOBILE_UA) {
  return worker.fetch(
    new Request(`https://worker.example.com${path}`, {
      headers: { 'user-agent': ua },
      redirect: 'manual',
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

const TESTIN = {
  id: 'acct-testin',
  channel_id: '2011171710',
  login_channel_id: '2011177336',
  liff_id: '2011177336-RWMDBXOl',
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getLineAccounts.mockResolvedValue([]);
  dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);
  dbMocks.getAffiliateLinkByRefCode.mockResolvedValue(null);
  dbMocks.getTrafficPoolBySlug.mockResolvedValue(null);
  dbMocks.getLineAccountByChannelId.mockResolvedValue(null);
});

describe('/r/:ref — ?account= resolution', () => {
  it('resolves the account LIFF and skips the pool fallback', async () => {
    dbMocks.getLineAccountByChannelId.mockResolvedValue(TESTIN);

    const res = await get('/r/dashboard?account=2011171710');
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(dbMocks.getLineAccountByChannelId).toHaveBeenCalledWith(DB, '2011171710');
    // Landing page targets the account's LIFF, with ref + account riding along.
    expect(html).toContain('liff.line.me/2011177336-RWMDBXOl');
    expect(html).toContain('ref%3Ddashboard');
    expect(html).toContain('account%3D2011171710');
    // account resolution replaces the pool fallback entirely
    expect(dbMocks.getTrafficPoolBySlug).not.toHaveBeenCalled();
  });

  it('unknown account (or one without liff_id) falls through to the pool fallback', async () => {
    dbMocks.getLineAccountByChannelId.mockResolvedValue({ ...TESTIN, liff_id: null });

    const res = await get('/r/dashboard?account=999');
    expect(res.status).toBe(200);
    const html = await res.text();

    // env LIFF_URL default via the normal fallback chain
    expect(html).toContain('liff.line.me/1000000000-DefaultAA');
    expect(dbMocks.getTrafficPoolBySlug).toHaveBeenCalledWith(DB, 'main');
  });

  it('?account= wins over a colliding entry_route ref (selected-account guarantee)', async () => {
    // A tenant may have an entry route or affiliate link whose ref_code happens
    // to be the same word the dashboard uses ('dashboard'). The explicit
    // account pin must not be re-routed by it.
    dbMocks.getEntryRouteByRefCode.mockResolvedValue({ id: 'er-1', pool_id: 'pool-1' });
    dbMocks.getTrafficPoolById.mockResolvedValue({ id: 'pool-1', is_active: 1 });
    dbMocks.getRandomPoolAccount.mockResolvedValue({
      id: 'acct-pool',
      channel_id: '3000000001',
      liff_id: '3000000001-PoolAAAA',
    });
    dbMocks.getLineAccountByChannelId.mockResolvedValue(TESTIN);

    const res = await get('/r/dashboard?account=2011171710');
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('liff.line.me/2011177336-RWMDBXOl');
    expect(html).not.toContain('liff.line.me/3000000001-PoolAAAA');
    // account pin short-circuits route/pool resolution entirely
    expect(dbMocks.getEntryRouteByRefCode).not.toHaveBeenCalled();
    expect(dbMocks.getRandomPoolAccount).not.toHaveBeenCalled();
  });
});

describe('/auth/line — mobile ?account= routing', () => {
  it('?account= without uid goes LIFF-direct (LINE app), not OAuth', async () => {
    dbMocks.getLineAccountByChannelId.mockResolvedValue(TESTIN);

    const res = await get('/auth/line?account=2011171710');
    expect(res.status).toBe(302);
    const location = res.headers.get('location') ?? '';

    expect(location).toContain('liff.line.me/2011177336-RWMDBXOl');
    expect(location).not.toContain('access.line.me');
    expect(location).toContain('account=2011171710');
  });

  it.each([
    ['uid', '/auth/line?account=2011171710&uid=user-uuid-1'],
    ['redirect', '/auth/line?account=2011171710&redirect=https%3A%2F%2Fexample.com%2Fthanks'],
    ['xh: ref', '/auth/line?account=2011171710&ref=xh%3Asecret-token'],
  ])(
    '?account= with callback-only state (%s) keeps the OAuth detour',
    async (_label, path) => {
      dbMocks.getLineAccountByChannelId.mockResolvedValue(TESTIN);

      const res = await get(path);
      expect(res.status).toBe(302);
      const location = res.headers.get('location') ?? '';

      expect(location).toContain('access.line.me/oauth2/v2.1/authorize');
      expect(location).toContain('client_id=2011177336');
    },
  );

  it('reserved ref codes are rejected at entry-route creation', async () => {
    const res = await worker.fetch(
      new Request('https://worker.example.com/api/entry-routes', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer env-key',
        },
        body: JSON.stringify({ refCode: 'Dashboard', name: 'collision' }),
      }),
      { ...env, API_KEY: 'env-key' } as typeof env,
      { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toContain('予約済み');
  });

  it('PC still gets the QR landing page for ?account= links', async () => {
    dbMocks.getLineAccountByChannelId.mockResolvedValue(TESTIN);

    const res = await get('/auth/line?account=2011171710', DESKTOP_UA);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('/api/qr');
    expect(html).toContain(encodeURIComponent('liff.line.me/2011177336-RWMDBXOl'));
  });
});
