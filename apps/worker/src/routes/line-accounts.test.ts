import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';

// Mock @line-crm/db so we can assert on the values the route forwards to the
// DB layer without needing a real D1Database. The route's responsibility is
// "normalize body → call DB function with correct args", so capturing those
// args is the meaningful assertion.
const dbMocks = {
  getLineAccounts: vi.fn(),
  getLineAccountById: vi.fn(),
  createLineAccount: vi.fn(),
  updateLineAccount: vi.fn(),
  updateLineAccountFields: vi.fn(),
  updateLineAccountOrder: vi.fn(),
  deleteLineAccount: vi.fn(),
  getAccountSetting: vi.fn(),
  setAccountSetting: vi.fn(),
  jstNow: vi.fn(() => '2026-08-10T12:00:00.000+09:00'),
};
vi.mock('@line-crm/db', () => dbMocks);

const lineClientMocks = {
  getFollowersInsight: vi.fn(),
  getFollowerIds: vi.fn(),
  getMessageQuota: vi.fn(),
  getMessageQuotaConsumption: vi.fn(),
};
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => lineClientMocks),
}));

// Re-import after mock so the module picks up mocked deps.
const { lineAccounts } = await import('./line-accounts.js');

type TestEnv = {
  Variables: { staff: { id: string; role: 'owner' | 'admin' | 'staff' } };
  Bindings: { DB: D1Database };
};

// Minimal D1 stub: every prepare/bind/first chain resolves to `null` (no row).
// Used for the uniqueness check in checkUniqueLoginAndLiff — tests that need
// to assert duplicate-rejection override `firstResult` per request.
function makeDbStub(firstResult: unknown = null): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        first: vi.fn().mockResolvedValue(firstResult),
      })),
    })),
  } as unknown as D1Database;
}

function setupApp(
  role: 'owner' | 'admin' | 'staff' = 'owner',
  dbStub: D1Database = makeDbStub(),
) {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'test-staff', role });
    c.env = { DB: dbStub };
    await next();
  });
  app.route('/', lineAccounts);
  return app;
}

const fakeAccount = {
  id: 'acc-1',
  channel_id: '123456789',
  name: 'メイン',
  channel_access_token: 'token',
  channel_secret: 'secret',
  login_channel_id: null,
  login_channel_secret: null,
  liff_id: null,
  is_active: 1,
  country: null,
  role: null,
  display_order: 0,
  token_expires_at: null,
  created_at: '2026-05-08T00:00:00.000',
  updated_at: '2026-05-08T00:00:00.000',
};

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
  lineClientMocks.getFollowersInsight.mockReset();
  lineClientMocks.getFollowerIds.mockReset();
  lineClientMocks.getMessageQuota.mockReset();
  lineClientMocks.getMessageQuotaConsumption.mockReset();
  dbMocks.getAccountSetting.mockResolvedValue(null);
  dbMocks.setAccountSetting.mockResolvedValue(undefined);
  dbMocks.jstNow.mockReturnValue('2026-08-10T12:00:00.000+09:00');
  lineClientMocks.getFollowerIds.mockResolvedValue({ userIds: [] });
});

