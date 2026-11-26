import { describe, it, expect, vi, beforeEach } from 'vitest';

// friend_add auto-enroll gating on GET /auth/callback (LIFF/OAuth path).
//
// The friend_scenarios partial UNIQUE only blocks non-completed enrollments
// (WHERE status != 'completed'), so an existing friend with a completed
// enrollment would get re-enrolled — and the welcome sequence re-sent — every
// time they re-run OAuth login (e.g. via a form link). Re-sends on actual
// re-adds (unblock → follow) are the follow webhook's job, so the OAuth path
// must only enroll friends with no enrollment history for the scenario. It
// must NOT gate on "friend row is new": friends whose row was created without
// a follow event (message-first via ensureFriendFromWebhookUser, migrated
// bases, webhook partial failure) still rely on this path as their only
// friend_add entry.
//
// Cases:
//   - new friend → enrolls in active friend_add scenarios
//   - existing friend with a prior (completed) enrollment → does NOT enroll
//   - existing friend with NO enrollment history → enrolls (catch-up)

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
  computeNextDeliveryAt: vi.fn(),
  resolveStepContent: vi.fn(),
  getTrafficPoolBySlug: vi.fn().mockResolvedValue(null),
  getTrafficPoolById: vi.fn().mockResolvedValue(null),
  getRandomPoolAccount: vi.fn().mockResolvedValue(null),
  getPoolAccounts: vi.fn().mockResolvedValue([]),
  jstNow: () => '2026-07-19 00:00:00',
};
vi.mock('@line-crm/db', () => dbMocks);

const worker = (await import('../index.js')).default;

// Prepared-statement stub. Raw statements are no-ops except the
// friend_scenarios existence probe, which answers from `priorEnrollment` so
// tests can simulate a friend with/without enrollment history.
let priorEnrollment: { id: string } | null = null;
const DB = {
  prepare: (sql: string) => ({
    bind: () => ({
      run: async () => ({ meta: { changes: 0 } }),
      first: async () => (sql.includes('FROM friend_scenarios') ? priorEnrollment : null),
      all: async () => ({ results: [] }),
    }),
    run: async () => ({ meta: { changes: 0 } }),
    first: async () => null,
    all: async () => ({ results: [] }),
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
        return new Response(JSON.stringify({ sub: 'U-login', name: 'Tester' }), {
          status: 200,
        });
      }
      if (url === 'https://api.line.me/v2/profile') {
        return new Response(JSON.stringify({ userId: 'U-login', displayName: 'Tester' }), {
          status: 200,
        });
      }
      // bot/info, push, etc → 404 so the handler falls through
      return new Response('not found', { status: 404 });
    }),
  );
}

function callback() {
  const state = btoa(JSON.stringify({}));
  return worker.fetch(
    new Request(
      `https://worker.example.com/auth/callback?code=abc&state=${encodeURIComponent(state)}`,
    ),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

const friendAddScenario = {
  id: 'SC-1',
  trigger_type: 'friend_add',
  is_active: 1,
  line_account_id: null,
  delivery_mode: 'relative',
};

beforeEach(() => {
  vi.clearAllMocks();
  installFetchMock();
  priorEnrollment = null;
  dbMocks.createUser.mockResolvedValue({ id: 'U-uuid' });
  dbMocks.upsertFriend.mockResolvedValue({
    id: 'F-1',
    line_user_id: 'U-login',
    line_account_id: null,
    user_id: null,
  });
  dbMocks.getScenarios.mockResolvedValue([friendAddScenario]);
  dbMocks.enrollFriendInScenario.mockResolvedValue({ id: 'FS-1' });
  dbMocks.getScenarioSteps.mockResolvedValue([]);
});

describe('GET /auth/callback — friend_add scenario auto-enroll gating', () => {
  it('enrolls a brand-new friend in active friend_add scenarios', async () => {
    dbMocks.getFriendByLineUserId.mockResolvedValue(null); // brand-new friend

    await callback();

    expect(dbMocks.enrollFriendInScenario).toHaveBeenCalledWith(
      expect.anything(),
      'F-1',
      'SC-1',
    );
  });

  it('does NOT enroll an existing friend with a prior enrollment on OAuth re-login', async () => {
    // A completed enrollment doesn't block the partial UNIQUE, so without the
    // existence guard this re-login would re-create the enrollment and
    // re-send the whole welcome sequence.
    dbMocks.getFriendByLineUserId.mockResolvedValue({
      id: 'F-1',
      line_user_id: 'U-login',
      line_account_id: null,
      user_id: 'U-uuid',
    });
    priorEnrollment = { id: 'FS-done' };

    await callback();

    expect(dbMocks.enrollFriendInScenario).not.toHaveBeenCalled();
  });

  it('enrolls an existing friend with NO enrollment history (catch-up)', async () => {
    // Friend row was created without a follow event (message-first friend,
    // migrated base, or a follow webhook that died before enrolling). The
    // OAuth path is their only friend_add entry — it must still enroll them.
    dbMocks.getFriendByLineUserId.mockResolvedValue({
      id: 'F-1',
      line_user_id: 'U-login',
      line_account_id: null,
      user_id: 'U-uuid',
    });
    priorEnrollment = null;

    await callback();

    expect(dbMocks.enrollFriendInScenario).toHaveBeenCalledWith(
      expect.anything(),
      'F-1',
      'SC-1',
    );
  });
});
