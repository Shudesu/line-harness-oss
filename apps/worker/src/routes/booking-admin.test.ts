import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const availabilityMocks = {
  computeSlots: vi.fn(() => [] as { start: string; end: string }[]),
  getAvailability: vi.fn(async (_db: unknown, params: { from: string }) => ({
    by_staff: [{
      staff_id: 's1',
      display_name: 'A',
      slots: availabilityMocks.computeSlots().map((slot) => ({ date: params.from, ...slot })),
    }],
  })),
};
vi.mock('../services/availability.js', () => availabilityMocks);

const notifierMocks = { sendBookingNotification: vi.fn() };
vi.mock('../services/booking-notifier.js', () => notifierMocks);

const { default: booking } = await import('./booking.js');

function makeApp(db: unknown) {
  const app = new Hono();
  app.route('/', booking);
  return { app, env: { DB: db } };
}

const emptyDb = {
  prepare: () => ({
    bind: () => ({
      first: async () => null,
      all: async () => ({ results: [] }),
      run: async () => ({ meta: { changes: 0 } }),
    }),
  }),
};

describe('GET /api/booking/admin/menus/:id/staff', () => {
  test('400 without account_id', async () => {
    const { app, env } = makeApp(emptyDb);
    const res = await app.request('/api/booking/admin/menus/m1/staff', {}, env);
    expect(res.status).toBe(400);
  });

  test('200 with staff list', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [{ id: 's1', display_name: 'スタッフA' }] }),
        }),
      }),
    };
    const { app, env } = makeApp(db);
    const res = await app.request('/api/booking/admin/menus/m1/staff?account_id=acc1', {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { staff: unknown[] };
    expect(body.staff).toHaveLength(1);
  });
});

describe('GET /api/booking/admin/availability', () => {
  test('400 without params', async () => {
    const { app, env } = makeApp(emptyDb);
    const res = await app.request('/api/booking/admin/availability?account_id=acc1', {}, env);
    expect(res.status).toBe(400);
  });

  test('200 delegates to getAvailability with minLeadTimeMinutes 0', async () => {
    const { app, env } = makeApp(emptyDb);
    const res = await app.request(
      '/api/booking/admin/availability?account_id=acc1&menu_id=m1&from=2026-07-08&to=2026-07-14',
      {},
      env,
    );
    expect(res.status).toBe(200);
    expect(availabilityMocks.getAvailability).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ lineAccountId: 'acc1', menuId: 'm1', minLeadTimeMinutes: 0 }),
    );
  });

  test('400 when range wider than 28 days', async () => {
    const { app, env } = makeApp(emptyDb);
    const res = await app.request(
      '/api/booking/admin/availability?account_id=acc1&menu_id=m1&from=2026-07-01&to=2026-08-15',
      {},
      env,
    );
    expect(res.status).toBe(400);
  });
});

// ----------------------------------------------------------------
// POST /api/booking/admin/bookings

type Handler = {
  first?: unknown;
  all?: { results: unknown[] };
  run?: { meta: { changes: number } };
};

// SQL 断片マッチで応答を返す scripted D1。マッチしない SQL は空応答。
function scriptedDb(handlers: [string, Handler][]) {
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          calls.push({ sql, params });
          const h = handlers.find(([frag]) => sql.includes(frag))?.[1] ?? {};
          return {
            first: async () => h.first ?? null,
            all: async () => h.all ?? { results: [] },
            run: async () => h.run ?? { meta: { changes: 0 } },
          };
        },
      };
    },
    async batch(stmts: unknown[]) {
      return stmts;
    },
  };
}

const execCtx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

