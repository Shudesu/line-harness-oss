import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { capabilities } from './capabilities.js';

type TestEnv = {
  Variables: { staff: { id: string; role: 'owner' | 'admin' | 'staff' } };
};

type CapabilitiesResponse = {
  success: boolean;
  data: {
    harness_kind: string;
    harness_version: string;
    api_version: number;
    features: string[];
    min_app_version: string;
    product: string;
    platform: string;
    connectorVersion: string;
    identity: {
      primaryKey: string;
      supportedLinks: string[];
    };
    endpoints: Record<string, string>;
    external_writes: Record<string, string>;
  };
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
    const body = await res.json() as CapabilitiesResponse;
    expect(body.success).toBe(true);
    expect(body.data.harness_kind).toBe('line');
    expect(body.data.harness_version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(body.data.api_version).toBe(2);
    expect(body.data.features).toContain('friends');
    expect(body.data.features).toContain('broadcasts');
    expect(body.data.features).toContain('staff');
    expect(body.data.features).toContain('provider_receipt_v1');
    expect(body.data.features).toContain('dispatch_readback_v1');
    expect(body.data.features).toContain('push_retry_key_v1');
    expect(body.data.features).toContain('account_scope_fingerprint_v1');
    expect(body.data.min_app_version).toBeDefined();
    expect(body.data.product).toBe('line-harness');
    expect(body.data.platform).toBe('line');
    expect(body.data.connectorVersion).toBe('2026-05-20');
    expect(body.data.identity.primaryKey).toBe('line_friend_id');
    expect(body.data.identity.supportedLinks).toContain('x_user_id');
    expect(body.data.identity.supportedLinks).toContain('ig_igsid');
    expect(body.data.endpoints.staffMe).toBe('/api/staff/me');
    expect(body.data.endpoints.trackedLinks).toBe('/api/tracked-links');
    expect(body.data.endpoints.runtimeMessageSend).toBe('/api/runtime/messages:send');
    expect(body.data.endpoints.runtimeAccountScope)
      .toBe('/api/runtime/conversations/:conversationRef/account-scope');
    expect(body.data.endpoints.runtimeDispatchReadback)
      .toBe('/api/runtime/dispatches/:clientRequestId');
    expect(body.data.external_writes.message_send).toBe('provider_receipt_v1');
  });

  test('accessible to any authenticated role', async () => {
    for (const role of ['owner', 'admin', 'staff'] as const) {
      const app = setupApp(role);
      const res = await app.request('/api/capabilities');
      expect(res.status).toBe(200);
    }
  });
});
