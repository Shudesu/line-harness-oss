import { describe, expect, test, vi } from 'vitest';
import { replyViaHarnessProxy } from './line-proxy-send.js';

describe('replyViaHarnessProxy', () => {
  test('sends reply messages through the Harness proxy endpoint', async () => {
    let captured: Request | null = null;
    const dispatch = vi.fn(async (request: Request) => {
      captured = request;
      return new Response('{}', { status: 200 });
    });

    await replyViaHarnessProxy(
      'https://worker.example.com/',
      'channel-token',
      'reply-token',
      [{ type: 'text', text: 'マイルはこちらです' }],
      dispatch,
    );

    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(captured).not.toBeNull();
    expect(captured!.url).toBe('https://worker.example.com/line-api/v2/bot/message/reply');
    expect(captured!.headers.get('Authorization')).toBe('Bearer channel-token');
    await expect(captured!.json()).resolves.toEqual({
      replyToken: 'reply-token',
      messages: [{ type: 'text', text: 'マイルはこちらです' }],
    });
  });

  test('surfaces proxy failures without retrying a one-time reply token', async () => {
    const dispatch = vi.fn().mockResolvedValue(
      new Response('{"message":"invalid reply token"}', { status: 400, statusText: 'Bad Request' }),
    );

    await expect(
      replyViaHarnessProxy(
        'https://worker.example.com',
        'channel-token',
        'used-token',
        [{ type: 'text', text: 'test' }],
        dispatch,
      ),
    ).rejects.toThrow('LINE Harness proxy error: 400 Bad Request');
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
