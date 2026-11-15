import { beforeEach, describe, expect, test, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  getSignatureFailureWindow: vi.fn(),
  getSignatureSuccessAt: vi.fn(),
  getTokenRefreshFailureWindow: vi.fn(),
  getTokenUnauthorizedWindow: vi.fn(),
  getWebhookEndpointCheck: vi.fn(),
  getWebhookTest: vi.fn(),
  jstNow: vi.fn(() => '2026-11-16T12:00:00.000+09:00'),
  UNATTRIBUTED_ACCOUNT_ID: '__unattributed__',
  recordWebhookEndpointCheck: vi.fn().mockResolvedValue(undefined),
  recordWebhookTest: vi.fn().mockResolvedValue(undefined),
  probeWebhookEndpoint: vi.fn(),
}));

vi.mock('@line-crm/db', () => dbMocks);
vi.mock('./webhook-endpoint.js', () => ({ probeWebhookEndpoint: dbMocks.probeWebhookEndpoint }));

import { buildConnectionHealth } from './connection-health.js';

const ACCOUNT = { id: 'acc-1', name: 'メイン' } as never;

function healthyState() {
  dbMocks.getSignatureFailureWindow.mockResolvedValue({ failures: 0, lastAt: null, lastReason: null });
  dbMocks.getSignatureSuccessAt.mockResolvedValue('2026-11-16T11:30:00.000+09:00');
  dbMocks.getTokenRefreshFailureWindow.mockResolvedValue({ failures: 0, lastAt: null, lastReason: null });
  dbMocks.getTokenUnauthorizedWindow.mockResolvedValue({ failures: 0, lastAt: null, lastReason: null });
  dbMocks.getWebhookEndpointCheck.mockResolvedValue({
    checkedAt: '2026-11-16T10:00:00.000+09:00',
    endpoint: 'https://worker.example.test/webhook',
    expectedUrl: 'https://worker.example.test/webhook',
    matches: true,
    active: true,
  });
  dbMocks.getWebhookTest.mockResolvedValue({
    checkedAt: '2026-11-16T10:00:00.000+09:00',
    success: true,
    message: null,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  healthyState();
});

describe('buildConnectionHealth — PLAN.md 1-1 contract', () => {
  test('a healthy account returns ok with the five stable check ids', async () => {
    const health = await buildConnectionHealth({} as D1Database, ACCOUNT);

    expect(health.platform).toBe('line');
    expect(health.overall).toBe('ok');
    expect(health.checks.map((c) => c.id)).toEqual([
      'line.webhook.signature',
      'line.token.refresh',
      'line.bot_info',
      'line.webhook.endpoint',
      'line.webhook.test',
    ]);
    for (const check of health.checks) {
      expect(check.status).toBe('ok');
      expect(typeof check.summary).toBe('string');
      expect(check.evidence).toBeDefined();
    }
  });

  test('signature failures with no successful receive are a fail with a human_console nextAction', async () => {
    dbMocks.getSignatureFailureWindow.mockResolvedValue({
      failures: 41,
      lastAt: '2026-11-16T11:40:00.000+09:00',
      lastReason: 'unverified',
    });
    // 直近の成功受信が無いことが fail 条件なので、success 記録を消す。
    dbMocks.getSignatureSuccessAt.mockResolvedValue(null);

    const health = await buildConnectionHealth({} as D1Database, ACCOUNT);
    const signature = health.checks.find((c) => c.id === 'line.webhook.signature')!;

    expect(signature.status).toBe('fail');
    expect(signature.summary).toContain('41');
    expect(signature.evidence).toMatchObject({ failures1h: 41, lastSuccessAt: null });
    expect(signature.nextAction).toMatchObject({ kind: 'human_console' });
    expect(health.overall).toBe('fail');
  });

  test('a token refresh failure and a 401 surface as their own failing checks', async () => {
    dbMocks.getTokenRefreshFailureWindow.mockResolvedValue({
      failures: 3,
      lastAt: '2026-11-16T09:00:00.000+09:00',
      lastReason: '400',
    });
    dbMocks.getTokenUnauthorizedWindow.mockResolvedValue({
      failures: 2,
      lastAt: '2026-11-16T11:50:00.000+09:00',
      lastReason: null,
    });

    const health = await buildConnectionHealth({} as D1Database, ACCOUNT);
    expect(health.checks.find((c) => c.id === 'line.token.refresh')!.status).toBe('fail');
    expect(health.checks.find((c) => c.id === 'line.bot_info')!.status).toBe('fail');
  });

  test('a foreign webhook endpoint is a fail whose nextAction is the confirm-gated fix tool', async () => {
    dbMocks.getWebhookEndpointCheck.mockResolvedValue({
      checkedAt: '2026-11-16T10:00:00.000+09:00',
      endpoint: 'https://someone-else.example/webhook',
      expectedUrl: 'https://worker.example.test/webhook',
      matches: false,
      active: true,
    });

    const health = await buildConnectionHealth({} as D1Database, ACCOUNT);
    const endpoint = health.checks.find((c) => c.id === 'line.webhook.endpoint')!;

    expect(endpoint.status).toBe('fail');
    expect(endpoint.nextAction).toMatchObject({
      kind: 'approve',
      tool: 'manage_webhook_endpoint',
      args: { action: 'set', accountId: 'acc-1' },
    });
  });

  test('unprobed webhook endpoint/test are manual, not silently ok', async () => {
    dbMocks.getWebhookEndpointCheck.mockResolvedValue(null);
    dbMocks.getWebhookTest.mockResolvedValue(null);

    const health = await buildConnectionHealth({} as D1Database, ACCOUNT);
    expect(health.checks.find((c) => c.id === 'line.webhook.endpoint')!.status).toBe('manual');
    expect(health.checks.find((c) => c.id === 'line.webhook.test')!.status).toBe('manual');
  });

  test('refresh=true re-runs the live probe before reading the stored records', async () => {
    const client = {
      getWebhookEndpoint: vi.fn(),
      testWebhookEndpoint: vi.fn(),
    };
    await buildConnectionHealth({} as D1Database, ACCOUNT, {
      refresh: true,
      client,
      expectedUrl: 'https://worker.example.test/webhook',
    });

    expect(dbMocks.probeWebhookEndpoint).toHaveBeenCalledWith(
      expect.anything(),
      client,
      'acc-1',
      'https://worker.example.test/webhook',
    );
  });

  test('a probe failure without an HTTP status (network error) is unknown, not ok', async () => {
    // Connection exceptions carry no errorStatus — matches:null must map to
    // 'unknown' on its own, never silently to a healthy endpoint check.
    dbMocks.getWebhookEndpointCheck.mockResolvedValue({
      checkedAt: '2026-11-16T10:00:00.000+09:00',
      endpoint: '',
      expectedUrl: 'https://worker.example.test/webhook',
      matches: null,
      active: null,
    });

    const health = await buildConnectionHealth({} as D1Database, ACCOUNT);
    const endpoint = health.checks.find((c) => c.id === 'line.webhook.endpoint')!;

    expect(endpoint.status).toBe('unknown');
    expect(health.overall).toBe('warn');
  });

  test('a webhook test that could not be executed (success null) is unknown, not fail', async () => {
    dbMocks.getWebhookTest.mockResolvedValue({
      checkedAt: '2026-11-16T10:00:00.000+09:00',
      success: null,
      message: null,
    });

    const health = await buildConnectionHealth({} as D1Database, ACCOUNT);
    const testCheck = health.checks.find((c) => c.id === 'line.webhook.test')!;

    expect(testCheck.status).toBe('unknown');
    expect(health.overall).toBe('warn');
  });

  test('signature failures that match no registered secret surface as an unattributed warn check', async () => {
    dbMocks.getSignatureFailureWindow
      .mockResolvedValueOnce({ failures: 0, lastAt: null, lastReason: null }) // this account
      .mockResolvedValueOnce({
        failures: 7,
        lastAt: '2026-11-16T11:58:00.000+09:00',
        lastReason: 'unverified',
      }); // __unattributed__

    const health = await buildConnectionHealth({} as D1Database, ACCOUNT);
    expect(health.checks.map((c) => c.id)).toContain('line.webhook.signature.unattributed');
    const unattributed = health.checks.find(
      (c) => c.id === 'line.webhook.signature.unattributed',
    )!;
    expect(unattributed.status).toBe('warn');
    expect(unattributed.evidence).toMatchObject({ failures1h: 7 });
    // getSignatureFailureWindow must be asked for the unattributed sentinel too.
    expect(dbMocks.getSignatureFailureWindow).toHaveBeenCalledWith(
      expect.anything(),
      '__unattributed__',
      1,
    );
  });
});
