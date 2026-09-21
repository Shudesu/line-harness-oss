import { describe, it, expect, vi, beforeEach } from 'vitest';

// /api/liff/link must persist ad click IDs (fbclid etc.) + UA/IP into
// ref_tracking, mirroring /auth/callback. Without this, Meta CAPI
// (sendAdConversions) finds no click ID for LIFF-path friends and silently
// sends nothing. Exercises the already-linked branch (same helper is used by
// the newly-linked branch).
const dbMocks = {
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  getFriendByLineUserIdForAccount: vi.fn(),
  getEntryRouteByRefCode: vi.fn().mockResolvedValue({ id: 'ER-1', tag_id: null, scenario_id: null }),
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
vi.mock('../services/affiliate-notifier.js', () => ({ notifyAffiliateFriendAdd: vi.fn() }));
vi.mock('../services/friend-tag-attach.js', () => ({
  attachTagAndFireSideEffects: vi.fn().mockResolvedValue({ added: true }),
}));

const worker = (await import('../index.js')).default;

const DB = {
  prepare: () => ({
    bind: () => ({
      run: async () => ({}),
      first: async () => null,
      all: async () => ({ results: [] }),
    }),
  }),
} as unknown as D1Database;

const env = {
  DB,
  LIFF_URL: 'https://liff.line.me/1000000000-DefaultAA',
  WORKER_URL: 'https://worker.example.com',
  LINE_LOGIN_CHANNEL_ID: '2000000000',
} as unknown as import('../index.js').Env['Bindings'];

function link(body: Record<string, unknown>) {
  return worker.fetch(
    new Request('https://worker.example.com/api/liff/link', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'UA-test',
        'CF-Connecting-IP': '203.0.113.9',
      },
      body: JSON.stringify({ idToken: 'tok', ...body }),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

describe('POST /api/liff/link — click IDs into ref_tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getFriendByLineUserIdForAccount.mockImplementation(
      (...args: unknown[]) => dbMocks.getFriendByLineUserId(...(args as [unknown, unknown])),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url === 'https://api.line.me/oauth2/v2.1/verify') {
          return new Response(JSON.stringify({ sub: 'U-friend', name: 'Tester' }), { status: 200 });
        }
        return new Response('not found', { status: 404 });
      }),
    );
    dbMocks.getFriendByLineUserId.mockResolvedValue({ id: 'F-1', line_account_id: null, user_id: 'U-uuid' });
  });

  it('persists fbclid/utm + UA/IP when the client forwards them', async () => {
    const res = await link({ ref: 'cg-a', fbclid: 'FB123', utmSource: 'meta' });
    expect(res.status).toBe(200);
    expect(dbMocks.recordRefTracking).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordRefTracking.mock.calls[0][1]).toMatchObject({
      refCode: 'cg-a',
      friendId: 'F-1',
      entryRouteId: 'ER-1',
      fbclid: 'FB123',
      gclid: null,
      utmSource: 'meta',
      userAgent: 'UA-test',
      ipAddress: '203.0.113.9',
    });
  });

  it('stores nulls (not undefined) when no click IDs are sent', async () => {
    const res = await link({ ref: 'cg-a' });
    expect(res.status).toBe(200);
    expect(dbMocks.recordRefTracking.mock.calls[0][1]).toMatchObject({ fbclid: null, gclid: null, ttclid: null });
  });
});