describe('POST /api/booking/admin/bookings', () => {
  // Always 7 days in the future at 02:00Z (= JST 11:00, inside the mocked
  // 10:00-19:00 shift). A fixed date here becomes a time bomb: the route
  // rejects past slots with 422 once the calendar catches up.
  const futureStartsAt = (() => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 7);
    d.setUTCHours(2, 0, 0, 0);
    return d.toISOString();
  })();
  const validBody = {
    friend_id: 'f1',
    menu_id: 'm1',
    staff_id: 's1',
    starts_at: futureStartsAt, // JST 11:00
  };

  function happyDb(insertChanges = 1) {
    return scriptedDb([
      ['FROM friends', { first: { id: 'f1', is_following: 1 } }],
      ['FROM staff WHERE', { first: { ok: 1 } }],
      [
        'FROM menus m',
        {
          first: {
            duration_minutes: 60,
            buffer_after_minutes: 10,
            dur: 60,
            price: 8000,
            is_offered: 1,
          },
        },
      ],
      ['FROM staff_shifts', { first: { start_time: '10:00', end_time: '19:00' } }],
      ['SELECT starts_at, block_ends_at FROM bookings', { all: { results: [] } }],
      ['INSERT INTO bookings', { run: { meta: { changes: insertChanges } } }],
    ]);
  }

  test('400 without account_id', async () => {
    const { app, env } = makeApp(emptyDb);
    const res = await app.request(
      '/api/booking/admin/bookings',
      {
        method: 'POST',
        body: JSON.stringify(validBody),
        headers: { 'Content-Type': 'application/json' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(400);
  });

  test('404 when friend not found', async () => {
    const db = scriptedDb([['FROM friends', { first: null }]]);
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/bookings?account_id=acc1',
      {
        method: 'POST',
        body: JSON.stringify(validBody),
        headers: { 'Content-Type': 'application/json' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(404);
  });

  test('201 creates confirmed booking and inserts reminders', async () => {
    availabilityMocks.computeSlots.mockReturnValue([{ start: '11:00', end: '12:00' }]);
    const db = happyDb();
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/bookings?account_id=acc1',
      {
        method: 'POST',
        body: JSON.stringify(validBody),
        headers: { 'Content-Type': 'application/json' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { booking_id: string; status: string };
    expect(body.status).toBe('confirmed');
    const insert = db.calls.find((c) => c.sql.includes('INSERT INTO bookings'));
    expect(insert?.params).toContain('confirmed');
    // booking_reminders INSERT が走っている(未来の予約なので day_before + hours_before)
    const reminders = db.calls.filter((c) => c.sql.includes('INSERT INTO booking_reminders'));
    expect(reminders.length).toBeGreaterThan(0);
  });

  test('409 on slot conflict (atomic insert 0 rows)', async () => {
    availabilityMocks.computeSlots.mockReturnValue([{ start: '11:00', end: '12:00' }]);
    const db = happyDb(0);
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/bookings?account_id=acc1',
      {
        method: 'POST',
        body: JSON.stringify(validBody),
        headers: { 'Content-Type': 'application/json' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(409);
  });

  test('422 when slot not in availability', async () => {
    availabilityMocks.computeSlots.mockReturnValue([{ start: '14:00', end: '15:00' }]);
    const db = happyDb();
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/bookings?account_id=acc1',
      {
        method: 'POST',
        body: JSON.stringify(validBody),
        headers: { 'Content-Type': 'application/json' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(422);
  });

  test('404 when staff belongs to another account', async () => {
    availabilityMocks.computeSlots.mockReturnValue([{ start: '11:00', end: '12:00' }]);
    // friend exists, but the staff-in-account assertion returns no row.
    const db = scriptedDb([
      ['FROM friends', { first: { id: 'f1', is_following: 1 } }],
      ['FROM staff WHERE', { first: null }],
    ]);
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/bookings?account_id=acc1',
      {
        method: 'POST',
        body: JSON.stringify(validBody),
        headers: { 'Content-Type': 'application/json' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('staff_not_found');
  });

  test('server-side availability recheck receives the correct September JST date', async () => {
    availabilityMocks.computeSlots.mockReturnValue([{ start: '11:00', end: '12:00' }]);
    const db = happyDb();
    const { app, env } = makeApp(db);
    // September exercises the old `.replace('-09', ...)` mangling bug, but the
    // year must stay in the future (past slots are rejected with 422 before the
    // window query runs) — pick this year's Sep 10 or next year's once passed.
    const now = new Date();
    const sepYear =
      now.getTime() < Date.UTC(now.getUTCFullYear(), 8, 1) // before Sep 1
        ? now.getUTCFullYear()
        : now.getUTCFullYear() + 1;
    const res = await app.request(
      '/api/booking/admin/bookings?account_id=acc1',
      {
        method: 'POST',
        body: JSON.stringify({ ...validBody, starts_at: `${sepYear}-09-10T02:00:00.000Z` }),
        headers: { 'Content-Type': 'application/json' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(201);
    expect(availabilityMocks.getAvailability).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ from: `${sepYear}-09-10`, to: `${sepYear}-09-10` }),
    );
  });
});

describe('jstDayWindowUtc', () => {
  test('July date: bounds cover the full JST calendar day', async () => {
    const { jstDayWindowUtc } = await import('./booking.js');
    const w = jstDayWindowUtc('2026-07-10');
    expect(w.startUtc).toBe('2026-07-09T15:00:00.000Z');
    expect(w.endUtc).toBe('2026-07-10T15:00:00Z');
  });

  test('September/November dates are not corrupted', async () => {
    const { jstDayWindowUtc } = await import('./booking.js');
    expect(jstDayWindowUtc('2026-09-10').startUtc).toBe('2026-09-09T15:00:00.000Z');
    expect(jstDayWindowUtc('2026-11-09').startUtc).toBe('2026-11-08T15:00:00.000Z');
  });
});

// 「有効」の保存。管理画面は 1/0 を、API 利用者は true/false を送る。
describe('is_active is stored as sent (staff / menus)', () => {
  type Call = { sql: string; binds: unknown[] };

  function recordingDb() {
    const calls: Call[] = [];
    const db = {
      prepare: (sql: string) => ({
        bind: (...binds: unknown[]) => {
          calls.push({ sql, binds });
          return {
            first: async () => null,
            all: async () => ({ results: [] }),
            run: async () => ({ meta: { changes: 1 } }),
          };
        },
      }),
    };
    return { db, calls };
  }

  // SQL の ? の並びから、指定した列に渡された値を取り出す。
  function boundValue(call: Call, column: string): unknown {
    const insert = call.sql.match(/INSERT INTO \w+\s*\(([^)]+)\)/);
    if (insert) {
      const columns = insert[1].split(',').map((s) => s.trim());
      return columns.includes(column) ? call.binds[columns.indexOf(column)] : undefined;
    }
    const setClause = call.sql.slice(call.sql.indexOf('SET'), call.sql.indexOf('WHERE'));
    const columns = [...setClause.matchAll(/(\w+)\s*=\s*\?/g)].map((m) => m[1]);
    return columns.includes(column) ? call.binds[columns.indexOf(column)] : undefined;
  }

  async function send(method: 'POST' | 'PUT', path: string, body: Record<string, unknown>) {
    const { db, calls } = recordingDb();
    const { app, env } = makeApp(db);
    const res = await app.request(
      `${path}?account_id=acc1`,
      { method, body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } },
      env,
    );
    const write = calls.find((c) => /^\s*(INSERT|UPDATE)/.test(c.sql));
    return { status: res.status, stored: write ? boundValue(write, 'is_active') : undefined };
  }

  const staffBody = { name: '確認用', display_name: '確認用' };
  const menuBody = { name: '確認用', duration_minutes: 30, base_price: 0 };
  const off = [0, false, '0', 'false'];
  const on = [1, true, '1', 'true'];

  test.each(off)('PUT staff: %j is saved as OFF', async (value) => {
    const r = await send('PUT', '/api/booking/admin/staff/s1', { ...staffBody, is_active: value });
    expect(r).toEqual({ status: 200, stored: 0 });
  });

  test.each(on)('PUT staff: %j is saved as ON', async (value) => {
    const r = await send('PUT', '/api/booking/admin/staff/s1', { ...staffBody, is_active: value });
    expect(r).toEqual({ status: 200, stored: 1 });
  });

  test.each(off)('POST staff: %j creates the staff as OFF', async (value) => {
    const r = await send('POST', '/api/booking/admin/staff', { ...staffBody, is_active: value });
    expect(r).toEqual({ status: 201, stored: 0 });
  });

  test.each(on)('POST staff: %j creates the staff as ON', async (value) => {
    const r = await send('POST', '/api/booking/admin/staff', { ...staffBody, is_active: value });
    expect(r).toEqual({ status: 201, stored: 1 });
  });

  test('staff: omitted is_active keeps the default ON', async () => {
    expect((await send('POST', '/api/booking/admin/staff', staffBody)).stored).toBe(1);
    expect((await send('PUT', '/api/booking/admin/staff/s1', staffBody)).stored).toBe(1);
  });

  test.each(off)('PUT menu: %j is saved as OFF (with and without auto_tag_id)', async (value) => {
    const withTag = await send('PUT', '/api/booking/admin/menus/m1', { ...menuBody, is_active: value, auto_tag_id: '' });
    const withoutTag = await send('PUT', '/api/booking/admin/menus/m1', { ...menuBody, is_active: value });
    expect(withTag).toEqual({ status: 200, stored: 0 });
    expect(withoutTag).toEqual({ status: 200, stored: 0 });
  });

  test.each(on)('PUT menu: %j is saved as ON', async (value) => {
    const r = await send('PUT', '/api/booking/admin/menus/m1', { ...menuBody, is_active: value });
    expect(r).toEqual({ status: 200, stored: 1 });
  });

  test.each(off)('POST menu: %j creates the menu as OFF', async (value) => {
    const r = await send('POST', '/api/booking/admin/menus', { ...menuBody, is_active: value });
    expect(r).toEqual({ status: 201, stored: 0 });
  });

  test('menu: omitted is_active keeps the default ON', async () => {
    expect((await send('POST', '/api/booking/admin/menus', menuBody)).stored).toBe(1);
    expect((await send('PUT', '/api/booking/admin/menus/m1', menuBody)).stored).toBe(1);
  });
});
