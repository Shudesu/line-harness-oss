import { it, expect, afterEach } from 'vitest';
import { createAuthTestDb } from '../test-support/auth-db.js';
import {
  createMachineKey,
  revokeMachineKey,
  authenticateMachineKey,
} from '@line-crm/db';
import { createAuthorizedRouter } from './authorized-router.js';
import { authMiddleware, issueAdminSession } from './auth.js';
import machineRoutes from '../routes/machine-keys.js';
import { adminAuth } from '../routes/admin-auth.js';
import { requireRole } from './role-guard.js';
import type { Env } from '../index.js';
const opened: ReturnType<typeof createAuthTestDb>[] = [];
afterEach(() => opened.splice(0).forEach((s) => s.close()));
function setup() {
  const s = createAuthTestDb();
  opened.push(s);
  const env = { DB: s.db, API_KEY: 'root-key', STAFF_ROLE_POLICY: 'strict' };
  const app = createAuthorizedRouter<Env>();
  app.use('*', authMiddleware);
  app.route('/', machineRoutes);
  app.route('/', adminAuth);
  app.get('/api/friends', (c) => c.json({ ok: true }));
  app.post('/api/friends/:id/messages', (c) => c.json({ ok: true }));
  app.get('/api/friends/credentials', (c) =>
    c.json({ secret: 'must-not-leak' }),
  );
  app.get('/api/friends/:id', (c) => c.json({ ok: true }));
  app.post('/api/automations', requireRole('owner', 'admin'), (c) =>
    c.json({ ok: true }),
  );
  app.put('/api/account-settings', requireRole('owner'), (c) =>
    c.json({ ok: true }),
  );
  const request = (
    path: string,
    token: string,
    method = 'GET',
    body?: unknown,
  ) =>
    app.request(
      path,
      {
        method,
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
      env,
    );
  return { ...s, app, env, request };
}
it('stores only a digest, enforces registered routes/scopes, denies human credential endpoints', async () => {
  const s = setup();
  const issued = await createMachineKey(s.db, {
    name: 'reader',
    scopes: ['read'],
    createdBy: null,
    expiresAt: null,
  });
  expect(issued.token).toMatch(/^lhk_[A-Za-z0-9_-]{43}$/);
  expect(
    JSON.stringify(s.sql.prepare('SELECT * FROM machine_keys').get()),
  ).not.toContain(issued.token);
  expect((await s.request('/api/friends', issued.token)).status).toBe(200);
  const send = await s.request(
    '/api/friends/one/messages',
    issued.token,
    'POST',
  );
  expect(send.status).toBe(403);
  expect(await send.json()).toMatchObject({
    error: 'insufficient_scope',
    required: 'send',
  });
  for (const path of [
    '/api/friends/credentials',
    '/api/machine-keys',
    '/api/auth/session',
  ])
    expect((await s.request(path, issued.token)).status, path).toBe(403);
  expect(
    (await s.request('/api/auth/login', '', 'POST', { apiKey: issued.token }))
      .status,
  ).toBe(401);
  expect(
    (
      await s.app.request(
        '/api/friends',
        { headers: { Cookie: 'lh_admin_session=' + issued.token } },
        s.env,
      )
    ).status,
  ).toBe(401);
});
it('allows only explicit send/admin capability and never promotes a machine to owner', async () => {
  const s = setup();
  const issue = (scopes: ('send' | 'admin' | 'write')[]) =>
    createMachineKey(s.db, {
      name: 'integration',
      scopes,
      createdBy: null,
      expiresAt: null,
    });
  const send = await issue(['send']);
  expect(
    (await s.request('/api/friends/one/messages', send.token, 'POST')).status,
  ).toBe(200);
  expect((await s.request('/api/friends', send.token)).status).toBe(403);
  const write = await issue(['write']);
  expect((await s.request('/api/friends', write.token)).status).toBe(200);
  expect(
    (await s.request('/api/automations', write.token, 'POST')).status,
  ).toBe(403);
  const admin = await issue(['admin']);
  expect(
    (await s.request('/api/automations', admin.token, 'POST')).status,
  ).toBe(200);
  expect(
    (await s.request('/api/account-settings', admin.token, 'PUT')).status,
  ).toBe(403);
  expect(
    (
      await s.request('/api/machine-keys', admin.token, 'POST', {
        name: 'escalate',
        scopes: ['admin'],
      })
    ).status,
  ).toBe(403);
});
it('preserves env owner lhk_ compatibility and revokes/ages new keys', async () => {
  const s = setup();
  s.env.API_KEY = 'lhk_' + 'x'.repeat(43);
  expect((await s.request('/api/machine-keys', s.env.API_KEY)).status).toBe(
    200,
  );
  const key = await createMachineKey(
    s.db,
    { name: 'expires', scopes: ['read'], createdBy: null, expiresAt: 2000 },
    1000,
  );
  expect(await authenticateMachineKey(s.db, key.token, 1999)).not.toBeNull();
  expect(await authenticateMachineKey(s.db, key.token, 2000)).toBeNull();
  await revokeMachineKey(s.db, key.key.id, 1002);
  expect(await authenticateMachineKey(s.db, key.token, 1003)).toBeNull();
});
it('returns plaintext once only and requires a human admin to create/list/revoke', async () => {
  const s = setup();
  const res = await s.request('/api/machine-keys', 'root-key', 'POST', {
    name: 'MCP',
    scopes: ['read'],
  });
  expect(res.status).toBe(201);
  const body = (await res.json()) as any;
  expect(body.data.token).toMatch(/^lhk_/);
  expect(body.data.key.expires_at - body.data.key.created_at).toBe(90 * 86400);
  const list = await s.request('/api/machine-keys', 'root-key');
  const text = await list.text();
  expect(text).not.toContain(body.data.token);
  expect(text).not.toContain('key_hash');
  expect(
    (
      await s.request(
        '/api/machine-keys/' + body.data.key.id,
        'root-key',
        'DELETE',
      )
    ).status,
  ).toBe(200);
  expect((await s.request('/api/friends', body.data.token)).status).toBe(401);
});
