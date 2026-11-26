import { Hono } from 'hono';
import { beforeEach, expect, test, vi } from 'vitest';
import type { Env } from '../index.js';
const mocks = vi.hoisted(() => ({ getStaffByApiKey: vi.fn(), setLinkBaseUrl: vi.fn(), setTrackedLinkBaseUrl: vi.fn(), getLinkBaseUrl: vi.fn() }));
vi.mock('@line-crm/db', () => mocks);
import { accountSettings } from './account-settings.js';
import { authMiddleware } from '../middleware/auth.js';
const prepare = vi.fn(() => ({ bind: () => ({ run: async () => ({ success: true }) }) }));
const env = { DB: { prepare }, API_KEY: 'fixture-owner' } as unknown as Env['Bindings'];
const paths = ['test-recipients', 'link-base-url', 'tracked-link-base-url'];
function app() { const app = new Hono<Env>(); app.use('*', authMiddleware); app.route('/', accountSettings); return app; }
beforeEach(() => { vi.resetAllMocks(); });
test.each(paths)('staff cannot mutate %s before parsing input or touching settings', async path => {
  mocks.getStaffByApiKey.mockResolvedValue({ id: 's', role: 'staff' });
  const res = await app().request(`/api/account-settings/${path}`, { method: 'PUT', headers: { Authorization: 'Bearer fixture-staff' }, body: '{bad' }, env);
  expect(res.status).toBe(403); expect(prepare).not.toHaveBeenCalled();
  expect(mocks.setLinkBaseUrl).not.toHaveBeenCalled(); expect(mocks.setTrackedLinkBaseUrl).not.toHaveBeenCalled();
});
test.each(['owner', 'admin'])('%s retains settings changes', async role => {
  mocks.getStaffByApiKey.mockResolvedValue({ id: 's', role });
  const res = await app().request('/api/account-settings/link-base-url', { method: 'PUT', headers: { Authorization: 'Bearer fixture-key' }, body: '{"value":"https://links.example"}' }, env);
  expect(res.status).toBe(200); expect(mocks.setLinkBaseUrl).toHaveBeenCalledWith(env.DB, '__global__', 'https://links.example');
});
test('unauthenticated writes remain denied and staff retains read access needed for message composition', async () => {
  mocks.getStaffByApiKey.mockResolvedValue(null);
  expect((await app().request('/api/account-settings/link-base-url', { method: 'PUT' }, env)).status).toBe(401);
  mocks.getStaffByApiKey.mockResolvedValue({ id: 's', role: 'staff' });
  mocks.getLinkBaseUrl.mockResolvedValue('https://links.example');
  expect((await app().request('/api/account-settings/link-base-url', { headers: { Authorization: 'Bearer fixture-staff' } }, env)).status).toBe(200);
});
