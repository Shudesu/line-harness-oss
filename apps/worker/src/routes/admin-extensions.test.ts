import { it, expect, afterEach } from 'vitest';
import { createAuthorizedRouter } from '../middleware/authorized-router.js';
import { authMiddleware } from '../middleware/auth.js';
import extensions from './admin-extensions.js';
import { createAuthTestDb } from '../test-support/auth-db.js';
import {
  createExtensionTicket,
  verifyExtensionTicket,
} from '@line-harness/sdk';
import { createMachineKey } from '@line-crm/db';
import type { Env } from '../index.js';
const opened: ReturnType<typeof createAuthTestDb>[] = [];
afterEach(() => opened.splice(0).forEach((s) => s.close()));
const secret = 'extension-A-secret-'.repeat(3);
function setup() {
  const s = createAuthTestDb();
  opened.push(s);
  const env = {
    DB: s.db,
    API_KEY: 'root',
    WORKER_URL: 'https://api.example.com',
    ADMIN_EXTENSIONS: JSON.stringify([
      {
        id: 'a',
        url: 'https://ext.example.com',
        minRole: 'admin',
        launch: 'ticket',
      },
    ]),
    ADMIN_EXTENSION_SECRETS: JSON.stringify({ a: secret }),
    STAFF_ROLE_POLICY: 'strict',
  };
  const app = createAuthorizedRouter<Env>();
  app.use('*', authMiddleware);
  app.route('/', extensions);
  app.get('/api/friends', (c) => c.json({ ok: true }));
  return { ...s, env, app };
}
it('issues per-extension short-lived tickets interoperable with SDK durable replay rejection', async () => {
  const s = setup();
  const res = await s.app.request(
    '/api/admin/extensions/a/launch',
    { method: 'POST', headers: { Authorization: 'Bearer staff-key' } },
    s.env,
  );
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toBe('no-store');
  const body = (await res.json()) as any;
  const used = new Set<string>();
  const opts = {
    secret,
    extensionId: 'a',
    issuer: s.env.WORKER_URL,
    consumeJti: async (p: any) => {
      if (used.has(p.jti)) return false;
      used.add(p.jti);
      return true;
    },
  };
  const payload = await verifyExtensionTicket(body.data.ticket, opts);
  expect(payload).toMatchObject({ sub: 'staff-1', role: 'admin' });
  expect(payload!.exp - payload!.iat).toBe(60);
  expect(await verifyExtensionTicket(body.data.ticket, opts)).toBeNull();
  for (const override of [
    { extensionId: 'b' },
    { issuer: 'https://other.example.com' },
    { secret: 'wrong'.repeat(10) },
    { now: body.data.expiresAt },
    { now: Math.floor(Date.now() / 1000) - 100 },
  ])
    expect(
      await verifyExtensionTicket(body.data.ticket, { ...opts, ...override }),
    ).toBeNull();
  expect(
    (
      await s.app.request(
        '/api/friends',
        { headers: { Authorization: 'Bearer ' + body.data.ticket } },
        s.env,
      )
    ).status,
  ).toBe(401);
});
it('requires CSRF/human privilege and hides missing secrets', async () => {
  const s = setup();
  const req = (headers: Record<string, string>) =>
    s.app.request(
      '/api/admin/extensions/a/launch',
      { method: 'POST', headers },
      s.env,
    );
  expect((await req({ Cookie: 'lh_admin_session=staff-key' })).status).toBe(
    403,
  );
  s.sql.prepare("UPDATE staff_members SET role='staff'").run();
  expect((await req({ Authorization: 'Bearer staff-key' })).status).toBe(403);
  const machine = await createMachineKey(s.db, {
    name: 'm',
    scopes: ['read', 'write', 'admin'],
    createdBy: null,
    expiresAt: null,
  });
  expect((await req({ Authorization: 'Bearer ' + machine.token })).status).toBe(
    403,
  );
  s.env.ADMIN_EXTENSION_SECRETS = '{}';
  expect((await req({ Authorization: 'Bearer root' })).status).toBe(404);
});
