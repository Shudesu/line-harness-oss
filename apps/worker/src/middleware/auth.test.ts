import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { authMiddleware } from './auth.js';
import { resolveCorsOrigin } from './admin-auth-config.js';
import { adminAuth } from '../routes/admin-auth.js';
import type { Env } from '../index.js';

vi.mock('@line-crm/db', () => ({
  getStaffByApiKey: vi.fn(async (_db: unknown, token: string) => {
    if (token !== 'staff-key') return null;
    return { id: 'staff-1', name: 'Staff One', role: 'admin' };
  }),
}));

const PAGES = 'https://line-crm-admin.pages.dev';
const WORKERS = 'https://line-crm-worker.line-crm-api.workers.dev';

function env(overrides: Partial<Env['Bindings']> = {}): Env['Bindings'] {
  return {
    DB: {} as D1Database,
    IMAGES: {} as R2Bucket,
    ASSETS: {} as Fetcher,
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
    expect(session).toContain('lh_admin_session=staff-key');
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
      headers: { Cookie: 'lh_admin_session=staff-key' },
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

describe('CSRF protection', () => {
  test('cookie-authenticated POST without an X-CSRF-Token is rejected', async () => {
    const res = await app().request('/api/protected', {
      method: 'POST',
      headers: { Cookie: 'lh_admin_session=staff-key; lh_csrf=token-abc' },
    }, crossSiteEnv());
    expect(res.status).toBe(403);
    expect((await res.json() as { error: string }).error).toMatch(/csrf/i);
  });

  test('cookie-authenticated POST with a mismatched token is rejected', async () => {
    const res = await app().request('/api/protected', {
      method: 'POST',
      headers: {
        Cookie: 'lh_admin_session=staff-key; lh_csrf=token-abc',
        'X-CSRF-Token': 'token-WRONG',
      },
    }, crossSiteEnv());
    expect(res.status).toBe(403);
  });

  test('cookie-authenticated POST with a matching double-submit token succeeds', async () => {
    const res = await app().request('/api/protected', {
      method: 'POST',
      headers: {
        Cookie: 'lh_admin_session=staff-key; lh_csrf=token-abc',
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
      headers: { Cookie: 'lh_admin_session=staff-key; lh_csrf=token-abc' },
    }, crossSiteEnv());
    expect(res.status).toBe(200);
    const body = await res.json() as { data: { id: string }; csrfToken: string };
    expect(body.data).toMatchObject({ id: 'staff-1' });
    expect(body.csrfToken).toBe('token-abc');
  });

  test('mints and sets a CSRF cookie when none is present', async () => {
    const res = await app().request('/api/auth/session', {
      headers: { Cookie: 'lh_admin_session=staff-key' },
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
      headers: { Origin: PAGES, Cookie: 'lh_admin_session=staff-key' },
    }, crossSiteEnv());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(PAGES);
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
  });

  test('unknown origin gets no Access-Control-Allow-Origin header', async () => {
    const res = await app().request('/api/protected', {
      headers: { Origin: 'https://evil.example.com', Cookie: 'lh_admin_session=staff-key' },
    }, crossSiteEnv());
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
