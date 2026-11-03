import { describe, expect, test, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

const setStaffPassword = vi.fn(async () => true);
vi.mock('@line-crm/db', () => ({
  getStaffByApiKey: vi.fn(async (_db: unknown, token: string) => {
    if (token === 'current-key') return { id: 'staff-1', name: 'A', role: 'staff' };
    if (token === 'someone-elses-key') return { id: 'staff-2', name: 'B', role: 'staff' };
    return null;
  }),
  setStaffPassword: (...args: unknown[]) => setStaffPassword(...(args as [])),
}));

const { staff } = await import('./staff.js');

type TestEnv = {
  Variables: { staff: { id: string; name: string; role: 'owner' | 'admin' | 'staff' } };
  Bindings: { DB: D1Database; API_KEY: string; WORKER_URL: string };
};

function setupApp(id = 'staff-1') {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.set('staff', { id, name: 'A', role: id === 'env-owner' ? 'owner' : 'staff' });
    c.env = { DB: {} as D1Database, API_KEY: 'owner-secret', WORKER_URL: 'https://harness.example.test' };
    await next();
  });
  app.route('/', staff);
  return app;
}

function post(app: Hono<TestEnv>, body: unknown) {
  return app.request('https://harness.example.test/api/staff/me/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => setStaffPassword.mockClear());

describe('POST /api/staff/me/password', () => {
  test('changes the password and reissues the session cookie', async () => {
    const res = await post(setupApp(), { currentPassword: 'current-key', newPassword: 'brand-new-password' });
    expect(res.status).toBe(200);
    expect(setStaffPassword).toHaveBeenCalledWith(expect.anything(), 'staff-1', 'brand-new-password');
    expect(res.headers.get('Set-Cookie')).toContain('lh_admin_session=brand-new-password');
  });

  test('refuses a wrong current password', async () => {
    const res = await post(setupApp(), { currentPassword: 'wrong', newPassword: 'brand-new-password' });
    expect(res.status).toBe(400);
    expect(setStaffPassword).not.toHaveBeenCalled();
  });

  test("refuses another staff member's key as the current password", async () => {
    const res = await post(setupApp(), { currentPassword: 'someone-elses-key', newPassword: 'brand-new-password' });
    expect(res.status).toBe(400);
  });

  test('refuses a short password and one that is already a credential', async () => {
    expect((await post(setupApp(), { currentPassword: 'current-key', newPassword: 'short' })).status).toBe(400);
    expect((await post(setupApp(), { currentPassword: 'current-key', newPassword: 'owner-secret' })).status).toBe(400);
    expect((await post(setupApp(), { currentPassword: 'current-key', newPassword: 'someone-elses-key' })).status).toBe(400);
    expect(setStaffPassword).not.toHaveBeenCalled();
  });

  test('the env owner cannot change the password here', async () => {
    const res = await post(setupApp('env-owner'), { currentPassword: 'owner-secret', newPassword: 'brand-new-password' });
    expect(res.status).toBe(400);
  });
});
