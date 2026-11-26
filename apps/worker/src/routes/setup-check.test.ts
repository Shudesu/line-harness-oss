import { Hono } from 'hono';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Env } from '../index.js';
const mocks = vi.hoisted(() => ({ getLineAccounts: vi.fn(), getStaffByApiKey: vi.fn() }));
vi.mock('@line-crm/db', () => mocks);
import { setupCheck } from './setup-check.js';
import { authMiddleware } from '../middleware/auth.js';
const account = { id: 'a', is_active: 1, channel_access_token: 'row-token', channel_secret: 'row-secret', login_channel_id: 'login', login_channel_secret: 'login-secret', liff_id: 'liff' };
const env = { DB: {}, API_KEY: 'owner-key', LINE_CHANNEL_ACCESS_TOKEN: 'env-token', ADMIN_ORIGIN: 'https://test.example' } as unknown as Env['Bindings'];
function request(path = '/api/setup/check', token = 'owner-key') {
  const app = new Hono<Env>();
  app.use('*', authMiddleware); app.route('/', setupCheck);
  return app.request(`https://test.example${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, env);
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getStaffByApiKey.mockResolvedValue(null);
  mocks.getLineAccounts.mockResolvedValue([account]);
  vi.stubGlobal('fetch', vi.fn(async url => Response.json(String(url).endsWith('/info') ? { userId: 'bot', basicId: '@bot' } : { endpoint: 'https://test.example/webhook', active: true })));
});
afterEach(() => vi.unstubAllGlobals());
test('unauthenticated and staff callers cannot inspect configuration or call LINE', async () => {
  expect((await request(undefined, '')).status).toBe(401);
  mocks.getStaffByApiKey.mockResolvedValue({ id: 's', role: 'staff' });
  expect((await request(undefined, 'staff')).status).toBe(403);
  expect(mocks.getLineAccounts).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
test('owner gets redacted read-only diagnostics scoped to the account', async () => {
  const res = await request(); const body = await res.text();
  expect(res.status).toBe(200); expect(res.headers.get('cache-control')).toBe('no-store');
  for (const secret of ['row-token', 'row-secret', 'login-secret', 'env-token', 'owner-key']) expect(body).not.toContain(secret);
  expect(JSON.parse(body).data.webhook).toEqual({ status: 200, active: true, endpointMatches: true });
  for (const [, init] of vi.mocked(fetch).mock.calls) {
    expect(init?.headers).toEqual({ Authorization: 'Bearer row-token' });
    expect(init?.method).toBeUndefined();
  }
});
test('multiple accounts require selection; inactive/missing accounts cannot fall back', async () => {
  mocks.getLineAccounts.mockResolvedValue([account, { ...account, id: 'b' }]);
  expect((await request()).status).toBe(400);
  expect((await request('/api/setup/check?accountId=missing')).status).toBe(404);
  expect(fetch).not.toHaveBeenCalled();
});
test('provider failure or timeout remains visibly unverified and never exposes response text', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('row-token', { status: 401 })));
  const body = await (await request()).json() as any;
  expect(body.data.bot.reachable).toBe(false); expect(body.data.bot.status).toBe(401);
  expect(body.data.secretsVerified).toBe(false);
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('row-token'); }));
  expect((await (await request()).json() as any).data.bot.status).toBeNull();
});
