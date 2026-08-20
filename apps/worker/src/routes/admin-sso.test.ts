import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { authMiddleware, ADMIN_AUTH_COOKIE, CSRF_COOKIE } from '../middleware/auth.js';
import { adminSso } from './admin-sso.js';
import {
  ADMIN_SSO_AUDIENCE,
  ADMIN_SSO_MAX_TTL_SECONDS,
  signAdminSsoToken,
  type AdminSsoPayload,
} from '../lib/admin-sso-token.js';
import type { Env } from '../index.js';

const consumeAdminSsoJti = vi.hoisted(() => vi.fn());

vi.mock('@line-crm/db', () => ({
  getStaffByApiKey: vi.fn(async () => null),
  consumeAdminSsoJti,
}));

const SECRET = 'sso-shared-secret-of-at-least-32-chars';
const OTHER_SECRET = 'a-completely-different-secret-32-chars';
const API_KEY = 'env-owner-key';
const NOW = 1_735_689_600;

/**
 * In-memory stand-in for the sso_jti table: first burn wins, every later burn
 * of the same jti reports a replay.
 */
function ledger() {
  const seen = new Set<string>();
  return vi.fn(async (_db: unknown, jti: string) => {
    if (seen.has(jti)) return { consumed: false, purged: 0 };
    seen.add(jti);
    return { consumed: true, purged: 0 };
  });
}

function env(overrides: Partial<Env['Bindings']> = {}): Env['Bindings'] {
  return {
    DB: {} as D1Database,
    IMAGES: {} as R2Bucket,
    ASSETS: {} as Fetcher,
    LINE_CHANNEL_SECRET: 'secret',
    LINE_CHANNEL_ACCESS_TOKEN: 'line-token',
    API_KEY,
    LIFF_URL: 'https://liff.example.test',
    LINE_CHANNEL_ID: 'line-channel',
    LINE_LOGIN_CHANNEL_ID: 'login-channel',
    LINE_LOGIN_CHANNEL_SECRET: 'login-secret',
    WORKER_URL: 'https://worker.example.test',
    ADMIN_ORIGIN: 'https://admin.example.test',
    ADMIN_SSO_SECRET: SECRET,
    ...overrides,
  };
}

function app() {
  const a = new Hono<Env>();
  a.use('*', authMiddleware);
  a.route('/', adminSso);
  return a;
}

function payload(overrides: Partial<AdminSsoPayload> = {}): AdminSsoPayload {
  return {
    aud: ADMIN_SSO_AUDIENCE,
    iat: NOW,
    exp: NOW + 60,
    jti: crypto.randomUUID(),
    ...overrides,
  };
}

async function sso(
  token: string | null,
  bindings: Partial<Env['Bindings']> = {},
): Promise<Response> {
  const path = token === null ? '/admin/sso' : `/admin/sso?token=${encodeURIComponent(token)}`;
  return app().request(path, {}, env(bindings));
}

