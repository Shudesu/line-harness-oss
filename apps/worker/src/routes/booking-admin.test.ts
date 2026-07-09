import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';

const availabilityMocks = {
  computeSlots: vi.fn(() => [] as { start: string; end: string }[]),
  getAvailability: vi.fn(async () => ({
    by_staff: [{ staff_id: 's1', display_name: 'A', slots: [] }],
  })),
};
vi.mock('../services/availability.js', () => availabilityMocks);

const notifierMocks = vi.hoisted(() => ({ sendBookingNotification: vi.fn() }));
vi.mock('../services/booking-notifier.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/booking-notifier.js')>();
  return { ...actual, sendBookingNotification: notifierMocks.sendBookingNotification };
});

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

function settingsDb(initialValue: string | null = null) {
  let storedValue = initialValue;
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    get storedValue() {
      return storedValue;
    },
    prepare(sql: string) {
      let params: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          params = args;
          calls.push({ sql, params });
          return stmt;
        },
        first: async () => {
          if (sql.includes('FROM account_settings')) {
            return storedValue === null ? null : { value: storedValue };
          }
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => {
          if (sql.includes('INSERT INTO account_settings')) {
            storedValue = String(params[3]);
          }
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
}

const execCtx = {
  waitUntil: () => undefined,
  passThroughOnException: () => undefined,
} as unknown as ExecutionContext;

describe('GET/PUT /api/booking/admin/notification-templates', () => {
  test('GET は保存テンプレート・既定文言・プレースホルダを返す', async () => {
    const db = settingsDb(JSON.stringify({ requested: '受付 {menu}' }));
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/notification-templates?account_id=acc1',
      {},
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      templates: Record<string, string | null>;
      defaults: Record<string, string>;
      placeholders: string[];
    };
    expect(body.templates.requested).toBe('受付 {menu}');
    expect(body.templates.approved).toBeNull();
    expect(body.defaults.requested).toContain('{menu}');
    expect(body.placeholders).toEqual(['{menu}', '{staff}', '{datetime}', '{hours}']);
  });

  test('PUT は未知キーを拒否する', async () => {
    const db = settingsDb();
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/notification-templates?account_id=acc1',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates: { requested: 'ok', unknown: 'ng' } }),
      },
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'unknown_template_key', key: 'unknown' });
  });

  test('PUT はnull以外の非文字列値を拒否する', async () => {
    const db = settingsDb();
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/notification-templates?account_id=acc1',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates: { requested: 123 } }),
      },
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_template_value', key: 'requested' });
  });

  test('PUT は1000文字超の値を拒否する', async () => {
    const db = settingsDb();
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/notification-templates?account_id=acc1',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates: { requested: 'あ'.repeat(1001) } }),
      },
      env,
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'template_too_long', key: 'requested' });
  });

  test('PUT は空文字/nullでその種類だけ既定に戻す', async () => {
    const db = settingsDb(JSON.stringify({
      requested: 'old requested',
      approved: 'old approved',
      rejected: 'keep rejected',
    }));
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/notification-templates?account_id=acc1',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates: { requested: '', approved: null } }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { templates: Record<string, string | null> };
    expect(body.templates.requested).toBeNull();
    expect(body.templates.approved).toBeNull();
    expect(body.templates.rejected).toBe('keep rejected');
    expect(JSON.parse(db.storedValue ?? '{}')).toEqual({ rejected: 'keep rejected' });
  });
});

describe('POST /api/booking/admin/bookings', () => {
  const validBody = {
    friend_id: 'f1',
    menu_id: 'm1',
    staff_id: 's1',
    starts_at: '2026-07-10T02:00:00.000Z', // JST 11:00
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

  test('existing-bookings window uses correct JST bounds for a September date', async () => {
    availabilityMocks.computeSlots.mockReturnValue([{ start: '11:00', end: '12:00' }]);
    const db = happyDb();
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/bookings?account_id=acc1',
      {
        method: 'POST',
        body: JSON.stringify({ ...validBody, starts_at: '2026-09-10T02:00:00.000Z' }),
        headers: { 'Content-Type': 'application/json' },
      },
      env,
      execCtx,
    );
    expect(res.status).toBe(201);
    // The busy-window query must bind real ISO timestamps, never a corrupted
    // string from the old `.replace('-09', ...)` (which mangled September dates).
    const windowQuery = db.calls.find(
      (c) => c.sql.includes('SELECT starts_at, block_ends_at FROM bookings'),
    );
    const [, endUtc, startUtc] = windowQuery!.params as [string, string, string];
    expect(startUtc).toBe('2026-09-09T15:00:00.000Z'); // JST 2026-09-10 00:00 = prev-day 15:00Z
    expect(endUtc).toBe('2026-09-10T15:00:00Z'); // JST 2026-09-11 00:00 = 2026-09-10 15:00Z
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
