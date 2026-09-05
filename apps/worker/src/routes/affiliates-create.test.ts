import { describe, it, expect, vi, beforeEach } from 'vitest';

// Route-level test for POST /api/affiliates (admin-side create). The db layer is
// mocked — the real collision-retry / UNIQUE behaviour is covered against SQLite
// in packages/db/test. Here we assert the route wires body → db calls, defaults,
// link issuance, and error mapping (404 / 409 / 400).
const dbMocks = {
  // eager module-load deps (mirror other route tests)
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  // affiliates route deps
  getAffiliates: vi.fn(),
  getAffiliateById: vi.fn(),
  getAffiliateByCode: vi.fn(),
  createAffiliate: vi.fn(),
  createAffiliateWithRandomCode: vi.fn(),
  createAffiliateLink: vi.fn(),
  updateAffiliate: vi.fn(),
  deleteAffiliate: vi.fn(),
  recordAffiliateClick: vi.fn(),
  getAffiliateReport: vi.fn(),
  getAffiliateReportV2: vi.fn(),
  getFriendById: vi.fn(),
  getFriendJourney: vi.fn(),
  getAffiliateByFriendId: vi.fn(),
  getAffiliateJourneys: vi.fn(),
  listAffiliateLinks: vi.fn(),
  listAffiliateOffers: vi.fn().mockResolvedValue([]),
  // resolveLinkBaseUrl → getLinkBaseUrl
  getLinkBaseUrl: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const worker = (await import('../index.js')).default;

const API_KEY = 'test-owner-key';
const env = {
  DB: {} as D1Database,
  LINE_LOGIN_CHANNEL_ID: '2000000000',
  API_KEY,
  WORKER_URL: 'https://worker.example.com',
} as unknown as import('../index.js').Env['Bindings'];

function get(path: string) {
  const headers = new Headers({ Authorization: `Bearer ${API_KEY}` });
  return worker.fetch(
    new Request(`https://worker.example.com${path}`, { method: 'GET', headers }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

function post(path: string, body: unknown) {
  const headers = new Headers({
    Authorization: `Bearer ${API_KEY}`,
    'Content-Type': 'application/json',
  });
  return worker.fetch(
    new Request(`https://worker.example.com${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

const UNIQUE_CODE_ERR = new Error('D1_ERROR: UNIQUE constraint failed: affiliates.code');
const UNIQUE_FRIEND_ERR = new Error(
  'D1_ERROR: UNIQUE constraint failed: affiliates.friend_id',
);

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getLineAccounts.mockResolvedValue([]);
  dbMocks.getLinkBaseUrl.mockResolvedValue(null); // fall back to WORKER_URL/r
});

describe('POST /api/affiliates — random-code create', () => {
  it('auto-generates a code when none is supplied', async () => {
    dbMocks.createAffiliateWithRandomCode.mockResolvedValue({
      id: 'aff-1',
      name: 'Alice',
      code: 'Ab3xYz',
      commission_rate: 10,
      is_active: 1,
      created_at: '2026-07-07T00:00:00.000+09:00',
      friend_id: null,
    });

    const res = await post('/api/affiliates', { name: 'Alice', commissionRate: 10 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { code: string };
      link: unknown;
    };
    expect(body.success).toBe(true);
    expect(body.data.code).toBe('Ab3xYz');
    // No friendId + no explicit issueInitialLink → no link issued by default.
    expect(body.link).toBeNull();
    expect(dbMocks.createAffiliateWithRandomCode).toHaveBeenCalledWith(env.DB, {
      name: 'Alice',
      commissionRate: 10,
      friendId: null,
    });
    // createAffiliate (legacy explicit path) must not be touched.
    expect(dbMocks.createAffiliate).not.toHaveBeenCalled();
  });
});

describe('POST /api/affiliates — friend binding', () => {
  it('issues an initial link and uses friend.display_name when name omitted', async () => {
    dbMocks.getFriendById.mockResolvedValue({ id: 'friend-1', display_name: 'Bob' });
    dbMocks.createAffiliateWithRandomCode.mockResolvedValue({
      id: 'aff-2',
      name: 'Bob',
      code: 'Cd4wVu',
      commission_rate: 0,
      is_active: 1,
      created_at: '2026-07-07T00:00:00.000+09:00',
      friend_id: 'friend-1',
    });
    dbMocks.createAffiliateLink.mockResolvedValue({
      id: 'link-1',
      affiliate_id: 'aff-2',
      ref_code: 'Ef5tSr',
      label: null,
      line_account_id: null,
      is_active: 1,
      created_at: '2026-07-07T00:00:00.000+09:00',
      click_count: 0,
    });

    const res = await post('/api/affiliates', { friendId: 'friend-1' });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      data: { name: string; friendId: string };
      link: { refCode: string; url: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.name).toBe('Bob'); // from friend.display_name
    expect(body.data.friendId).toBe('friend-1');
    // Link issued by default when friendId is present.
    expect(body.link.refCode).toBe('Ef5tSr');
    expect(body.link.url).toBe('https://worker.example.com/r/Ef5tSr');
    expect(dbMocks.createAffiliateWithRandomCode).toHaveBeenCalledWith(env.DB, {
      name: 'Bob',
      commissionRate: undefined,
      friendId: 'friend-1',
    });
  });

  it('404s when the friend does not exist', async () => {
    dbMocks.getFriendById.mockResolvedValue(null);
    const res = await post('/api/affiliates', { friendId: 'ghost' });
    expect(res.status).toBe(404);
    expect(dbMocks.createAffiliateWithRandomCode).not.toHaveBeenCalled();
  });

  it('409s when the friend is already an affiliate', async () => {
    dbMocks.getFriendById.mockResolvedValue({ id: 'friend-1', display_name: 'Bob' });
    dbMocks.createAffiliateWithRandomCode.mockRejectedValue(UNIQUE_FRIEND_ERR);
    dbMocks.getAffiliateByFriendId.mockResolvedValue({
      id: 'aff-existing',
      name: 'Bob',
      code: 'old123',
      commission_rate: 0,
      is_active: 1,
      created_at: '2026-06-01T00:00:00.000+09:00',
      friend_id: 'friend-1',
    });

    const res = await post('/api/affiliates', { friendId: 'friend-1' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('この友だちは既にアフィリエイターです');
  });
});

describe('POST /api/affiliates — legacy explicit code (back-compat)', () => {
  it('accepts { name, code } and creates via createAffiliate', async () => {
    dbMocks.createAffiliate.mockResolvedValue({
      id: 'aff-3',
      name: 'Legacy',
      code: 'promo2026',
      commission_rate: 5,
      is_active: 1,
      created_at: '2026-07-07T00:00:00.000+09:00',
      friend_id: null,
    });

    const res = await post('/api/affiliates', {
      name: 'Legacy',
      code: 'promo2026',
      commissionRate: 5,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; data: { code: string } };
    expect(body.data.code).toBe('promo2026');
    expect(dbMocks.createAffiliate).toHaveBeenCalledWith(env.DB, {
      name: 'Legacy',
      code: 'promo2026',
      commissionRate: 5,
    });
    expect(dbMocks.createAffiliateWithRandomCode).not.toHaveBeenCalled();
  });

  it('409s on a duplicate explicit code', async () => {
    dbMocks.createAffiliate.mockRejectedValue(UNIQUE_CODE_ERR);
    const res = await post('/api/affiliates', { name: 'Dup', code: 'takenCode' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('このコードは既に使われています');
  });
});

describe('POST /api/affiliates — code validation', () => {
  it('rejects a code shorter than 4 chars', async () => {
    const res = await post('/api/affiliates', { name: 'Short', code: 'ab' });
    expect(res.status).toBe(400);
    expect(dbMocks.createAffiliate).not.toHaveBeenCalled();
  });

  it('rejects a code with non-alphanumeric characters', async () => {
    const res = await post('/api/affiliates', { name: 'Bad', code: 'bad-code!' });
    expect(res.status).toBe(400);
    expect(dbMocks.createAffiliate).not.toHaveBeenCalled();
  });

  it('400s when name, code, and friendId are all missing', async () => {
    const res = await post('/api/affiliates', { commissionRate: 10 });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/affiliates/:id/links — offer_name enrichment', () => {
  it('attaches offer_name to rows with offer_id and null to rows without', async () => {
    dbMocks.getAffiliateById.mockResolvedValue({
      id: 'aff-1',
      name: 'Alice',
      code: 'Ab3xYz',
      commission_rate: 10,
      is_active: 1,
      created_at: '2026-07-07T00:00:00.000+09:00',
      friend_id: null,
    });
    dbMocks.listAffiliateLinks.mockResolvedValue([
      {
        id: 'link-1',
        affiliate_id: 'aff-1',
        ref_code: 'Ref001',
        label: null,
        line_account_id: null,
        offer_id: 'offer-A',
        is_active: 1,
        created_at: '2026-07-07T00:00:00.000+09:00',
        click_count: 0,
      },
      {
        id: 'link-2',
        affiliate_id: 'aff-1',
        ref_code: 'Ref002',
        label: null,
        line_account_id: null,
        offer_id: null,
        is_active: 1,
        created_at: '2026-07-07T00:00:00.000+09:00',
        click_count: 0,
      },
    ]);
    dbMocks.listAffiliateOffers.mockResolvedValue([
      { id: 'offer-A', name: 'Summer Campaign', is_active: 1, reward_amount: 100, description: null, line_account_id: null, tag_id: null, scenario_id: null, created_at: '2026-07-01T00:00:00.000+09:00' },
    ]);

    const res = await get('/api/affiliates/aff-1/links');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: Array<{ id: string; offer_id: string | null; offer_name: string | null }>;
    };
    expect(body.success).toBe(true);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].offer_name).toBe('Summer Campaign');
    expect(body.data[1].offer_name).toBeNull();
  });
});
