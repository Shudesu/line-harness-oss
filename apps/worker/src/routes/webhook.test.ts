import {
  describe,
  expect,
  test,
  vi,
  beforeEach,
  afterEach,
  type MockInstance,
} from 'vitest';
import { Hono } from 'hono';
import { webhook } from './webhook.js';

async function signBody(secret: string, body: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(body));
  const bytes = new Uint8Array(sig);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

interface MockAccountRow {
  id: string;
  channel_id?: string;
  name?: string;
  channel_secret: string;
  channel_access_token: string;
  is_active: number;
}

interface RecordedCall {
  sql: string;
  binds: unknown[];
}

function recordingDb(opts: { accounts?: MockAccountRow[] } = {}) {
  const accounts = opts.accounts ?? [];
  const calls: RecordedCall[] = [];
  let prepareCount = 0;

  const db = {
    prepare(sql: string) {
      prepareCount += 1;
      let bindArgs: unknown[] = [];
      const stmt: Record<string, unknown> = {};
      Object.assign(stmt, {
        bind: (...args: unknown[]) => {
          bindArgs = args;
          return stmt;
        },
        all: async () => {
          calls.push({ sql, binds: bindArgs });
          if (sql.includes('FROM line_accounts')) {
            return { results: accounts };
          }
          return { results: [] };
        },
        first: async () => {
          calls.push({ sql, binds: bindArgs });
          // Return a synthetic friend row for the post-INSERT lookup so the
          // follow-event flow can continue and we can observe matchedAccountId.
          if (/^SELECT \* FROM friends WHERE id =/.test(sql.trim())) {
            return {
              id: bindArgs[0],
              line_user_id: 'U-fake',
              display_name: null,
              picture_url: null,
              status_message: null,
              is_following: 1,
              user_id: null,
              line_account_id: null,
              metadata: '{}',
              first_tracked_link_id: null,
              created_at: '2026-01-01T00:00:00+09:00',
              updated_at: '2026-01-01T00:00:00+09:00',
            };
          }
          return null;
        },
        run: async () => {
          calls.push({ sql, binds: bindArgs });
          return { meta: { changes: 0 } };
        },
      });
      return stmt;
    },
  };

  return {
    db,
    calls: () => calls,
    prepareCount: () => prepareCount,
  };
}

function createCtx() {
  const promises: Promise<unknown>[] = [];
  const ctx = {
    waitUntil: (p: Promise<unknown>) => {
      promises.push(p);
    },
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
  return {
    ctx,
    flush: async () => {
      await Promise.allSettled(promises);
    },
  };
}

const baseEnv = (db: unknown) => ({
  LINE_CHANNEL_SECRET: 'env-secret',
  LINE_CHANNEL_ACCESS_TOKEN: 'env-access-token',
  DB: db,
});

describe('POST /webhook — payload size limits', () => {
  let consoleErrorSpy: MockInstance;
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('rejects bodies larger than 512KB via Content-Length pre-check (413, no DB access)', async () => {
    const app = new Hono();
    app.route('/', webhook);
    const { db, prepareCount } = recordingDb();

    const oversized = 'x'.repeat(513 * 1024);
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: { 'X-Line-Signature': 'dummy' },
        body: oversized,
      },
      baseEnv(db),
    );

    expect(res.status).toBe(413);
    expect(prepareCount()).toBe(0);
  });

  test('uses UTF-8 byte length, not UTF-16 code units, for size check', async () => {
    // 'あ' is 1 UTF-16 code unit but 3 UTF-8 bytes.
    // 200K chars: String.length 200K (under 512KB if mistakenly counted as
    // code units) vs byteLength ~600KB (must be rejected).
    const body = 'あ'.repeat(200 * 1024);
    expect(body.length).toBeLessThan(512 * 1024);
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(512 * 1024);

    const app = new Hono();
    app.route('/', webhook);
    const { db } = recordingDb();
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: { 'X-Line-Signature': 'dummy' },
        body,
      },
      baseEnv(db),
    );

    expect(res.status).toBe(413);
  });

  test('post-read fallback rejects oversized body when Content-Length is absent', async () => {
    // ReadableStream bodies do not get an automatic Content-Length, so the
    // pre-check is bypassed and only the post-read fallback can reject.
    const oversized = 'x'.repeat(600 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(oversized));
        controller.close();
      },
    });

    const req = new Request('http://localhost/webhook', {
      method: 'POST',
      headers: { 'X-Line-Signature': 'dummy' },
      body: stream,
      // @ts-expect-error duplex is required for streaming bodies in Node fetch
      duplex: 'half',
    });
    expect(req.headers.get('Content-Length')).toBeNull();

    const app = new Hono();
    app.route('/', webhook);
    const { db } = recordingDb();
    const res = await app.fetch(req, baseEnv(db));
    expect(res.status).toBe(413);
  });
});

