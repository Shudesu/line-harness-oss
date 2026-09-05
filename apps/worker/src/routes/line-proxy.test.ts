import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';

const lineClientMocks = vi.hoisted(() => ({
  getProfile: vi.fn(),
  getMessageQuota: vi.fn(),
  getMessageQuotaConsumption: vi.fn(),
}));

vi.mock('@line-crm/db', () => ({
  getLineAccounts: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  upsertFriend: vi.fn(),
  getChatByFriendId: vi.fn(),
  createChat: vi.fn(),
  updateChat: vi.fn(),
  jstNow: vi.fn(() => '2026-08-02T12:00:00.000'),
}));

vi.mock('../middleware/auth.js', () => ({
  authenticateApiToken: vi.fn(async () => null),
}));

vi.mock('@line-crm/line-sdk', async () => {
  const actual = await vi.importActual<typeof import('@line-crm/line-sdk')>('@line-crm/line-sdk');
  return {
    ...actual,
    LineClient: vi.fn().mockImplementation(() => lineClientMocks),
  };
});

// LINE プランクォータのガード面。デフォルトは「不足なし」(null) — 既存テストの
// 挙動を変えない。個別テストで shortfall を差し込む。
const quotaAlertMocks = vi.hoisted(() => ({
  getLinePlanQuotaShortfall: vi.fn(),
  notifyQuotaAlert: vi.fn(),
  allTargetGuardAudience: vi.fn(),
  readPlanQuotaSnapshot: vi.fn(),
  LINE_MONTHLY_LIMIT_MESSAGE: 'You have reached your monthly limit.',
}));

vi.mock('../services/quota-alert.js', () => quotaAlertMocks);

// Keep the real shape of messageToLogPayload without dragging in the whole
// step-delivery dependency graph.
vi.mock('../services/step-delivery.js', () => ({
  messageToLogPayload: (message: { type: string; text?: string }) =>
    message.type === 'text'
      ? { messageType: 'text', content: message.text }
      : { messageType: message.type, content: JSON.stringify(message) },
}));

import {
  getLineAccounts,
  getFriendByLineUserId,
  upsertFriend,
  getChatByFriendId,
  createChat,
  updateChat,
} from '@line-crm/db';
import { authenticateApiToken } from '../middleware/auth.js';
import { lineProxy } from './line-proxy.js';

type Exec = { sql: string; params: unknown[] };

const U = (n: number) => `U${n.toString(16).padStart(32, '0')}`;

/**
 * Minimal D1 stub. `friendsByUserId` feeds the IN (...) lookup used by
 * multicast; `broadcastFriendIds` feeds the is_following SELECTs.
 */
function fakeDb(opts: {
  friendsByUserId?: Record<string, { id: string; line_user_id: string }>;
  broadcastFriendIds?: string[];
  /** Quota tallies: COUNT answers for the usage-limit gate. */
  counts?: { monthly?: number; friends?: number; knownRecipients?: number };
} = {}) {
  const executed: Exec[] = [];
  const db = {
    prepare(sql: string) {
      const stmt = {
        sql,
        params: [] as unknown[],
        bind(...params: unknown[]) {
          stmt.params = params;
          return stmt;
        },
        async run() {
          executed.push({ sql, params: stmt.params });
          return {};
        },
        async all() {
          executed.push({ sql, params: stmt.params });
          if (sql.includes('line_user_id IN')) {
            const rows = stmt.params
              .map((p) => opts.friendsByUserId?.[p as string])
              .filter(Boolean);
            return { results: rows };
          }
          return { results: (opts.broadcastFriendIds ?? []).map((id) => ({ id })) };
        },
        async first() {
          executed.push({ sql, params: stmt.params });
          if (sql.includes('FROM messages_log')) return { count: opts.counts?.monthly ?? 0 };
          if (sql.includes('SUM(success_count)')) return { count: 0 };
          if (sql.includes('COUNT(DISTINCT line_user_id)')) {
            return { count: opts.counts?.knownRecipients ?? 0 };
          }
          if (sql.includes('FROM friends')) return { count: opts.counts?.friends ?? 0 };
          return null;
        },
      };
      return stmt;
    },
    async batch(stmts: Array<{ sql: string; params: unknown[] }>) {
      for (const s of stmts) executed.push({ sql: s.sql, params: s.params });
      return [];
    },
  };
  return { db: db as unknown as D1Database, executed };
}

/** Flatten multi-row messages_log INSERTs into logical rows (8 params each). */
function loggedRows(executed: Exec[]) {
  const rows: { friendId: unknown; messageType: unknown; content: unknown; deliveryType: unknown; source: unknown; lineAccountId: unknown }[] = [];
  for (const e of executed) {
    if (!e.sql.includes('INSERT INTO messages_log')) continue;
    for (let i = 0; i < e.params.length; i += 8) {
      rows.push({
        friendId: e.params[i + 1],
        messageType: e.params[i + 2],
        content: e.params[i + 3],
        deliveryType: e.params[i + 4],
        source: e.params[i + 5],
        lineAccountId: e.params[i + 6],
      });
    }
  }
  return rows;
}

function setupApp() {
  const app = new Hono();
  app.route('/', lineProxy);
  return app;
}

function env(db: D1Database) {
  return {
    DB: db,
    LINE_CHANNEL_ACCESS_TOKEN: 'env-token',
    API_KEY: 'harness-key',
  } as Record<string, unknown>;
}

const ACCOUNT = {
  id: 'acc-1',
  channel_id: 'ch-1',
  name: 'Main',
  channel_access_token: 'acc-token',
  channel_secret: 'secret',
  is_active: 1,
};

