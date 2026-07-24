import { afterEach, describe, expect, test, vi } from 'vitest';
import { LineClient } from '@line-crm/line-sdk';

const retryKey = '123e4567-e89b-12d3-a456-426614174000';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LineClient.pushMessageWithReceipt', () => {
  test('captures the provider request id and sent message ids on 200', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      sentMessages: [
        { id: '461230966842064897', quoteToken: 'quote-token' },
      ],
    }), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-line-request-id': 'provider-request-1',
      },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new LineClient('channel-token');
    const receipt = await client.pushMessageWithReceipt(
      'Urecipient',
      [{ type: 'text', text: 'hello' }],
      retryKey,
    );

    expect(receipt).toEqual({
      httpStatus: 200,
      providerRequestId: 'provider-request-1',
      acceptedRequestId: null,
      providerMessageIds: ['461230966842064897'],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(new Headers(init.headers).get('x-line-retry-key')).toBe(retryKey);
    expect(new Headers(init.headers).get('authorization')).toBe('Bearer channel-token');
  });

  test('treats LINE 409 retry acknowledgement as the original accepted receipt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      message: 'The retry key is already accepted',
      sentMessages: [{ id: '461230966842064897', quoteToken: 'quote-token' }],
    }), {
      status: 409,
      headers: {
        'content-type': 'application/json',
        'x-line-request-id': 'provider-request-2',
        'x-line-accepted-request-id': 'provider-request-1',
      },
    })));

    const client = new LineClient('channel-token');
    const receipt = await client.pushMessageWithReceipt(
      'Urecipient',
      [{ type: 'text', text: 'hello' }],
      retryKey,
    );

    expect(receipt).toEqual({
      httpStatus: 409,
      providerRequestId: 'provider-request-2',
      acceptedRequestId: 'provider-request-1',
      providerMessageIds: ['461230966842064897'],
    });
  });

  test('does not report provider acceptance without request and message ids', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })));

    const client = new LineClient('channel-token');
    await expect(client.pushMessageWithReceipt(
      'Urecipient',
      [{ type: 'text', text: 'hello' }],
      retryKey,
    )).rejects.toThrow('LINE provider receipt is incomplete');
  });
});
