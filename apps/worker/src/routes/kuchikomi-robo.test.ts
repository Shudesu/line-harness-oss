import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { kuchikomiRobo } from './kuchikomi-robo.js';

function setupApp() {
  const app = new Hono();
  app.route('/', kuchikomiRobo);
  return app;
}

function fakeDb(): D1Database {
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        async first<T>(): Promise<T | null> {
          return {
            id: 'friend-1',
            line_user_id: 'U123',
            display_name: '山田 太郎',
            metadata: JSON.stringify({ phone: '09000000000' }),
          } as T;
        },
      };
    },
  } as unknown as D1Database;
}

const baseEnv = {
  DB: fakeDb(),
  KUCHIKOMI_ROBO_WEBHOOK_URL: 'https://kuchikomi.example.test/webhook',
  KUCHIKOMI_ROBO_API_KEY: 'secret-token',
  KUCHIKOMI_ROBO_SHARED_SECRET: 'shared-secret',
  KUCHIKOMI_ROBO_STORE_ID: 'store-1',
} as Record<string, unknown>;

describe('Kuchikomi Robo routes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reports configuration without exposing secret values', async () => {
    const app = setupApp();
    const res = await app.request('/api/integrations/kuchikomi-robo/status', {}, baseEnv);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      success: boolean;
      data: { configured: boolean; hasApiKey: boolean; hasSharedSecret: boolean; defaultStoreId: string };
    };
    expect(body).toEqual({
      success: true,
      data: {
        configured: true,
        hasApiKey: true,
        hasSharedSecret: true,
        defaultStoreId: 'store-1',
      },
    });
  });

  it('delivers an authenticated review request payload', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('accepted', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    const app = setupApp();
    const res = await app.request(
      '/api/integrations/kuchikomi-robo/review-request',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          friendId: 'friend-1',
          trigger: 'manual',
          metadata: { operator: 'owner' },
        }),
      },
      baseEnv,
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toMatchObject({
      source: 'line-harness',
      event: 'review_request',
      storeId: 'store-1',
      customer: {
        friendId: 'friend-1',
        lineUserId: 'U123',
        displayName: '山田 太郎',
      },
      context: {
        trigger: 'manual',
        metadata: { operator: 'owner', phone: '09000000000' },
      },
    });
  });

  it('returns 503 when the delivery endpoint is not configured', async () => {
    const app = setupApp();
    const res = await app.request(
      '/api/integrations/kuchikomi-robo/review-request',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendId: 'friend-1' }),
      },
      { DB: fakeDb() } as Record<string, unknown>,
    );

    expect(res.status).toBe(503);
    const body = await res.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/KUCHIKOMI_ROBO_WEBHOOK_URL/);
  });
});