describe('GET /api/line-accounts/:id', () => {
  const secretAccount = {
    ...fakeAccount,
    channel_access_token: 'plaintext-channel-token-WXYZ',
    channel_secret: 'plaintext-channel-secret-1234',
    login_channel_secret: 'plaintext-login-secret-5678',
  };

  // An API key handed to an MCP agent is owner-role. Returning the plaintext
  // channel token here would let a leaked key take over the LINE channel itself.
  test('masks secrets for owner instead of returning them in full', async () => {
    dbMocks.getLineAccountById.mockResolvedValue(secretAccount);

    const app = setupApp('owner');
    const res = await app.request('/api/line-accounts/acc-1');

    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain('plaintext-channel-token');
    expect(raw).not.toContain('plaintext-channel-secret');
    expect(raw).not.toContain('plaintext-login-secret');

    const body = JSON.parse(raw) as { data: Record<string, unknown> };
    expect(body.data.channelAccessToken).toBe('****WXYZ');
    expect(body.data.channelSecret).toBe('****1234');
    expect(body.data.loginChannelSecret).toBe('****5678');
  });

  test('omits secret fields entirely for staff role', async () => {
    dbMocks.getLineAccountById.mockResolvedValue(secretAccount);

    const app = setupApp('staff');
    const res = await app.request('/api/line-accounts/acc-1');

    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.channelAccessToken).toBeUndefined();
    expect(body.data.channelSecret).toBeUndefined();
    expect(body.data.loginChannelSecret).toBeUndefined();
  });

  // An update that touches only non-secret fields still returns the row, so an
  // unmasked PUT response would hand back the *stored* token — the same read
  // path the GET masking closes.
  test('PUT response masks secrets the caller did not supply', async () => {
    dbMocks.getLineAccountById.mockResolvedValue(secretAccount);
    dbMocks.updateLineAccountFields.mockResolvedValue(secretAccount);
    dbMocks.updateLineAccount.mockResolvedValue(secretAccount);

    const app = setupApp('owner');
    const res = await app.request('/api/line-accounts/acc-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '名前だけ変更' }),
    });

    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain('plaintext-channel-token');
    expect(raw).not.toContain('plaintext-channel-secret');
    expect(raw).not.toContain('plaintext-login-secret');
  });

  // Masking null would render as "****" and read as "configured" in the UI.
  test('keeps unset secrets null rather than masking them into a value', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({ ...secretAccount, login_channel_secret: null });

    const app = setupApp('owner');
    const res = await app.request('/api/line-accounts/acc-1');

    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.loginChannelSecret).toBeNull();
  });
});

describe('GET /api/line-accounts/:id/follower-insight', () => {
  test('returns LINE follower insight without exposing account token', async () => {
    dbMocks.getLineAccountById.mockResolvedValue(fakeAccount);
    lineClientMocks.getFollowersInsight.mockResolvedValue({
      status: 'ready',
      followers: 123,
      targetedReaches: 111,
      blocks: 4,
    });

    const app = setupApp('owner');
    const res = await app.request('/api/line-accounts/acc-1/follower-insight?date=20260616');

    expect(res.status).toBe(200);
    expect(dbMocks.getLineAccountById).toHaveBeenCalledWith(expect.anything(), 'acc-1');
    expect(lineClientMocks.getFollowersInsight).toHaveBeenCalledWith('20260616');
    const body = (await res.json()) as {
      success: boolean;
      data: {
        lineAccountId: string;
        date: string;
        status: string;
        followers: number;
        targetedReaches: number;
        blocks: number;
        channelAccessToken?: string;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      lineAccountId: 'acc-1',
      date: '20260616',
      status: 'ready',
      followers: 123,
      targetedReaches: 111,
      blocks: 4,
    });
    expect(body.data.channelAccessToken).toBeUndefined();
  });

  test('rejects missing insight date', async () => {
    const app = setupApp('owner');
    const res = await app.request('/api/line-accounts/acc-1/follower-insight');

    expect(res.status).toBe(400);
    expect(lineClientMocks.getFollowersInsight).not.toHaveBeenCalled();
  });
});

