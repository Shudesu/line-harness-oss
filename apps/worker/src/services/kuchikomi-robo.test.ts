import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildKuchikomiRoboReviewRequest,
  sendKuchikomiRoboReviewRequest,
} from './kuchikomi-robo.js';

vi.mock('@line-crm/db', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@line-crm/db');
  return {
    ...actual,
    jstNow: () => '2026-06-22T13:00:00.000+09:00',
  };
});

function fakeDb(friend: {
  id: string;
  line_user_id: string | null;
  display_name: string | null;
  metadata: string | null;
} | null): D1Database {
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        async first<T>(): Promise<T | null> {
          return friend as T | null;
        },
      };
    },
  } as unknown as D1Database;
}

describe('Kuchikomi Robo integration service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds a review request from a LINE Harness friend and metadata', async () => {
    const request = await buildKuchikomiRoboReviewRequest(
      fakeDb({
        id: 'friend-1',
        line_user_id: 'U123',
        display_name: '山田 太郎',
        metadata: JSON.stringify({ phone: '09000000000', email: 'taro@example.com' }),
      }),
      {
        friendId: 'friend-1',
        trigger: 'booking_completed',
        reviewUrl: 'https://g.page/r/example/review',
        metadata: { bookingId: 'booking-1' },
      },
      { defaultStoreId: 'store-default' },
    );

    expect(request).toMatchObject({
      source: 'line-harness',
      event: 'review_request',
      storeId: 'store-default',
      customer: {
        friendId: 'friend-1',
        lineUserId: 'U123',
        displayName: '山田 太郎',
        phone: '09000000000',
        email: 'taro@example.com',
      },
      context: {
        trigger: 'booking_completed',
        reviewUrl: 'https://g.page/r/example/review',
      },
    });
    expect(request.context.metadata).toMatchObject({ bookingId: 'booking-1' });
  });

  it('sends bearer-authenticated and signed webhook delivery', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 202 }));
    vi.stubGlobal('fetch', fetchMock);

    await sendKuchikomiRoboReviewRequest(
      {
        KUCHIKOMI_ROBO_WEBHOOK_URL: 'https://kuchikomi.example.test/webhook',
        KUCHIKOMI_ROBO_API_KEY: 'token-1',
        KUCHIKOMI_ROBO_SHARED_SECRET: 'secret-1',
        KUCHIKOMI_ROBO_STORE_ID: 'store-1',
      },
      {
        source: 'line-harness',
        event: 'review_request',
        timestamp: '2026-06-22T13:00:00.000+09:00',
        customer: { friendId: 'friend-1' },
        context: {},
      },
    );

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://kuchikomi.example.test/webhook');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer token-1');
    expect(headers['X-Webhook-Signature']).toMatch(/^[0-9a-f]{64}$/);
    expect(headers['X-Line-Harness-Signature']).toBe(`sha256=${headers['X-Webhook-Signature']}`);
    expect(JSON.parse(init.body as string)).toMatchObject({
      source: 'line-harness',
      event: 'review_request',
      storeId: 'store-1',
      customer: { friendId: 'friend-1' },
    });
  });

  it('fails closed when the delivery endpoint is not configured', async () => {
    await expect(
      sendKuchikomiRoboReviewRequest(
        {},
        {
          source: 'line-harness',
          event: 'review_request',
          timestamp: '2026-06-22T13:00:00.000+09:00',
          customer: { friendId: 'friend-1' },
          context: {},
        },
      ),
    ).rejects.toThrow(/KUCHIKOMI_ROBO_WEBHOOK_URL/);
  });
});

