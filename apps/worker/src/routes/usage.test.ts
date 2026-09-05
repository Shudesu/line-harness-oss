import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { usage } from './usage.js';

function makeDb(counts: { friends?: number; monthly?: number }) {
  const db = {
    prepare(sql: string) {
      const stmt = {
        bind() { return stmt; },
        async first() {
          if (sql.includes('FROM friends')) return { count: counts.friends ?? 0 };
          if (sql.includes('FROM messages_log')) return { count: counts.monthly ?? 0 };
          return null;
        },
      };
      return stmt;
    },
  };
  return db as unknown as D1Database;
}

function setupApp(db: D1Database, quotaEnv: Record<string, string>) {
  const app = new Hono<{ Bindings: Record<string, unknown> }>();
  app.use('*', async (c, next) => {
    c.env = { DB: db, ...quotaEnv };
    await next();
  });
  app.route('/', usage);
  return app;
}

describe('GET /api/usage', () => {
  test('limits configured → returns used/max/exceeded', async () => {
    const app = setupApp(makeDb({ friends: 120, monthly: 6000 }), {
      QUOTA_FRIENDS_MAX: '100',
      QUOTA_MONTHLY_MESSAGES_MAX: '5000',
      QUOTA_NOTICE_URL: 'https://example.com/notice',
    });
    const res = await app.request('/api/usage');
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data).toEqual({
      friends: { used: 120, max: 100 },
      monthlyMessages: { used: 6000, max: 5000 },
      exceeded: true,
      noticeUrl: 'https://example.com/notice',
    });
  });

  test('nothing configured → max 0 (renders as unlimited), no DB reads', async () => {
    const res = await setupApp(makeDb({}), {}).request('/api/usage');
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Record<string, unknown> };
    expect(body.data).toEqual({
      friends: { used: 0, max: 0 },
      monthlyMessages: { used: 0, max: 0 },
      exceeded: false,
      noticeUrl: null,
    });
  });
});