describe('GET /api/line-accounts/delivery-health', () => {
  // Freeze time so insight dates are deterministic and the followers-insight
  // mock can be keyed on the requested date (order-independent):
  // 2026-09-02T03:00Z = 2026-09-02 12:00 JST → yesterday 20260901, before 20260831.
  const YESTERDAY = '20260901';
  const DAY_BEFORE = '20260831';
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-09-02T03:00:00Z'), toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** SQL-sniffing D1 stub: monthly log rows / all-target broadcasts / friend count. */
  function makeCountsDb(counts: { log?: number; broadcast?: number; friends?: number }): D1Database {
    return {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes('FROM messages_log')) return { count: counts.log ?? 0 };
            if (sql.includes('FROM broadcasts')) return { count: counts.broadcast ?? 0 };
            if (sql.includes('FROM friends')) return { count: counts.friends ?? 0 };
            return null;
          },
        }),
      }),
    } as unknown as D1Database;
  }

  function mockInsightByDate(
    byDate: Record<string, { status: string; followers?: number; targetedReaches?: number; blocks?: number }>,
  ) {
    lineClientMocks.getFollowersInsight.mockImplementation((date: string) =>
      byDate[date] ? Promise.resolve(byDate[date]) : Promise.reject(new Error(`no insight for ${date}`)),
    );
  }

  test('returns quota, insight deltas, monthly count and flags quota shortage', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([fakeAccount]);
    lineClientMocks.getMessageQuota.mockResolvedValue({ type: 'limited', value: 300 });
    lineClientMocks.getMessageQuotaConsumption.mockResolvedValue({ totalUsage: 260 });
    mockInsightByDate({
      [YESTERDAY]: { status: 'ready', followers: 120, targetedReaches: 100, blocks: 8 },
      [DAY_BEFORE]: { status: 'ready', followers: 115, targetedReaches: 96, blocks: 5 },
    });

    const app = setupApp('owner', makeCountsDb({ log: 40, broadcast: 2, friends: 110 }));
    const res = await app.request('/api/line-accounts/delivery-health');

    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).not.toContain(fakeAccount.channel_access_token);
    expect(raw).not.toContain(fakeAccount.channel_secret);

    const body = JSON.parse(raw) as {
      success: boolean;
      data: { insightDate: string; accounts: Array<Record<string, unknown>> };
    };
    expect(body.success).toBe(true);
    expect(body.data.insightDate).toBe(YESTERDAY);
    expect(body.data.accounts).toHaveLength(1);
    expect(body.data.accounts[0]).toMatchObject({
      lineAccountId: 'acc-1',
      name: 'メイン',
      quota: { type: 'limited', limit: 300, consumption: 260, remaining: 40 },
      // remaining 40 < targetedReaches 100 → an all-target send cannot complete
      quotaAlert: true,
      insight: {
        status: 'ready',
        date: YESTERDAY,
        followers: 120,
        targetedReaches: 100,
        blocks: 8,
        followersDelta: 5,
        blocksDelta: 3,
      },
      // 40 log rows + 2 all-target broadcast recipients
      messagesThisMonth: 42,
      errors: [],
    });
  });

  test('unlimited plan (type=none) yields null limit and no alert', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([fakeAccount]);
    lineClientMocks.getMessageQuota.mockResolvedValue({ type: 'none' });
    lineClientMocks.getMessageQuotaConsumption.mockResolvedValue({ totalUsage: 5000 });
    mockInsightByDate({
      [YESTERDAY]: { status: 'ready', followers: 10, targetedReaches: 9, blocks: 1 },
      [DAY_BEFORE]: { status: 'ready', followers: 10, targetedReaches: 9, blocks: 1 },
    });

    const app = setupApp('owner', makeCountsDb({}));
    const res = await app.request('/api/line-accounts/delivery-health');

    const body = (await res.json()) as { data: { accounts: Array<Record<string, unknown>> } };
    expect(body.data.accounts[0]).toMatchObject({
      quota: { type: 'none', limit: null, consumption: 5000, remaining: null },
      quotaAlert: false,
    });
  });

  test('failing quota calls degrade to null with errors recorded; unready insight is a distinct status', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([fakeAccount]);
    lineClientMocks.getMessageQuota.mockRejectedValue(new Error('LINE API error: 401'));
    lineClientMocks.getMessageQuotaConsumption.mockRejectedValue(new Error('LINE API error: 401'));
    mockInsightByDate({
      [YESTERDAY]: { status: 'unready' },
      [DAY_BEFORE]: { status: 'unready' },
    });

    const app = setupApp('owner', makeCountsDb({ log: 3 }));
    const res = await app.request('/api/line-accounts/delivery-health');

    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { accounts: Array<Record<string, unknown>> } };
    expect(body.data.accounts[0]).toMatchObject({
      quota: { type: null, limit: null, consumption: null, remaining: null },
      quotaAlert: false,
      insight: {
        status: 'unready',
        date: null,
        followers: null,
        targetedReaches: null,
        blocks: null,
        followersDelta: null,
        blocksDelta: null,
      },
      messagesThisMonth: 3,
    });
    // Fulfilled-but-unready is NOT an error — only the real failures are.
    expect(body.data.accounts[0].errors).toEqual(['quota', 'consumption']);
  });

  test('quota exhaustion still alerts when the insight is unready (DB friend-count fallback)', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([fakeAccount]);
    lineClientMocks.getMessageQuota.mockResolvedValue({ type: 'limited', value: 300 });
    lineClientMocks.getMessageQuotaConsumption.mockResolvedValue({ totalUsage: 280 });
    mockInsightByDate({
      [YESTERDAY]: { status: 'unready' },
      [DAY_BEFORE]: { status: 'unready' },
    });

    // remaining 20 < 50 following friends in DB → alert even without insight
    const app = setupApp('owner', makeCountsDb({ friends: 50 }));
    const res = await app.request('/api/line-accounts/delivery-health');

    const body = (await res.json()) as { data: { accounts: Array<Record<string, unknown>> } };
    expect(body.data.accounts[0]).toMatchObject({
      quota: { remaining: 20 },
      quotaAlert: true,
    });
  });

  test('remaining 0 alerts even when no audience estimate is available', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([fakeAccount]);
    lineClientMocks.getMessageQuota.mockResolvedValue({ type: 'limited', value: 300 });
    lineClientMocks.getMessageQuotaConsumption.mockResolvedValue({ totalUsage: 300 });
    mockInsightByDate({
      [YESTERDAY]: { status: 'unready' },
      [DAY_BEFORE]: { status: 'unready' },
    });

    const app = setupApp('owner', makeCountsDb({ friends: 0 }));
    const res = await app.request('/api/line-accounts/delivery-health');

    const body = (await res.json()) as { data: { accounts: Array<Record<string, unknown>> } };
    expect(body.data.accounts[0]).toMatchObject({
      quota: { remaining: 0 },
      quotaAlert: true,
    });
  });

  test('a failing day-before insight call is recorded in errors, deltas stay null', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([fakeAccount]);
    lineClientMocks.getMessageQuota.mockResolvedValue({ type: 'limited', value: 300 });
    lineClientMocks.getMessageQuotaConsumption.mockResolvedValue({ totalUsage: 10 });
    mockInsightByDate({
      [YESTERDAY]: { status: 'ready', followers: 120, targetedReaches: 100, blocks: 8 },
      // DAY_BEFORE missing → the mock rejects that call
    });

    const app = setupApp('owner', makeCountsDb({ friends: 100 }));
    const res = await app.request('/api/line-accounts/delivery-health');

    const body = (await res.json()) as { data: { accounts: Array<Record<string, unknown>> } };
    expect(body.data.accounts[0]).toMatchObject({
      insight: {
        status: 'ready',
        followers: 120,
        followersDelta: null,
        blocksDelta: null,
      },
    });
    expect(body.data.accounts[0].errors).toEqual(['prevInsight']);
  });

  test('skips inactive accounts', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([
      fakeAccount,
      { ...fakeAccount, id: 'acc-2', name: '停止中', is_active: 0 },
    ]);
    lineClientMocks.getMessageQuota.mockResolvedValue({ type: 'limited', value: 200 });
    lineClientMocks.getMessageQuotaConsumption.mockResolvedValue({ totalUsage: 0 });
    mockInsightByDate({
      [YESTERDAY]: { status: 'unready' },
      [DAY_BEFORE]: { status: 'unready' },
    });

    const app = setupApp('owner', makeCountsDb({}));
    const res = await app.request('/api/line-accounts/delivery-health');

    const body = (await res.json()) as { data: { accounts: Array<{ lineAccountId: string }> } };
    expect(body.data.accounts.map((a) => a.lineAccountId)).toEqual(['acc-1']);
  });
});

