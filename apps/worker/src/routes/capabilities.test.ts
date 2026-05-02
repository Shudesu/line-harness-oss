import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { capabilities } from './capabilities.js';

type TestEnv = {
  Variables: { staff: { id: string; role: 'owner' | 'admin' | 'staff' } };
};

describe('GET /api/capabilities', () => {
  function setupApp(staffRole: 'owner' | 'admin' | 'staff' = 'owner') {
    const app = new Hono<TestEnv>();
    app.use('*', async (c, next) => {
      c.set('staff', { id: 'test-staff', role: staffRole });
      await next();
    });
    app.route('/', capabilities);
    return app;
  }

  test('returns harness metadata with success envelope', async () => {
    const app = setupApp('owner');
    const res = await app.request('/api/capabilities');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.harness_kind).toBe('line');
    expect(body.data.harness_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.data.api_version).toBe(1);
    expect(body.data.features).toContain('friends');
    expect(body.data.features).toContain('broadcasts');
    expect(body.data.features).toContain('staff');
    expect(body.data.min_app_version).toBeDefined();
  });

  test('accessible to any authenticated role', async () => {
    for (const role of ['owner', 'admin', 'staff'] as const) {
      const app = setupApp(role);
      const res = await app.request('/api/capabilities');
      expect(res.status).toBe(200);
    }
  });
});
