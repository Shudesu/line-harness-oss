import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const lineClientMocks = vi.hoisted(() => ({
  getWebhookEndpoint: vi.fn(),
  setWebhookEndpoint: vi.fn().mockResolvedValue(undefined),
  testWebhookEndpoint: vi.fn(),
}));

const dbMocks = vi.hoisted(() => ({
  getLineAccountById: vi.fn(),
  getLatestRiskLevel: vi.fn().mockResolvedValue('normal'),
  jstNow: vi.fn(() => '2026-11-16T12:00:00.000+09:00'),
  recordWebhookEndpointCheck: vi.fn().mockResolvedValue(undefined),
  recordWebhookTest: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@line-crm/db', () => dbMocks);
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => lineClientMocks),
}));

// Re-import after mock so the module picks up mocked deps.
const { lineAccounts } = await import('./line-accounts.js');

type TestEnv = {
  Variables: { staff: { id: string; role: 'owner' | 'admin' | 'staff' } };
  Bindings: { DB: D1Database; WORKER_URL?: string };
};

const ACCOUNT = {
  id: 'acc-1',
  channel_id: '123',
  name: 'メイン',
  channel_access_token: 'token',
  channel_secret: 'secret',
  is_active: 1,
};

function setupApp(role: 'owner' | 'admin' | 'staff' = 'owner') {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'test-staff', role });
    c.env = { DB: {} as D1Database, WORKER_URL: 'https://worker.example.test' };
    await next();
  });
  app.route('/', lineAccounts);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getLineAccountById.mockResolvedValue(ACCOUNT);
  lineClientMocks.getWebhookEndpoint.mockResolvedValue({
    endpoint: 'https://worker.example.test/webhook',
    active: true,
  });
  lineClientMocks.testWebhookEndpoint.mockResolvedValue({ success: true, message: 'OK' });
});

describe('GET /api/line-accounts/:id/webhook-endpoint (B-10)', () => {
  test('reports a matching active endpoint and records both probe results', async () => {
    const app = setupApp();
    const res = await app.request('/api/line-accounts/acc-1/webhook-endpoint');
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown> };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      expectedUrl: 'https://worker.example.test/webhook',
      endpoint: 'https://worker.example.test/webhook',
      matches: true,
      active: true,
      status: 'ok',
      test: { success: true },
    });
    expect(lineClientMocks.testWebhookEndpoint).toHaveBeenCalledTimes(1);
    expect(dbMocks.recordWebhookEndpointCheck).toHaveBeenCalledWith(
      expect.anything(),
      'acc-1',
      expect.objectContaining({ matches: true, active: true }),
    );
    expect(dbMocks.recordWebhookTest).toHaveBeenCalledWith(
      expect.anything(),
      'acc-1',
      expect.objectContaining({ success: true }),
    );
  });

  test('a foreign endpoint is a fail with a warning and the test is not fired at it', async () => {
    lineClientMocks.getWebhookEndpoint.mockResolvedValue({
      endpoint: 'https://someone-else.example/webhook',
      active: true,
    });

    const app = setupApp();
    const res = await app.request('/api/line-accounts/acc-1/webhook-endpoint');
    const body = (await res.json()) as { data: { matches: boolean; status: string; warning?: string } };

    expect(body.data.matches).toBe(false);
    expect(body.data.status).toBe('fail');
    expect(body.data.warning).toContain('一致しません');
    expect(lineClientMocks.testWebhookEndpoint).not.toHaveBeenCalled();
  });

  test('LINE API failures degrade to unknown instead of throwing', async () => {
    lineClientMocks.getWebhookEndpoint.mockRejectedValue({ status: 401 });

    const app = setupApp();
    const res = await app.request('/api/line-accounts/acc-1/webhook-endpoint');
    const body = (await res.json()) as { data: { status: string } };

    expect(res.status).toBe(200);
    expect(body.data.status).toBe('unknown');
  });
});

describe('PUT /api/line-accounts/:id/webhook-endpoint (B-10)', () => {
  test('refuses to overwrite without confirm and never touches the channel', async () => {
    const app = setupApp();
    const res = await app.request('/api/line-accounts/acc-1/webhook-endpoint', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = (await res.json()) as { success: boolean; requiresConfirm: boolean };

    expect(res.status).toBe(409);
    expect(body.requiresConfirm).toBe(true);
    expect(lineClientMocks.setWebhookEndpoint).not.toHaveBeenCalled();
  });

  test('requires confirm even when the endpoint is empty (a channel mutation either way)', async () => {
    lineClientMocks.getWebhookEndpoint.mockResolvedValue({ endpoint: '', active: false });

    const app = setupApp();
    const res = await app.request('/api/line-accounts/acc-1/webhook-endpoint', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(409);
    expect(lineClientMocks.setWebhookEndpoint).not.toHaveBeenCalled();
  });

  test('sets the Worker URL with confirm=true and returns the post-change probe', async () => {
    // after the PUT, the probe re-reads and now matches
    lineClientMocks.getWebhookEndpoint
      .mockResolvedValueOnce({ endpoint: 'https://someone-else.example/webhook', active: true })
      .mockResolvedValueOnce({ endpoint: 'https://worker.example.test/webhook', active: true });

    const app = setupApp();
    const res = await app.request('/api/line-accounts/acc-1/webhook-endpoint', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    const body = (await res.json()) as { success: boolean; data: { matches: boolean } };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.matches).toBe(true);
    expect(lineClientMocks.setWebhookEndpoint).toHaveBeenCalledWith(
      'https://worker.example.test/webhook',
    );
  });

  test('LINE API errors while setting return 502 without retrying', async () => {
    lineClientMocks.setWebhookEndpoint.mockRejectedValue({ status: 400 });

    const app = setupApp();
    const res = await app.request('/api/line-accounts/acc-1/webhook-endpoint', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });

    expect(res.status).toBe(502);
  });
});
