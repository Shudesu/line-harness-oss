import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { executeD1Query } from '../../src/cf-api/d1.js';
import type { CfApiCreds } from '../../src/types.js';

const creds: CfApiCreds = {
  accountId: 'acct123',
  apiToken: 'tok_abc',
};

describe('executeD1Query', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('happy path — executes SQL and returns parsed JSON response', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const apiResponse = {
      success: true,
      result: [
        {
          results: [{ id: 1, name: 'alice' }],
          success: true,
          meta: { duration: 0.5 },
        },
      ],
    };
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => apiResponse,
    } as Response);

    const out = await executeD1Query({
      creds,
      databaseId: 'db123',
      sql: 'SELECT * FROM users WHERE id = ?',
      params: [1],
    });

    expect(out).toEqual(apiResponse);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws on 400 (bad SQL) with informative message', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      text: async () => '{"errors":[{"message":"syntax error near SELEC"}]}',
    } as Response);

    await expect(
      executeD1Query({
        creds,
        databaseId: 'db123',
        sql: 'SELEC * FROM users',
        params: [],
      }),
    ).rejects.toThrow(/D1 query failed HTTP 400/);
  });

  it('throws on 401 (auth failure)', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => '{"errors":[{"message":"unauthorized"}]}',
    } as Response);

    await expect(
      executeD1Query({
        creds,
        databaseId: 'db123',
        sql: 'SELECT 1',
      }),
    ).rejects.toThrow(/D1 query failed HTTP 401/);
  });

  it('passes params array correctly in body', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, result: [] }),
    } as Response);

    await executeD1Query({
      creds,
      databaseId: 'db123',
      sql: 'INSERT INTO t (a, b, c) VALUES (?, ?, ?)',
      params: ['one', 2, true],
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.sql).toBe('INSERT INTO t (a, b, c) VALUES (?, ?, ?)');
    expect(body.params).toEqual(['one', 2, true]);
  });

  it.each([
    { success: false, result: [] },
    { success: true, result: [{ success: false, error: 'sensitive SQL data' }] },
    { success: true, result: null },
  ])('rejects an unsuccessful SQL envelope even with HTTP 200', async (body) => {
    vi.mocked(globalThis.fetch).mockResolvedValue({
      ok: true, status: 200, json: async () => body,
    } as Response);
    await expect(executeD1Query({ creds, databaseId: 'db', sql: 'SELECT 1' }))
      .rejects.toThrow('D1 query returned an unsuccessful SQL result');
  });

  it('defaults params to [] when not provided', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, result: [] }),
    } as Response);

    await executeD1Query({
      creds,
      databaseId: 'db123',
      sql: 'SELECT 1',
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.params).toEqual([]);
  });

  it('uses correct URL with accountId + databaseId interpolation and headers', async () => {
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, result: [] }),
    } as Response);

    await executeD1Query({
      creds,
      databaseId: 'db_xyz',
      sql: 'SELECT 1',
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct123/d1/database/db_xyz/query',
    );
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tok_abc');
    expect(headers['Content-Type']).toBe('application/json');
  });
});