describe('POST /webhook — signature gates JSON.parse', () => {
  let consoleErrorSpy: MockInstance;
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  test('valid signature with malformed JSON reaches parser (logs parse failure)', async () => {
    const app = new Hono();
    app.route('/', webhook);
    const { db } = recordingDb();

    const body = 'this is { not valid json';
    const sig = await signBody('env-secret', body);

    const { ctx } = createCtx();
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: { 'X-Line-Signature': sig },
        body,
      },
      baseEnv(db),
      ctx,
    );

    expect(res.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Failed to parse verified webhook body');
    expect(consoleErrorSpy).not.toHaveBeenCalledWith('Invalid LINE signature');
  });

  test('invalid signature with malformed JSON stops before the parser', async () => {
    const app = new Hono();
    app.route('/', webhook);
    const { db } = recordingDb();

    const body = 'this is { not valid json';
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: { 'X-Line-Signature': 'aW52YWxpZA==' },
        body,
      },
      baseEnv(db),
    );

    expect(res.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid LINE signature');
    expect(consoleErrorSpy).not.toHaveBeenCalledWith('Failed to parse verified webhook body');
  });

  test('missing X-Line-Signature returns 200 without DB access', async () => {
    const app = new Hono();
    app.route('/', webhook);
    const { db, prepareCount } = recordingDb();

    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        body: '{"events":[]}',
      },
      baseEnv(db),
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { status: string };
    expect(json.status).toBe('ok');
    expect(prepareCount()).toBe(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid LINE signature');
  });
});

describe('POST /webhook — multi-account routing', () => {
  let consoleErrorSpy: MockInstance;
  let fetchSpy: MockInstance;
  let fetchCalls: { url: string; auth: string | null }[];
  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchCalls = [];
    fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input: Request | string | URL, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        fetchCalls.push({ url, auth: headers.get('Authorization') });
        return new Response(JSON.stringify({ displayName: 'Test User' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  test('signature signed with a DB-registered account secret routes matchedAccountId and channelAccessToken to that account', async () => {
    // Env secret check fails; the DB-registered account's secret matches, so
    // both matchedAccountId and channelAccessToken must switch to the DB row.
    // Observed via:
    //   (1) UPDATE friends SET line_account_id = ? — bind[0] is the DB account id
    //   (2) Outbound LINE API call's Authorization header uses the DB token
    const accId = 'db-account-uuid';
    const dbSecret = 'db-channel-secret';
    const dbToken = 'db-channel-access-token';
    const { db, calls } = recordingDb({
      accounts: [
        {
          id: accId,
          channel_id: 'C-db',
          name: 'DB Account',
          channel_secret: dbSecret,
          channel_access_token: dbToken,
          is_active: 1,
        },
      ],
    });

    const body = JSON.stringify({
      destination: 'U-destination',
      events: [
        {
          type: 'follow',
          mode: 'active',
          timestamp: 1700000000000,
          source: { type: 'user', userId: 'U-test-user' },
          replyToken: 'rt-test-token',
        },
      ],
    });
    const sig = await signBody(dbSecret, body);

    const app = new Hono();
    app.route('/', webhook);
    const { ctx, flush } = createCtx();
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: { 'X-Line-Signature': sig },
        body,
      },
      baseEnv(db),
      ctx,
    );
    await flush();

    expect(res.status).toBe(200);
    expect(consoleErrorSpy).not.toHaveBeenCalledWith('Invalid LINE signature');
    expect(consoleErrorSpy).not.toHaveBeenCalledWith('Failed to parse verified webhook body');

    const updateAccountIdCall = calls().find((c) =>
      c.sql.includes('UPDATE friends SET line_account_id'),
    );
    expect(updateAccountIdCall, 'UPDATE friends SET line_account_id should be issued').toBeDefined();
    expect(updateAccountIdCall!.binds[0]).toBe(accId);

    const profileFetch = fetchCalls.find((c) => c.url.includes('/v2/bot/profile/'));
    expect(profileFetch, 'getProfile fetch to LINE API should occur').toBeDefined();
    expect(profileFetch!.auth).toBe(`Bearer ${dbToken}`);
    expect(profileFetch!.auth).not.toBe('Bearer env-access-token');
  });

  test('inactive DB account is skipped during signature matching', async () => {
    const inactiveSecret = 'inactive-secret';
    const { db } = recordingDb({
      accounts: [
        {
          id: 'inactive-acc',
          channel_secret: inactiveSecret,
          channel_access_token: 'inactive-token',
          is_active: 0,
        },
      ],
    });
    const body = JSON.stringify({ events: [] });
    const sig = await signBody(inactiveSecret, body);

    const app = new Hono();
    app.route('/', webhook);
    const res = await app.request(
      '/webhook',
      {
        method: 'POST',
        headers: { 'X-Line-Signature': sig },
        body,
      },
      baseEnv(db),
    );

    expect(res.status).toBe(200);
    expect(consoleErrorSpy).toHaveBeenCalledWith('Invalid LINE signature');
  });
});
