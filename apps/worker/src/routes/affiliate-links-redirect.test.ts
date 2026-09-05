import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @line-crm/db. index.ts pulls several helpers eagerly at module load, so
// every referenced export must exist as a stub. The /r/:ref handler is the only
// thing exercised here; unrelated helpers stay as bare vi.fn().
const dbMocks = {
  // eager module-load deps (mirror not-found.test.ts)
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  // /r/:ref resolution helpers
  getEntryRouteByRefCode: vi.fn(),
  getTrafficPoolBySlug: vi.fn(),
  getTrafficPoolById: vi.fn(),
  getRandomPoolAccount: vi.fn(),
  getPoolAccounts: vi.fn(),
  getLineAccountById: vi.fn(),
  getAffiliateLinkByRefCode: vi.fn(),
  incrementAffiliateLinkClick: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

// Import after the mock so index.ts binds the mocked helpers.
const worker = (await import('../index.js')).default;

// A stub DB is enough: every query goes through the mocked @line-crm/db
// helpers, so the binding itself is never touched by the /r/:ref handler.
const DB = {} as D1Database;

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';

const env = {
  DB,
  LIFF_URL: 'https://liff.line.me/1000000000-DefaultAA',
} as unknown as import('../index.js').Env['Bindings'];

function get(path: string) {
  return worker.fetch(
    new Request(`https://worker.example.com${path}`, {
      headers: { 'user-agent': MOBILE_UA },
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getLineAccounts.mockResolvedValue([]);
});

describe('/r/:ref — affiliate_links fallback', () => {
  it('(a) affiliate-only ref → landing page on the link account + click incremented', async () => {
    // entry_routes miss, affiliate_links hit.
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue({
      id: 'link-1',
      affiliate_id: 'aff-1',
      ref_code: 'aff123',
      label: null,
      line_account_id: 'acct-9',
      is_active: 1,
      created_at: '2026-01-01 00:00:00',
      click_count: 0,
    });
    dbMocks.getLineAccountById.mockResolvedValue({
      id: 'acct-9',
      liff_id: '2000000000-BbCcDd',
    });

    const res = await get('/r/aff123');
    expect(res.status).toBe(200);
    const html = await res.text();

    // Click counted exactly once, keyed by the ref_code.
    expect(dbMocks.incrementAffiliateLinkClick).toHaveBeenCalledTimes(1);
    expect(dbMocks.incrementAffiliateLinkClick).toHaveBeenCalledWith(DB, 'aff123');

    // Landing page targets the affiliate link's account LIFF, with the ref
    // carried into LIFF state so downstream ref_tracking still attributes.
    expect(html).toContain('liff.line.me/2000000000-BbCcDd');
    expect(html).toContain('ref=aff123');
    expect(html).toContain('liffId=2000000000-BbCcDd');

    // The pooled 'main' fallback must NOT run for an affiliate ref — its account
    // is already resolved.
    expect(dbMocks.getTrafficPoolBySlug).not.toHaveBeenCalled();
  });

  it('(a2) is_active=0 affiliate link still redirects (spec §8) and counts the click', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue({
      id: 'link-2',
      affiliate_id: 'aff-2',
      ref_code: 'paused1',
      label: null,
      line_account_id: 'acct-9',
      is_active: 0, // paused
      created_at: '2026-01-01 00:00:00',
      click_count: 5,
    });
    dbMocks.getLineAccountById.mockResolvedValue({
      id: 'acct-9',
      liff_id: '2000000000-BbCcDd',
    });

    const res = await get('/r/paused1');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(dbMocks.incrementAffiliateLinkClick).toHaveBeenCalledWith(DB, 'paused1');
    expect(html).toContain('liff.line.me/2000000000-BbCcDd');
    expect(html).toContain('ref=paused1');
  });

  it('(a3) affiliate link with null line_account_id → default LIFF account', async () => {
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue({
      id: 'link-3',
      affiliate_id: 'aff-3',
      ref_code: 'nulldef',
      label: null,
      line_account_id: null, // → 既定アカウント (env.LIFF_URL)
      is_active: 1,
      created_at: '2026-01-01 00:00:00',
      click_count: 0,
    });

    const res = await get('/r/nulldef');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(dbMocks.incrementAffiliateLinkClick).toHaveBeenCalledWith(DB, 'nulldef');
    // No account lookup when line_account_id is null; default LIFF is used.
    expect(dbMocks.getLineAccountById).not.toHaveBeenCalled();
    expect(html).toContain('liff.line.me/1000000000-DefaultAA');
    expect(html).toContain('ref=nulldef');
  });

  it('(b) entry_routes ref → legacy behavior unchanged (affiliate path not consulted)', async () => {
    // entry_route hit with an active pool → pooled account chosen, exactly as
    // before this task. Affiliate helpers must never be touched.
    dbMocks.getEntryRouteByRefCode.mockResolvedValue({
      ref_code: 'route1',
      pool_id: 'pool-1',
    });
    dbMocks.getTrafficPoolById.mockResolvedValue({
      id: 'pool-1',
      is_active: 1,
      liff_id: null,
    });
    dbMocks.getRandomPoolAccount.mockResolvedValue({
      liff_id: '3000000000-PoolAcct',
    });

    const res = await get('/r/route1');
    expect(res.status).toBe(200);
    const html = await res.text();

    expect(html).toContain('liff.line.me/3000000000-PoolAcct');
    expect(html).toContain('ref=route1');

    // Affiliate fallback must be entirely bypassed for a known entry_route.
    expect(dbMocks.getAffiliateLinkByRefCode).not.toHaveBeenCalled();
    expect(dbMocks.incrementAffiliateLinkClick).not.toHaveBeenCalled();
  });

  it('(c) ref in neither table → legacy default behavior unchanged', async () => {
    // entry_routes miss AND affiliate_links miss → falls through to the pooled
    // 'main' resolution, same as before this task.
    dbMocks.getEntryRouteByRefCode.mockResolvedValue(null);
    dbMocks.getAffiliateLinkByRefCode.mockResolvedValue(null);
    dbMocks.getTrafficPoolBySlug.mockResolvedValue(null); // no 'main' pool

    const res = await get('/r/unknown');
    expect(res.status).toBe(200);
    const html = await res.text();

    // No click recorded for an unknown ref.
    expect(dbMocks.incrementAffiliateLinkClick).not.toHaveBeenCalled();
    // The 'main' pool fallback ran, proving legacy resolution still fires.
    expect(dbMocks.getTrafficPoolBySlug).toHaveBeenCalledWith(DB, 'main');
    // Default LIFF used; ref still carried through.
    expect(html).toContain('liff.line.me/1000000000-DefaultAA');
    expect(html).toContain('ref=unknown');
  });
});
