import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  putWorkerScript,
  getWorkerScriptContent,
  listWorkerBindings,
  getLatestWorkerDeployment,
  deployWorkerVersion,
  type WorkerBinding,
} from '../../src/cf-api/workers.js';
import type { CfApiCreds } from '../../src/types.js';

const creds: CfApiCreds = {
  accountId: 'acct123',
  apiToken: 'tok_abc',
};

describe('putWorkerScript', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('calls correct URL with PUT, Bearer auth, multipart FormData', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, result: {} }),
    } as Response);

    await putWorkerScript({
      creds,
      scriptName: 'myname',
      scriptContent: Buffer.from('export default { fetch() {} }'),
      bindings: [],
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct123/workers/scripts/myname',
    );
    expect(init.method).toBe('PUT');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok_abc');
    expect(init.body).toBeInstanceOf(FormData);
  });

  it('includes metadata JSON with bindings, main_module, and compatibility_date', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, result: {} }),
    } as Response);

    const bindings: WorkerBinding[] = [
      { type: 'plain_text', name: 'API_URL', text: 'https://example.com' },
      { type: 'd1', name: 'DB', database_id: 'db123' },
      { type: 'r2_bucket', name: 'BUCKET', bucket_name: 'my-bucket' },
      { type: 'kv_namespace', name: 'KV', namespace_id: 'ns123' },
    ];

    await putWorkerScript({
      creds,
      scriptName: 'myname',
      scriptContent: Buffer.from('hello'),
      bindings,
      compatibilityDate: '2025-01-15',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const fd = init.body as FormData;
    const metadataBlob = fd.get('metadata');
    expect(metadataBlob).toBeTruthy();
    const metadataText = await (metadataBlob as Blob).text();
    const parsed = JSON.parse(metadataText);
    expect(parsed.main_module).toBe('worker.js');
    expect(parsed.compatibility_date).toBe('2025-01-15');
    expect(parsed.bindings).toEqual(bindings);
  });

  it('defaults compatibility_date when not provided', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, result: {} }),
    } as Response);

    await putWorkerScript({
      creds,
      scriptName: 'w',
      scriptContent: Buffer.from('x'),
      bindings: [],
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const fd = init.body as FormData;
    const metadataText = await (fd.get('metadata') as Blob).text();
    const parsed = JSON.parse(metadataText);
    expect(parsed.compatibility_date).toBe('2024-12-01');
  });

  it('includes the worker.js script content', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, result: {} }),
    } as Response);

    const scriptText = 'export default { fetch() { return new Response("ok"); } }';
    await putWorkerScript({
      creds,
      scriptName: 'myname',
      scriptContent: Buffer.from(scriptText),
      bindings: [],
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const fd = init.body as FormData;
    const scriptPart = fd.get('worker.js');
    expect(scriptPart).toBeInstanceOf(Blob);
    const blob = scriptPart as Blob;
    expect(blob.type).toBe('application/javascript+module');
    const text = await blob.text();
    expect(text).toBe(scriptText);
  });

  it('throws on 403 with informative message', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 403,
      text: async () => '{"errors":[{"message":"forbidden"}]}',
    } as Response);

    await expect(
      putWorkerScript({
        creds,
        scriptName: 'myname',
        scriptContent: Buffer.from('x'),
        bindings: [],
      }),
    ).rejects.toThrow(/PUT worker script failed: HTTP 403/);
  });
});

describe('getWorkerScriptContent', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns response text on 200', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => 'export default { fetch() {} }',
    } as Response);

    const content = await getWorkerScriptContent({
      creds,
      scriptName: 'myname',
    });

    expect(content).toBe('export default { fetch() {} }');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct123/workers/scripts/myname',
    );
    expect(init.method ?? 'GET').toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok_abc');
  });

  it('throws on 404', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'not found',
    } as Response);

    await expect(
      getWorkerScriptContent({ creds, scriptName: 'missing' }),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe('listWorkerBindings', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns the result array', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const bindings: WorkerBinding[] = [
      { type: 'd1', name: 'DB', database_id: 'db1' },
      { type: 'secret_text', name: 'TOKEN' },
    ];
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, result: bindings }),
    } as Response);

    const result = await listWorkerBindings({ creds, scriptName: 'myname' });

    expect(result).toEqual(bindings);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct123/workers/scripts/myname/bindings',
    );
    expect(init.method ?? 'GET').toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok_abc');
  });

  it('throws on non-200', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'oops',
    } as Response);

    await expect(
      listWorkerBindings({ creds, scriptName: 'myname' }),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe('Worker version snapshots', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('selects the newest deployment returned by Cloudflare', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          deployments: [
            {
              id: 'older',
              created_on: '2026-08-01T00:00:00Z',
              versions: [{ version_id: 'v1', percentage: 100 }],
            },
            {
              id: 'newer',
              created_on: '2026-08-02T00:00:00Z',
              versions: [
                { version_id: 'canary', percentage: 20 },
                { version_id: 'stable', percentage: 80 },
              ],
            },
          ],
        },
      }),
    } as Response));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const deployment = await getLatestWorkerDeployment({
      creds,
      scriptName: 'myname',
    });
    expect(deployment.id).toBe('newer');
    expect(deployment.versions[0].version_id).toBe('stable');
  });

  it('redeploys a saved version at 100 percent traffic', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await deployWorkerVersion({
      creds,
      scriptName: 'myname',
      versionId: 'version-123',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/workers/scripts/myname/deployments');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toMatchObject({
      strategy: 'percentage',
      versions: [{ version_id: 'version-123', percentage: 100 }],
    });
  });
});