describe('POST /api/line-accounts', () => {
  test('passes loginChannelId / loginChannelSecret / liffId through to createLineAccount', async () => {
    dbMocks.createLineAccount.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: '2009624792',
      login_channel_secret: 'login-secret',
      liff_id: '2009624792-XXXX',
    });

    const app = setupApp('owner');
    const res = await app.request('/api/line-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: '123456789',
        name: 'メイン',
        channelAccessToken: 'token',
        channelSecret: 'secret',
        loginChannelId: '2009624792',
        loginChannelSecret: 'login-secret',
        liffId: '2009624792-XXXX',
      }),
    });

    expect(res.status).toBe(201);
    expect(dbMocks.createLineAccount).toHaveBeenCalledTimes(1);
    expect(dbMocks.createLineAccount.mock.calls[0][1]).toMatchObject({
      channelId: '123456789',
      loginChannelId: '2009624792',
      loginChannelSecret: 'login-secret',
      liffId: '2009624792-XXXX',
    });

    const body = (await res.json()) as { success: boolean; data: { loginChannelId: string | null; liffId: string | null; loginChannelSecret: string | null } };
    expect(body.success).toBe(true);
    expect(body.data.loginChannelId).toBe('2009624792');
    expect(body.data.liffId).toBe('2009624792-XXXX');
    // serializeLineAccountFull exposes loginChannelSecret to owner-only POST response
    expect(body.data.loginChannelSecret).toBe('login-secret');
  });

  test('omits loginChannelId/etc when not provided (stores null)', async () => {
    dbMocks.createLineAccount.mockResolvedValue(fakeAccount);

    const app = setupApp('owner');
    const res = await app.request('/api/line-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: '123456789',
        name: 'メイン',
        channelAccessToken: 'token',
        channelSecret: 'secret',
      }),
    });

    expect(res.status).toBe(201);
    expect(dbMocks.createLineAccount.mock.calls[0][1]).toMatchObject({
      loginChannelId: null,
      loginChannelSecret: null,
      liffId: null,
    });
  });

  test('trims whitespace and treats empty string as null for optional fields', async () => {
    dbMocks.createLineAccount.mockResolvedValue(fakeAccount);

    // Use a complete login pair (both id+secret present) to focus on the
    // trim/empty-string normalization behavior. liffId is independent.
    const app = setupApp('owner');
    await app.request('/api/line-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: '123456789',
        name: 'メイン',
        channelAccessToken: 'token',
        channelSecret: 'secret',
        loginChannelId: '  2009624792  ',
        loginChannelSecret: '  login-secret  ',
        liffId: '   ',
      }),
    });

    expect(dbMocks.createLineAccount.mock.calls[0][1]).toMatchObject({
      loginChannelId: '2009624792',
      loginChannelSecret: 'login-secret',
      liffId: null,
    });
  });
});

