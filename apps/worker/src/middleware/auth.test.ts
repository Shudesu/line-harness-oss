import { authDb, seedAuthStaff, TEST_SESSION } from '../test-support/auth-db.js';
import { afterEach } from 'vitest';
const databases: ReturnType<typeof authDb>[] = [];
afterEach(() => databases.splice(0).forEach(d => d.sqlite.close()));
import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware } from './auth.js';
import { hashApiKey } from '@line-crm/db';
import { resolveCorsOrigin } from './admin-auth-config.js';
import { adminAuth } from '../routes/admin-auth.js';
import type { Env } from '../index.js';

const PAGES = 'https://your-admin.pages.dev';
const WORKERS = 'https://your-worker.your-subdomain.workers.dev';

function env(overrides: Partial<Env['Bindings']> = {}): Env['Bindings'] {
  const database = authDb(); databases.push(database); seedAuthStaff(database.sqlite);
  return {
    DB: database.db,
    IMAGES: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    TENANT_SCHEDULER: {} as Env['Bindings']['TENANT_SCHEDULER'],
    LINE_CHANNEL_SECRET: 'secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    API_KEY: 'env-key',
    LIFF_URL: 'https://liff.example.test',
    LINE_CHANNEL_ID: 'line-channel',
    LINE_LOGIN_CHANNEL_ID: 'login-channel',
    LINE_LOGIN_CHANNEL_SECRET: 'login-secret',
    WORKER_URL: WORKERS,
    ...overrides,
  };
}

// Cross-site production topology with explicit opt-in (the supported case).
function crossSiteEnv(): Env['Bindings'] {
  return env({ ADMIN_ORIGIN: PAGES, ADMIN_ALLOW_CROSS_SITE: 'true' });
}

function app() {
  const a = new Hono<Env>();
  a.use('*', cors({
    origin: (origin, c) => resolveCorsOrigin(c.env, origin, c.req.url),
    credentials: true,
  }));
  a.use('*', authMiddleware);
  a.route('/', adminAuth);
  a.get('/api/protected', (c) => c.json({ success: true, data: c.get('staff') }));
  a.post('/api/protected', (c) => c.json({ success: true, data: c.get('staff') }));
  a.get('/api/forms/:id', (c) => c.json({ success: true, staff: c.get('staff') ?? null }));
  a.put('/api/forms/:id', (c) => c.json({ success: true }));
  a.delete('/api/forms/:id', (c) => c.json({ success: true }));
  a.post('/api/forms/:id/submit', (c) => c.json({ success: true }));
  a.post('/api/forms/:id/partial', (c) => c.json({ success: true }));
  a.post('/api/forms/:id/opened', (c) => c.json({ success: true }));
  a.get('/api/booking/google-calendar/oauth/callback', (c) => c.text('oauth-callback'));
  a.post('/api/booking/google-calendar/oauth/callback', (c) => c.text('wrong-method'));
  return a;
}

function setCookies(res: Response): string[] {
  const anyHeaders = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === 'function') return anyHeaders.getSetCookie();
  const single = res.headers.get('Set-Cookie');
  return single ? [single] : [];
}

function cookieFor(res: Response, name: string): string | undefined {
  return setCookies(res).find((c) => c.startsWith(`${name}=`));
}

