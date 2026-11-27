import { afterEach, describe, expect, test, vi } from 'vitest';
import { LineApiError, LineClient } from '@line-crm/line-sdk';

describe('LineClient retry keys', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('sends X-Line-Retry-Key for push and omits undefined body fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new LineClient('token');
    await client.pushMessage('U1', [{ type: 'text', text: 'hello' }], '123e4567-e89b-12d3-a456-426614174000');

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)['X-Line-Retry-Key'])
      .toBe('123e4567-e89b-12d3-a456-426614174000');
    expect(JSON.parse(init.body as string)).toEqual({
      to: 'U1',
      messages: [{ type: 'text', text: 'hello' }],
    });
  });

  test.each(['push', 'multicast', 'broadcast'] as const)(
    'treats %s retry-key 409 with an accepted request ID as success', async (method) => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"conflict"}', {
        status: 409,
        headers: {
          'Content-Type': 'application/json',
          'x-line-accepted-request-id': 'accepted-original-request',
          'x-line-request-id': 'retry-attempt-request',
        },
      })));

      const client = new LineClient('token');
      const messages = [{ type: 'text' as const, text: 'hello' }];
      const retryKey = '123e4567-e89b-12d3-a456-426614174000';
      if (method === 'push') {
        await expect(client.pushMessage('U1', messages, retryKey))
          .resolves.toEqual({ retryAccepted: true });
      } else if (method === 'multicast') {
        await expect(client.multicast(['U1'], messages, undefined, retryKey))
          .resolves.toEqual({ data: { retryAccepted: true }, requestId: 'accepted-original-request' });
      } else {
        await expect(client.broadcast(messages, retryKey))
          .resolves.toEqual({ data: { retryAccepted: true }, requestId: 'accepted-original-request' });
      }
    },
  );

  test.each(['multicast', 'broadcast'] as const)(
    'preserves the normal %s request ID for insight tracking', async (method) => {
      const fetchMock = vi.fn().mockResolvedValue(new Response('{}', {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-line-request-id': 'normal-request',
        },
      }));
      vi.stubGlobal('fetch', fetchMock);
      const client = new LineClient('token');
      const messages = [{ type: 'text' as const, text: 'hello' }];
      const result = method === 'multicast'
        ? await client.multicast(['U1'], messages)
        : await client.broadcast(messages);
      expect(result).toEqual({ data: {}, requestId: 'normal-request' });
      expect((fetchMock.mock.calls[0][1].headers as Record<string, string>)['X-Line-Retry-Key'])
        .toBeUndefined();
    },
  );

  test('uses the accepted broadcast request ID to retrieve its insight', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('conflict', {
        status: 409,
        headers: {
          'x-line-request-id': 'retry-attempt-request',
          'x-line-accepted-request-id': 'accepted-original-request',
        },
      }))
      .mockResolvedValueOnce(new Response('{"overview":{"delivered":30}}', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new LineClient('token');
    const result = await client.broadcast([{ type: 'text', text: 'hello' }],
      '123e4567-e89b-12d3-a456-426614174000');
    await expect(client.getMessageEventInsight(result.requestId!))
      .resolves.toEqual({ overview: { delivered: 30 } });
    expect(fetchMock.mock.calls[1][0])
      .toBe('https://api.line.me/v2/bot/insight/message/event?requestId=accepted-original-request');
  });

  test.each([undefined, ''])(
    'rejects 409 when accepted request ID is %s', async (acceptedRequestId) => {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (acceptedRequestId !== undefined) headers['x-line-accepted-request-id'] = acceptedRequestId;
      const body = '{"message":"unconfirmed conflict"}';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, {
        status: 409,
        statusText: 'Conflict',
        headers,
      })));

      const result = new LineClient('token').pushMessage(
        'U1', [{ type: 'text', text: 'hello' }], '123e4567-e89b-12d3-a456-426614174000',
      );
      await expect(result).rejects.toBeInstanceOf(LineApiError);
      await expect(result).rejects.toMatchObject({ status: 409, responseBody: body });
    },
  );

  test('rejects 409 without a retry key even if accepted request ID is present', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('conflict', {
      status: 409,
      headers: { 'x-line-accepted-request-id': 'accepted-original-request' },
    })));
    await expect(new LineClient('token').pushMessage('U1', [{ type: 'text', text: 'hello' }]))
      .rejects.toMatchObject({ status: 409, responseBody: 'conflict' });
  });

  test.each([400, 429, 500])('rejects status %s despite retry key and accepted ID', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('request failed', {
      status,
      headers: { 'x-line-accepted-request-id': 'accepted-original-request' },
    })));
    await expect(new LineClient('token').pushMessage(
      'U1', [{ type: 'text', text: 'hello' }], '123e4567-e89b-12d3-a456-426614174000',
    )).rejects.toMatchObject({ status, responseBody: 'request failed' });
  });
});
