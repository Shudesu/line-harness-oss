import { beforeEach, afterEach, describe, expect, test, vi } from 'vitest';

const dbMocks = vi.hoisted(() => ({
  getLineAccounts: vi.fn(),
  createAccountHealthLog: vi.fn().mockResolvedValue({ id: 'log-1' }),
  getAccountHealthLogs: vi.fn().mockResolvedValue([]),
  recordTokenUnauthorized: vi.fn().mockResolvedValue(undefined),
  clearTokenUnauthorized: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@line-crm/db', () => dbMocks);

vi.mock('./quota-alert.js', () => ({
  countDeliverableAudience: vi.fn(),
  getLinePlanQuotaShortfall: vi.fn(),
  notifyQuotaAlert: vi.fn(),
}));

import { checkAccountHealth } from './ban-monitor.js';

const ACCOUNT = {
  id: 'acc-1',
  name: 'メイン',
  is_active: 1,
  channel_access_token: 'token',
};

function makeDb(): D1Database {
  const stmt = {
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue({ count: 0 }),
  };
  return {
    prepare: vi.fn(() => stmt),
  } as unknown as D1Database;
}

const okResponse = () => new Response(JSON.stringify({ displayName: 'bot' }), { status: 200 });
const statusResponse = (status: number) => new Response('error', { status });

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getLineAccounts.mockResolvedValue([ACCOUNT]);
  dbMocks.getAccountHealthLogs.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('checkAccountHealth — 401 handling (B-05)', () => {
  test('401 (revoked token) is treated as danger and recorded for connection health', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusResponse(401)));
    const db = makeDb();

    await checkAccountHealth(db);

    expect(dbMocks.createAccountHealthLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ lineAccountId: 'acc-1', errorCode: 401, riskLevel: 'danger' }),
    );
    expect(dbMocks.recordTokenUnauthorized).toHaveBeenCalledWith(db, 'acc-1');
    expect(dbMocks.clearTokenUnauthorized).not.toHaveBeenCalled();
  });

  test('403 keeps its existing danger semantics without a 401 record', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusResponse(403)));
    const db = makeDb();

    await checkAccountHealth(db);

    expect(dbMocks.createAccountHealthLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ lineAccountId: 'acc-1', errorCode: 403, riskLevel: 'danger' }),
    );
    expect(dbMocks.recordTokenUnauthorized).not.toHaveBeenCalled();
  });

  test('429 stays warning', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(statusResponse(429)));
    const db = makeDb();

    await checkAccountHealth(db);

    expect(dbMocks.createAccountHealthLog).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ lineAccountId: 'acc-1', errorCode: 429, riskLevel: 'warning' }),
    );
  });

  test('a healthy bot/info call clears a previous 401 record so health recovers immediately', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(okResponse()));
    const db = makeDb();
    // 最新のヘルスログも正常状態 — 状態変化 dedup によりログは増えない。
    dbMocks.getAccountHealthLogs.mockResolvedValue([{ risk_level: 'normal', error_code: null }]);

    await checkAccountHealth(db);

    expect(dbMocks.clearTokenUnauthorized).toHaveBeenCalledWith(db, 'acc-1');
    expect(dbMocks.recordTokenUnauthorized).not.toHaveBeenCalled();
    expect(dbMocks.createAccountHealthLog).not.toHaveBeenCalled(); // normal state, unchanged
  });
});
