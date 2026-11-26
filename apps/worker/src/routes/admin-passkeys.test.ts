import { it, expect, afterEach, vi } from 'vitest';
import { createAuthorizedRouter } from '../middleware/authorized-router.js';
import { authMiddleware } from '../middleware/auth.js';
import passkeys from './admin-passkeys.js';
import { adminAuth } from './admin-auth.js';
import { createAuthTestDb } from '../test-support/auth-db.js';
import { syntheticAuthenticator } from '../test-support/webauthn-fixture.js';
import type { Env } from '../index.js';
let serial = 1;
const opened: ReturnType<typeof createAuthTestDb>[] = [];
afterEach(() => {
  opened.splice(0).forEach((s) => s.close());
  vi.restoreAllMocks();
});
async function setup() {
  const s = createAuthTestDb();
  opened.push(s);
  const env = {
    DB: s.db,
    API_KEY: 'root',
    ADMIN_ORIGIN: 'https://admin.example.com',
    WORKER_URL: 'https://api.example.com',
  };
  const app = createAuthorizedRouter<Env>();
  app.use('*', authMiddleware);
  app.route('/', adminAuth);
  app.route('/', passkeys);
  const ip = '192.0.2.' + serial++;
  const request = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.request(
      'https://api.example.com' + path,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'cf-connecting-ip': ip,
          ...headers,
        },
        body: JSON.stringify(body),
      },
      env,
    );
  const login = await request('/api/auth/login', { apiKey: 'staff-key' });
  const data = (await login.json()) as any;
  const session = login.headers
    .get('Set-Cookie')!
    .match(/lh_admin_session=([^;]+)/)![1];
  const headers = {
    Cookie: 'lh_admin_session=' + session + '; lh_csrf=' + data.csrfToken,
    'X-CSRF-Token': data.csrfToken,
  };
  const authenticator = syntheticAuthenticator(
    'admin.example.com',
    'https://admin.example.com',
  );
  const enroll = async () => {
    const res = await request(
      '/api/auth/passkeys/register/options',
      {},
      headers,
    );
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as any;
    const registered = await request(
      '/api/auth/passkeys/register/verify',
      {
        challengeId: data.challengeId,
        response: authenticator.register(data.options),
        name: 'Synthetic',
      },
      headers,
    );
    expect(registered.status).toBe(200);
  };
  const options = async () => {
    const res = await request('/api/auth/passkeys/login/options', {});
    expect(res.status).toBe(200);
    return ((await res.json()) as any).data;
  };
  return { ...s, env, app, request, headers, authenticator, enroll, options };
}
it('registers and logs in with real ES256 protocol signatures, then rejects reused challenges/counters', async () => {
  const s = await setup();
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(
    new Error('No external network'),
  );
  await s.enroll();
  const data = await s.options();
  const body = {
    challengeId: data.challengeId,
    response: s.authenticator.login(data.options),
  };
  const res = await s.request('/api/auth/passkeys/login/verify', body);
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    data: { id: 'staff-1', role: 'admin', authMethod: 'passkey' },
  });
  expect(res.headers.get('Set-Cookie')).toContain('lh_admin_session=lhs_');
  expect(
    (await s.request('/api/auth/passkeys/login/verify', body)).status,
  ).toBe(401);
  const next = await s.options();
  expect(
    (
      await s.request('/api/auth/passkeys/login/verify', {
        challengeId: next.challengeId,
        response: s.authenticator.login(next.options, { counter: 1 }),
      })
    ).status,
  ).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
});
it('rejects origin, RP, missing UV, challenge mismatch, and expired challenges', async () => {
  const s = await setup();
  await s.enroll();
  for (const overrides of [
    { origin: 'https://evil.example.com' },
    { rpId: 'evil.example.com' },
    { uv: false },
    { challenge: 'wrong' },
  ]) {
    const data = await s.options();
    expect(
      (
        await s.request('/api/auth/passkeys/login/verify', {
          challengeId: data.challengeId,
          response: s.authenticator.login(data.options, overrides),
        })
      ).status,
    ).toBe(401);
  }
  const data = await s.options();
  s.sql
    .prepare('UPDATE admin_webauthn_challenges SET expires_at=0 WHERE id=?')
    .run(data.challengeId);
  expect(
    (
      await s.request('/api/auth/passkeys/login/verify', {
        challengeId: data.challengeId,
        response: s.authenticator.login(data.options),
      })
    ).status,
  ).toBe(401);
});
it('requires recent real login and CSRF for enrollment, and deletes disabled staff passkeys atomically', async () => {
  const s = await setup();
  expect(
    (
      await s.request(
        '/api/auth/passkeys/register/options',
        {},
        { Cookie: s.headers.Cookie },
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await s.request(
        '/api/auth/passkeys/register/options',
        {},
        { Authorization: 'Bearer staff-key' },
      )
    ).status,
  ).toBe(403);
  await s.enroll();
  s.sql.prepare('UPDATE admin_sessions SET created_at=created_at-601').run();
  expect(
    (await s.request('/api/auth/passkeys/register/options', {}, s.headers))
      .status,
  ).toBe(403);
  s.sql.prepare('UPDATE staff_members SET is_active=0').run();
  expect(
    s.sql.prepare('SELECT COUNT(*) AS n FROM admin_passkeys').get(),
  ).toEqual({ n: 0 });
  const data = await s.options();
  expect(
    (
      await s.request('/api/auth/passkeys/login/verify', {
        challengeId: data.challengeId,
        response: s.authenticator.login(data.options),
      })
    ).status,
  ).toBe(401);
});
