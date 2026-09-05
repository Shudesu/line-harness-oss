import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getWorkersSubdomain,
  putWorkersSubdomain,
  SubdomainConflictError,
} from '../../src/cf-api/subdomain.js';
import type { CfApiCreds } from '../../src/types.js';

const creds: CfApiCreds = {
  accountId: 'acct123',
  apiToken: 'tok_abc',
};

function mockResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  } as Response;
}

describe('getWorkersSubdomain', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('returns the registered subdomain name', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      mockResponse(200, { success: true, result: { subdomain: 'example' } }),
    );

    await expect(getWorkersSubdomain({ creds })).resolves.toBe('example');

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct123/workers/subdomain',
    );
    expect(init.method).toBe('GET');
    expect(init.headers.Authorization).toBe('Bearer tok_abc');
  });

  it('returns null when the account has no subdomain (404 + code 10007)', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      mockResponse(404, {
        success: false,
        errors: [{ code: 10007, message: 'workers.api.error.subdomain_not_found' }],
        result: null,
      }),
    );

    await expect(getWorkersSubdomain({ creds })).resolves.toBeNull();
  });

  it('returns null when the API answers 200 with a null subdomain', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      mockResponse(200, { success: true, result: { subdomain: null } }),
    );

    await expect(getWorkersSubdomain({ creds })).resolves.toBeNull();
  });

  it('throws on auth errors instead of reporting "unregistered"', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      mockResponse(403, {
        success: false,
        errors: [{ code: 10000, message: 'Authentication error' }],
      }),
    );

    await expect(getWorkersSubdomain({ creds })).rejects.toThrow(/HTTP 403/);
  });

  it('throws on a non-JSON 5xx body without crashing the parser', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(mockResponse(502, '<html>Bad Gateway</html>'));

    await expect(getWorkersSubdomain({ creds })).rejects.toThrow(/HTTP 502/);
  });
});

describe('putWorkersSubdomain', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('registers the subdomain with a JSON body', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      mockResponse(200, { success: true, result: { subdomain: 'example' } }),
    );

    await expect(
      putWorkersSubdomain({ creds, subdomain: 'example' }),
    ).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct123/workers/subdomain',
    );
    expect(init.method).toBe('PUT');
    expect(init.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body)).toEqual({ subdomain: 'example' });
  });

  it('throws SubdomainConflictError on code 10031 (name taken)', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      mockResponse(400, {
        success: false,
        errors: [{ code: 10031, message: 'workers.api.error.subdomain_unavailable' }],
      }),
    );

    await expect(
      putWorkersSubdomain({ creds, subdomain: 'taken' }),
    ).rejects.toBeInstanceOf(SubdomainConflictError);
  });

  it('throws SubdomainConflictError on HTTP 409', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      mockResponse(409, { success: false, errors: [{ message: 'conflict' }] }),
    );

    await expect(
      putWorkersSubdomain({ creds, subdomain: 'taken' }),
    ).rejects.toBeInstanceOf(SubdomainConflictError);
  });

  it('throws a plain Error on other failures (e.g. missing permission)', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      mockResponse(403, {
        success: false,
        errors: [{ code: 10000, message: 'Authentication error' }],
      }),
    );

    const err = await putWorkersSubdomain({ creds, subdomain: 'x' }).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(SubdomainConflictError);
    expect(err.message).toMatch(/HTTP 403/);
  });
});
