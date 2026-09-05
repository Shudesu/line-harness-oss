import { describe, it, expect, vi, beforeEach } from 'vitest';

// Route-level test for the approval queue endpoints:
//   GET   /api/conversions/approvals?status=…
//   PATCH /api/conversions/events/:id/approval
// The db layer is mocked (real SQL is covered in packages/db/test). Here we
// assert status validation, the injected IDENTITY_KEY_SQL wiring, duplicateFlag
// pass-through, and the 404 for missing / non-attributed events.
const dbMocks = {
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  // conversions route deps
  getConversionPoints: vi.fn(),
  getConversionPointById: vi.fn(),
  createConversionPoint: vi.fn(),
  deleteConversionPoint: vi.fn(),
  trackConversion: vi.fn(),
  getConversionEvents: vi.fn(),
  getConversionReport: vi.fn(),
  getConversionApprovalQueue: vi.fn(),
  setConversionApproval: vi.fn(),
  getConversionApprovalNotifyInfo: vi.fn(),
  syncAffiliateConversionMileage: vi.fn().mockResolvedValue(undefined),
};
vi.mock('@line-crm/db', () => dbMocks);

// Mock the affiliate notifier so the approval route's push is observable
// without touching LINE / the DB resolution chain.
const notifyAffiliateApproval = vi.fn().mockResolvedValue(undefined);
vi.mock('../services/affiliate-notifier.js', () => ({ notifyAffiliateApproval }));

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

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getLineAccounts.mockResolvedValue([]);
  dbMocks.syncAffiliateConversionMileage.mockResolvedValue(undefined);
});

describe('GET /api/conversions/approvals', () => {
  it('returns the queue with duplicateFlag and injects IDENTITY_KEY_SQL', async () => {
    dbMocks.getConversionApprovalQueue.mockResolvedValue([
      {
        eventId: 'ev-1',
        createdAt: '2026-01-01 00:00:00',
        friendId: 'f-1',
        friendName: 'Alice',
        affiliateId: 'aff-1',
        affiliateName: 'AffA',
        offerName: 'キャンペーンA',
        conversionPointName: '購入',
        value: 500,
        approvalStatus: 'pending',
        duplicateFlag: true,
      },
    ]);

    const res = await req('GET', '/api/conversions/approvals?status=pending');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: Array<{ eventId: string; duplicateFlag: boolean }> };
    expect(body.data[0].eventId).toBe('ev-1');
    expect(body.data[0].duplicateFlag).toBe(true);

    const callArgs = dbMocks.getConversionApprovalQueue.mock.calls[0][1];
    expect(callArgs.status).toBe('pending');
    // The route injects the identity-key SQL fragment (referencing friends.*).
    expect(String(callArgs.identityKeySql)).toContain('friends');
  });

  it('defaults status to pending when omitted', async () => {
    dbMocks.getConversionApprovalQueue.mockResolvedValue([]);
    await req('GET', '/api/conversions/approvals');
    expect(dbMocks.getConversionApprovalQueue.mock.calls[0][1].status).toBe('pending');
  });

  it('rejects an invalid status with 400', async () => {
    const res = await req('GET', '/api/conversions/approvals?status=bogus');
    expect(res.status).toBe(400);
    expect(dbMocks.getConversionApprovalQueue).not.toHaveBeenCalled();
  });

  it('accepts approved and rejected', async () => {
    dbMocks.getConversionApprovalQueue.mockResolvedValue([]);
    expect((await req('GET', '/api/conversions/approvals?status=approved')).status).toBe(200);
    expect((await req('GET', '/api/conversions/approvals?status=rejected')).status).toBe(200);
  });

  it('clamps non-numeric limit to default 200', async () => {
    dbMocks.getConversionApprovalQueue.mockResolvedValue([]);
    await req('GET', '/api/conversions/approvals?limit=abc');
    const callArgs = dbMocks.getConversionApprovalQueue.mock.calls[0][1];
    expect(callArgs.limit).toBe(200);
  });

  it('clamps oversized limit to 500', async () => {
    dbMocks.getConversionApprovalQueue.mockResolvedValue([]);
    await req('GET', '/api/conversions/approvals?limit=99999');
    const callArgs = dbMocks.getConversionApprovalQueue.mock.calls[0][1];
    expect(callArgs.limit).toBe(500);
  });
});

