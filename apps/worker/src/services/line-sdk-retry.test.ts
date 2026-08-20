import { afterEach, describe, expect, test, vi } from 'vitest';
import { LineClient } from '@line-crm/line-sdk';

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

  test('treats retry-key 409 as an already-accepted success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"conflict"}', {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    })));

    const client = new LineClient('token');
    await expect(client.pushMessage(
      'U1',
      [{ type: 'text', text: 'hello' }],
      '123e4567-e89b-12d3-a456-426614174000',
    )).resolves.toEqual({ retryAccepted: true });
  });
});
