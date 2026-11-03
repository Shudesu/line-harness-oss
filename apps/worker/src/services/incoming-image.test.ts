import { describe, test, expect, vi } from 'vitest';
import { fetchAndStoreIncomingImage } from './incoming-image.js';

function makeR2Stub() {
  const store = new Map<string, { data: ArrayBuffer; contentType: string }>();
  return {
    put: vi.fn(async (key: string, data: ArrayBuffer, opts: { httpMetadata?: { contentType?: string } }) => {
      store.set(key, { data, contentType: opts.httpMetadata?.contentType ?? '' });
      return null;
    }),
    _store: store,
  };
}

describe('fetchAndStoreIncomingImage', () => {
  test('Content API 成功時に R2 PUT して URL を返す', async () => {
    const r2 = makeR2Stub();
    const fetchMock = vi.fn(async () =>
      new Response(new ArrayBuffer(100), {
        status: 200,
        headers: { 'Content-Type': 'image/jpeg' },
      }),
    );

    const result = await fetchAndStoreIncomingImage({
      r2: r2 as unknown as R2Bucket,
      fetch: fetchMock,
      workerUrl: 'https://worker.example.com',
      channelAccessToken: 'token-abc',
      accountId: 'acc-1',
      messageId: 'msg-xyz',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api-data.line.me/v2/bot/message/msg-xyz/content',
      expect.objectContaining({
        headers: { Authorization: 'Bearer token-abc' },
      }),
    );
    expect(r2.put).toHaveBeenCalled();
    const [key, , opts] = r2.put.mock.calls[0];
    expect(key).toMatch(/^incoming-[0-9a-f]{64}\.jpg$/);
    expect(opts.httpMetadata?.contentType).toBe('image/jpeg');
    expect(result?.originalContentUrl).toBe(`https://worker.example.com/api/incoming-images/${key}`);
    expect(result?.previewImageUrl).toBe(result?.originalContentUrl);
  });

  test('Content API が非 200 を返したら null', async () => {
    const r2 = makeR2Stub();
    const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));

    const result = await fetchAndStoreIncomingImage({
      r2: r2 as unknown as R2Bucket,
      fetch: fetchMock,
      workerUrl: 'https://worker.example.com',
      channelAccessToken: 'token-bad',
      accountId: 'acc-1',
      messageId: 'msg-y',
    });

    expect(result).toBeNull();
    expect(r2.put).not.toHaveBeenCalled();
  });

  test('R2 PUT が throw したら null', async () => {
    const r2 = makeR2Stub();
    r2.put.mockRejectedValueOnce(new Error('R2 down'));
    const fetchMock = vi.fn(async () =>
      new Response(new ArrayBuffer(50), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }),
    );

    const result = await fetchAndStoreIncomingImage({
      r2: r2 as unknown as R2Bucket,
      fetch: fetchMock,
      workerUrl: 'https://worker.example.com',
      channelAccessToken: 'token-abc',
      accountId: 'acc-1',
      messageId: 'msg-z',
    });

    expect(result).toBeNull();
  });

  test('Content-Type から拡張子を判定 (png)', async () => {
    const r2 = makeR2Stub();
    const fetchMock = vi.fn(async () =>
      new Response(new ArrayBuffer(50), {
        status: 200,
        headers: { 'Content-Type': 'image/png' },
      }),
    );

    await fetchAndStoreIncomingImage({
      r2: r2 as unknown as R2Bucket,
      fetch: fetchMock,
      workerUrl: 'https://worker.example.com',
      channelAccessToken: 'token-abc',
      accountId: 'a',
      messageId: 'm-png',
    });

    const [key] = r2.put.mock.calls[0];
    expect(key).toMatch(/^incoming-[0-9a-f]{64}\.png$/);
  });
  test('同じイベントの再試行は同じキー、別アカウントは別キー', async () => {
    const r2 = makeR2Stub();
    const options = {
      r2: r2 as unknown as R2Bucket,
      fetch: vi.fn(async () => new Response(new ArrayBuffer(1), { headers: { 'Content-Type': 'image/png' } })),
      workerUrl: 'https://worker.example.com', channelAccessToken: 'token', accountId: 'a', messageId: 'm',
    };
    const first = await fetchAndStoreIncomingImage(options);
    expect(await fetchAndStoreIncomingImage(options)).toEqual(first);
    expect(await fetchAndStoreIncomingImage({ ...options, accountId: 'b' })).not.toEqual(first);
    expect(r2._store.size).toBe(2);
  });

});
