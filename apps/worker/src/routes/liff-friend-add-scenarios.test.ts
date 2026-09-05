import { describe, it, expect, vi, beforeEach } from 'vitest';

// GET /auth/callback — the friend_add auto-enroll loop must delegate the
// instant welcome to the unified pushImmediateFirstStep service ('once' mode,
// pre-created enrollment). The pre-unification inline block pushed step 1
// itself WITHOUT advancing the enrollment, leaving the fresh row at step -1
// with next_delivery_at already due — the next cron tick then re-sent step 1
// (double welcome). These tests pin the delegation contract; the claim /
// cooldown / advance semantics themselves are covered by
// ../services/immediate-first-step.test.ts.

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
  getTrafficPoolBySlug: vi.fn().mockResolvedValue(null),
  getTrafficPoolById: vi.fn().mockResolvedValue(null),
  getRandomPoolAccount: vi.fn().mockResolvedValue(null),
  getPoolAccounts: vi.fn().mockResolvedValue([]),
  jstNow: () => '2026-07-19 00:00:00',
};
vi.mock('@line-crm/db', () => dbMocks);

const pushImmediateFirstStep = vi.fn().mockResolvedValue(true);
vi.mock('../services/immediate-first-step.js', () => ({ pushImmediateFirstStep }));

const worker = (await import('../index.js')).default;

// No-op prepared statement chain; the callback's raw UPDATE/SELECT statements
// don't matter for the delegation assertions.
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

function callback(state: Record<string, string>) {
  const encoded = btoa(JSON.stringify(state));
  return worker.fetch(
    new Request(
      `https://worker.example.com/auth/callback?code=abc&state=${encodeURIComponent(encoded)}`,
    ),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

const FRIEND_ADD_SCENARIO = {
  id: 'scn-1',
  trigger_type: 'friend_add',
  is_active: 1,
  line_account_id: null,
  delivery_mode: 'relative',
};
const ENROLLMENT = { id: 'fs-1', current_step_order: -1 };

beforeEach(() => {
  vi.clearAllMocks();
  installFetchMock();
  pushImmediateFirstStep.mockResolvedValue(true);
  dbMocks.getFriendByLineUserId.mockResolvedValue(null); // brand-new friend
  dbMocks.createUser.mockResolvedValue({ id: 'U-uuid' });
  dbMocks.upsertFriend.mockResolvedValue({
    id: 'F-new',
    line_user_id: 'U-new-friend',
    line_account_id: null,
    user_id: null,
  });
  dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);
  dbMocks.getLineAccountByChannelId.mockResolvedValue(null);
  dbMocks.getScenarios.mockResolvedValue([FRIEND_ADD_SCENARIO]);
  dbMocks.enrollFriendInScenario.mockResolvedValue(ENROLLMENT);
});

describe('GET /auth/callback — friend_add auto-enroll delegates to pushImmediateFirstStep', () => {
  it("enrolls and hands the fresh enrollment to the service ('once' mode contract)", async () => {
    await callback({ ref: '' });

    expect(dbMocks.enrollFriendInScenario).toHaveBeenCalledWith(DB, 'F-new', 'scn-1');
    expect(pushImmediateFirstStep).toHaveBeenCalledTimes(1);
    expect(pushImmediateFirstStep).toHaveBeenCalledWith(
      DB,
      'F-new',
      'scn-1',
      {
        defaultAccessToken: 'env-token',
        workerUrl: 'https://worker.example.com',
        accountChannelId: null,
      },
      // No mode override → the service defaults to 'once' (claim protocol,
      // advance-after-send). The push target is the id_token sub, which is
      // known before friend.line_user_id is fully wired.
      { enrollment: ENROLLMENT, targetLineUserId: 'U-new-friend' },
    );
  });

  it('does NOT push when the friend is already enrolled (INSERT OR IGNORE returned null)', async () => {
    dbMocks.enrollFriendInScenario.mockResolvedValue(null);

    await callback({ ref: '' });

    expect(pushImmediateFirstStep).not.toHaveBeenCalled();
  });

  it('skips inactive and non-friend_add scenarios without enrolling', async () => {
    dbMocks.getScenarios.mockResolvedValue([
      { ...FRIEND_ADD_SCENARIO, id: 'scn-paused', is_active: 0 },
      { ...FRIEND_ADD_SCENARIO, id: 'scn-tag', trigger_type: 'tag_added' },
    ]);

    await callback({ ref: '' });

    expect(dbMocks.enrollFriendInScenario).not.toHaveBeenCalled();
    expect(pushImmediateFirstStep).not.toHaveBeenCalled();
  });

  it('honors entry_routes.run_account_friend_add_scenarios = 0 (referral override)', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue({
      id: 'er-1',
      run_account_friend_add_scenarios: 0,
      tag_id: null,
      scenario_id: null,
      tracked_link_id: null,
    });

    await callback({ ref: 'r-override' });

    expect(dbMocks.enrollFriendInScenario).not.toHaveBeenCalled();
    expect(pushImmediateFirstStep).not.toHaveBeenCalled();
  });

  it('account-scoped: enrolls only matching-account scenarios and forwards accountChannelId', async () => {
    dbMocks.getLineAccountByChannelId.mockResolvedValue({
      id: 'acct-9',
      channel_access_token: 'tok-9',
    });
    dbMocks.getScenarios.mockResolvedValue([
      { ...FRIEND_ADD_SCENARIO, id: 'scn-mine', line_account_id: 'acct-9' },
      { ...FRIEND_ADD_SCENARIO, id: 'scn-other', line_account_id: 'acct-other' },
    ]);

    await callback({ ref: '', account: 'CH-9' });

    expect(dbMocks.enrollFriendInScenario).toHaveBeenCalledTimes(1);
    expect(dbMocks.enrollFriendInScenario).toHaveBeenCalledWith(DB, 'F-new', 'scn-mine');
    expect(pushImmediateFirstStep).toHaveBeenCalledTimes(1);
    expect(pushImmediateFirstStep).toHaveBeenCalledWith(
      DB,
      'F-new',
      'scn-mine',
      expect.objectContaining({ accountChannelId: 'CH-9' }),
      { enrollment: ENROLLMENT, targetLineUserId: 'U-new-friend' },
    );
  });

  it('a failure on one scenario neither skips the remaining scenarios nor aborts the callback', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    dbMocks.getScenarios.mockResolvedValue([
      { ...FRIEND_ADD_SCENARIO, id: 'scn-a' },
      { ...FRIEND_ADD_SCENARIO, id: 'scn-b' },
    ]);
    pushImmediateFirstStep.mockRejectedValueOnce(new Error('LINE 500'));

    const res = await callback({ ref: '' });

    expect(res.status).toBe(200);
    // scn-a failed, scn-b must still be enrolled and pushed.
    expect(dbMocks.enrollFriendInScenario).toHaveBeenCalledTimes(2);
    expect(pushImmediateFirstStep).toHaveBeenCalledTimes(2);
    expect(pushImmediateFirstStep).toHaveBeenLastCalledWith(
      DB,
      'F-new',
      'scn-b',
      expect.anything(),
      { enrollment: ENROLLMENT, targetLineUserId: 'U-new-friend' },
    );
    errorSpy.mockRestore();
  });
});
