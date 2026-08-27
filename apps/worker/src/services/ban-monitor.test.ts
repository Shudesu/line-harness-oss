import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';

const getLineAccounts = vi.fn();
const createAccountHealthLog = vi.fn();
const getAccountHealthLogs = vi.fn();

vi.mock('@line-crm/db', () => ({
  getLineAccounts: (...args: unknown[]) => getLineAccounts(...args),
  createAccountHealthLog: (...args: unknown[]) => createAccountHealthLog(...args),
  getAccountHealthLogs: (...args: unknown[]) => getAccountHealthLogs(...args),
}));

const { checkAccountHealth } = await import('./ban-monitor.js');

/** messages_log の集計だけを返す最小の D1 スタブ。 */
function dbStub(): D1Database {
  return {
    prepare: () => ({
      bind: () => ({ first: async () => ({ count: 0 }) }),
    }),
  } as unknown as D1Database;
}

function log(riskLevel: string, errorCode: number | null) {
  return {
    id: 'log-1',
    line_account_id: 'acc-1',
    error_code: errorCode,
    error_count: errorCode === null ? 0 : 1,
    check_period: '2026-08-26T13:00:00.000+09:00',
    risk_level: riskLevel,
    created_at: '2026-08-26T13:00:00.000+09:00',
  };
}

describe('checkAccountHealth', () => {
  beforeEach(() => {
    getLineAccounts.mockReset();
    createAccountHealthLog.mockReset();
    getAccountHealthLogs.mockReset();
    getLineAccounts.mockResolvedValue([
      { id: 'acc-1', channel_access_token: 'token', is_active: 1 },
    ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('状態が前回から変わっていなければログを書かない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    getAccountHealthLogs.mockResolvedValue([log('normal', null)]);

    await checkAccountHealth(dbStub());

    expect(createAccountHealthLog).not.toHaveBeenCalled();
  });

  test('403 が出て risk が変わったらログを書く', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
    getAccountHealthLogs.mockResolvedValue([log('normal', null)]);

    await checkAccountHealth(dbStub());

    expect(createAccountHealthLog).toHaveBeenCalledTimes(1);
    expect(createAccountHealthLog.mock.calls[0][1]).toMatchObject({
      lineAccountId: 'acc-1',
      errorCode: 403,
      riskLevel: 'danger',
    });
  });

  test('403 が続いている間は最初の1回しか書かない', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 403 })));
    getAccountHealthLogs.mockResolvedValue([log('danger', 403)]);

    await checkAccountHealth(dbStub());

    expect(createAccountHealthLog).not.toHaveBeenCalled();
  });

  test('履歴が1件も無ければ現在の状態を記録する', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    getAccountHealthLogs.mockResolvedValue([]);

    await checkAccountHealth(dbStub());

    expect(createAccountHealthLog).toHaveBeenCalledTimes(1);
    expect(createAccountHealthLog.mock.calls[0][1]).toMatchObject({
      riskLevel: 'normal',
      errorCode: undefined,
    });
  });

  test('risk は同じでもエラーコードが変わったら記録する', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
    getAccountHealthLogs.mockResolvedValue([log('normal', null)]);

    await checkAccountHealth(dbStub());

    expect(createAccountHealthLog).toHaveBeenCalledTimes(1);
    expect(createAccountHealthLog.mock.calls[0][1]).toMatchObject({
      errorCode: 500,
      riskLevel: 'normal',
    });
  });
});
