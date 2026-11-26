import { afterEach, describe, expect, test, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  getLineAccounts: vi.fn(),
  updateLineAccount: vi.fn().mockResolvedValue({ id: 'acc-1' }),
  recordTokenRefreshFailure: vi.fn().mockResolvedValue(undefined),
  clearTokenRefreshFailure: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@line-crm/db', () => dbMocks);

import { refreshLineAccessTokens } from './token-refresh.js';

const ACCOUNT = {
  id: 'acc-1',
  name: 'メイン',
  is_active: 1,
  channel_id: '123',
  channel_secret: 'secret',
  channel_access_token: 'old-token',
  token_expires_at: null, // unknown expiry → refresh once
};

function makeDb(): D1Database {
  return { prepare: vi.fn() } as unknown as D1Database;
}

const db = makeDb();

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('refreshLineAccessTokens — failure recording (B-05)', () => {
  test('records the failure time + HTTP status in the DB without logging the LINE response body', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // LINE returns 400 with a body that may echo credential material — it must
    // never reach the log or the stored record.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('invalid_grant: client_secret mismatch', { status: 400 })),
    );
    dbMocks.getLineAccounts.mockResolvedValue([ACCOUNT]);

    await refreshLineAccessTokens(db);

    expect(dbMocks.recordTokenRefreshFailure).toHaveBeenCalledWith(db, 'acc-1', '400');
    expect(dbMocks.updateLineAccount).not.toHaveBeenCalled();
    for (const call of errorSpy.mock.calls) {
      expect(String(call.join(' '))).not.toContain('client_secret mismatch');
    }
    expect(dbMocks.clearTokenRefreshFailure).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  test('a network failure is recorded with a coarse reason (no body available)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED')));
    dbMocks.getLineAccounts.mockResolvedValue([ACCOUNT]);

    await refreshLineAccessTokens(db);

    expect(dbMocks.recordTokenRefreshFailure).toHaveBeenCalledWith(db, 'acc-1', 'network');
    errorSpy.mockRestore();
  });

  test('a successful refresh updates the account and clears the stored failure record', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ access_token: 'new-token', expires_in: 2592000, token_type: 'Bearer' }), {
          status: 200,
        }),
      ),
    );
    dbMocks.getLineAccounts.mockResolvedValue([ACCOUNT]);

    await refreshLineAccessTokens(db);

    expect(dbMocks.updateLineAccount).toHaveBeenCalledWith(
      db,
      'acc-1',
      expect.objectContaining({ channel_access_token: 'new-token' }),
    );
    expect(dbMocks.clearTokenRefreshFailure).toHaveBeenCalledWith(db, 'acc-1');
    expect(dbMocks.recordTokenRefreshFailure).not.toHaveBeenCalled();
  });
});
