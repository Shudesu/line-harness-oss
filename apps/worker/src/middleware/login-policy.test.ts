import { it, expect, afterEach } from 'vitest';
import { createAuthTestDb } from '../test-support/auth-db.js';
import { createAuthorizedRouter } from './authorized-router.js';
import { authMiddleware } from './auth.js';
import { adminAuth } from '../routes/admin-auth.js';
import type { Env } from '../index.js';
const opened: ReturnType<typeof createAuthTestDb>[] = [];
afterEach(() => opened.splice(0).forEach((s) => s.close()));
function setup() {
  const s = createAuthTestDb();
  opened.push(s);
  const env = {
    DB: s.db,
    API_KEY: 'root',
    LEGACY_API_KEY: 'legacy',
    API_KEY_LOGIN_MODE: 'allow',
  };
  const app = createAuthorizedRouter<Env>();
  app.use('*', authMiddleware);
  app.route('/', adminAuth);
  app.get('/api/friends', (c) => c.json({ ok: true }));
  const login = (apiKey: string) =>
    app.request(
      '/api/auth/login',
      {
        method: 'POST',
        body: JSON.stringify({ apiKey }),
        headers: { 'Content-Type': 'application/json' },
      },
      env,
    );
  return { ...s, env, app, login };
}
it('keeps Bearer and existing opaque sessions while disabling API-key login and raw-cookie upgrade', async () => {
  const s = setup();
  const login = await s.login('root');
  expect(login.status).toBe(200);
  const cookie = login.headers
    .get('Set-Cookie')!
    .match(/lh_admin_session=([^;]+)/)![1];
  s.env.API_KEY_LOGIN_MODE = 'disabled';
  expect((await s.login('root')).status).toBe(403);
  expect(
    (
      await s.app.request(
        '/api/friends',
        { headers: { Authorization: 'Bearer root' } },
        s.env,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await s.app.request(
        '/api/friends',
        { headers: { Cookie: 'lh_admin_session=root' } },
        s.env,
      )
    ).status,
  ).toBe(401);
  expect(
    (
      await s.app.request(
        '/api/auth/session',
        { headers: { Cookie: 'lh_admin_session=' + cookie } },
        s.env,
      )
    ).status,
  ).toBe(200);
});
it('break glass accepts only the current root key and caps its session at one hour', async () => {
  const s = setup();
  s.env.API_KEY_LOGIN_MODE = 'break-glass';
  for (const key of ['staff-key', 'legacy'])
    expect((await s.login(key)).status).toBe(401);
  const res = await s.login('root');
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({
    data: { authMethod: 'break_glass' },
  });
  const row = s.sql
    .prepare('SELECT expires_at-created_at AS ttl FROM admin_sessions')
    .get();
  expect(row).toEqual({ ttl: 3600 });
});
