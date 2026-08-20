import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  getBroadcasts: vi.fn(),
  getBroadcastById: vi.fn(),
  createBroadcast: vi.fn(),
  updateBroadcast: vi.fn(),
  deleteBroadcast: vi.fn(),
  getLineAccountById: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const { broadcasts } = await import('./broadcasts.js');

const KEY = '11111111-2222-4333-8444-555555555555';
const requestBody = {
  title: '朝のお知らせ',
  messageType: 'text',
  messageContent: '{{name}}さん、おはようございます',
  targetType: 'all',
  scheduledAt: '2026-08-12T09:00:00.000+09:00',
  lineAccountId: 'account-1',
  trackLinks: true,
};

const row = {
  id: KEY,
  title: requestBody.title,
  message_type: requestBody.messageType,
  message_content: requestBody.messageContent,
  target_type: requestBody.targetType,
  target_tag_id: null,
  status: 'scheduled',
  scheduled_at: requestBody.scheduledAt,
  sent_at: null,
  total_count: 0,
  success_count: 0,
  created_at: '2026-08-11T12:00:00.000+09:00',
  account_ids: null,
  dedup_priority: null,
  failed_account_ids: null,
  dedup_progress: null,
  batch_lock_at: null,
  track_links: 1,
  line_account_id: requestBody.lineAccountId,
  alt_text: null,
};

function setupApp() {
  const app = new Hono<{ Bindings: { DB: D1Database } }>();
  app.use('*', async (c, next) => {
    c.env = { DB: {} as D1Database };
    await next();
  });
  app.route('/', broadcasts);
  return app;
}

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) fn.mockReset();
});
describe('POST /api/broadcasts idempotency', () => {
  test('creates with the idempotency key as the stable broadcast id', async () => {
    dbMocks.getBroadcastById.mockResolvedValueOnce(null);
    dbMocks.createBroadcast.mockResolvedValueOnce(row);

    const response = await setupApp().request('/api/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': KEY },
      body: JSON.stringify(requestBody),
    });

    expect(response.status).toBe(201);
    expect(dbMocks.createBroadcast).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      id: KEY,
      lineAccountId: 'account-1',
      messageContent: requestBody.messageContent,
    }));
  });

  test('returns the original row without creating a duplicate on replay', async () => {
    dbMocks.getBroadcastById.mockResolvedValueOnce(row);

    const response = await setupApp().request('/api/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': KEY },
      body: JSON.stringify(requestBody),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Idempotency-Replayed')).toBe('true');
    expect(dbMocks.createBroadcast).not.toHaveBeenCalled();
    expect((await response.json() as { data: { id: string } }).data.id).toBe(KEY);
  });

  test('rejects reuse of the same key for different content', async () => {
    dbMocks.getBroadcastById.mockResolvedValueOnce(row);

    const response = await setupApp().request('/api/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': KEY },
      body: JSON.stringify({ ...requestBody, messageContent: '別の内容' }),
    });

    expect(response.status).toBe(409);
    expect(dbMocks.createBroadcast).not.toHaveBeenCalled();
  });

  test('rejects a malformed key before touching the database', async () => {
    const response = await setupApp().request('/api/broadcasts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'not-a-uuid' },
      body: JSON.stringify(requestBody),
    });

    expect(response.status).toBe(400);
    expect(dbMocks.getBroadcastById).not.toHaveBeenCalled();
    expect(dbMocks.createBroadcast).not.toHaveBeenCalled();
  });
});
