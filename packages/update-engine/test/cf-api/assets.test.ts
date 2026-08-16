import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  hashWorkerAsset,
  uploadWorkerAssets,
} from '../../src/cf-api/assets.js';

const creds = { accountId: 'acc', apiToken: 'token' };

describe('Workers Assets upload', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('matches Wrangler asset hashing', () => {
    expect(hashWorkerAsset('index.html', Buffer.from('hello'))).toBe(
      'a2b82584e50075886b08927390f2f573',
    );
  });

  it('returns the session JWT when every asset is already uploaded', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: { buckets: [], jwt: 'session-jwt' } }),
    } as Response);

    await expect(
      uploadWorkerAssets({
        creds,
        scriptName: 'worker',
        files: new Map([['index.html', Buffer.from('hello')]]),
      }),
    ).resolves.toBe('session-jwt');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/workers/scripts/worker/assets-upload-session');
    const body = JSON.parse(init.body as string);
    expect(body.manifest['/index.html']).toEqual({
      hash: 'a2b82584e50075886b08927390f2f573',
      size: 5,
    });
    expect(body.manifest['index.html']).toBeUndefined();
  });

  it('normalizes every manifest key to a slash-prefixed URL path', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ result: { buckets: [], jwt: 'session-jwt' } }),
    } as Response);

    await uploadWorkerAssets({
      creds,
      scriptName: 'worker',
      files: new Map([
        ['./index.html', Buffer.from('index')],
        ['assets\\app.js', Buffer.from('app')],
        ['/assets/app.css', Buffer.from('css')],
      ]),
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(Object.keys(body.manifest).sort()).toEqual([
      '/assets/app.css',
      '/assets/app.js',
      '/index.html',
    ]);
  });

  it('uploads requested hashes as base64 and returns the completion JWT', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const hash = hashWorkerAsset('index.html', Buffer.from('hello'));
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: { buckets: [[hash]], jwt: 'session-jwt' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: { jwt: 'completion-jwt' } }),
      } as Response);

    await expect(
      uploadWorkerAssets({
        creds,
        scriptName: 'worker',
        files: new Map([['index.html', Buffer.from('hello')]]),
      }),
    ).resolves.toBe('completion-jwt');

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toContain('/workers/assets/upload?base64=true');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      'Bearer session-jwt',
    );
    const form = init.body as FormData;
    const uploaded = form.get(hash) as Blob;
    expect(await uploaded.text()).toBe(Buffer.from('hello').toString('base64'));
    expect(uploaded.type).toBe('text/html');
  });

  it('refuses an empty asset tree', async () => {
    await expect(
      uploadWorkerAssets({
        creds,
        scriptName: 'worker',
        files: new Map(),
      }),
    ).rejects.toThrow(/empty Workers Assets tree/);
  });
});