describe('PATCH /api/conversions/events/:id/approval', () => {
  it('approves an attributed event', async () => {
    dbMocks.setConversionApproval.mockResolvedValue(true);
    dbMocks.getConversionApprovalNotifyInfo.mockResolvedValue({
      affiliateId: 'aff-1',
      offerName: '案件X',
      rewardAmount: 5000,
    });
    const res = await req('PATCH', '/api/conversions/events/ev-1/approval', {
      status: 'approved',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { approvalStatus: string } };
    expect(body.data.approvalStatus).toBe('approved');
    expect(dbMocks.setConversionApproval).toHaveBeenCalledWith(
      expect.anything(),
      'ev-1',
      'approved',
    );
    expect(dbMocks.syncAffiliateConversionMileage).toHaveBeenCalledWith(
      expect.anything(),
      'ev-1',
      'approved',
    );
  });

  it('notifies the affiliate on approval', async () => {
    dbMocks.setConversionApproval.mockResolvedValue(true);
    dbMocks.getConversionApprovalNotifyInfo.mockResolvedValue({
      affiliateId: 'aff-1',
      offerName: '案件X',
      rewardAmount: 5000,
    });
    await req('PATCH', '/api/conversions/events/ev-1/approval', { status: 'approved' });
    expect(notifyAffiliateApproval).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      'aff-1',
      '案件X',
      5000,
    );
  });

  it('does NOT notify the affiliate on rejection', async () => {
    dbMocks.setConversionApproval.mockResolvedValue(true);
    const res = await req('PATCH', '/api/conversions/events/ev-1/approval', {
      status: 'rejected',
    });
    expect(res.status).toBe(200);
    expect(dbMocks.getConversionApprovalNotifyInfo).not.toHaveBeenCalled();
    expect(notifyAffiliateApproval).not.toHaveBeenCalled();
  });

  it('still returns 200 when the notify lookup finds nothing', async () => {
    dbMocks.setConversionApproval.mockResolvedValue(true);
    dbMocks.getConversionApprovalNotifyInfo.mockResolvedValue(null);
    const res = await req('PATCH', '/api/conversions/events/ev-1/approval', {
      status: 'approved',
    });
    expect(res.status).toBe(200);
    expect(notifyAffiliateApproval).not.toHaveBeenCalled();
  });

  it('rejects an unknown status with 400', async () => {
    const res = await req('PATCH', '/api/conversions/events/ev-1/approval', {
      status: 'pending',
    });
    expect(res.status).toBe(400);
    expect(dbMocks.setConversionApproval).not.toHaveBeenCalled();
  });

  it('rejects a missing status with 400', async () => {
    const res = await req('PATCH', '/api/conversions/events/ev-1/approval', {});
    expect(res.status).toBe(400);
  });

  it('404s a missing or non-attributed event', async () => {
    dbMocks.setConversionApproval.mockResolvedValue(false);
    const res = await req('PATCH', '/api/conversions/events/nope/approval', {
      status: 'rejected',
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 without calling notifyAffiliate when status is already_set (double-click guard)', async () => {
    dbMocks.setConversionApproval.mockResolvedValue('already_set');
    const res = await req('PATCH', '/api/conversions/events/ev-dup/approval', {
      status: 'approved',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { approvalStatus: string } };
    expect(body.data.approvalStatus).toBe('approved');
    expect(dbMocks.syncAffiliateConversionMileage).toHaveBeenCalledWith(
      expect.anything(),
      'ev-dup',
      'approved',
    );
    // Critical: notify must NOT be called for an idempotent no-op
    expect(notifyAffiliateApproval).not.toHaveBeenCalled();
    expect(dbMocks.getConversionApprovalNotifyInfo).not.toHaveBeenCalled();
  });

  it('returns 500 when the mileage projection fails so a retry can repair it', async () => {
    dbMocks.setConversionApproval.mockResolvedValue(true);
    dbMocks.syncAffiliateConversionMileage.mockRejectedValue(new Error('ledger unavailable'));
    const res = await req('PATCH', '/api/conversions/events/ev-1/approval', {
      status: 'approved',
    });
    expect(res.status).toBe(500);
    expect(notifyAffiliateApproval).not.toHaveBeenCalled();
  });
});