const ACCOUNT_2 = {
  ...ACCOUNT,
  id: 'acc-2',
  channel_id: 'ch-2',
  name: 'Sub',
  channel_access_token: 'acc-token-2',
};

const USER_A = U(0x123);
const FRIEND = { id: 'friend-1', line_user_id: USER_A, line_account_id: 'acc-1' };

let fetchMock: ReturnType<typeof vi.fn>;

function upstreamResponse(status = 200, body = '{}') {
  return new Response(body, {
    status,
    headers: { 'content-type': 'application/json', 'x-line-request-id': 'req-1' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => upstreamResponse());
  vi.stubGlobal('fetch', fetchMock);
  vi.mocked(getLineAccounts).mockResolvedValue([ACCOUNT] as never);
  vi.mocked(getFriendByLineUserId).mockResolvedValue(FRIEND as never);
  vi.mocked(getChatByFriendId).mockResolvedValue({ id: 'chat-1', status: 'unread' } as never);
  vi.mocked(updateChat).mockResolvedValue(undefined as never);
  vi.mocked(authenticateApiToken).mockResolvedValue(null as never);
  quotaAlertMocks.getLinePlanQuotaShortfall.mockResolvedValue(null);
  quotaAlertMocks.notifyQuotaAlert.mockResolvedValue(true);
  quotaAlertMocks.allTargetGuardAudience.mockReturnValue(async () => 0);
  // デフォルトは「quota 再取得が失敗」— 429 事後通知が合成 shortfall (limit=0) に落ちる経路
  quotaAlertMocks.readPlanQuotaSnapshot.mockRejectedValue(new Error('not stubbed'));
  lineClientMocks.getMessageQuota.mockRejectedValue(new Error('not stubbed'));
  lineClientMocks.getMessageQuotaConsumption.mockRejectedValue(new Error('not stubbed'));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function pushRequest(
  token: string | null,
  body: unknown = { to: USER_A, messages: [{ type: 'text', text: 'hello' }] },
  extraHeaders: Record<string, string> = {},
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  return new Request('http://worker.test/line-api/v2/bot/message/push', {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
}

describe('auth', () => {
  test('no Authorization header → 401, upstream not called', async () => {
    const { db } = fakeDb();
    const res = await setupApp().request(pushRequest(null), {}, env(db));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('unknown token → 401 (no open relay)', async () => {
    const { db } = fakeDb();
    const res = await setupApp().request(pushRequest('stranger-token'), {}, env(db));
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('env fallback token is accepted with null account', async () => {
    const { db, executed } = fakeDb();
    const res = await setupApp().request(pushRequest('env-token'), {}, env(db));
    expect(res.status).toBe(200);
    const rows = loggedRows(executed);
    expect(rows).toHaveLength(1);
    expect(rows[0].lineAccountId).toBeNull();
  });

  test('inactive account token → 401', async () => {
    vi.mocked(getLineAccounts).mockResolvedValue([{ ...ACCOUNT, is_active: 0 }] as never);
    const { db } = fakeDb();
    const res = await setupApp().request(pushRequest('acc-token'), {}, env(db));
    expect(res.status).toBe(401);
  });
});

describe('harness API key auth', () => {
  beforeEach(() => {
    vi.mocked(authenticateApiToken).mockImplementation(async (_c: unknown, token: unknown) =>
      token === 'harness-key' ? ({ id: 's1', name: 'Owner', role: 'owner' } as never) : null,
    );
  });

  test('single account: upstream gets the channel token, log carries account id', async () => {
    const { db, executed } = fakeDb();
    const res = await setupApp().request(pushRequest('harness-key'), {}, env(db));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/message/push',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer acc-token' }),
      }),
    );
    const rows = loggedRows(executed);
    expect(rows).toHaveLength(1);
    expect(rows[0].lineAccountId).toBe('acc-1');
  });

  test('multiple accounts without X-Line-Account-Id → 400', async () => {
    vi.mocked(getLineAccounts).mockResolvedValue([ACCOUNT, ACCOUNT_2] as never);
    const { db } = fakeDb();
    const res = await setupApp().request(pushRequest('harness-key'), {}, env(db));
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('X-Line-Account-Id selects the account (by channel_id too)', async () => {
    vi.mocked(getLineAccounts).mockResolvedValue([ACCOUNT, ACCOUNT_2] as never);
    const { db, executed } = fakeDb();
    const res = await setupApp().request(
      pushRequest('harness-key', undefined, { 'X-Line-Account-Id': 'ch-2' }),
      {},
      env(db),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer acc-token-2' }),
      }),
    );
    expect(loggedRows(executed)[0].lineAccountId).toBe('acc-2');
  });

  test('unknown X-Line-Account-Id → 400', async () => {
    vi.mocked(getLineAccounts).mockResolvedValue([ACCOUNT, ACCOUNT_2] as never);
    const { db } = fakeDb();
    const res = await setupApp().request(
      pushRequest('harness-key', undefined, { 'X-Line-Account-Id': 'nope' }),
      {},
      env(db),
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('push', () => {
  test('forwards to api.line.me and logs source=external', async () => {
    const { db, executed } = fakeDb();
    const res = await setupApp().request(pushRequest('acc-token'), {}, env(db));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-line-request-id')).toBe('req-1');
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.line.me/v2/bot/message/push',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer acc-token' }),
      }),
    );

    const rows = loggedRows(executed);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      friendId: 'friend-1',
      messageType: 'text',
      content: 'hello',
      deliveryType: 'push',
      source: 'external',
      lineAccountId: 'acc-1',
    });

    expect(updateChat).toHaveBeenCalledWith(
      expect.anything(),
      'chat-1',
      expect.objectContaining({ status: 'in_progress' }),
    );
  });

  test('manual header logs a 1:1 operator reply as source=manual and is not forwarded', async () => {
    const { db, executed } = fakeDb();
    const res = await setupApp().request(
      pushRequest('acc-token', undefined, { 'X-Line-Harness-Source': 'manual' }),
      {},
      env(db),
    );

    expect(res.status).toBe(200);
    expect(loggedRows(executed)).toHaveLength(1);
    expect(loggedRows(executed)[0].source).toBe('manual');
    const [, init] = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(init.headers).not.toHaveProperty('X-Line-Harness-Source');
  });

  test('unknown source header is rejected before upstream send', async () => {
    const { db } = fakeDb();
    const res = await setupApp().request(
      pushRequest('acc-token', undefined, { 'X-Line-Harness-Source': 'operator' }),
      {},
      env(db),
    );

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('manual source cannot be used for multicast', async () => {
    const { db } = fakeDb();
    const res = await setupApp().request(
      new Request('http://worker.test/line-api/v2/bot/message/multicast', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer acc-token',
          'Content-Type': 'application/json',
          'X-Line-Harness-Source': 'manual',
        },
        body: JSON.stringify({ to: [USER_A], messages: [{ type: 'text', text: 'hello' }] }),
      }),
      {},
      env(db),
    );

    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('percent-encoded path still logs (no log-dodging)', async () => {
    const { db, executed } = fakeDb();
    const res = await setupApp().request(
      new Request('http://worker.test/line-api/v2/bot/message/%70ush', {
        method: 'POST',
        headers: { Authorization: 'Bearer acc-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: USER_A, messages: [{ type: 'text', text: 'sneaky' }] }),
      }),
      {},
      env(db),
    );
    expect(res.status).toBe(200);
    expect(loggedRows(executed)).toHaveLength(1);
  });

  test('group target (C…) is forwarded but never fabricates a friend', async () => {
    const { db, executed } = fakeDb();
    const res = await setupApp().request(
      pushRequest('acc-token', {
        to: `C${'0'.repeat(32)}`,
        messages: [{ type: 'text', text: 'to group' }],
      }),
      {},
      env(db),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    expect(loggedRows(executed)).toHaveLength(0);
    expect(upsertFriend).not.toHaveBeenCalled();
  });

  test('unknown recipient → profile fetched, friend created, account pinned', async () => {
    const newUser = U(0x999);
    vi.mocked(getFriendByLineUserId).mockResolvedValue(null as never);
    lineClientMocks.getProfile.mockResolvedValue({ displayName: 'New User' });
    vi.mocked(upsertFriend).mockResolvedValue({ id: 'friend-new', line_user_id: newUser } as never);
    vi.mocked(getChatByFriendId).mockResolvedValue(null as never);
    vi.mocked(createChat).mockResolvedValue({ id: 'chat-new' } as never);

    const { db, executed } = fakeDb();
    const res = await setupApp().request(
      pushRequest('acc-token', { to: newUser, messages: [{ type: 'text', text: 'yo' }] }),
      {},
      env(db),
    );

    expect(res.status).toBe(200);
    expect(lineClientMocks.getProfile).toHaveBeenCalledWith(newUser);
    expect(upsertFriend).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lineUserId: newUser, displayName: 'New User' }),
    );
    const accountPin = executed.find((e) => e.sql.includes('UPDATE friends SET line_account_id'));
    expect(accountPin).toBeDefined();
    expect(accountPin!.params).toEqual(['acc-1', 'friend-new']);
    expect(createChat).toHaveBeenCalled();
  });

  test('upstream 400 → status passthrough, nothing logged', async () => {
    fetchMock.mockResolvedValue(upstreamResponse(400, '{"message":"bad"}'));
    const { db, executed } = fakeDb();
    const res = await setupApp().request(pushRequest('acc-token'), {}, env(db));
    expect(res.status).toBe(400);
    expect(loggedRows(executed)).toHaveLength(0);
  });

  test('logging failure does not break the 200 response', async () => {
    vi.mocked(getFriendByLineUserId).mockRejectedValue(new Error('db down'));
    const { db } = fakeDb();
    const res = await setupApp().request(pushRequest('acc-token'), {}, env(db));
    expect(res.status).toBe(200);
  });
});

describe('multicast', () => {
  test('logs one row per recipient per message via chunked IN lookup', async () => {
    const [u1, u2] = [U(1), U(2)];
    const { db, executed } = fakeDb({
      friendsByUserId: {
        [u1]: { id: 'f1', line_user_id: u1 },
        [u2]: { id: 'f2', line_user_id: u2 },
      },
    });
    const res = await setupApp().request(
      new Request('http://worker.test/line-api/v2/bot/message/multicast', {
        method: 'POST',
        headers: { Authorization: 'Bearer acc-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: [u1, u2, u1], // duplicate must be deduped
          messages: [
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' },
          ],
        }),
      }),
      {},
      env(db),
    );

    expect(res.status).toBe(200);
    const rows = loggedRows(executed);
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.friendId))).toEqual(new Set(['f1', 'f2']));
    expect(getFriendByLineUserId).not.toHaveBeenCalled();
  });

  test('unknown recipients beyond the creation cap are skipped, known ones still logged', async () => {
    const known = U(1);
    const strangers = Array.from({ length: 25 }, (_, i) => U(0x1000 + i));
    lineClientMocks.getProfile.mockResolvedValue(null);
    vi.mocked(upsertFriend).mockImplementation(
      async (_db: unknown, input: { lineUserId: string }) =>
        ({ id: `new-${input.lineUserId}`, line_user_id: input.lineUserId }) as never,
    );

    const { db, executed } = fakeDb({
      friendsByUserId: { [known]: { id: 'f-known', line_user_id: known } },
    });
    const res = await setupApp().request(
      new Request('http://worker.test/line-api/v2/bot/message/multicast', {
        method: 'POST',
        headers: { Authorization: 'Bearer acc-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: [known, ...strangers], messages: [{ type: 'text', text: 'x' }] }),
      }),
      {},
      env(db),
    );

    expect(res.status).toBe(200);
    // 1 known + 20 created (cap) = 21 logged; 5 skipped with a warning
    expect(loggedRows(executed)).toHaveLength(21);
    expect(upsertFriend).toHaveBeenCalledTimes(20);
  });
});

