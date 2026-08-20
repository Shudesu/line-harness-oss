import { describe, it, expect, vi, beforeEach } from 'vitest';

// L Harness Cloud tenants are provisioned WITHOUT LINE Login / LIFF config:
// LINE_LOGIN_CHANNEL_ID / LIFF_URL env are unset and the line_accounts row has
// no login_channel_id / liff_id yet. /auth/line (and /auth/oauth, /auth/callback,
// /r/:ref) used to crash with a 500 — `liffUrl.match()` on undefined, or
// client_id=undefined sent to access.line.me. These tests pin the guard:
// a 503 Japanese setup-guidance page instead of the 500.

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
  jstNow: () => '2026-07-19 00:00:00',
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

// L Harness Cloud tenant shape: no LIFF_URL, no LINE_LOGIN_CHANNEL_ID/SECRET.
const unconfiguredEnv = {
  DB,
  WORKER_URL: 'https://worker.example.com',
  LINE_CHANNEL_ACCESS_TOKEN: 'env-token',
} as unknown as import('../index.js').Env['Bindings'];

const configuredEnv = {
  DB,
  WORKER_URL: 'https://worker.example.com',
  LINE_CHANNEL_ACCESS_TOKEN: 'env-token',
  LIFF_URL: 'https://liff.line.me/1000000000-DefaultAA',
  LINE_LOGIN_CHANNEL_ID: '2000000000',
  LINE_LOGIN_CHANNEL_SECRET: 'login-secret',
} as unknown as import('../index.js').Env['Bindings'];

const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile';

function get(path: string, env: import('../index.js').Env['Bindings'], ua = DESKTOP_UA) {
  return worker.fetch(
    new Request(`https://worker.example.com${path}`, { headers: { 'user-agent': ua } }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getLineAccounts.mockResolvedValue([]);
  dbMocks.getLineAccountByChannelId.mockResolvedValue(null);
  dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);
  dbMocks.getAffiliateLinkByRefCode.mockResolvedValue(null);
  dbMocks.getTrafficPoolBySlug.mockResolvedValue(null);
  // fetch must never fire on the guard paths — fail loudly if it does
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('unexpected external fetch', { status: 500 })),
  );
});

describe('GET /auth/line — LINE Login unconfigured guard', () => {
  it('returns the 503 guidance page instead of a 500 (desktop)', async () => {
    const res = await get('/auth/line', unconfiguredEnv);
    expect(res.status).toBe(503);
    const body = await res.text();
    expect(body).toContain('LINE ログインが未設定です');
    expect(body).toContain('harness-wiki.pages.dev');
  });

  it('returns 503 for mobile UA as well', async () => {
    const res = await get('/auth/line', unconfiguredEnv, MOBILE_UA);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('LINE ログインが未設定です');
  });

  it('returns 503 when ?account= resolves to a row without login/liff fields (LHC tenant repro)', async () => {
    dbMocks.getLineAccountByChannelId.mockResolvedValue({
      channel_id: '2011171710',
      login_channel_id: null,
      login_channel_secret: null,
      liff_id: null,
    });
    const res = await get('/auth/line?account=2011171710', unconfiguredEnv);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('LINE ログインが未設定です');
  });

  it('still serves the QR page when env config is present (regression)', async () => {
    const res = await get('/auth/line', configuredEnv);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('QR');
  });

  it('proceeds when the account row itself provides login config', async () => {
    dbMocks.getLineAccountByChannelId.mockResolvedValue({
      channel_id: '2011171710',
      login_channel_id: '2099999999',
      login_channel_secret: 's',
      liff_id: '2099999999-AbCdEfGh',
    });
    const res = await get('/auth/line?account=2011171710', unconfiguredEnv);
    expect(res.status).toBe(200);
  });
});

describe('GET /auth/oauth — LINE Login unconfigured guard', () => {
  it('returns 503 instead of redirecting with client_id=undefined', async () => {
    const res = await get('/auth/oauth', unconfiguredEnv);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('LINE ログインが未設定です');
  });

  it('still redirects to access.line.me when configured (regression)', async () => {
    const res = await get('/auth/oauth', configuredEnv);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain('access.line.me');
  });
});

describe('GET /auth/callback — LINE Login unconfigured guard', () => {
  it('returns 503 before attempting the token exchange', async () => {
    const state = btoa(JSON.stringify({ ref: '' }));
    const res = await get(
      `/auth/callback?code=abc&state=${encodeURIComponent(state)}`,
      unconfiguredEnv,
    );
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('LINE ログインが未設定です');
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('GET /r/:ref — LIFF unconfigured guard', () => {
  it('returns 503 instead of crashing on liffUrl.match', async () => {
    const res = await get('/r/somecode', unconfiguredEnv, MOBILE_UA);
    expect(res.status).toBe(503);
    expect(await res.text()).toContain('LINE ログインが未設定です');
  });

  it('still renders the landing page when LIFF_URL is configured (regression)', async () => {
    const res = await get('/r/somecode', configuredEnv, MOBILE_UA);
    expect(res.status).toBe(200);
  });
});
