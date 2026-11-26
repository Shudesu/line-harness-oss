import { it, expect, vi, afterEach } from 'vitest';
import { createAuthorizedRouter } from '../middleware/authorized-router.js';
import { authMiddleware } from '../middleware/auth.js';
import magic from './admin-magic-link.js';
import { createAuthTestDb } from '../test-support/auth-db.js';
import type { Env } from '../index.js';
let serial = 100;
const opened: ReturnType<typeof createAuthTestDb>[] = [];
afterEach(() => {
  opened.splice(0).forEach((s) => s.close());
  vi.restoreAllMocks();
});
function setup() {
  const s = createAuthTestDb();
  opened.push(s);
  s.sql.prepare('UPDATE staff_members SET email=?').run('person@example.com');
  const env = {
    DB: s.db,
    API_KEY: 'root',
    ADMIN_ORIGIN: 'https://admin.example.com',
    WORKER_URL: 'https://api.example.com',
    MAGIC_LINK_EMAIL_PROVIDER: 'resend',
    RESEND_API_KEY: 'test-secret',
    MAGIC_LINK_FROM: 'login@example.com',
  };
  const app = createAuthorizedRouter<Env>();
  app.use('*', authMiddleware);
  app.route('/', magic);
  let token = '';
  const emailBodies: any[] = [];
  const mail = vi
    .spyOn(globalThis, 'fetch')
    .mockImplementation(async (url, init) => {
      expect(String(url)).toBe('https://api.resend.com/emails');
      const body = JSON.parse(String(init?.body));
      emailBodies.push(body);
      token = body.text.match(/#t=(lhm_[A-Za-z0-9_-]+)/)[1];
      return Response.json({ id: 'synthetic' });
    });
  const ip = '192.0.2.' + serial++;
  const request = (path: string, body: unknown) =>
    app.request(
      'https://api.example.com' + path,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip },
        body: JSON.stringify(body),
      },
      env,
    );
  return { ...s, env, request, mail, emailBodies, token: () => token };
}
it('returns the same response for known/unknown emails and consumes a digest-only link once', async () => {
  const s = setup();
  const unknown = await s.request('/api/auth/magic-link', {
    email: 'missing@example.com',
  });
  const known = await s.request('/api/auth/magic-link', {
    email: 'person@example.com',
  });
  expect(await unknown.json()).toEqual(await known.json());
  expect(s.mail).toHaveBeenCalledTimes(1);
  expect(s.emailBodies[0].text).toContain('心当たりがなければ無視');
  expect(s.emailBodies[0].text).toContain('192.0.2.x');
  expect(
    JSON.stringify(s.sql.prepare('SELECT * FROM admin_magic_links').get()),
  ).not.toContain(s.token());
  const consumed = await s.request('/api/auth/magic-link/consume', {
    token: s.token(),
  });
  expect(consumed.status).toBe(200);
  expect(await consumed.json()).toMatchObject({
    data: { id: 'staff-1', authMethod: 'magic_link' },
  });
  expect(
    (await s.request('/api/auth/magic-link/consume', { token: s.token() }))
      .status,
  ).toBe(401);
});
it('is unavailable without a provider, expires after 15 minutes, and rejects changed staff', async () => {
  const s = setup();
  s.env.RESEND_API_KEY = '';
  expect(
    (await s.request('/api/auth/magic-link', { email: 'person@example.com' }))
      .status,
  ).toBe(404);
  expect(s.mail).not.toHaveBeenCalled();
  s.env.RESEND_API_KEY = 'test-secret';
  await s.request('/api/auth/magic-link', { email: 'person@example.com' });
  expect(
    s.sql
      .prepare('SELECT expires_at-created_at AS ttl FROM admin_magic_links')
      .get(),
  ).toEqual({ ttl: 900 });
  s.sql.prepare('UPDATE admin_magic_links SET expires_at=0').run();
  expect(
    (await s.request('/api/auth/magic-link/consume', { token: s.token() }))
      .status,
  ).toBe(401);
  await s.request('/api/auth/magic-link', { email: 'person@example.com' });
  s.sql.prepare('UPDATE staff_members SET is_active=0').run();
  expect(
    (await s.request('/api/auth/magic-link/consume', { token: s.token() }))
      .status,
  ).toBe(403);
});
it('invalidates a failed delivery without disclosing email existence', async () => {
  const s = setup();
  s.mail.mockImplementation(async () => new Response(null, { status: 503 }));
  const response = await s.request('/api/auth/magic-link', {
    email: 'person@example.com',
  });
  expect(response.status).toBe(200);
  expect(
    s.sql.prepare('SELECT used_at FROM admin_magic_links').get(),
  ).toMatchObject({ used_at: expect.any(Number) });
});
