import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { liffRoutes } from './liff.js';
import type { Env } from '../index.js';

// /api/liff/link can arrive before the follow webhook on a first-ever friend
// add. It then creates the friend row itself — and must attribute the LINE
// account in that same write, never leave it for a later statement: a friend
// committed without line_account_id drops out of per-account broadcasts.

const schema = readFileSync(new NodeURL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const app = new Hono<Env>().route('/', liffRoutes);

const ENV_LOGIN = 'login-env';
const ENV_SECRET = 'secret-env';
const NEW_USER = 'U-first-visit';

let store: ReturnType<typeof sqliteD1>;
let env: Env['Bindings'];
/** Login channel the mocked LINE verify endpoint accepts the id_token for. */
let tokenChannel: string;
/** Every statement that wrote to `friends`, in order. */
let friendWrites: string[];

function addAccount(id: string, opts: { login?: string | null; secret?: string; active?: number; order?: number } = {}) {
  store.sqlite
    .prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret, login_channel_id, is_active, display_order)
       VALUES (?, ?, ?, 'token', ?, ?, ?, ?)`,
    )
    .run(id, `ch-${id}`, id, opts.secret ?? `secret-${id}`, opts.login ?? null, opts.active ?? 1, opts.order ?? 0);
}

function friendRow(lineUserId = NEW_USER) {
  return store.sqlite
    .prepare('SELECT id, line_account_id, user_id, ref_code, display_name FROM friends WHERE line_user_id = ?')
    .get(lineUserId) as
    | { id: string; line_account_id: string | null; user_id: string | null; ref_code: string | null; display_name: string | null }
    | undefined;
}

async function link(input: Record<string, unknown> = {}) {
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil(p: Promise<unknown>) { pending.push(p); }, passThroughOnException() {} } as ExecutionContext;
  const res = await app.request(
    '/api/liff/link',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken: 'id-token', displayName: 'First Visit', ...input }),
    },
    env,
    ctx,
  );
  await Promise.all(pending);
  return res;
}

beforeEach(() => {
  store = sqliteD1();
  store.sqlite.exec(schema);
  friendWrites = [];
  const prepare = store.db.prepare.bind(store.db);
  const db = {
    ...store.db,
    prepare(sql: string) {
      const track = (stmt: D1PreparedStatement): D1PreparedStatement => ({
        ...stmt,
        bind: (...values: unknown[]) => track(stmt.bind(...values)),
        async run<T>() {
          if (/^\s*(INSERT INTO|UPDATE)\s+friends\b/i.test(sql)) friendWrites.push(sql);
          return stmt.run<T>();
        },
      } as D1PreparedStatement);
      return track(prepare(sql));
    },
  } as D1Database;
  env = {
    DB: db,
    LINE_LOGIN_CHANNEL_ID: ENV_LOGIN,
    LINE_LOGIN_CHANNEL_SECRET: 'login-secret',
    LINE_CHANNEL_SECRET: ENV_SECRET,
    LINE_CHANNEL_ACCESS_TOKEN: 'env-token',
    LIFF_URL: 'https://liff.line.me/123-Test',
  } as Env['Bindings'];
  tokenChannel = ENV_LOGIN;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    if (url.endsWith('/oauth2/v2.1/verify')) {
      const clientId = new URLSearchParams(String(init?.body)).get('client_id');
      return clientId === tokenChannel
        ? Response.json({ sub: NEW_USER, name: 'Verified Name' })
        : Response.json({ error: 'invalid_request' }, { status: 400 });
    }
    throw new Error(`Unexpected network destination: ${url}`);
  });
});

afterEach(() => {
  store.sqlite.close();
  vi.restoreAllMocks();
});

describe('/api/liff/link before the follow webhook', () => {
  test('creates the friend with the LIFF account in the same single INSERT', async () => {
    addAccount('acc-a', { login: 'login-a' });
    addAccount('acc-b', { login: 'login-b' });
    tokenChannel = 'login-b';

    const res = await link({ ref: 'route-1' });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, data: { alreadyLinked: false } });
    expect(friendRow()).toMatchObject({ line_account_id: 'acc-b', ref_code: 'route-1', display_name: 'First Visit' });
    expect(friendRow()!.user_id).toBeTruthy();
    // The account is part of the statement that creates the row.
    expect(friendWrites[0]).toMatch(/INSERT INTO friends[\s\S]*line_account_id/);
    expect(friendWrites.some((sql) => /UPDATE friends SET line_account_id/.test(sql))).toBe(false);
  });

  test('an interruption right after the creating write still leaves an attributed friend', async () => {
    addAccount('acc-a', { login: 'login-a' });
    tokenChannel = 'login-a';
    const inner = env.DB;
    let tripped = false;
    env.DB = {
      ...inner,
      prepare(sql: string) {
        const wrap = (stmt: D1PreparedStatement): D1PreparedStatement => ({
          ...stmt,
          bind: (...values: unknown[]) => wrap(stmt.bind(...values)),
          async run<T>() {
            if (tripped) throw new Error('isolate interrupted');
            const result = await stmt.run<T>();
            if (/INSERT INTO friends/.test(sql)) tripped = true;
            return result;
          },
        } as D1PreparedStatement);
        return wrap(inner.prepare(sql));
      },
    } as D1Database;
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await link({ ref: 'route-1' });

    expect(res.status).toBe(500);
    expect(friendRow()?.line_account_id).toBe('acc-a');
  });

  test('env default Login channel not registered on any account → the env default Messaging account', async () => {
    // The main account is registered by its Messaging channel only; the webhook
    // attributes its follows by channel secret, so the same account is used here.
    addAccount('acc-other', { login: 'login-other' });
    addAccount('acc-main', { secret: ENV_SECRET });

    const res = await link();

    expect(res.status).toBe(200);
    expect(friendRow()?.line_account_id).toBe('acc-main');
  });

  test('env-only install (no account rows) → friend is created with NULL, as the follow webhook stores it', async () => {
    const res = await link({ ref: 'route-1' });

    expect(res.status).toBe(200);
    expect(friendRow()).toMatchObject({ line_account_id: null, ref_code: 'route-1' });
  });

  test('Login channel shared by several accounts → no friend row is created (404), nothing unattributed', async () => {
    addAccount('acc-a', { login: 'login-shared', order: 1 });
    addAccount('acc-b', { login: 'login-shared', order: 2 });
    tokenChannel = 'login-shared';

    const res = await link({ ref: 'route-1' });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Friend not found' });
    expect(friendRow()).toBeUndefined();
    expect(store.sqlite.prepare('SELECT COUNT(*) AS n FROM users').get()).toEqual({ n: 0 });
  });

  test('a shared Login channel with only one active account is not ambiguous', async () => {
    addAccount('acc-old', { login: 'login-shared', active: 0, order: 1 });
    addAccount('acc-live', { login: 'login-shared', order: 2 });
    tokenChannel = 'login-shared';

    const res = await link();

    expect(res.status).toBe(200);
    expect(friendRow()?.line_account_id).toBe('acc-live');
  });

  test('a friend the follow webhook already created keeps its account and is not re-created', async () => {
    addAccount('acc-a', { login: 'login-a' });
    addAccount('acc-b', { login: 'login-b' });
    store.sqlite
      .prepare("INSERT INTO friends (id, line_user_id, display_name, line_account_id) VALUES ('f-follow', ?, 'From follow', 'acc-a')")
      .run(NEW_USER);
    tokenChannel = 'login-b';

    const res = await link({ ref: 'route-1' });

    expect(res.status).toBe(200);
    expect(friendRow()).toMatchObject({ id: 'f-follow', line_account_id: 'acc-a', ref_code: 'route-1' });
    expect(friendWrites.some((sql) => /INSERT INTO friends/.test(sql))).toBe(false);
  });
});

test('losing the insert race to the follow webhook keeps its account and profile picture', async () => {
  addAccount('acc-a', { login: 'login-a' });
  addAccount('acc-b', { login: 'login-b' });
  tokenChannel = 'login-b';
  // The follow webhook inserts the same LINE user between our lookup and our INSERT.
  const inner = env.DB;
  let raced = false;
  env.DB = {
    ...inner,
    prepare(sql: string) {
      const wrap = (stmt: D1PreparedStatement): D1PreparedStatement => ({
        ...stmt,
        bind: (...values: unknown[]) => wrap(stmt.bind(...values)),
        async run<T>() {
          if (!raced && /INSERT INTO friends/.test(sql)) {
            raced = true;
            store.sqlite
              .prepare("INSERT INTO friends (id, line_user_id, display_name, picture_url, line_account_id) VALUES ('f-follow', ?, 'From follow', 'https://example.com/p.jpg', 'acc-a')")
              .run(NEW_USER);
          }
          return stmt.run<T>();
        },
      } as D1PreparedStatement);
      return wrap(inner.prepare(sql));
    },
  } as D1Database;

  const res = await link({ ref: 'route-1' });

  expect(res.status).toBe(200);
  const row = store.sqlite
    .prepare('SELECT id, line_account_id, picture_url, ref_code FROM friends WHERE line_user_id = ?')
    .get(NEW_USER);
  expect(row).toEqual({ id: 'f-follow', line_account_id: 'acc-a', picture_url: 'https://example.com/p.jpg', ref_code: 'route-1' });
  expect(store.sqlite.prepare('SELECT COUNT(*) AS n FROM friends').get()).toEqual({ n: 1 });
});