describe('admin login cookie attributes', () => {
  test('cross-site login sets HttpOnly Secure SameSite=None session + readable CSRF cookie', async () => {
    const res = await app().request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ apiKey: 'staff-key' }),
      headers: { 'Content-Type': 'application/json' },
    }, crossSiteEnv());

    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: { id: string }; csrfToken: string };
    expect(body.data).toMatchObject({ id: 'staff-1', role: 'admin' });
    expect(body.csrfToken).toBeTruthy();

    const session = cookieFor(res, 'lh_admin_session') ?? '';
    expect(session).toContain('lh_admin_session=lhs_');
    expect(session).not.toContain('staff-key');
    expect(session).toContain('HttpOnly');
    expect(session).toContain('Secure');
    expect(session).toContain('SameSite=None');
    expect(session).toContain('Max-Age=604800');

    const csrf = cookieFor(res, 'lh_csrf') ?? '';
    expect(csrf).toContain(`lh_csrf=${body.csrfToken}`);
    expect(csrf).not.toContain('HttpOnly'); // SPA-readable (double-submit)
    expect(csrf).toContain('SameSite=None');
  });

  test('same-site (custom domain) login uses SameSite=Lax', async () => {
    const res = await app().request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ apiKey: 'staff-key' }),
      headers: { 'Content-Type': 'application/json' },
    }, env({ ADMIN_ORIGIN: 'https://admin.example.com', WORKER_URL: 'https://api.example.com' }));

    expect(res.status).toBe(200);
    expect(cookieFor(res, 'lh_admin_session') ?? '').toContain('SameSite=Lax');
  });

  test('invalid api key is rejected without a cookie', async () => {
    const res = await app().request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ apiKey: 'wrong' }),
      headers: { 'Content-Type': 'application/json' },
    }, crossSiteEnv());
    expect(res.status).toBe(401);
    expect(cookieFor(res, 'lh_admin_session')).toBeUndefined();
  });
});

describe('topology guard', () => {
  test('cross-site WITHOUT opt-in refuses login with an actionable error', async () => {
    const res = await app().request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ apiKey: 'staff-key' }),
      headers: { 'Content-Type': 'application/json' },
    }, env({ ADMIN_ORIGIN: PAGES })); // no ADMIN_ALLOW_CROSS_SITE

    expect(res.status).toBe(500);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/cross-site/i);
    expect(cookieFor(res, 'lh_admin_session')).toBeUndefined();
  });
});

