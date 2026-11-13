import { describe, it, expect, vi, beforeEach } from 'vitest';

// GET /auth/callback — bind the friend to the account named in the login link
// (state.account = channel id) when the friend isn't bound yet, so step delivery
// uses that account's token before the account's webhook ever fires.
//
// Cases:
//   - account in link + unbound friend → UPDATE line_account_id
//   - account in link + already bound friend → no UPDATE (never overwrite)
//   - no account in link → no UPDATE

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

const executed: { sql: string; args: unknown[] }[] = [];
const DB = {
  prepare: (sql: string) => ({
    bind: (...args: unknown[]) => ({
      run: async () => {
        executed.push({ sql, args });
        return { meta: { changes: 1 } };
      },
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
        return new Response(JSON.stringify({ sub: 'U-friend', name: 'Tester' }), { status: 200 });
      }
      if (url === 'https://api.line.me/v2/profile') {
        return new Response(JSON.stringify({ userId: 'U-friend', displayName: 'Tester' }), {
          status: 200,
        });
      }
      return new Response('not found', { status: 404 });
    }),
  );
}

function callback(state: Record<string, string>) {
  const s = btoa(JSON.stringify(state));
  return worker.fetch(
    new Request(`https://worker.example.com/auth/callback?code=abc&state=${encodeURIComponent(s)}`),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

const bindUpdates = () =>
  executed.filter((e) => e.sql.startsWith('UPDATE friends SET line_account_id'));

beforeEach(() => {
  vi.clearAllMocks();
  executed.length = 0;
  installFetchMock();
  dbMocks.createUser.mockResolvedValue({ id: 'U-uuid' });
  dbMocks.getFriendByLineUserId.mockResolvedValue(null);
  dbMocks.getLineAccountByChannelId.mockImplementation(async (_db: unknown, channelId: string) =>
    channelId === '2008806062' ? { id: 'ACC-kidou', channel_id: '2008806062' } : null,
  );
});

describe('GET /auth/callback — bind friend to the link account', () => {
  it('binds an unbound friend to the account in the link', async () => {
    dbMocks.upsertFriend.mockResolvedValue({
      id: 'F-1', line_user_id: 'U-friend', line_account_id: null, user_id: null,
    });
    await callback({ account: '2008806062' });
    const ups = bindUpdates();
    expect(ups).toHaveLength(1);
    expect(ups[0].sql).toContain('AND line_account_id IS NULL');
    expect(ups[0].args[0]).toBe('ACC-kidou');
    expect(ups[0].args[2]).toBe('F-1');
  });

  it('does not overwrite an existing binding', async () => {
    dbMocks.upsertFriend.mockResolvedValue({
      id: 'F-2', line_user_id: 'U-friend', line_account_id: 'ACC-other', user_id: null,
    });
    await callback({ account: '2008806062' });
    expect(bindUpdates()).toHaveLength(0);
  });

  it('does nothing when the link names no account', async () => {
    dbMocks.upsertFriend.mockResolvedValue({
      id: 'F-3', line_user_id: 'U-friend', line_account_id: null, user_id: null,
    });
    await callback({});
    expect(bindUpdates()).toHaveLength(0);
  });

  it('does nothing when the account in the link is unknown', async () => {
    dbMocks.upsertFriend.mockResolvedValue({
      id: 'F-4', line_user_id: 'U-friend', line_account_id: null, user_id: null,
    });
    await callback({ account: '9999999999' });
    expect(bindUpdates()).toHaveLength(0);
  });
});
