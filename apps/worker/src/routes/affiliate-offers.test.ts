import { describe, it, expect, vi, beforeEach } from 'vitest';

// Route-level test for the admin offer CRUD (/api/affiliate-offers). The db
// layer is mocked — real INSERT/UPDATE behaviour is covered against SQLite in
// packages/db/test. Here we assert body → db wiring, validation (name required,
// rewardAmount non-negative integer), serialization (snake → camel), and 404s.
const dbMocks = {
  // eager module-load deps (mirror other route tests)
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  // offer route deps
  createAffiliateOffer: vi.fn(),
  updateAffiliateOffer: vi.fn(),
  listAffiliateOffers: vi.fn(),
  getAffiliateOfferById: vi.fn(),
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

function req(method: string, path: string, body?: unknown) {
  const headers = new Headers({ Authorization: `Bearer ${API_KEY}` });
  if (body !== undefined) headers.set('Content-Type', 'application/json');
  return worker.fetch(
    new Request(`https://worker.example.com${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

const OFFER_ROW = {
  id: 'off-1',
  name: 'キャンペーンA',
  description: '説明',
  reward_amount: 1000,
  reward_miles: 500,
  mileage_program_id: 'default',
  line_account_id: null,
  tag_id: null,
  scenario_id: null,
  is_active: 1,
  created_at: '2026-01-01 00:00:00',
};

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getLineAccounts.mockResolvedValue([]);
});

describe('POST /api/affiliate-offers', () => {
  it('creates an offer and serializes snake → camel', async () => {
    dbMocks.createAffiliateOffer.mockResolvedValue(OFFER_ROW);
    const res = await req('POST', '/api/affiliate-offers', {
      name: 'キャンペーンA',
      description: '説明',
      rewardAmount: 1000,
      rewardMiles: 500,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({
      id: 'off-1',
      name: 'キャンペーンA',
      rewardAmount: 1000,
      rewardMiles: 500,
      isActive: true,
    });
    expect(dbMocks.createAffiliateOffer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ name: 'キャンペーンA', rewardAmount: 1000, rewardMiles: 500 }),
    );
  });

  it('rejects a missing name with 400', async () => {
    const res = await req('POST', '/api/affiliate-offers', { rewardAmount: 100 });
    expect(res.status).toBe(400);
    expect(dbMocks.createAffiliateOffer).not.toHaveBeenCalled();
  });

  it('rejects a negative rewardAmount with 400', async () => {
    const res = await req('POST', '/api/affiliate-offers', { name: 'x', rewardAmount: -1 });
    expect(res.status).toBe(400);
    expect(dbMocks.createAffiliateOffer).not.toHaveBeenCalled();
  });

  it('rejects a non-integer rewardAmount with 400', async () => {
    const res = await req('POST', '/api/affiliate-offers', { name: 'x', rewardAmount: 1.5 });
    expect(res.status).toBe(400);
    expect(dbMocks.createAffiliateOffer).not.toHaveBeenCalled();
  });

  it('accepts an omitted rewardAmount (defaults db-side)', async () => {
    dbMocks.createAffiliateOffer.mockResolvedValue({ ...OFFER_ROW, reward_amount: 0 });
    const res = await req('POST', '/api/affiliate-offers', { name: 'x' });
    expect(res.status).toBe(201);
  });

  it('rejects a negative rewardMiles with 400', async () => {
    const res = await req('POST', '/api/affiliate-offers', { name: 'x', rewardMiles: -1 });
    expect(res.status).toBe(400);
    expect(dbMocks.createAffiliateOffer).not.toHaveBeenCalled();
  });
});

describe('GET /api/affiliate-offers', () => {
  it('lists all offers', async () => {
    dbMocks.listAffiliateOffers.mockResolvedValue([OFFER_ROW]);
    const res = await req('GET', '/api/affiliate-offers');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ id: string }> };
    expect(body.data).toHaveLength(1);
    expect(body.data[0].id).toBe('off-1');
    expect(dbMocks.listAffiliateOffers).toHaveBeenCalledWith(
      expect.anything(),
      { activeOnly: false },
    );
  });

  it('passes activeOnly=true through', async () => {
    dbMocks.listAffiliateOffers.mockResolvedValue([]);
    await req('GET', '/api/affiliate-offers?activeOnly=true');
    expect(dbMocks.listAffiliateOffers).toHaveBeenCalledWith(
      expect.anything(),
      { activeOnly: true },
    );
  });
});

describe('GET /api/affiliate-offers/:id', () => {
  it('404s an unknown offer', async () => {
    dbMocks.getAffiliateOfferById.mockResolvedValue(null);
    const res = await req('GET', '/api/affiliate-offers/nope');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/affiliate-offers/:id', () => {
  it('updates and returns the serialized offer', async () => {
    dbMocks.getAffiliateOfferById.mockResolvedValue(OFFER_ROW);
    dbMocks.updateAffiliateOffer.mockResolvedValue({ ...OFFER_ROW, is_active: 0 });
    const res = await req('PUT', '/api/affiliate-offers/off-1', { isActive: false });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { isActive: boolean } };
    expect(body.data.isActive).toBe(false);
    expect(dbMocks.updateAffiliateOffer).toHaveBeenCalledWith(
      expect.anything(),
      'off-1',
      expect.objectContaining({ is_active: 0 }),
    );
  });

  it('404s an unknown offer before updating', async () => {
    dbMocks.getAffiliateOfferById.mockResolvedValue(null);
    const res = await req('PUT', '/api/affiliate-offers/nope', { name: 'z' });
    expect(res.status).toBe(404);
    expect(dbMocks.updateAffiliateOffer).not.toHaveBeenCalled();
  });

  it('rejects an empty name with 400', async () => {
    const res = await req('PUT', '/api/affiliate-offers/off-1', { name: '   ' });
    expect(res.status).toBe(400);
    expect(dbMocks.updateAffiliateOffer).not.toHaveBeenCalled();
  });

  it('rejects a negative rewardAmount with 400', async () => {
    const res = await req('PUT', '/api/affiliate-offers/off-1', { rewardAmount: -5 });
    expect(res.status).toBe(400);
  });

  it('passes rewardMiles through on update', async () => {
    dbMocks.getAffiliateOfferById.mockResolvedValue(OFFER_ROW);
    dbMocks.updateAffiliateOffer.mockResolvedValue({ ...OFFER_ROW, reward_miles: 750 });
    const res = await req('PUT', '/api/affiliate-offers/off-1', { rewardMiles: 750 });
    expect(res.status).toBe(200);
    expect(dbMocks.updateAffiliateOffer).toHaveBeenCalledWith(
      expect.anything(),
      'off-1',
      expect.objectContaining({ reward_miles: 750 }),
    );
  });
});