describe('PATCH /api/line-accounts/:id', () => {
  test('updates loginChannelId / loginChannelSecret / liffId via metadata path', async () => {
    dbMocks.getLineAccountById.mockResolvedValue(fakeAccount);
    dbMocks.updateLineAccountFields.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: '2009999999',
      liff_id: '2009999999-YYYY',
    });

    const app = setupApp('admin');
    const res = await app.request('/api/line-accounts/acc-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loginChannelId: '2009999999',
        loginChannelSecret: 'rotated',
        liffId: '2009999999-YYYY',
      }),
    });

    expect(res.status).toBe(200);
    expect(dbMocks.updateLineAccountFields).toHaveBeenCalledTimes(1);
    expect(dbMocks.updateLineAccountFields.mock.calls[0][2]).toMatchObject({
      loginChannelId: '2009999999',
      loginChannelSecret: 'rotated',
      liffId: '2009999999-YYYY',
    });
  });

  test('clears LIFF when explicitly set to empty string', async () => {
    dbMocks.getLineAccountById.mockResolvedValue(fakeAccount);
    dbMocks.updateLineAccountFields.mockResolvedValue({
      ...fakeAccount,
      liff_id: null,
    });

    const app = setupApp('admin');
    await app.request('/api/line-accounts/acc-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liffId: '' }),
    });

    expect(dbMocks.updateLineAccountFields.mock.calls[0][2]).toMatchObject({
      liffId: null,
    });
  });

  test('does not touch login/liff fields when not provided', async () => {
    dbMocks.updateLineAccountFields.mockResolvedValue(fakeAccount);
    dbMocks.getLineAccountById.mockResolvedValue(fakeAccount);

    const app = setupApp('admin');
    await app.request('/api/line-accounts/acc-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ country: '日本' }),
    });

    const arg = dbMocks.updateLineAccountFields.mock.calls[0][2];
    expect(arg.country).toBe('日本');
    expect(arg.loginChannelId).toBeUndefined();
    expect(arg.loginChannelSecret).toBeUndefined();
    expect(arg.liffId).toBeUndefined();
  });
});