describe('protected API access', () => {
  test('accepts the admin session cookie (GET, no CSRF needed)', async () => {
    const res = await app().request('/api/protected', {
      headers: { Cookie: 'lh_admin_session=lhs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    }, crossSiteEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string } };
    expect(body.data).toMatchObject({ id: 'staff-1', role: 'admin' });
  });

  test('still accepts Bearer tokens for SDK / MCP callers', async () => {
    const res = await app().request('/api/protected', {
      headers: { Authorization: 'Bearer env-key' },
    }, crossSiteEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string } };
    expect(body.data).toMatchObject({ id: 'env-owner', role: 'owner' });
  });

  test('rejects requests with no credentials', async () => {
    const res = await app().request('/api/protected', {}, crossSiteEnv());
    expect(res.status).toBe(401);
  });

  test('a malformed cookie value yields 401, not a 500', async () => {
    // `%` is an invalid percent escape — decoding must not throw.
    const res = await app().request('/api/protected', {
      headers: { Cookie: 'lh_admin_session=%; other=%E0%A4%A' },
    }, crossSiteEnv());
    expect(res.status).toBe(401);
  });
});

describe('public form method boundaries', () => {
  test('allows unauthenticated GET of a form definition', async () => {
    const res = await app().request('/api/forms/form-1', {}, crossSiteEnv());
    expect(res.status).toBe(200);
    expect((await res.json() as { staff: unknown }).staff).toBeNull();
  });

  test('authenticates an admin GET so the route can return private settings', async () => {
    const res = await app().request('/api/forms/form-1', {
      headers: { Authorization: 'Bearer env-key' },
    }, crossSiteEnv());
    expect(res.status).toBe(200);
    expect((await res.json() as { staff: { role: string } }).staff.role).toBe('owner');
  });

  test.each(['PUT', 'DELETE'])('%s on the same form path requires admin auth', async (method) => {
    const res = await app().request('/api/forms/form-1', { method }, crossSiteEnv());
    expect(res.status).toBe(401);
  });

  test.each(['submit', 'partial', 'opened'])(
    'allows POST /%s through to route-level LIFF authentication',
    async (action) => {
      const res = await app().request(`/api/forms/form-1/${action}`, {
        method: 'POST',
      }, crossSiteEnv());
      expect(res.status).toBe(200);
    },
  );

  test('does not exempt the wrong method on a public action path', async () => {
    const res = await app().request('/api/forms/form-1/submit', {
      method: 'DELETE',
    }, crossSiteEnv());
    expect(res.status).toBe(401);
  });
});

describe('Google OAuth callback boundary', () => {
  test('allows only unauthenticated GET callback through to signed-state validation', async () => {
    const get = await app().request(
      '/api/booking/google-calendar/oauth/callback?state=signed&code=code',
      {},
      crossSiteEnv(),
    );
    expect(get.status).toBe(200);
    expect(await get.text()).toBe('oauth-callback');

    const post = await app().request('/api/booking/google-calendar/oauth/callback', {
      method: 'POST',
    }, crossSiteEnv());
    expect(post.status).toBe(401);
  });
});

describe('CSRF protection', () => {
  test('cookie-authenticated POST without an X-CSRF-Token is rejected', async () => {
    const res = await app().request('/api/protected', {
      method: 'POST',
      headers: { Cookie: 'lh_admin_session=lhs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA; lh_csrf=token-abc' },
    }, crossSiteEnv());
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toMatch(/csrf/i);
  });

  test('cookie-authenticated POST with a mismatched token is rejected', async () => {
    const res = await app().request('/api/protected', {
      method: 'POST',
      headers: {
        Cookie: 'lh_admin_session=lhs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA; lh_csrf=token-abc',
        'X-CSRF-Token': 'token-WRONG',
      },
    }, crossSiteEnv());
    expect(res.status).toBe(403);
  });

  test('cookie-authenticated POST with a matching double-submit token succeeds', async () => {
    const res = await app().request('/api/protected', {
      method: 'POST',
      headers: {
        Cookie: 'lh_admin_session=lhs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA; lh_csrf=token-abc',
        'X-CSRF-Token': 'token-abc',
      },
    }, crossSiteEnv());
    expect(res.status).toBe(200);
  });

  test('Bearer POST is exempt from CSRF (not cookie-driven)', async () => {
    const res = await app().request('/api/protected', {
      method: 'POST',
      headers: { Authorization: 'Bearer env-key' },
    }, crossSiteEnv());
    expect(res.status).toBe(200);
  });
});

describe('logout', () => {
  test('expires both the session and CSRF cookies', async () => {
    const res = await app().request('/api/auth/logout', { method: 'POST' }, crossSiteEnv());
    expect(res.status).toBe(200);
    const session = cookieFor(res, 'lh_admin_session') ?? '';
    const csrf = cookieFor(res, 'lh_csrf') ?? '';
    expect(session).toContain('Max-Age=0');
    expect(csrf).toContain('Max-Age=0');
  });
});

describe('session endpoint', () => {
  test('returns the staff identity and a CSRF token', async () => {
    const res = await app().request('/api/auth/session', {
      headers: { Cookie: 'lh_admin_session=lhs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA; lh_csrf=token-abc' },
    }, crossSiteEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string }; csrfToken: string };
    expect(body.data).toMatchObject({ id: 'staff-1' });
    expect(body.csrfToken).toBe('token-abc');
  });

  test('mints and sets a CSRF cookie when none is present', async () => {
    const res = await app().request('/api/auth/session', {
      headers: { Cookie: 'lh_admin_session=lhs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    }, crossSiteEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as { csrfToken: string };
    expect(body.csrfToken).toBeTruthy();
    expect(cookieFor(res, 'lh_csrf') ?? '').toContain(`lh_csrf=${body.csrfToken}`);
  });
});

describe('CORS allowed / blocked origins', () => {
  test('allowlisted admin origin is echoed back', async () => {
    const res = await app().request('/api/protected', {
      headers: { Origin: PAGES, Cookie: 'lh_admin_session=lhs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    }, crossSiteEnv());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(PAGES);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  test('Cloudflare Pages preview origin for the admin project is echoed back', async () => {
    const preview = 'https://abc123.your-admin.pages.dev';
    const res = await app().request('/api/protected', {
      headers: { Origin: preview, Cookie: 'lh_admin_session=lhs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    }, crossSiteEnv());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(preview);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  test('login preflight succeeds from a Cloudflare Pages preview origin', async () => {
    const preview = 'https://abc123.your-admin.pages.dev';
    const res = await app().request('/api/auth/login', {
      method: 'OPTIONS',
      headers: {
        Origin: preview,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    }, crossSiteEnv());
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(preview);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  test('unknown origin gets no Access-Control-Allow-Origin header', async () => {
    const res = await app().request('/api/protected', {
      headers: { Origin: 'https://evil.example.com', Cookie: 'lh_admin_session=lhs_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' },
    }, crossSiteEnv());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('期限付きの旧Cookie交換', () => {
  const start = '2026-11-04T00:00:00Z';
  const startMs = Date.parse(start);
  function compatibilityEnv(overrides: Partial<Env['Bindings']> = {}) {
    vi.spyOn(Date, 'now').mockReturnValue(startMs + 86400_000);
    return env({ ADMIN_LEGACY_COOKIE_UPGRADE_STARTED_AT: start, ...overrides });
  }
  afterEach(() => vi.restoreAllMocks());

  test.each(['staff-key', 'env-key', 'legacy-env-key'])('%sを再検証し、通常のセッションとCSRFを発行する', async key => {
    const bindings = compatibilityEnv({ LEGACY_API_KEY: 'legacy-env-key', ADMIN_ORIGIN: PAGES, ADMIN_ALLOW_CROSS_SITE: 'true' });
    const a = app();
    const res = await a.request('/api/auth/session', { headers: { Cookie: `lh_admin_session=${key}` } }, bindings);
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const session = cookieFor(res, 'lh_admin_session')!;
    expect(session).toMatch(/^lh_admin_session=lhs_[A-Za-z0-9_-]{43};/);
    for (const attr of ['HttpOnly', 'Secure', 'SameSite=None', 'Max-Age=604800']) expect(session).toContain(attr);
    const body = await res.json() as { data: { id: string }; csrfToken: string };
    expect(body.data.id).toBe(key === 'staff-key' ? 'staff-1' : 'env-owner');
    const csrf = cookieFor(res, 'lh_csrf')!.split(';')[0];
    const cookie = session.split(';')[0] + '; ' + csrf;
    expect((await a.request('/api/protected', { method: 'POST', headers: { Cookie: cookie } }, bindings)).status).toBe(403);
    expect((await a.request('/api/protected', { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': 'wrong' } }, bindings)).status).toBe(403);
    expect((await a.request('/api/protected', { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': body.csrfToken } }, bindings)).status).toBe(200);
    // 互換期間終了後も発行済みセッションは通常の検証を受ける。
    bindings.ADMIN_LEGACY_COOKIE_UPGRADE_STARTED_AT = '';
    expect((await a.request('/api/protected', { headers: { Cookie: cookie } }, bindings)).status).toBe(200);
    const sql = databases.at(-1)!.sqlite;
    expect(sql.prepare('SELECT action,outcome,actor_id FROM auth_audit_log').all()).toEqual([
      { action: 'legacy_cookie_upgrade', outcome: 'attempted', actor_id: body.data.id },
    ]);
    const dump = JSON.stringify(sql.prepare('SELECT * FROM admin_sessions').all()) + JSON.stringify(sql.prepare('SELECT * FROM auth_audit_log').all());
    expect(dump).not.toContain(key);
    expect(dump).not.toContain(session.split(';')[0].split('=')[1]);
    if (key === 'staff-key') sql.exec("UPDATE staff_members SET is_active=0");
    else if (key === 'env-key') bindings.API_KEY = 'rotated-env-key';
    else bindings.LEGACY_API_KEY = undefined;
    expect((await a.request('/api/protected', { headers: { Cookie: cookie } }, bindings)).status).toBe(401);
  });

  test.each([undefined, '', 'false', 'true', 'invalid', '2026-02-30T00:00:00Z', '2026-11-04', '2026-11-04T00:00:00', '2026-11-04T24:00:00Z'])('未設定・不正値 %s は旧Cookieを拒否する', async value => {
    const bindings = compatibilityEnv({ ADMIN_LEGACY_COOKIE_UPGRADE_STARTED_AT: value });
    const res = await app().request('/api/protected', { headers: { Cookie: 'lh_admin_session=staff-key' } }, bindings);
    expect(res.status).toBe(401);
    expect(cookieFor(res, 'lh_admin_session')).toBeUndefined();
  });

  test.each([[-1, 401], [0, 200], [14 * 86400_000 - 1, 200], [14 * 86400_000, 401], [30 * 86400_000, 401]])('開始から %i ms の境界を判定する', async (elapsed, status) => {
    const bindings = compatibilityEnv();
    vi.spyOn(Date, 'now').mockReturnValue(startMs + elapsed);
    const res = await app().request('/api/protected', { headers: { Cookie: 'lh_admin_session=staff-key' } }, bindings);
    expect(res.status).toBe(status);
    expect(!!cookieFor(res, 'lh_admin_session')).toBe(status === 200);
  });

  test('ミリ秒付きUTC日時を受け付ける', async () => {
    const bindings = compatibilityEnv({ ADMIN_LEGACY_COOKIE_UPGRADE_STARTED_AT: '2026-11-04T00:00:00.000Z' });
    expect((await app().request('/api/protected', { headers: { Cookie: 'lh_admin_session=staff-key' } }, bindings)).status).toBe(200);
  });

  test.each(['POST', 'PUT', 'PATCH', 'DELETE'])('%sではCSRFの有無にかかわらず旧Cookieを交換しない', async method => {
    const bindings = compatibilityEnv();
    for (const csrf of [undefined, 'test-csrf']) {
      const headers: Record<string, string> = { Cookie: 'lh_admin_session=staff-key; lh_csrf=test-csrf' };
      if (csrf) headers['X-CSRF-Token'] = csrf;
      const res = await app().request('/api/protected', { method, headers }, bindings);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
      expect(cookieFor(res, 'lh_admin_session')).toBeUndefined();
    }
    expect(databases.at(-1)!.sqlite.prepare('SELECT count(*) AS n FROM admin_sessions').get()).toEqual({ n: 1 });
  });

  test.each(["api_scopes='[]'", `api_scopes='["messages:read"]'`, "api_scopes='invalid'", 'is_active=0'])('%sのスタッフは交換できない', async change => {
    const bindings = compatibilityEnv();
    databases.at(-1)!.sqlite.exec('UPDATE staff_members SET ' + change);
    const res = await app().request('/api/protected', { headers: { Cookie: 'lh_admin_session=staff-key' } }, bindings);
    expect(res.status).toBe(401);
    expect(cookieFor(res, 'lh_admin_session')).toBeUndefined();
  });

  test.each(['wrong', 'hashed:staff-1', 'lhs_invalid', TEST_SESSION])('%sはBearer資格情報への再解釈で復活しない', async token => {
    const bindings = compatibilityEnv({ API_KEY: token.startsWith('lhs_') ? token : 'env-key' });
    const sql = databases.at(-1)!.sqlite;
    sql.exec('UPDATE admin_sessions SET revoked_at=1');
    const res = await app().request('/api/protected', { headers: { Cookie: `lh_admin_session=${token}` } }, bindings);
    expect(res.status).toBe(401);
    expect(cookieFor(res, 'lh_admin_session')).toBeUndefined();
  });

  test.each([false, true])('six parallel legacy GETs succeed with lazy hashing %s without spending login quota', async lazy => {
    const bindings = compatibilityEnv({ STAFF_API_KEY_LAZY_HASH_ENABLED: String(lazy) });
    const sql = databases.at(-1)!.sqlite;
    sql.exec("UPDATE staff_members SET api_key='staff-key',api_key_hash=NULL");
    const a = app();
    const responses = await Promise.all(Array.from({ length: 6 }, () =>
      a.request('/api/protected', { headers: { Cookie: 'lh_admin_session=staff-key' } }, bindings)));
    expect(responses.map(r => r.status)).toEqual(Array(6).fill(200));
    expect(sql.prepare('SELECT count(*) AS n FROM admin_sessions').get()).toEqual({ n: 7 });
    for (const response of responses) {
      const cookie = cookieFor(response, 'lh_admin_session')!.split(';')[0];
      expect((await a.request('/api/protected', { headers: { Cookie: cookie } }, bindings)).status).toBe(200);
    }
    for (let i = 0; i < 10; i++) {
      expect((await a.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ apiKey: 'staff-key' }) }, bindings)).status).toBe(200);
    }
    expect((await a.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ apiKey: 'staff-key' }) }, bindings)).status).toBe(429);
  });

  test('bounds parallel upgrades per credential across IPs, independently of login and other credentials', async () => {
    const bindings = compatibilityEnv();
    const a = app();
    const responses = await Promise.all(Array.from({ length: 36 }, (_, i) =>
      a.request('/api/protected', { headers: { Cookie: 'lh_admin_session=staff-key', 'CF-Connecting-IP': `192.0.2.${i + 1}` } }, bindings)));
    expect(responses.filter(r => r.status === 200)).toHaveLength(30);
    expect(responses.filter(r => r.status === 429)).toHaveLength(6);
    for (const res of responses.filter(r => r.status === 429)) {
      expect(Number(res.headers.get('Retry-After'))).toBeGreaterThan(0);
      expect(cookieFor(res, 'lh_admin_session')).toBeUndefined();
    }
    const sql = databases.at(-1)!.sqlite;
    expect(sql.prepare('SELECT count(*) AS n FROM admin_sessions').get()).toEqual({ n: 31 });
    expect(sql.prepare('SELECT count(*) AS n FROM auth_audit_log').get()).toEqual({ n: 30 });
    const cookie = cookieFor(responses.find(r => r.status === 200)!, 'lh_admin_session')!.split(';')[0];
    expect((await a.request('/api/protected', { headers: { Cookie: cookie } }, bindings)).status).toBe(200);
    expect((await a.request('/api/forms/test', { headers: { Cookie: 'lh_admin_session=staff-key' } }, bindings)).status).toBe(429);
    expect((await a.request('/api/protected', { headers: { Cookie: 'lh_admin_session=env-key' } }, bindings)).status).toBe(200);
    expect((await a.request('/api/auth/login', { method: 'POST', body: JSON.stringify({ apiKey: 'staff-key' }) }, bindings)).status).toBe(200);
    // Fixed-window renewal, with no automatic retries in the server/client.
    vi.spyOn(Date, 'now').mockReturnValue(startMs + 86400_000 + 300_000);
    expect((await a.request('/api/protected', { headers: { Cookie: 'lh_admin_session=staff-key' } }, bindings)).status).toBe(200);
  });

  test.each(['lazy', 'migrate-keys'])('plaintext-cookie sessions survive %s conversion with the same credential fingerprint', async mode => {
    const bindings = compatibilityEnv();
    const sql = databases.at(-1)!.sqlite;
    sql.exec("UPDATE staff_members SET api_key='staff-key',api_key_hash=NULL");
    const a = app();
    const upgraded = await a.request('/api/auth/session', { headers: { Cookie: 'lh_admin_session=staff-key' } }, bindings);
    expect(upgraded.status).toBe(200);
    const cookie = cookieFor(upgraded, 'lh_admin_session')!.split(';')[0];
    const idHash = await hashApiKey(cookie.split('=')[1]);
    const fingerprint = await hashApiKey('staff-key');
    const storedSession = () => sql.prepare('SELECT credential_fp FROM admin_sessions WHERE id_hash=?').get(idHash);
    expect(storedSession()).toEqual({ credential_fp: fingerprint });
    expect(sql.prepare('SELECT api_key_hash FROM staff_members').get()).toEqual({ api_key_hash: null });
    bindings.STAFF_API_KEY_LAZY_HASH_ENABLED = 'true';
    expect((await a.request('/api/protected', { headers: { Cookie: cookie } }, bindings)).status).toBe(200);
    if (mode === 'lazy') {
      expect((await a.request('/api/protected', { headers: { Authorization: 'Bearer staff-key' } }, bindings)).status).toBe(200);
    } else {
      // The explicit migration also works with lazy conversion disabled.
      bindings.STAFF_API_KEY_LAZY_HASH_ENABLED = 'false';
      const migration = await a.request('/api/auth/migrate-keys', { method: 'POST', headers: { Authorization: 'Bearer env-key' } }, bindings);
      expect(migration.status).toBe(200);
      expect(await migration.json()).toMatchObject({ data: { migrated: 1 } });
    }
    expect(sql.prepare('SELECT api_key,api_key_hash FROM staff_members').get()).toEqual({ api_key: 'hashed:staff-1', api_key_hash: fingerprint });
    expect(storedSession()).toEqual({ credential_fp: fingerprint });
    bindings.ADMIN_LEGACY_COOKIE_UPGRADE_STARTED_AT = '';
    expect((await a.request('/api/protected', { headers: { Cookie: cookie } }, bindings)).status).toBe(200);
    const maintenance = await a.request('/api/auth/migrate-keys', { method: 'POST', headers: { Authorization: 'Bearer env-key' } }, bindings);
    expect(await maintenance.json()).toMatchObject({ data: { migrated: 0 } });
    expect((await a.request('/api/protected', { headers: { Cookie: cookie } }, bindings)).status).toBe(200);
  });

  test.each(['auth_rate_limits', 'admin_sessions', 'auth_audit_log'])('%sの障害ではCookieを発行せず拒否する', async table => {
    const bindings = compatibilityEnv();
    databases.at(-1)!.sqlite.exec('DROP TABLE ' + table);
    const res = await app().request('/api/protected', { headers: { Cookie: 'lh_admin_session=staff-key' } }, bindings);
    expect(res.status).toBe(503);
    expect(cookieFor(res, 'lh_admin_session')).toBeUndefined();
  });

  test('Access必須・構成不正では旧Cookieを交換しない', async () => {
    const bindings = compatibilityEnv({ ACCESS_REQUIRED: 'true' });
    const request = () => app().request('/api/protected', { headers: { Cookie: 'lh_admin_session=staff-key' } }, bindings);
    const denied = await request();
    expect(denied.status).toBe(403);
    expect(cookieFor(denied, 'lh_admin_session')).toBeUndefined();
    bindings.ACCESS_REQUIRED = 'false';
    bindings.ADMIN_ORIGIN = PAGES;
    const misconfigured = await request();
    expect(misconfigured.status).toBe(500);
    expect(cookieFor(misconfigured, 'lh_admin_session')).toBeUndefined();
  });

  test.each([undefined, 'false', 'TRUE', 'true'])('遅延変換フラグ %s はBearer・ログイン・旧Cookieで共通', async flag => {
    for (const kind of ['bearer', 'login', 'cookie']) {
      const bindings = compatibilityEnv({ STAFF_API_KEY_LAZY_HASH_ENABLED: flag });
      const sql = databases.at(-1)!.sqlite;
      sql.exec("UPDATE staff_members SET api_key='staff-key',api_key_hash=NULL");
      const res = await app().request(kind === 'login' ? '/api/auth/login' : '/api/protected', kind === 'login'
        ? { method: 'POST', body: JSON.stringify({ apiKey: 'staff-key' }) }
        : { headers: kind === 'bearer' ? { Authorization: 'Bearer staff-key' } : { Cookie: 'lh_admin_session=staff-key' } }, bindings);
      expect(res.status).toBe(200);
      expect(sql.prepare('SELECT api_key FROM staff_members').get()).toEqual({ api_key: flag === 'true' ? 'hashed:staff-1' : 'staff-key' });
    }
  });
});