describe('broadcast', () => {
  test('single account install: logs the account friends including legacy NULL rows', async () => {
    const { db, executed } = fakeDb({ broadcastFriendIds: ['f1', 'f2', 'f3'] });
    const res = await setupApp().request(
      new Request('http://worker.test/line-api/v2/bot/message/broadcast', {
        method: 'POST',
        headers: { Authorization: 'Bearer acc-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ type: 'text', text: 'to everyone' }] }),
      }),
      {},
      env(db),
    );

    expect(res.status).toBe(200);
    const select = executed.find((e) => e.sql.includes('SELECT id FROM friends'));
    expect(select).toBeDefined();
    expect(select!.sql).toContain('line_account_id = ? OR line_account_id IS NULL');
    expect(select!.params).toEqual(['acc-1']);
    const rows = loggedRows(executed);
    expect(rows).toHaveLength(3);
    expect(rows[0].deliveryType).toBeNull();
  });

  test('single account install + env token: unscoped (all following friends)', async () => {
    const { db, executed } = fakeDb({ broadcastFriendIds: ['f1', 'f2'] });
    const res = await setupApp().request(
      new Request('http://worker.test/line-api/v2/bot/message/broadcast', {
        method: 'POST',
        headers: { Authorization: 'Bearer env-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ type: 'text', text: 'everyone' }] }),
      }),
      {},
      env(db),
    );
    expect(res.status).toBe(200);
    const select = executed.find((e) => e.sql.includes('SELECT id FROM friends'));
    expect(select!.sql).not.toContain('line_account_id');
    expect(loggedRows(executed)).toHaveLength(2);
  });

  test('multi-account: scoped to the sending account, legacy NULL rows included', async () => {
    vi.mocked(getLineAccounts).mockResolvedValue([ACCOUNT, ACCOUNT_2] as never);
    const { db, executed } = fakeDb({ broadcastFriendIds: ['f1', 'f2'] });
    const res = await setupApp().request(
      new Request('http://worker.test/line-api/v2/bot/message/broadcast', {
        method: 'POST',
        headers: { Authorization: 'Bearer acc-token-2', 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ type: 'text', text: 'sub only' }] }),
      }),
      {},
      env(db),
    );
    expect(res.status).toBe(200);
    const select = executed.find((e) => e.sql.includes('SELECT id FROM friends'));
    // Must match the projection population (estimateSendAudience): legacy
    // NULL-account rows receive the broadcast too, so they are logged — an
    // account-only filter would under-record every send and let usage drift
    // below reality.
    expect(select!.sql).toContain('(line_account_id = ? OR line_account_id IS NULL)');
    expect(select!.params).toEqual(['acc-2']);
    expect(loggedRows(executed)).toHaveLength(2);
  });

  test('multi-account + unregistered env token: forwarded but NOT logged (no fabrication)', async () => {
    vi.mocked(getLineAccounts).mockResolvedValue([ACCOUNT, ACCOUNT_2] as never);
    const { db, executed } = fakeDb({ broadcastFriendIds: ['f1', 'f2'] });
    const res = await setupApp().request(
      new Request('http://worker.test/line-api/v2/bot/message/broadcast', {
        method: 'POST',
        headers: { Authorization: 'Bearer env-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ type: 'text', text: 'whose friends?' }] }),
      }),
      {},
      env(db),
    );
    expect(res.status).toBe(200);
    expect(loggedRows(executed)).toHaveLength(0);
  });
});