/** Mirrors the helper in middleware/auth.test.ts — `getSetCookie` is not in lib.dom. */
function cookies(res: Response): string[] {
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const single = res.headers.get('Set-Cookie');
  return single ? [single] : [];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW * 1000);
  consumeAdminSsoJti.mockImplementation(ledger());
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('feature is opt-in', () => {
  test('ADMIN_SSO_SECRET unset → 404, as if the route did not exist', async () => {
    const token = await signAdminSsoToken(SECRET, payload());
    const res = await sso(token, { ADMIN_SSO_SECRET: undefined });

    expect(res.status).toBe(404);
    expect(cookies(res)).toEqual([]);
    expect(consumeAdminSsoJti).not.toHaveBeenCalled();
  });

  test('ADMIN_SSO_SECRET empty/whitespace → 404', async () => {
    const token = await signAdminSsoToken(SECRET, payload());
    expect((await sso(token, { ADMIN_SSO_SECRET: '   ' })).status).toBe(404);
  });

  test('disabled SSO falls through to the app notFound handler, like any unknown path', async () => {
    // index.ts installs a notFound handler that serves static assets. Routing
    // the disabled case through it is what makes /admin/sso indistinguishable
    // from a path that was never registered.
    const a = new Hono<Env>();
    a.use('*', authMiddleware);
    a.route('/', adminSso);
    a.notFound((c) => c.text('asset-fallback', 404));

    const token = await signAdminSsoToken(SECRET, payload());
    const disabled = await a.request(
      `/admin/sso?token=${encodeURIComponent(token)}`,
      {},
      env({ ADMIN_SSO_SECRET: undefined }),
    );
    const unregistered = await a.request('/admin/never-registered', {}, env());

    expect(await disabled.text()).toBe(await unregistered.text());
    expect(disabled.status).toBe(unregistered.status);
  });

  test('a too-short secret refuses loudly (500) instead of half-working', async () => {
    const short = 'too-short';
    const token = await signAdminSsoToken(short, payload());
    const res = await sso(token, { ADMIN_SSO_SECRET: short });

    expect(res.status).toBe(500);
    expect(cookies(res)).toEqual([]);
  });
});

describe('successful SSO', () => {
  test('establishes the same session cookie an API_KEY login issues', async () => {
    const res = await sso(await signAdminSsoToken(SECRET, payload({ sub: 'ops@example.test' })));

    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://admin.example.test');

    const setCookies = cookies(res);
    const session = setCookies.find((value) => value.startsWith(`${ADMIN_AUTH_COOKIE}=`));
    const csrf = setCookies.find((value) => value.startsWith(`${CSRF_COOKIE}=`));

    expect(session).toContain(`${ADMIN_AUTH_COOKIE}=${encodeURIComponent(API_KEY)}`);
    expect(session).toContain('HttpOnly');
    expect(session).toContain('Secure');
    expect(csrf).toBeDefined();
    expect(csrf).not.toContain('HttpOnly');
  });

  test('the issued cookie authenticates a subsequent API request', async () => {
    const res = await sso(await signAdminSsoToken(SECRET, payload()));
    const session = cookies(res).find((value) => value.startsWith(`${ADMIN_AUTH_COOKIE}=`))!;
    const cookieHeader = session.split(';')[0];

    const guarded = new Hono<Env>();
    guarded.use('*', authMiddleware);
    guarded.get('/api/friends', (c) => c.json({ success: true, staff: c.get('staff') }));

    const authed = await guarded.request(
      '/api/friends',
      { headers: { Cookie: cookieHeader } },
      env(),
    );
    expect(authed.status).toBe(200);
    expect(await authed.json()).toEqual({
      success: true,
      staff: { id: 'env-owner', name: 'Owner', role: 'owner' },
    });
  });

  test('response is uncacheable and leaks no referrer', async () => {
    const res = await sso(await signAdminSsoToken(SECRET, payload()));
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
  });

  test('falls back to ADMIN_PUBLIC_URL when no ADMIN_ORIGIN allowlist exists', async () => {
    const res = await sso(await signAdminSsoToken(SECRET, payload()), {
      ADMIN_ORIGIN: undefined,
      ADMIN_PUBLIC_URL: 'https://dashboard.example.test/',
    });
    expect(res.headers.get('Location')).toBe('https://dashboard.example.test');
  });

  test('the redirect target is never taken from the request (no open redirect)', async () => {
    const token = await signAdminSsoToken(SECRET, payload());
    const res = await app().request(
      `/admin/sso?token=${encodeURIComponent(token)}&redirect=https://evil.example`,
      {},
      env(),
    );
    expect(res.headers.get('Location')).toBe('https://admin.example.test');
  });
});

