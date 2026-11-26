import { it, expect, vi, afterEach, beforeAll } from 'vitest';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createAuthorizedRouter } from '../middleware/authorized-router.js';
import { authMiddleware } from '../middleware/auth.js';
import access from './admin-access.js';
import { adminAuth } from './admin-auth.js';
import { createAuthTestDb } from '../test-support/auth-db.js';
import { verifyAccessJwt } from '../lib/access-jwt.js';
import type { Env } from '../index.js';
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
let jwk: any;
let serial = 0;
const opened: ReturnType<typeof createAuthTestDb>[] = [];
beforeAll(async () => {
  pair = await generateKeyPair('RS256');
  jwk = {
    ...(await exportJWK(pair.publicKey)),
    kid: 'test',
    alg: 'RS256',
    use: 'sig',
  };
});
afterEach(() => {
  opened.splice(0).forEach((s) => s.close());
  vi.restoreAllMocks();
});
function setup() {
  const s = createAuthTestDb();
  opened.push(s);
  const env = {
    DB: s.db,
    API_KEY: 'root',
    ACCESS_TEAM_DOMAIN: `test-${serial++}.cloudflareaccess.com`,
    ACCESS_AUD: 'application',
    ADMIN_ORIGIN: 'https://admin.example.com',
    WORKER_URL: 'https://api.example.com',
  };
  const app = createAuthorizedRouter<Env>();
  app.use('*', authMiddleware);
  app.route('/', access);
  app.route('/', adminAuth);
  const network = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (input) => {
      expect(String(input)).toBe(
        `https://${env.ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`,
      );
      return Response.json({ keys: [jwk] });
    });
  const token = (extra: Record<string, unknown> = {}) =>
    new SignJWT({
      email: 'person@example.com',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 600,
      iss: `https://${env.ACCESS_TEAM_DOMAIN}`,
      aud: env.ACCESS_AUD,
      ...extra,
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test' })
      .sign(pair.privateKey);
  const login = async (jwt?: string, next = '') =>
    app.request(
      'https://api.example.com/auth/access/login' + next,
      { headers: jwt ? { 'Cf-Access-Jwt-Assertion': jwt } : {} },
      env,
    );
  return { ...s, env, app, network, token, login };
}
it('validates signature/issuer/audience/time/email and caches issuer JWKS', async () => {
  const s = setup();
  expect(await verifyAccessJwt(await s.token(), s.env)).toMatchObject({
    email: 'person@example.com',
  });
  expect(await verifyAccessJwt(await s.token(), s.env)).not.toBeNull();
  expect(s.network).toHaveBeenCalledTimes(1);
  for (const extra of [
    { iss: 'https://evil.example' },
    { aud: 'wrong' },
    { exp: 1 },
    { iat: Math.floor(Date.now() / 1000) + 1000 },
    { nbf: Math.floor(Date.now() / 1000) + 1000 },
    { email: undefined },
  ])
    expect(await verifyAccessJwt(await s.token(extra), s.env)).toBeNull();
  expect(
    await verifyAccessJwt((await s.token()).slice(0, -8) + 'tampered', s.env),
  ).toBeNull();
  expect(await verifyAccessJwt('eyJhbGciOiJub25lIn0.e30.', s.env)).toBeNull();
});
it('matches normalized staff email, issues opaque cookie and refuses external redirects', async () => {
  const s = setup();
  s.sql.prepare('UPDATE staff_members SET email=?').run(' Person@Example.Com ');
  const res = await s.login(await s.token(), '?next=https://evil.example');
  expect(res.status).toBe(302);
  expect(res.headers.get('Location')).toBe('https://admin.example.com/');
  const cookie = res.headers
    .get('Set-Cookie')!
    .match(/lh_admin_session=([^;]+)/)![1];
  expect(cookie).toMatch(/^lhs_/);
  const session = await s.app.request(
    'https://api.example.com/api/auth/session',
    { headers: { Cookie: 'lh_admin_session=' + cookie } },
    s.env,
  );
  expect(session.status).toBe(200);
  expect(await session.json()).toMatchObject({
    data: { id: 'staff-1', role: 'admin', authMethod: 'access' },
  });
  s.sql.prepare('UPDATE staff_members SET email=?').run('other@example.com');
  expect(
    (
      await s.app.request(
        'https://api.example.com/api/auth/session',
        { headers: { Cookie: 'lh_admin_session=' + cookie } },
        s.env,
      )
    ).status,
  ).toBe(401);
});
it('never falls through disabled or ambiguous staff to the owner allowlist', async () => {
  const s = setup();
  Object.assign(s.env, { ACCESS_OWNER_EMAILS: 'person@example.com' });
  s.sql
    .prepare('UPDATE staff_members SET email=?,is_active=0')
    .run('person@example.com');
  expect((await s.login(await s.token())).status).toBe(403);
  s.sql.prepare('UPDATE staff_members SET is_active=1').run();
  s.sql
    .prepare(
      "INSERT INTO staff_members(id,name,role,api_key,email,is_active) VALUES('two','Two','staff','other','PERSON@example.com',1)",
    )
    .run();
  expect((await s.login(await s.token())).status).toBe(403);
});
it('owner bootstrap needs explicit allowlist and its session tracks configuration removal', async () => {
  const s = setup();
  expect((await s.login(await s.token())).status).toBe(403);
  Object.assign(s.env, { ACCESS_OWNER_EMAILS: 'person@example.com' });
  const res = await s.login(await s.token());
  expect(res.status).toBe(302);
  const cookie = res.headers
    .get('Set-Cookie')!
    .match(/lh_admin_session=([^;]+)/)![1];
  const req = () =>
    s.app.request(
      'https://api.example.com/api/auth/session',
      { headers: { Cookie: 'lh_admin_session=' + cookie } },
      s.env,
    );
  expect((await req()).status).toBe(200);
  Object.assign(s.env, { ACCESS_OWNER_EMAILS: '' });
  expect((await req()).status).toBe(401);
});
it('is opt-in and ignores unsigned identity headers', async () => {
  const s = setup();
  expect((await s.login()).status).toBe(403);
  s.env.ACCESS_AUD = '';
  expect((await s.login()).status).toBe(404);
  expect(s.network).not.toHaveBeenCalled();
  const methods = await s.app.request(
    'https://api.example.com/api/auth/methods',
    {},
    s.env,
  );
  expect(await methods.json()).toMatchObject({
    apiKey: true,
    access: { enabled: false },
  });
});