describe('Login pair / uniqueness validation', () => {
  test('POST: rejects loginChannelId without secret', async () => {
    const app = setupApp('owner');
    const res = await app.request('/api/line-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: '123456789',
        name: 'メイン',
        channelAccessToken: 'token',
        channelSecret: 'secret',
        loginChannelId: '2009624792',
        // loginChannelSecret missing
      }),
    });

    expect(res.status).toBe(400);
    expect(dbMocks.createLineAccount).not.toHaveBeenCalled();
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toMatch(/loginChannelSecret/);
  });

  test('POST: rejects loginChannelSecret without ID', async () => {
    const app = setupApp('owner');
    const res = await app.request('/api/line-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: '123456789',
        name: 'メイン',
        channelAccessToken: 'token',
        channelSecret: 'secret',
        loginChannelSecret: 'orphan',
      }),
    });

    expect(res.status).toBe(400);
    expect(dbMocks.createLineAccount).not.toHaveBeenCalled();
  });

  test('POST: rejects duplicate liffId', async () => {
    // makeDbStub returns "another row already has this liff_id"
    const app = setupApp('owner', makeDbStub({ id: 'other-acc' }));

    const res = await app.request('/api/line-accounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channelId: '123456789',
        name: 'メイン',
        channelAccessToken: 'token',
        channelSecret: 'secret',
        liffId: '2009624792-DUPLICATE',
      }),
    });

    expect(res.status).toBe(409);
    expect(dbMocks.createLineAccount).not.toHaveBeenCalled();
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.error).toMatch(/already assigned/);
  });

  test('PATCH: LIFF-only edit succeeds against half-configured Login (id-only) account', async () => {
    // Setup CLI persists login_channel_id without secret as a best-effort.
    // Adding a LIFF ID later via the dashboard must NOT trip the pair check
    // because the request doesn't touch the Login fields at all.
    dbMocks.getLineAccountById.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: 'setup-cli-id',
      login_channel_secret: null,
    });
    dbMocks.updateLineAccountFields.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: 'setup-cli-id',
      login_channel_secret: null,
      liff_id: '2009624792-NEW',
    });

    const app = setupApp('admin');
    const res = await app.request('/api/line-accounts/acc-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ liffId: '2009624792-NEW' }),
    });

    expect(res.status).toBe(200);
    expect(dbMocks.updateLineAccountFields.mock.calls[0][2]).toMatchObject({
      liffId: '2009624792-NEW',
    });
  });

  test('PATCH: clearing both Login fields together succeeds', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: 'old-id',
      login_channel_secret: 'old-secret',
    });
    dbMocks.updateLineAccountFields.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: null,
      login_channel_secret: null,
    });

    const app = setupApp('admin');
    const res = await app.request('/api/line-accounts/acc-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginChannelId: null, loginChannelSecret: null }),
    });

    expect(res.status).toBe(200);
    expect(dbMocks.updateLineAccountFields.mock.calls[0][2]).toMatchObject({
      loginChannelId: null,
      loginChannelSecret: null,
    });
  });

  test('PATCH: clearing only loginChannelId is rejected (would orphan the secret)', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: 'old-id',
      login_channel_secret: 'old-secret',
    });

    const app = setupApp('admin');
    const res = await app.request('/api/line-accounts/acc-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginChannelId: null }),
    });

    expect(res.status).toBe(400);
    expect(dbMocks.updateLineAccountFields).not.toHaveBeenCalled();
  });

  test('PATCH: keeps existing secret when only changing the loginChannelId', async () => {
    // Current row already has both id+secret. Caller changes only the id —
    // pair check should pass because the unchanged secret keeps the pair complete.
    dbMocks.getLineAccountById.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: 'old-id',
      login_channel_secret: 'kept-secret',
    });
    dbMocks.updateLineAccountFields.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: 'new-id',
      login_channel_secret: 'kept-secret',
    });

    const app = setupApp('admin');

    const res = await app.request('/api/line-accounts/acc-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginChannelId: 'new-id' }),
    });

    expect(res.status).toBe(200);
    expect(dbMocks.updateLineAccountFields).toHaveBeenCalled();
  });
});

