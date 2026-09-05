import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { profileRefresh } from './profile-refresh.js';

type Row = Record<string, unknown> | null;

/** Minimal D1 stub: routes queries by SQL fingerprint. */
function makeDb(opts: { broadcast: Row; logCount: number }) {
  const executed: string[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind() { return this; },
        async first() {
          executed.push(sql);
          if (sql.includes('FROM broadcasts')) return opts.broadcast;
          if (sql.includes('COUNT(*)')) return { cnt: opts.logCount };
          return null;
        },
        async run() {
          executed.push(sql);
          return { success: true, meta: { changes: 1 } };
        },
      };
    },
  };
  return { db: db as unknown as D1Database, executed };
}

function setupApp(db: D1Database) {
  const app = new Hono<{ Bindings: { DB: D1Database } }>();
  app.use('*', async (c, next) => {
    c.env = { DB: db };
    await next();
  });
  app.route('/', profileRefresh);
  return app;
}

describe('POST /api/admin/broadcasts/:id/reset-to-draft', () => {
  test('refuses when the broadcast row carries send markers, even with zero messages_log rows (retention-pruned)', async () => {
    const { db, executed } = makeDb({
      broadcast: { status: 'sent', success_count: 120, sent_at: '2026-01-01T00:00:00.000', line_request_id: 'req-1', aggregation_unit: null },
      logCount: 0,
    });
    const res = await setupApp(db).request('/api/admin/broadcasts/b1/reset-to-draft', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(executed.some((s) => s.includes('UPDATE broadcasts'))).toBe(false);
  });

  test('refuses when messages_log still has rows', async () => {
    const { db } = makeDb({
      broadcast: { status: 'sent', success_count: 0, sent_at: null, line_request_id: null, aggregation_unit: null },
      logCount: 3,
    });
    const res = await setupApp(db).request('/api/admin/broadcasts/b1/reset-to-draft', { method: 'POST' });
    expect(res.status).toBe(409);
  });

  test('refuses when only aggregation_unit is set (crash between marker write and sent_at)', async () => {
    const { db, executed } = makeDb({
      broadcast: { status: 'sending', success_count: 0, sent_at: null, line_request_id: null, aggregation_unit: 'agg-1' },
      logCount: 0,
    });
    const res = await setupApp(db).request('/api/admin/broadcasts/b1/reset-to-draft', { method: 'POST' });
    expect(res.status).toBe(409);
    expect(executed.some((sq) => sq.includes('UPDATE broadcasts'))).toBe(false);
  });

  test('404s when the broadcast does not exist', async () => {
    const { db } = makeDb({ broadcast: null, logCount: 0 });
    const res = await setupApp(db).request('/api/admin/broadcasts/nope/reset-to-draft', { method: 'POST' });
    expect(res.status).toBe(404);
  });

  test('resets when there are no send markers and no log rows', async () => {
    const { db, executed } = makeDb({
      broadcast: { status: 'sent', success_count: 0, sent_at: null, line_request_id: null, aggregation_unit: null },
      logCount: 0,
    });
    const res = await setupApp(db).request('/api/admin/broadcasts/b1/reset-to-draft', { method: 'POST' });
    expect(res.status).toBe(200);
    expect(executed.some((s) => s.includes('UPDATE broadcasts'))).toBe(true);
  });
});
