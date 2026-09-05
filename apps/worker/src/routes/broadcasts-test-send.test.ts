import { beforeEach, describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const pushMessage = vi.fn();

vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => ({ pushMessage })),
}));

const BROADCAST = {
  id: 'broadcast-1',
  title: 'test',
  message_type: 'text',
  message_content: 'ご案内です https://example.com/lp',
  target_type: 'all',
  target_tag_id: null,
  status: 'draft',
  scheduled_at: null,
  sent_at: null,
  total_count: 0,
  success_count: 0,
  created_at: '2026-01-01T00:00:00+09:00',
  line_account_id: 'account-1',
  alt_text: null,
  track_links: 1,
};

vi.mock('@line-crm/db', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getBroadcastById: vi.fn(async () => BROADCAST),
  getLineAccountById: vi.fn(async () => ({
    id: 'account-1',
    channel_access_token: 'token',
    is_active: 1,
  })),
  getOrCreateAutoTrackedLink: vi.fn(async () => ({ id: 'link-1', short_code: 'AbC1234' })),
  getTrackedLinkBaseUrl: vi.fn(async () => null),
}));

const { broadcasts } = await import('./broadcasts.js');

/**
 * Minimal D1 stub: test-send only needs the `account_settings` lookup
 * (test recipients), the `friends` lookup, and the `messages_log` insert.
 */
function makeDb(): D1Database {
  return {
    prepare(sql: string) {
      const stmt = {
        bind: () => stmt,
        first: async () =>
          sql.includes('account_settings') ? { value: JSON.stringify(['friend-1']) } : null,
        all: async () => ({ results: [{ id: 'friend-1', line_user_id: 'U-line-1' }] }),
        run: async () => ({ success: true }),
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function setupApp() {
  const app = new Hono();
  app.route('/', broadcasts as unknown as Hono);
  return app;
}

describe('POST /api/broadcasts/:id/test-send', () => {
  beforeEach(() => {
    pushMessage.mockReset();
    pushMessage.mockResolvedValue(undefined);
  });

  test('sends when WORKER_URL is configured', async () => {
    const res = await setupApp().request(
      'http://worker.example.com/api/broadcasts/broadcast-1/test-send',
      { method: 'POST' },
      { DB: makeDb(), WORKER_URL: 'https://worker.example.com' },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, sent: 1, failed: 0 });
  });

  // Regression: WORKER_URL is absent from the wrangler.toml template, so installs
  // that never set it hit `workerUrl.replace(...)` on undefined inside
  // autoTrackContent and test-send answers 500 — while the real send path stays
  // quiet because it guards with `if (workerUrl && ...)`.
  test('still sends when WORKER_URL is unset (falls back to the request origin)', async () => {
    const res = await setupApp().request(
      'http://worker.example.com/api/broadcasts/broadcast-1/test-send',
      { method: 'POST' },
      { DB: makeDb() },
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ success: true, sent: 1, failed: 0 });
    expect(pushMessage).toHaveBeenCalledTimes(1);
  });
});