describe('PUT /api/line-accounts/:id', () => {
  test('owner can update Login/LIFF + country/role in one request', async () => {
    dbMocks.getLineAccountById.mockResolvedValue({
      ...fakeAccount,
      login_channel_secret: 'existing-secret',
    });
    dbMocks.updateLineAccount.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: '2009624792',
      login_channel_secret: 'existing-secret',
      liff_id: '2009624792-XXXX',
    });
    dbMocks.updateLineAccountFields.mockResolvedValue({
      ...fakeAccount,
      login_channel_id: '2009624792',
      login_channel_secret: 'existing-secret',
      liff_id: '2009624792-XXXX',
      country: '日本',
      role: '本店',
    });

    const app = setupApp('owner');
    const res = await app.request('/api/line-accounts/acc-1', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loginChannelId: '2009624792',
        liffId: '2009624792-XXXX',
        country: '日本',
        role: '本店',
      }),
    });

    expect(res.status).toBe(200);
    expect(dbMocks.updateLineAccount.mock.calls[0][2]).toMatchObject({
      login_channel_id: '2009624792',
      liff_id: '2009624792-XXXX',
    });
    // country/role uses the fields helper (separate code path)
    expect(dbMocks.updateLineAccountFields.mock.calls[0][2]).toMatchObject({
      country: '日本',
      role: '本店',
    });
  });
});

describe('GET /api/line-accounts monthly send stat', () => {
  test('month window starts at JST month start (bound param), not UTC date()', async () => {
    dbMocks.getLineAccounts.mockResolvedValue([fakeAccount]);
    // fetchBotProfile hits the network; fail it fast (it degrades to {}).
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
    try {
      const executed: { sql: string; params: unknown[] }[] = [];
      const db = {
        prepare(sql: string) {
          const stmt = {
            params: [] as unknown[],
            bind(...p: unknown[]) { stmt.params = p; return stmt; },
            async first() {
              executed.push({ sql, params: stmt.params });
              return { count: 0 };
            },
          };
          return stmt;
        },
      } as unknown as D1Database;

      const res = await setupApp('owner', db).request('/api/line-accounts');
      expect(res.status).toBe(200);

      const ml = executed.find((e) => e.sql.includes('FROM messages_log'))!;
      expect(ml).toBeDefined();
      // date('now') is UTC in SQLite: between 00:00 and 09:00 JST on the 1st
      // it still points at the previous month. The route must bind a JST
      // month-start string in the created_at format instead.
      expect(ml.sql).not.toContain("date('now', 'start of month')");
      expect(ml.params[0]).toMatch(/^\d{4}-\d{2}-01T00:00:00\.000$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