describe('reply and passthrough', () => {
  test('reply is forwarded but not logged', async () => {
    const { db, executed } = fakeDb();
    const res = await setupApp().request(
      new Request('http://worker.test/line-api/v2/bot/message/reply', {
        method: 'POST',
        headers: { Authorization: 'Bearer acc-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ replyToken: 'rt', messages: [{ type: 'text', text: 'hi' }] }),
      }),
      {},
      env(db),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalled();
    expect(loggedRows(executed)).toHaveLength(0);
  });

  test('GET /v2/bot/profile/:id passes through without logging', async () => {
    fetchMock.mockResolvedValue(
      new Response('{"displayName":"X"}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { db, executed } = fakeDb();
    const res = await setupApp().request(
      new Request(`http://worker.test/line-api/v2/bot/profile/${USER_A}`, {
        method: 'GET',
        headers: { Authorization: 'Bearer acc-token' },
      }),
      {},
      env(db),
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      `https://api.line.me/v2/bot/profile/${USER_A}`,
      expect.objectContaining({ method: 'GET' }),
    );
    expect(executed).toHaveLength(0);
  });

  test('line-api-data prefix targets api-data.line.me', async () => {
    const { db } = fakeDb();
    await setupApp().request(
      new Request('http://worker.test/line-api-data/v2/bot/message/m1/content', {
        method: 'GET',
        headers: { Authorization: 'Bearer acc-token' },
      }),
      {},
      env(db),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-data.line.me/v2/bot/message/m1/content',
      expect.anything(),
    );
  });

  test('path outside /v2/bot/ → 404, upstream not called', async () => {
    const { db } = fakeDb();
    const res = await setupApp().request(
      new Request('http://worker.test/line-api/oauth2/v2.1/token', {
        method: 'POST',
        headers: { Authorization: 'Bearer acc-token' },
        body: '{}',
      }),
      {},
      env(db),
    );
    expect(res.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('binary upload (rich menu image) is forwarded byte-exact, not logged', async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff, 0xfe]);
    const { db, executed } = fakeDb();
    const res = await setupApp().request(
      new Request('http://worker.test/line-api-data/v2/bot/richmenu/rm-1/content', {
        method: 'POST',
        headers: { Authorization: 'Bearer acc-token', 'Content-Type': 'image/png' },
        body: bytes,
      }),
      {},
      env(db),
    );
    expect(res.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as [string, { body: ArrayBuffer }];
    expect(new Uint8Array(init.body)).toEqual(bytes);
    expect(executed).toHaveLength(0);
  });

  test('oversized message body → 413', async () => {
    const { db } = fakeDb();
    const res = await setupApp().request(
      new Request('http://worker.test/line-api/v2/bot/message/push', {
        method: 'POST',
        headers: { Authorization: 'Bearer acc-token', 'Content-Type': 'application/json' },
        body: 'x'.repeat(1024 * 1024 + 1),
      }),
      {},
      env(db),
    );
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('usage limit gate', () => {
  const quotaEnv = { QUOTA_MONTHLY_MESSAGES_MAX: '5000' };

  function broadcastRequest(token = 'acc-token') {
    return new Request('http://worker.test/line-api/v2/bot/message/broadcast', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ type: 'text', text: 'to everyone' }] }),
    });
  }

  function multicastRequest(recipients: number, messageCount = 1) {
    return new Request('http://worker.test/line-api/v2/bot/message/multicast', {
      method: 'POST',
      headers: { Authorization: 'Bearer acc-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: Array.from({ length: recipients }, (_, i) => U(0x500 + i)),
        messages: Array.from({ length: messageCount }, (_, i) => ({ type: 'text', text: `hi ${i}` })),
      }),
    });
  }

  test('broadcast while over the limit → LINE-shaped 429, upstream not called', async () => {
    const { db } = fakeDb({ counts: { monthly: 5000 } });
    const res = await setupApp().request(broadcastRequest(), {}, { ...env(db), ...quotaEnv });
    expect(res.status).toBe(429);
    const body = await res.json() as { message: string };
    expect(typeof body.message).toBe('string');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('broadcast whose projected follower count would cross the limit → 429', async () => {
    // 4999 used + 500 followers = 5499 > 5000.
    const { db } = fakeDb({ counts: { monthly: 4999, friends: 500 } });
    const res = await setupApp().request(broadcastRequest(), {}, { ...env(db), ...quotaEnv });
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('multicast projected by its recipient count: over blocks, within passes', async () => {
    const over = fakeDb({ counts: { monthly: 4999 } });
    const resOver = await setupApp().request(multicastRequest(3), {}, { ...env(over.db), ...quotaEnv });
    expect(resOver.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();

    const fits = fakeDb({ counts: { monthly: 100 } });
    const resFits = await setupApp().request(multicastRequest(3), {}, { ...env(fits.db), ...quotaEnv });
    expect(resFits.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('multicast projection multiplies recipients by message count (one row per recipient per message)', async () => {
    // 4 sends left (4996 of 5000). 2 recipients x 3 messages = 6 rows → 429.
    const over = fakeDb({ counts: { monthly: 4996 } });
    const resOver = await setupApp().request(multicastRequest(2, 3), {}, { ...env(over.db), ...quotaEnv });
    expect(resOver.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();

    // 2 recipients x 1 message = 2 rows → fits in the remaining 4, forwarded.
    const fits = fakeDb({ counts: { monthly: 4996 } });
    const resFits = await setupApp().request(multicastRequest(2, 1), {}, { ...env(fits.db), ...quotaEnv });
    expect(resFits.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  function fakeCtx() {
    const captured: Promise<unknown>[] = [];
    return {
      captured,
      ctx: {
        waitUntil: (p: Promise<unknown>) => { captured.push(p); },
        passThroughOnException: () => {},
      } as ExecutionContext,
    };
  }

  test('monthly limit active: bulk-send logging completes before the response (sequential rapid fire is gated)', async () => {
    const { db, executed } = fakeDb({
      counts: { monthly: 0 },
      friendsByUserId: {
        [U(0x500)]: { id: 'k1', line_user_id: U(0x500) },
        [U(0x501)]: { id: 'k2', line_user_id: U(0x501) },
      },
    });
    const { ctx, captured } = fakeCtx();
    const res = await setupApp().request(multicastRequest(2), {}, { ...env(db), ...quotaEnv }, ctx);
    expect(res.status).toBe(200);
    // Rows are already durable when the client gets its 200 — the next
    // request's gate sees them.
    expect(loggedRows(executed).length).toBeGreaterThan(0);
    expect(captured).toHaveLength(0);
  });

  test('monthly limit active: 1:1 push keeps background logging', async () => {
    const { db, executed } = fakeDb({ counts: { monthly: 0 } });
    const { ctx, captured } = fakeCtx();
    const res = await setupApp().request(pushRequest('acc-token'), {}, { ...env(db), ...quotaEnv }, ctx);
    expect(res.status).toBe(200);
    // Still handed to waitUntil (background), not awaited inline.
    expect(captured).toHaveLength(1);
    await Promise.all(captured);
    expect(loggedRows(executed)).toHaveLength(1);
  });

  test('no monthly limit: bulk-send logging stays in the background (behavior unchanged)', async () => {
    const { db, executed } = fakeDb({
      friendsByUserId: {
        [U(0x500)]: { id: 'k1', line_user_id: U(0x500) },
        [U(0x501)]: { id: 'k2', line_user_id: U(0x501) },
      },
    });
    const { ctx, captured } = fakeCtx();
    const res = await setupApp().request(multicastRequest(2), {}, env(db), ctx);
    expect(res.status).toBe(200);
    // Still handed to waitUntil (background), not awaited inline.
    expect(captured).toHaveLength(1);
    await Promise.all(captured);
    expect(loggedRows(executed).length).toBeGreaterThan(0);
  });

  test('multicast with more unknown recipients than logging can register → 429', async () => {
    // 25 recipients, none registered: friend creation is capped at 20, so 5
    // sends would never be recorded — refuse the whole send.
    const { db } = fakeDb({ counts: { monthly: 0, knownRecipients: 0 } });
    const res = await setupApp().request(multicastRequest(25), {}, { ...env(db), ...quotaEnv });
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('multicast whose unknown recipients fit under the creation cap passes', async () => {
    // 25 recipients, 10 already registered → 15 unknown <= cap of 20.
    const { db } = fakeDb({ counts: { monthly: 0, knownRecipients: 10 } });
    const res = await setupApp().request(multicastRequest(25), {}, { ...env(db), ...quotaEnv });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('no monthly limit: large unknown multicast passes and runs no recipient COUNT', async () => {
    const { db, executed } = fakeDb({ counts: { knownRecipients: 0 } });
    const res = await setupApp().request(multicastRequest(25), {}, env(db));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(executed.filter((e) => e.sql.includes('COUNT(DISTINCT line_user_id)'))).toEqual([]);
  });

  test('multi-account install + unregistered env token: broadcast is refused while a monthly limit is active (usage would be unrecordable)', async () => {
    vi.mocked(getLineAccounts).mockResolvedValue([ACCOUNT, ACCOUNT_2] as never);
    const { db } = fakeDb({ counts: { monthly: 0, friends: 1 } });
    const res = await setupApp().request(broadcastRequest('env-token'), {}, { ...env(db), ...quotaEnv });
    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('single-account install + env token: broadcast is recordable (unscoped log) and passes', async () => {
    const { db } = fakeDb({ counts: { monthly: 0, friends: 1 }, broadcastFriendIds: ['f1'] });
    const res = await setupApp().request(broadcastRequest('env-token'), {}, { ...env(db), ...quotaEnv });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('no monthly limit: multi-account env-token broadcast passes through as before', async () => {
    vi.mocked(getLineAccounts).mockResolvedValue([ACCOUNT, ACCOUNT_2] as never);
    const { db } = fakeDb();
    const res = await setupApp().request(broadcastRequest('env-token'), {}, env(db));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('1:1 push passes through even while over the limit (one-to-one is never paused)', async () => {
    const { db } = fakeDb({ counts: { monthly: 5000 } });
    const res = await setupApp().request(pushRequest('acc-token'), {}, { ...env(db), ...quotaEnv });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  function narrowcastRequest() {
    return new Request('http://worker.test/line-api/v2/bot/message/narrowcast', {
      method: 'POST',
      headers: { Authorization: 'Bearer acc-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ type: 'text', text: 'targeted' }],
        recipient: { type: 'audience', audienceGroupId: 1 },
      }),
    });
  }

  test('narrowcast while a monthly limit is active → 429, upstream not called (recipients are unknowable)', async () => {
    const { db } = fakeDb({ counts: { monthly: 0 } });
    const res = await setupApp().request(narrowcastRequest(), {}, { ...env(db), ...quotaEnv });
    expect(res.status).toBe(429);
    const body = await res.json() as { message: string };
    expect(typeof body.message).toBe('string');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('narrowcast with no limits configured passes through as before', async () => {
    const { db } = fakeDb();
    const res = await setupApp().request(narrowcastRequest(), {}, env(db));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * ゲートが返す 429 が「LINE が止めた」のか「harness が止めた」のかを、
   * 応答本文だけで判別できること。
   *
   * message は LINE の limit レスポンスと同じ文面のままにする（既存クライアントは
   * これを読む）。同じ文面のままだと運用中に取り違えるので、source / reason を
   * 足して由来と理由が分かるようにした。実際、本番で 1:1 送信が 429 になった際に
   * 「LINE のプラン枠を使い切った」と誤って切り分けかけている
   * （実際は LINE 側の別要因で、枠は 30,000 中 200 しか使っていなかった）。
   */
  describe('429 の由来が判別できる', () => {
    test('月次上限超過: message は LINE 互換のまま、source/reason で harness 由来と分かる', async () => {
      const { db } = fakeDb({ counts: { monthly: 5000 } });
      const res = await setupApp().request(broadcastRequest(), {}, { ...env(db), ...quotaEnv });
      expect(res.status).toBe(429);
      const body = await res.json() as { message: string; source?: string; reason?: string };
      expect(body.message).toBe('You have reached your monthly limit.');
      expect(body.source).toBe('line-harness');
      expect(body.reason).toBe('monthly-messages-exceeded');
    });

    test('友だち数上限で止めたときは monthly ではなく friends の reason を返す', async () => {
      // usage.exceeded は友だち数上限でも立つ。ここで monthly-messages-exceeded を
      // 返すと、運用者を「追加メッセージを買う」という誤った対処に誘導してしまう。
      const { db } = fakeDb({ counts: { monthly: 0, friends: 11 } });
      const res = await setupApp().request(
        broadcastRequest(),
        {},
        { ...env(db), QUOTA_FRIENDS_MAX: '10' },
      );
      expect(res.status).toBe(429);
      const body = await res.json() as { message: string; source?: string; reason?: string };
      expect(body.source).toBe('line-harness');
      expect(body.reason).toBe('friends-exceeded');
      // message は既存クライアント互換のため据え置き（挙動を変えない）
      expect(body.message).toBe('You have reached your monthly limit.');
    });

    test('narrowcast 拒否にも source/reason が付く', async () => {
      const { db } = fakeDb({ counts: { monthly: 0 } });
      const res = await setupApp().request(narrowcastRequest(), {}, { ...env(db), ...quotaEnv });
      expect(res.status).toBe(429);
      const body = await res.json() as { source?: string; reason?: string };
      expect(body.source).toBe('line-harness');
      expect(body.reason).toBe('narrowcast-unrecordable');
    });

    test('未登録チャネルからの broadcast 拒否にも source/reason が付く', async () => {
      vi.mocked(getLineAccounts).mockResolvedValue([ACCOUNT, ACCOUNT_2] as never);
      const { db } = fakeDb({ counts: { monthly: 0, friends: 1 } });
      const res = await setupApp().request(broadcastRequest('env-token'), {}, { ...env(db), ...quotaEnv });
      expect(res.status).toBe(429);
      const body = await res.json() as { source?: string; reason?: string };
      expect(body.source).toBe('line-harness');
      expect(body.reason).toBe('broadcast-unregistered-channel');
    });

    test('未登録受信者が多すぎる multicast 拒否にも source/reason が付く', async () => {
      const { db } = fakeDb({ counts: { monthly: 0, knownRecipients: 0 } });
      const res = await setupApp().request(multicastRequest(25), {}, { ...env(db), ...quotaEnv });
      expect(res.status).toBe(429);
      const body = await res.json() as { source?: string; reason?: string };
      expect(body.source).toBe('line-harness');
      expect(body.reason).toBe('too-many-unregistered-recipients');
    });
  });

  test('monthly limit active (not exceeded): 1:1 push still passes', async () => {
    const { db } = fakeDb({ counts: { monthly: 0 } });
    const res = await setupApp().request(pushRequest('acc-token'), {}, { ...env(db), ...quotaEnv });
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test('no limits configured → zero quota queries, behavior unchanged', async () => {
    const { db, executed } = fakeDb({ counts: { monthly: 999999 } });
    const res = await setupApp().request(broadcastRequest(), {}, env(db));
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(executed.filter((e) => e.sql.includes('COUNT(*) as count'))).toEqual([]);
  });
});

describe('LINE plan quota guard (proxy bulk sends)', () => {
  const SHORTFALL = { limit: 1000, consumption: 950, remaining: 50, audience: 300 };

  function broadcastRequest(token = 'acc-token') {
    return new Request('http://worker.test/line-api/v2/bot/message/broadcast', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ type: 'text', text: 'to everyone' }] }),
    });
  }

  function multicastRequest(recipients: number) {
    return new Request('http://worker.test/line-api/v2/bot/message/multicast', {
      method: 'POST',
      headers: { Authorization: 'Bearer acc-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: Array.from({ length: recipients }, (_, i) => U(0x700 + i)),
        messages: [{ type: 'text', text: 'hi' }],
      }),
    });
  }

  test('broadcast: プラン不足が確定 → 通知して 429、上流は呼ばない (quotaEnv 未設定でも)', async () => {
    quotaAlertMocks.getLinePlanQuotaShortfall.mockResolvedValue(SHORTFALL);
    const { db } = fakeDb();
    const res = await setupApp().request(broadcastRequest(), {}, env(db));

    expect(res.status).toBe(429);
    const body = await res.json() as { message: string; reason: string; quota: unknown };
    expect(body.message).toBe('You have reached your monthly limit.');
    expect(body.reason).toBe('line-plan-quota-insufficient');
    expect(body.quota).toEqual(SHORTFALL);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(quotaAlertMocks.notifyQuotaAlert).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        lineAccountId: 'acc-1',
        accountName: 'Main',
        shortfall: SHORTFALL,
        source: 'proxy-pre-send',
      }),
    );
  });

  test('未登録 env トークンは通知キー default で通知する', async () => {
    quotaAlertMocks.getLinePlanQuotaShortfall.mockResolvedValue(SHORTFALL);
    const { db } = fakeDb();
    const res = await setupApp().request(broadcastRequest('env-token'), {}, env(db));

    expect(res.status).toBe(429);
    expect(quotaAlertMocks.notifyQuotaAlert).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ lineAccountId: 'default', source: 'proxy-pre-send' }),
    );
  });

  test('multicast: audience は to のユニーク受信者数 (重複は過大計上しない)', async () => {
    const { db } = fakeDb();
    const [u1, u2] = [U(0x700), U(0x701)];
    const res = await setupApp().request(
      new Request('http://worker.test/line-api/v2/bot/message/multicast', {
        method: 'POST',
        headers: { Authorization: 'Bearer acc-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: [u1, u2, u1, 42], messages: [{ type: 'text', text: 'hi' }] }),
      }),
      {},
      env(db),
    );

    expect(res.status).toBe(200);
    expect(quotaAlertMocks.getLinePlanQuotaShortfall).toHaveBeenCalledWith(expect.anything(), 2, expect.any(String));
  });

  test('broadcast: audience は共有の allTargetGuardAudience (lazy) — accountCount を single 判定に渡す', async () => {
    const lazy = async () => 120;
    quotaAlertMocks.allTargetGuardAudience.mockReturnValue(lazy);
    const { db } = fakeDb();
    const res = await setupApp().request(broadcastRequest(), {}, env(db));

    expect(res.status).toBe(200);
    expect(quotaAlertMocks.allTargetGuardAudience).toHaveBeenCalledWith(db, 'acc-1', true);
    expect(quotaAlertMocks.getLinePlanQuotaShortfall).toHaveBeenCalledWith(expect.anything(), lazy, expect.any(String));
  });

  test('マルチアカウント + 未登録 env トークンの broadcast: audience=0 (remaining=0 のみブロック)', async () => {
    vi.mocked(getLineAccounts).mockResolvedValue([ACCOUNT, ACCOUNT_2] as never);
    const { db } = fakeDb();
    const res = await setupApp().request(broadcastRequest('env-token'), {}, env(db));

    expect(res.status).toBe(200);
    expect(quotaAlertMocks.getLinePlanQuotaShortfall).toHaveBeenCalledWith(expect.anything(), 0, expect.any(String));
    expect(quotaAlertMocks.allTargetGuardAudience).not.toHaveBeenCalled();
  });

  test('narrowcast: audience=0 で常時ガード対象 — remaining=0 なら通知して 429', async () => {
    quotaAlertMocks.getLinePlanQuotaShortfall.mockResolvedValue({
      limit: 200, consumption: 200, remaining: 0, audience: 0,
    });
    const { db } = fakeDb();
    const res = await setupApp().request(
      new Request('http://worker.test/line-api/v2/bot/message/narrowcast', {
        method: 'POST',
        headers: { Authorization: 'Bearer acc-token', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [{ type: 'text', text: 'targeted' }],
          recipient: { type: 'audience', audienceGroupId: 1 },
        }),
      }),
      {},
      env(db),
    );

    expect(res.status).toBe(429);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(quotaAlertMocks.getLinePlanQuotaShortfall).toHaveBeenCalledWith(expect.anything(), 0, expect.any(String));
    expect(quotaAlertMocks.notifyQuotaAlert).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ source: 'proxy-pre-send' }),
    );
  });

  test('1:1 push はプランクォータのチェック対象外', async () => {
    const { db } = fakeDb();
    const res = await setupApp().request(pushRequest('acc-token'), {}, env(db));

    expect(res.status).toBe(200);
    expect(quotaAlertMocks.getLinePlanQuotaShortfall).not.toHaveBeenCalled();
  });

  test('上流 429 (LINE の月間上限文言) → proxy-upstream-429 で通知、応答は据え置き', async () => {
    // 送信前ガードは fail-open で素通り (null)、429 後の残量再取得も失敗
    // → limit=0 の合成 shortfall で通知される。
    fetchMock.mockResolvedValue(
      upstreamResponse(429, '{"message":"You have reached your monthly limit."}'),
    );
    const { db } = fakeDb();
    const res = await setupApp().request(multicastRequest(2), {}, env(db));

    expect(res.status).toBe(429);
    const body = await res.json() as { message: string };
    expect(body.message).toBe('You have reached your monthly limit.');
    expect(quotaAlertMocks.notifyQuotaAlert).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        source: 'proxy-upstream-429',
        lineAccountId: 'acc-1',
        shortfall: { limit: 0, consumption: 0, remaining: 0, audience: 2 },
      }),
    );
  });

  test('上流 429: 残量再取得が成功したら実測値で通知する (不足判定は経ない — 429 の事実が優先)', async () => {
    fetchMock.mockResolvedValue(
      upstreamResponse(429, '{"message":"You have reached your monthly limit."}'),
    );
    // consumption API のラグで remaining(100) > audience(2) に見えても通知する。
    quotaAlertMocks.readPlanQuotaSnapshot.mockResolvedValue({
      limit: 30000,
      consumption: 29900,
      remaining: 100,
    });
    const { db } = fakeDb();
    const res = await setupApp().request(multicastRequest(2), {}, env(db));

    expect(res.status).toBe(429);
    expect(quotaAlertMocks.notifyQuotaAlert).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        source: 'proxy-upstream-429',
        shortfall: { limit: 30000, consumption: 29900, remaining: 100, audience: 2 },
      }),
    );
  });

  test('上流 429: broadcast の audience COUNT が失敗しても通知は audience=0 で生き残る', async () => {
    fetchMock.mockResolvedValue(
      upstreamResponse(429, '{"message":"You have reached your monthly limit."}'),
    );
    quotaAlertMocks.allTargetGuardAudience.mockReturnValue(async () => {
      throw new Error('D1 down');
    });
    const { db } = fakeDb();
    const res = await setupApp().request(broadcastRequest(), {}, env(db));

    expect(res.status).toBe(429);
    expect(quotaAlertMocks.notifyQuotaAlert).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        source: 'proxy-upstream-429',
        shortfall: expect.objectContaining({ audience: 0 }),
      }),
    );
  });

  test('上流 429 (レート制限など別文言) では通知しない', async () => {
    fetchMock.mockResolvedValue(upstreamResponse(429, '{"message":"Too many requests"}'));
    const { db } = fakeDb();
    const res = await setupApp().request(multicastRequest(2), {}, env(db));

    expect(res.status).toBe(429);
    expect(quotaAlertMocks.notifyQuotaAlert).not.toHaveBeenCalled();
  });

  test('1:1 push の上流 429 では通知しない (一斉送信経路のみ)', async () => {
    fetchMock.mockResolvedValue(
      upstreamResponse(429, '{"message":"You have reached your monthly limit."}'),
    );
    const { db } = fakeDb();
    const res = await setupApp().request(pushRequest('acc-token'), {}, env(db));

    expect(res.status).toBe(429);
    expect(quotaAlertMocks.notifyQuotaAlert).not.toHaveBeenCalled();
  });
});