describe('attack cases', () => {
  test('a tampered signature is rejected with 403 and no session', async () => {
    const token = await signAdminSsoToken(SECRET, payload());
    const [encoded, signature] = token.split('.');
    const forged = `${encoded}.${(signature[0] === 'A' ? 'B' : 'A') + signature.slice(1)}`;

    const res = await sso(forged);
    expect(res.status).toBe(403);
    expect(cookies(res)).toEqual([]);
    expect(consumeAdminSsoJti).not.toHaveBeenCalled();
  });

  test('a token signed with a different secret is rejected', async () => {
    const res = await sso(await signAdminSsoToken(OTHER_SECRET, payload()));
    expect(res.status).toBe(403);
    expect(cookies(res)).toEqual([]);
  });

  test('an expired token is rejected', async () => {
    const res = await sso(
      await signAdminSsoToken(SECRET, payload({ iat: NOW - 600, exp: NOW - 300 })),
    );
    expect(res.status).toBe(403);
    expect(cookies(res)).toEqual([]);
  });

  test('a long-lived token is rejected even though it is unexpired', async () => {
    const res = await sso(
      await signAdminSsoToken(
        SECRET,
        payload({ iat: NOW, exp: NOW + ADMIN_SSO_MAX_TTL_SECONDS + 1 }),
      ),
    );
    expect(res.status).toBe(403);
    expect(cookies(res)).toEqual([]);
    expect(consumeAdminSsoJti).not.toHaveBeenCalled();
  });

  test('replaying a valid token is rejected the second time', async () => {
    const token = await signAdminSsoToken(SECRET, payload({ jti: 'replayed-jti-01' }));

    const first = await sso(token);
    expect(first.status).toBe(302);

    const second = await sso(token);
    expect(second.status).toBe(403);
    expect(cookies(second)).toEqual([]);
    expect(consumeAdminSsoJti).toHaveBeenCalledTimes(2);
  });

  test('the jti is burnt with the token exp so the ledger can expire the row', async () => {
    const token = await signAdminSsoToken(SECRET, payload({ jti: 'burn-me-0001', exp: NOW + 120 }));
    await sso(token);

    expect(consumeAdminSsoJti).toHaveBeenCalledWith(
      expect.anything(),
      'burn-me-0001',
      NOW + 120,
      NOW,
    );
  });

  test('a token minted for another audience is rejected', async () => {
    const res = await sso(await signAdminSsoToken(SECRET, payload({ aud: 'some-other-app' })));
    expect(res.status).toBe(403);
  });

  test('a missing token is rejected', async () => {
    const res = await sso(null);
    expect(res.status).toBe(403);
    expect(cookies(res)).toEqual([]);
  });

  test('every rejection returns the identical page (no oracle)', async () => {
    const bad = await sso('garbage');
    const expired = await sso(
      await signAdminSsoToken(SECRET, payload({ iat: NOW - 600, exp: NOW - 300 })),
    );
    expect(await bad.text()).toBe(await expired.text());
  });

  test('a ledger failure fails closed (no session issued)', async () => {
    consumeAdminSsoJti.mockRejectedValueOnce(new Error('no such table: sso_jti'));
    const res = await sso(await signAdminSsoToken(SECRET, payload()));

    expect(res.status).toBe(500);
    expect(cookies(res)).toEqual([]);
  });
});

describe('topology guard', () => {
  test('refuses when the session cookie would be dropped by the browser', async () => {
    // Admin on pages.dev, API on workers.dev → cross-site, but SameSite stays
    // Lax, so the cookie would never come back. Same guard as POST /api/auth/login.
    const res = await sso(await signAdminSsoToken(SECRET, payload()), {
      ADMIN_ORIGIN: 'https://admin.pages.dev',
      WORKER_URL: 'https://api.workers.dev',
    });

    expect(res.status).toBe(500);
    expect(cookies(res)).toEqual([]);
  });

  test('cross-site opt-in issues SameSite=None cookies', async () => {
    const res = await sso(await signAdminSsoToken(SECRET, payload()), {
      ADMIN_ORIGIN: 'https://admin.pages.dev',
      WORKER_URL: 'https://api.workers.dev',
      ADMIN_ALLOW_CROSS_SITE: 'true',
    });

    expect(res.status).toBe(302);
    for (const cookie of cookies(res)) expect(cookie).toContain('SameSite=None');
  });
});
