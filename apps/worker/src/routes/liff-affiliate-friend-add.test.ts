import { describe, it, expect, vi, beforeEach } from 'vitest';

// ASP — friend-add push to the affiliate on a NEW friend arriving via an
// affiliate link. Drives GET /auth/callback (the genuine new-friend entry
// point). The db layer + notifier are mocked; a stubbed fetch answers the LINE
// OAuth token / verify / profile / bot-info calls.
//
// Cases:
//   - new friend via affiliate link → notifies
//   - self-click (affiliate adds own bot) → does NOT notify
//   - existing-friend re-touch → does NOT notify

const dbMocks = {
  // eager module-load deps
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  // /auth/callback deps
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
  getScenarioSteps: vi.fn().mockResolvedValue([]),
  getTrafficPoolBySlug: vi.fn().mockResolvedValue(null),
  getTrafficPoolById: vi.fn().mockResolvedValue(null),
  getRandomPoolAccount: vi.fn().mockResolvedValue(null),
  getPoolAccounts: vi.fn().mockResolvedValue([]),
  jstNow: () => '2026-07-07 00:00:00',
};
vi.mock('@line-crm/db', () => dbMocks);

const notifyAffiliateFriendAdd = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/affiliate-notifier.js', () => ({ notifyAffiliateFriendAdd }));

const worker = (await import('../index.js')).default;

// No-op prepared statement chain; the callback's raw UPDATE/SELECT statements
// don't matter for the notification assertions.
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
  LIFF_URL: 'https://liff.line.me/1000000000-DefaultAA',
  WORKER_URL: 'https://worker.example.com',
  LINE_LOGIN_CHANNEL_ID: '2000000000',
  LINE_LOGIN_CHANNEL_SECRET: 'secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'env-token',
} as unknown as import('../index.js').Env['Bindings'];

function installFetchMock() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://api.line.me/oauth2/v2.1/token') {
        return new Response(
          JSON.stringify({ access_token: 'at', id_token: 'idt', token_type: 'Bearer' }),
          { status: 200 },
        );
      }
      if (url === 'https://api.line.me/oauth2/v2.1/verify') {
        return new Response(JSON.stringify({ sub: 'U-new-friend', name: 'Tester' }), {
          status: 200,
        });
      }
      if (url === 'https://api.line.me/v2/profile') {
        return new Response(
          JSON.stringify({ userId: 'U-new-friend', displayName: 'Tester' }),
          { status: 200 },
        );
      }
      // bot/info etc → 404 so the handler falls through to the completion page
      return new Response('not found', { status: 404 });
    }),
  );
}

function callback(ref: string) {
  const state = btoa(JSON.stringify({ ref }));
  return worker.fetch(
    new Request(
      `https://worker.example.com/auth/callback?code=abc&state=${encodeURIComponent(state)}`,
    ),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  installFetchMock();
  dbMocks.createUser.mockResolvedValue({ id: 'U-uuid' });
  dbMocks.upsertFriend.mockResolvedValue({
    id: 'F-new',
    line_user_id: 'U-new-friend',
    line_account_id: null,
    user_id: null,
  });
});

describe('GET /auth/callback — affiliate friend-add notification', () => {
  it('notifies the affiliate for a new friend via an offer affiliate link', async () => {
    dbMocks.getFriendByLineUserId.mockResolvedValue(null); // brand-new friend
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue({
      id: 'AL-1',
      affiliate_id: 'AFF-1',
      ref_code: 'aff-ref',
      offer_id: 'OFF-1',
    });
    dbMocks.getAffiliateOfferById.mockResolvedValue({
      id: 'OFF-1',
      name: '案件A',
      tag_id: null,
      scenario_id: null,
      is_active: 1,
    });
    dbMocks.getAffiliateById.mockResolvedValue({ id: 'AFF-1', friend_id: 'F-owner' });

    await callback('aff-ref');

    expect(notifyAffiliateFriendAdd).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'AFF-1',
      '案件A',
    );
  });

  it('notifies with null offer name for a generic (offer-less) affiliate link', async () => {
    dbMocks.getFriendByLineUserId.mockResolvedValue(null);
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue({
      id: 'AL-2',
      affiliate_id: 'AFF-1',
      ref_code: 'aff-generic',
      offer_id: null,
    });
    dbMocks.getAffiliateById.mockResolvedValue({ id: 'AFF-1', friend_id: 'F-owner' });

    await callback('aff-generic');

    expect(notifyAffiliateFriendAdd).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'AFF-1',
      null,
    );
  });

  it('does NOT notify on a self-click (affiliate adds their own bot)', async () => {
    dbMocks.getFriendByLineUserId.mockResolvedValue(null);
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue({
      id: 'AL-3',
      affiliate_id: 'AFF-1',
      ref_code: 'aff-self',
      offer_id: 'OFF-1',
    });
    dbMocks.getAffiliateOfferById.mockResolvedValue({
      id: 'OFF-1',
      name: '案件A',
      tag_id: null,
      scenario_id: null,
      is_active: 1,
    });
    // affiliate's own friend_id == the friend being added
    dbMocks.getAffiliateById.mockResolvedValue({ id: 'AFF-1', friend_id: 'F-new' });

    await callback('aff-self');

    expect(notifyAffiliateFriendAdd).not.toHaveBeenCalled();
  });

  it('does NOT notify when the friend already existed (re-touch)', async () => {
    // Pre-existing friend → isNewFriend is false.
    dbMocks.getFriendByLineUserId.mockResolvedValue({
      id: 'F-new',
      line_user_id: 'U-new-friend',
      line_account_id: null,
      user_id: 'U-uuid',
    });
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue({
      id: 'AL-4',
      affiliate_id: 'AFF-1',
      ref_code: 'aff-ref',
      offer_id: 'OFF-1',
    });
    dbMocks.getAffiliateOfferById.mockResolvedValue({
      id: 'OFF-1',
      name: '案件A',
      tag_id: null,
      scenario_id: null,
      is_active: 1,
    });
    dbMocks.getAffiliateById.mockResolvedValue({ id: 'AFF-1', friend_id: 'F-owner' });

    await callback('aff-ref');

    expect(notifyAffiliateFriendAdd).not.toHaveBeenCalled();
  });
});
