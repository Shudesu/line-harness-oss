import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  deployPagesProject,
  getLatestDeployment,
  rollbackPagesDeployment,
} from '../../src/cf-api/pages.js';
import type { CfApiCreds } from '../../src/types.js';

const creds: CfApiCreds = {
  accountId: 'acct123',
  apiToken: 'tok_abc',
};

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

describe('deployPagesProject', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('runs full happy path: 4 calls in order, returns { deploymentId, url }', async () => {
    const indexHtml = Buffer.from('<html>hi</html>');
    const appJs = Buffer.from('console.log("ok")');
    const hashIndex = sha256Hex(indexHtml);
    const hashApp = sha256Hex(appJs);

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      // Step 1: upload token
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: { jwt: 'JWT_TOKEN' } }),
      } as Response)
      // Step 3: check-missing
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: [hashIndex, hashApp] }),
      } as Response)
      // Step 4: upload
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response)
      // Step 5: create deployment
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          result: { id: 'DEPLOY_ID', url: 'https://x.pages.dev' },
        }),
      } as Response);

    const result = await deployPagesProject({
      creds,
      projectName: 'myproj',
      files: new Map([
        ['index.html', indexHtml],
        ['app.js', appJs],
      ]),
    });

    expect(result).toEqual({
      deploymentId: 'DEPLOY_ID',
      url: 'https://x.pages.dev',
    });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // Step 1 URL
    const [url1] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url1).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct123/pages/projects/myproj/upload-token',
    );

    // Step 3 URL
    const [url3] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url3).toBe(
      'https://api.cloudflare.com/client/v4/pages/assets/check-missing',
    );

    // Step 4 URL
    const [url4] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(url4).toBe(
      'https://api.cloudflare.com/client/v4/pages/assets/upload',
    );

    // Step 5 URL
    const [url5] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(url5).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct123/pages/projects/myproj/deployments',
    );
  });

  it('skips upload step when no files are missing (3 calls only)', async () => {
    const indexHtml = Buffer.from('<html>hi</html>');

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: { jwt: 'JWT_TOKEN' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        // empty missing array → skip upload
        json: async () => ({ result: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          result: { id: 'DEPLOY_ID2', url: 'https://y.pages.dev' },
        }),
      } as Response);

    const result = await deployPagesProject({
      creds,
      projectName: 'myproj',
      files: new Map([['index.html', indexHtml]]),
    });

    expect(result).toEqual({
      deploymentId: 'DEPLOY_ID2',
      url: 'https://y.pages.dev',
    });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    // Third call should be deployment creation, not upload
    const [thirdUrl] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(thirdUrl).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct123/pages/projects/myproj/deployments',
    );
  });

  it('base64-encodes file content in upload payload', async () => {
    const content = Buffer.from('binary\x00\x01\x02data');
    const hash = sha256Hex(content);

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: { jwt: 'JWT' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: [hash] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: { id: 'D', url: 'https://x.pages.dev' } }),
      } as Response);

    await deployPagesProject({
      creds,
      projectName: 'p',
      files: new Map([['bin.dat', content]]),
    });

    const [, uploadInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    const uploadBody = JSON.parse(uploadInit.body as string);
    expect(Array.isArray(uploadBody.payload)).toBe(true);
    expect(uploadBody.payload).toHaveLength(1);
    const entry = uploadBody.payload[0];
    expect(entry.key).toBe(hash);
    expect(entry.value).toBe(content.toString('base64'));
    expect(entry.base64).toBe(true);
    expect(entry.metadata).toBeDefined();
    expect(entry.metadata.contentType).toBe('application/octet-stream');
  });

  it('uploads missing assets in batches of at most 50', async () => {
    const files = new Map<string, Buffer>();
    const hashes: string[] = [];
    for (let i = 0; i < 51; i++) {
      const content = Buffer.from(`file-${i}`);
      files.set(`asset-${i}.txt`, content);
      hashes.push(sha256Hex(content));
    }

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: { jwt: 'JWT' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: hashes }),
      } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: { id: 'D', url: 'https://x.pages.dev' } }),
      } as Response);

    await deployPagesProject({ creds, projectName: 'p', files });

    const [, firstUpload] = fetchMock.mock.calls[2] as [string, RequestInit];
    const [, secondUpload] = fetchMock.mock.calls[3] as [string, RequestInit];
    expect(JSON.parse(firstUpload.body as string).payload).toHaveLength(50);
    expect(JSON.parse(secondUpload.body as string).payload).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(5);
  });

  it('retries a transient Pages asset upload 5xx', async () => {
    const content = Buffer.from('retry me');
    const hash = sha256Hex(content);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: { jwt: 'JWT' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: [hash] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'temporary failure',
      } as Response)
      .mockResolvedValueOnce({ ok: true, status: 200 } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: { id: 'D', url: 'https://x.pages.dev' } }),
      } as Response);

    await deployPagesProject({
      creds,
      projectName: 'p',
      files: new Map([['index.html', content]]),
    });

    const uploadCalls = fetchMock.mock.calls.filter(
      ([url]) => url === 'https://api.cloudflare.com/client/v4/pages/assets/upload',
    );
    expect(uploadCalls).toHaveLength(2);
  });

  it('sends manifest with /{path} → hash mapping in final FormData', async () => {
    const indexHtml = Buffer.from('<html/>');
    const appJs = Buffer.from('x');
    const hashIndex = sha256Hex(indexHtml);
    const hashApp = sha256Hex(appJs);

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: { jwt: 'JWT' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: [] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: { id: 'D', url: 'https://x.pages.dev' } }),
      } as Response);

    await deployPagesProject({
      creds,
      projectName: 'p',
      files: new Map([
        ['index.html', indexHtml],
        ['assets/app.js', appJs],
      ]),
      branch: 'main',
    });

    const [, deployInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    const fd = deployInit.body as FormData;
    expect(fd).toBeInstanceOf(FormData);

    const manifestRaw = fd.get('manifest');
    expect(typeof manifestRaw).toBe('string');
    const manifest = JSON.parse(manifestRaw as string);
    expect(manifest).toEqual({
      '/index.html': hashIndex,
      '/assets/app.js': hashApp,
    });

    expect(fd.get('branch')).toBe('main');
  });

  it('uses JWT for check-missing & upload, API token for token & deployment calls', async () => {
    const content = Buffer.from('a');
    const hash = sha256Hex(content);

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: { jwt: 'JWT_TOKEN' } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: [hash] }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ result: { id: 'D', url: 'https://x.pages.dev' } }),
      } as Response);

    await deployPagesProject({
      creds,
      projectName: 'p',
      files: new Map([['a.txt', content]]),
    });

    const authOf = (idx: number): string => {
      const [, init] = fetchMock.mock.calls[idx] as [string, RequestInit];
      const headers = init.headers as Record<string, string>;
      return headers['Authorization'];
    };

    // Step 1: API token
    expect(authOf(0)).toBe('Bearer tok_abc');
    // Step 3: JWT
    expect(authOf(1)).toBe('Bearer JWT_TOKEN');
    // Step 4: JWT
    expect(authOf(2)).toBe('Bearer JWT_TOKEN');
    // Step 5: API token
    expect(authOf(3)).toBe('Bearer tok_abc');
  });

  it('throws on empty files map without calling fetch', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await expect(
      deployPagesProject({
        creds,
        projectName: 'p',
        files: new Map(),
      }),
    ).rejects.toThrow(/files map is empty/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects path traversal segments', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await expect(
      deployPagesProject({
        creds,
        projectName: 'p',
        files: new Map([['../etc/passwd', Buffer.from('x')]]),
      }),
    ).rejects.toThrow(/invalid path/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects empty path key', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    await expect(
      deployPagesProject({
        creds,
        projectName: 'p',
        files: new Map([['', Buffer.from('x')]]),
      }),
    ).rejects.toThrow(/invalid path/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('getLatestDeployment', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns the first deployment entry from the list', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        result: [
          { id: 'newest', created_on: '2026-05-12T00:00:00Z' },
          { id: 'older', created_on: '2026-05-11T00:00:00Z' },
        ],
      }),
    } as Response);

    const result = await getLatestDeployment({
      creds,
      projectName: 'myproj',
    });

    expect(result).toEqual({ id: 'newest' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct123/pages/projects/myproj/deployments?per_page=1',
    );
    expect((init.method ?? 'GET').toUpperCase()).toBe('GET');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok_abc');
  });

  it('throws on 500', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'server error',
    } as Response);

    await expect(
      getLatestDeployment({ creds, projectName: 'myproj' }),
    ).rejects.toThrow(/HTTP 500/);
  });
});

describe('rollbackPagesDeployment', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('POSTs to correct URL with API token', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true }),
    } as Response);

    await rollbackPagesDeployment({
      creds,
      projectName: 'myproj',
      deploymentId: 'dep_xyz',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct123/pages/projects/myproj/deployments/dep_xyz/rollback',
    );
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok_abc');
  });

  it('throws on non-2xx', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      text: async () => 'not found',
    } as Response);

    await expect(
      rollbackPagesDeployment({
        creds,
        projectName: 'myproj',
        deploymentId: 'missing',
      }),
    ).rejects.toThrow(/HTTP 404/);
  });
});
