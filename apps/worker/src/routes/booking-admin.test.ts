import { describe, expect, test, vi } from 'vitest';
import { Hono } from 'hono';
import { signCalendarState, verifyCalendarState } from '../services/staff-calendar.js';

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

function makeApp(db: unknown, envOverrides: Record<string, unknown> = {}) {
  const app = new Hono();
  app.route('/', booking);
  return { app, env: { DB: db, ...envOverrides } };
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
  const methodsFor = (sql: string, params: unknown[]) => {
    const h = handlers.find(([frag]) => sql.includes(frag))?.[1] ?? {};
    return {
      first: async () => h.first ?? null,
      all: async () => h.all ?? { results: [] },
      run: async () => h.run ?? { meta: { changes: 0 } },
    };
  };
  return {
    calls,
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          calls.push({ sql, params });
          return methodsFor(sql, params);
        },
        first: async () => {
          calls.push({ sql, params: [] });
          return methodsFor(sql, []).first();
        },
        all: async () => {
          calls.push({ sql, params: [] });
          return methodsFor(sql, []).all();
        },
        run: async () => {
          calls.push({ sql, params: [] });
          return methodsFor(sql, []).run();
        },
      };
    },
    async batch(stmts: unknown[]) {
      return stmts;
    },
  };
}

function settingsDb(initialValue: string | null = null, initialCalendarSummary: string | null = null) {
  const values = new Map<string, string>();
  if (initialValue !== null) values.set('booking_notification_templates', initialValue);
  if (initialCalendarSummary !== null) {
    values.set('booking_calendar_event_summary', initialCalendarSummary);
  }
  const calls: { sql: string; params: unknown[] }[] = [];
  return {
    calls,
    get storedValue() {
      return values.get('booking_notification_templates') ?? null;
    },
    get calendarSummary() {
      return values.get('booking_calendar_event_summary') ?? null;
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
            const value = values.get(String(params[1]));
            return value === undefined ? null : { value };
          }
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => {
          if (sql.includes('INSERT INTO account_settings')) {
            values.set(String(params[2]), String(params[3]));
          }
          if (sql.includes('DELETE FROM account_settings')) {
            values.delete(String(params[1]));
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

const googleEnv = {
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
};

const connectedCalendar = {
  id: 'cal-1',
  staff_id: 's1',
  google_calendar_id: 'primary',
  refresh_token: 'refresh-token',
  access_token: 'valid-access-token',
  access_token_expires_at: '2100-01-01T00:00:00.000Z',
  sync_events: 1,
  created_at: '2026-07-01T00:00:00.000Z',
  updated_at: '2026-07-01T00:00:00.000Z',
};

type StaffBlockRow = {
  id: string;
  staff_id: string;
  block_date: string;
  start_time: string;
  end_time: string;
  reason: string | null;
  created_at: string;
};

function staffBlocksDb() {
  let blocks: StaffBlockRow[] = [];
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            first: async () => {
              if (sql.includes('FROM staff WHERE')) return { ok: 1 };
              return null;
            },
            all: async () => {
              if (!sql.includes('FROM staff_blocks')) return { results: [] };
              const [staffId, from, to] = params as [string, string, string];
              return {
                results: blocks
                  .filter((b) => b.staff_id === staffId)
                  .filter((b) => b.block_date >= from && b.block_date <= to)
                  .map(({ staff_id, ...b }) => b),
              };
            },
            run: async () => {
              if (sql.includes('INSERT INTO staff_blocks')) {
                const [id, staffId, blockDate, startTime, endTime, reason, createdAt] = params as [
                  string,
                  string,
                  string,
                  string,
                  string,
                  string | null,
                  string,
                ];
                blocks = [...blocks, {
                  id,
                  staff_id: staffId,
                  block_date: blockDate,
                  start_time: startTime,
                  end_time: endTime,
                  reason,
                  created_at: createdAt,
                }];
                return { meta: { changes: 1 } };
              }
              if (sql.includes('DELETE FROM staff_blocks')) {
                const [blockId, staffId] = params as [string, string];
                const before = blocks.length;
                blocks = blocks.filter((b) => b.id !== blockId || b.staff_id !== staffId);
                return { meta: { changes: before - blocks.length } };
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  };
}

describe('GET/PUT /api/booking/admin/notification-templates', () => {
  test('GET は保存テンプレート・既定文言・プレースホルダを返す', async () => {
    const db = settingsDb(JSON.stringify({ requested: '受付 {menu}' }), '{friend} / {menu}');
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
      calendar_event_summary: string;
      calendar_event_summary_default: string;
      calendar_event_summary_placeholders: string[];
    };
    expect(body.templates.requested).toBe('受付 {menu}');
    expect(body.templates.approved).toBeNull();
    expect(body.defaults.requested).toContain('{menu}');
    expect(body.placeholders).toEqual(['{menu}', '{staff}', '{datetime}', '{hours}']);
    expect(body.calendar_event_summary).toBe('{friend} / {menu}');
    expect(body.calendar_event_summary_default).toBe('{menu}: {friend}');
    expect(body.calendar_event_summary_placeholders).toEqual(['{friend}', '{menu}']);
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

  test('PUT はGoogle Calendar件名テンプレートを兄弟設定として保存する', async () => {
    const db = settingsDb();
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/notification-templates?account_id=acc1',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templates: {},
          calendar_event_summary: '{friend} 様 - {menu}',
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    expect(db.calendarSummary).toBe('{friend} 様 - {menu}');
    expect((await res.json() as { calendar_event_summary: string }).calendar_event_summary)
      .toBe('{friend} 様 - {menu}');
  });
});

describe('POST /api/booking/admin/bookings', () => {
  const validBody = {
    friend_id: 'f1',
    menu_id: 'm1',
    staff_id: 's1',
    starts_at: '2099-07-10T02:00:00.000Z', // JST 11:00
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

  test('Google FreeBusyが予約区間と重なると409 slot_conflictを返す', async () => {
    availabilityMocks.computeSlots.mockReturnValue([{ start: '11:00', end: '12:00' }]);
    const db = scriptedDb([
      ['FROM friends', { first: { id: 'f1', is_following: 1 } }],
      ['FROM staff WHERE', { first: { ok: 1 } }],
      ['FROM menus m', { first: {
        duration_minutes: 60,
        buffer_after_minutes: 10,
        dur: 60,
        price: 8000,
        is_offered: 1,
      } }],
      ['FROM staff_shifts', { first: { start_time: '10:00', end_time: '19:00' } }],
      ['SELECT starts_at, block_ends_at FROM bookings', { all: { results: [] } }],
      ['FROM staff_calendar_connections', { first: connectedCalendar }],
      ['INSERT INTO bookings', { run: { meta: { changes: 1 } } }],
    ]);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      calendars: {
        primary: { busy: [{ start: '2099-07-10T02:30:00.000Z', end: '2099-07-10T03:30:00.000Z' }] },
      },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { app, env } = makeApp(db, googleEnv);
      const res = await app.request(
        '/api/booking/admin/bookings?account_id=acc1',
        {
          method: 'POST',
          body: JSON.stringify({ ...validBody, starts_at: '2099-07-10T02:00:00.000Z' }),
          headers: { 'Content-Type': 'application/json' },
        },
        env,
        execCtx,
      );

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'slot_conflict' });
      expect(db.calls.some((c) => c.sql.includes('INSERT INTO bookings'))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('Google FreeBusy APIエラー時はfail-openで予約を作成する', async () => {
    availabilityMocks.computeSlots.mockReturnValue([{ start: '11:00', end: '12:00' }]);
    const db = scriptedDb([
      ['FROM friends', { first: { id: 'f1', is_following: 1 } }],
      ['FROM staff WHERE', { first: { ok: 1 } }],
      ['FROM menus m', { first: {
        duration_minutes: 60,
        buffer_after_minutes: 10,
        dur: 60,
        price: 8000,
        is_offered: 1,
      } }],
      ['FROM staff_shifts', { first: { start_time: '10:00', end_time: '19:00' } }],
      ['SELECT starts_at, block_ends_at FROM bookings', { all: { results: [] } }],
      ['FROM staff_calendar_connections', { first: connectedCalendar }],
      ['INSERT INTO bookings', { run: { meta: { changes: 1 } } }],
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('Google unavailable'); }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { app, env } = makeApp(db, googleEnv);
      const res = await app.request(
        '/api/booking/admin/bookings?account_id=acc1',
        {
          method: 'POST',
          body: JSON.stringify({ ...validBody, starts_at: '2099-07-10T02:00:00.000Z' }),
          headers: { 'Content-Type': 'application/json' },
        },
        env,
        execCtx,
      );

      expect(res.status).toBe(201);
      expect(db.calls.some((c) => c.sql.includes('INSERT INTO bookings'))).toBe(true);
    } finally {
      errorSpy.mockRestore();
      vi.unstubAllGlobals();
    }
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

  test('409 slot_conflict when requested interval overlaps a staff block', async () => {
    availabilityMocks.computeSlots.mockReturnValue([{ start: '11:00', end: '12:00' }]);
    const db = scriptedDb([
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
      ['SELECT start_time, end_time FROM staff_blocks', {
        all: { results: [{ start_time: '10:30', end_time: '11:30' }] },
      }],
      ['SELECT starts_at, block_ends_at FROM bookings', { all: { results: [] } }],
      ['INSERT INTO bookings', { run: { meta: { changes: 1 } } }],
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
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'slot_conflict' });
    expect(db.calls.some((c) => c.sql.includes('INSERT INTO bookings'))).toBe(false);
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

describe('POST /api/booking/admin/bookings/:id/complete', () => {
  test('confirmed を completed に更新し、未送信 reminder を cancelled にする', async () => {
    const db = scriptedDb([
      ['SELECT id, status FROM bookings', { first: { id: 'b1', status: 'confirmed' } }],
      ['UPDATE bookings SET status =', { run: { meta: { changes: 1 } } }],
      ['UPDATE booking_reminders SET status', { run: { meta: { changes: 2 } } }],
    ]);
    const { app, env } = makeApp(db);

    const res = await app.request(
      '/api/booking/admin/bookings/b1/complete?account_id=acc1',
      { method: 'POST' },
      env,
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'completed' });
    const bookingUpdate = db.calls.find((c) => c.sql.includes('UPDATE bookings SET status ='));
    expect(bookingUpdate?.params).toEqual(['b1', 'acc1']);
    expect(bookingUpdate?.sql).toContain("status = 'completed'");
    expect(bookingUpdate?.sql).toContain("status = 'confirmed'");
    expect(bookingUpdate?.sql).toContain('updated_at');
    const reminderUpdate = db.calls.find((c) =>
      c.sql.includes('UPDATE booking_reminders SET status'),
    );
    expect(reminderUpdate?.params).toEqual(['b1']);
    expect(reminderUpdate?.sql).toContain("status = 'cancelled'");
    expect(reminderUpdate?.sql).toContain("status IN ('pending','failed')");
  });

  test('confirmed 以外は 409 invalid_status を返す', async () => {
    const db = scriptedDb([
      ['SELECT id, status FROM bookings', { first: { id: 'b1', status: 'requested' } }],
    ]);
    const { app, env } = makeApp(db);

    const res = await app.request(
      '/api/booking/admin/bookings/b1/complete?account_id=acc1',
      { method: 'POST' },
      env,
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'invalid_status' });
    expect(db.calls.some((c) => c.sql.includes('UPDATE bookings SET status ='))).toBe(false);
  });

  test('存在しない booking は 404 を返す', async () => {
    const db = scriptedDb([['SELECT id, status FROM bookings', { first: null }]]);
    const { app, env } = makeApp(db);

    const res = await app.request(
      '/api/booking/admin/bookings/missing/complete?account_id=acc1',
      { method: 'POST' },
      env,
    );

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not_found' });
  });
});

describe('POST /api/liff/booking/requests staff blocks', () => {
  const validBody = {
    menu_id: 'm1',
    staff_id: 's1',
    starts_at: '2099-07-10T02:00:00.000Z', // JST 11:00
  };

  test('409 slot_conflict when requested interval overlaps a staff block', async () => {
    availabilityMocks.computeSlots.mockReturnValue([{ start: '11:00', end: '12:00' }]);
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ sub: 'U1' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const db = scriptedDb([
      ['FROM line_accounts WHERE liff_id', { first: { id: 'acc1' } }],
      ['FROM line_accounts ORDER BY', {
        all: {
          results: [{
            id: 'acc1',
            channel_id: 'login-channel',
            login_channel_id: 'login-channel',
            liff_id: 'liff1',
          }],
        },
      }],
      ['line_user_id = ? AND line_account_id', { first: { id: 'f1' } }],
      ['SELECT is_following FROM friends', { first: { is_following: 1 } }],
      [
        'FROM menus m',
        {
          first: {
            duration_minutes: 60,
            buffer_after_minutes: 10,
            auto_tag_id: null,
            dur: 60,
            price: 8000,
            is_offered: 1,
          },
        },
      ],
      ['FROM staff_shifts', { first: { start_time: '10:00', end_time: '19:00' } }],
      ['SELECT start_time, end_time FROM staff_blocks', {
        all: { results: [{ start_time: '10:30', end_time: '11:30' }] },
      }],
      ['SELECT starts_at, block_ends_at FROM bookings', { all: { results: [] } }],
      ['INSERT INTO booking_idempotency_keys', { run: { meta: { changes: 1 } } }],
    ]);
    try {
      const { app, env } = makeApp(db);
      const res = await app.request(
        '/api/liff/booking/requests?liffId=liff1',
        {
          method: 'POST',
          body: JSON.stringify(validBody),
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': 'idem-1',
            Authorization: 'Bearer token',
          },
        },
        env,
        execCtx,
      );
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'slot_conflict' });
      expect(db.calls.some((c) => c.sql.includes('INSERT INTO bookings'))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  function liffCalendarDb() {
    return scriptedDb([
      ['FROM line_accounts WHERE liff_id', { first: { id: 'acc1' } }],
      ['FROM line_accounts ORDER BY', { all: { results: [] } }],
      ['line_user_id = ? AND line_account_id', { first: { id: 'f1' } }],
      ['SELECT is_following FROM friends', { first: { is_following: 1 } }],
      ['FROM menus m', { first: {
        duration_minutes: 60,
        buffer_after_minutes: 10,
        auto_tag_id: null,
        dur: 60,
        price: 8000,
        is_offered: 1,
      } }],
      ['FROM staff_shifts', { first: { start_time: '10:00', end_time: '19:00' } }],
      ['SELECT starts_at, block_ends_at FROM bookings', { all: { results: [] } }],
      ['FROM staff_calendar_connections', { first: connectedCalendar }],
      ['INSERT INTO bookings', { run: { meta: { changes: 1 } } }],
      ['INSERT INTO booking_idempotency_keys', { run: { meta: { changes: 1 } } }],
    ]);
  }

  test('LIFF作成でもGoogle FreeBusy競合を409 slot_conflictにする', async () => {
    availabilityMocks.computeSlots.mockReturnValue([{ start: '11:00', end: '12:00' }]);
    const db = liffCalendarDb();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('api.line.me')) return new Response(JSON.stringify({ sub: 'U1' }), { status: 200 });
      return new Response(JSON.stringify({
        calendars: {
          primary: { busy: [{ start: '2099-07-10T02:30:00.000Z', end: '2099-07-10T03:30:00.000Z' }] },
        },
      }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { app, env } = makeApp(db, { ...googleEnv, LINE_LOGIN_CHANNEL_ID: 'login-channel' });
      const res = await app.request(
        '/api/liff/booking/requests?liffId=liff1',
        {
          method: 'POST',
          body: JSON.stringify({ ...validBody, starts_at: '2099-07-10T02:00:00.000Z' }),
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': 'idem-freebusy-conflict',
            Authorization: 'Bearer token',
          },
        },
        env,
        execCtx,
      );

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'slot_conflict' });
      expect(db.calls.some((c) => c.sql.includes('INSERT INTO bookings'))).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  test('LIFF作成でもGoogle FreeBusy APIエラーはfail-openにする', async () => {
    availabilityMocks.computeSlots.mockReturnValue([{ start: '11:00', end: '12:00' }]);
    const db = liffCalendarDb();
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('api.line.me')) return new Response(JSON.stringify({ sub: 'U1' }), { status: 200 });
      throw new Error('Google unavailable');
    });
    vi.stubGlobal('fetch', fetchMock);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { app, env } = makeApp(db, { ...googleEnv, LINE_LOGIN_CHANNEL_ID: 'login-channel' });
      const res = await app.request(
        '/api/liff/booking/requests?liffId=liff1',
        {
          method: 'POST',
          body: JSON.stringify({ ...validBody, starts_at: '2099-07-10T02:00:00.000Z' }),
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': 'idem-freebusy-open',
            Authorization: 'Bearer token',
          },
        },
        env,
        execCtx,
      );

      expect(res.status).toBe(201);
      expect(db.calls.some((c) => c.sql.includes('INSERT INTO bookings'))).toBe(true);
    } finally {
      errorSpy.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

describe('GET/POST/DELETE /api/booking/admin/staff/:id/blocks', () => {
  test('full CRUD roundtrip', async () => {
    const db = staffBlocksDb();
    const { app, env } = makeApp(db);
    const create = await app.request(
      '/api/booking/admin/staff/s1/blocks?account_id=acc1',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          block_date: '2026-07-10',
          start_time: '13:00',
          end_time: '14:30',
          reason: '社内MTG',
        }),
      },
      env,
    );
    expect(create.status).toBe(201);
    const created = (await create.json()) as { id: string };
    expect(created.id).toEqual(expect.any(String));

    const list = await app.request(
      '/api/booking/admin/staff/s1/blocks?account_id=acc1&from=2026-07-01&to=2026-07-31',
      {},
      env,
    );
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { blocks: Array<Omit<StaffBlockRow, 'staff_id'>> };
    expect(listed.blocks).toEqual([{
      id: created.id,
      block_date: '2026-07-10',
      start_time: '13:00',
      end_time: '14:30',
      reason: '社内MTG',
      created_at: expect.any(String),
    }]);

    const del = await app.request(
      `/api/booking/admin/staff/s1/blocks/${created.id}?account_id=acc1`,
      { method: 'DELETE' },
      env,
    );
    expect(del.status).toBe(200);
    expect(await del.json()).toEqual({ ok: true });

    const after = await app.request(
      '/api/booking/admin/staff/s1/blocks?account_id=acc1&from=2026-07-01&to=2026-07-31',
      {},
      env,
    );
    expect(await after.json()).toEqual({ blocks: [] });
  });

  test('POST rejects invalid time range', async () => {
    const db = staffBlocksDb();
    const { app, env } = makeApp(db);
    const res = await app.request(
      '/api/booking/admin/staff/s1/blocks?account_id=acc1',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          block_date: '2026-07-10',
          start_time: '14:00',
          end_time: '13:00',
        }),
      },
      env,
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'invalid_time_range' });
  });
});

type OAuthStateTestRow = {
  nonce: string;
  staffId: string;
  expiresAt: string;
  consumedAt: string | null;
};

function oauthStateDb(initial: OAuthStateTestRow[] = []) {
  const states = new Map(initial.map((row) => [row.nonce, { ...row }]));
  let connectionUpserts = 0;
  return {
    states,
    get connectionUpserts() {
      return connectionUpserts;
    },
    prepare(sql: string) {
      let params: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          params = args;
          return stmt;
        },
        first: async () => {
          if (sql.includes('FROM staff WHERE')) return { ok: 1 };
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => {
          if (sql.includes('INSERT INTO oauth_states')) {
            const [, nonce, staffId, expiresAt] = params as [string, string, string, string];
            states.set(nonce, { nonce, staffId, expiresAt, consumedAt: null });
            return { meta: { changes: 1 } };
          }
          if (sql.includes('UPDATE oauth_states')) {
            const [consumedAt, nonce, staffId, nowIso] = params as [string, string, string, string];
            const row = states.get(nonce);
            if (
              !row ||
              row.staffId !== staffId ||
              row.consumedAt !== null ||
              row.expiresAt <= nowIso
            ) {
              return { meta: { changes: 0 } };
            }
            row.consumedAt = consumedAt;
            return { meta: { changes: 1 } };
          }
          if (sql.includes('INSERT INTO staff_calendar_connections')) {
            connectionUpserts += 1;
            return { meta: { changes: 1 } };
          }
          return { meta: { changes: 1 } };
        },
      };
      return stmt;
    },
  };
}

describe('Google Calendar OAuth callback state', () => {
  const oauthEnv = { ...googleEnv, WORKER_PUBLIC_URL: 'https://worker.example.com' };

  test('connectで10分有効のnonceを発行しoauth_statesへ保存する', async () => {
    const db = oauthStateDb();
    const { app, env } = makeApp(db, oauthEnv);
    const before = Math.floor(Date.now() / 1000);
    const res = await app.request(
      '/api/booking/admin/staff/s1/gcal/connect?account_id=acc1',
      {},
      env,
    );

    expect(res.status).toBe(200);
    const { url } = await res.json() as { url: string };
    const state = new URL(url).searchParams.get('state');
    expect(state).toBeTruthy();
    const payload = await verifyCalendarState(state!, googleEnv.GOOGLE_CLIENT_SECRET);
    expect(payload?.exp).toBeGreaterThanOrEqual(before + 599);
    expect(payload?.exp).toBeLessThanOrEqual(before + 601);
    expect(payload?.nonce).toEqual(expect.any(String));
    expect(db.states.get(payload!.nonce)?.staffId).toBe('s1');
  });

  test('期限切れstateを拒否する', async () => {
    const exp = Math.floor(Date.now() / 1000) - 1;
    const state = await signCalendarState(
      { staffId: 's1', accountId: 'acc1', exp, nonce: 'expired-nonce' },
      googleEnv.GOOGLE_CLIENT_SECRET,
    );
    const db = oauthStateDb([{
      nonce: 'expired-nonce',
      staffId: 's1',
      expiresAt: new Date((exp + 3600) * 1000).toISOString(),
      consumedAt: null,
    }]);
    const { app, env } = makeApp(db, oauthEnv);
    const res = await app.request(`/api/booking/gcal/callback?code=code&state=${encodeURIComponent(state)}`, {}, env);

    expect(res.status).toBe(400);
  });

  test('消費済みstateを拒否する', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const state = await signCalendarState(
      { staffId: 's1', accountId: 'acc1', exp, nonce: 'consumed-nonce' },
      googleEnv.GOOGLE_CLIENT_SECRET,
    );
    const db = oauthStateDb([{
      nonce: 'consumed-nonce',
      staffId: 's1',
      expiresAt: new Date(exp * 1000).toISOString(),
      consumedAt: new Date().toISOString(),
    }]);
    const { app, env } = makeApp(db, oauthEnv);
    const res = await app.request(`/api/booking/gcal/callback?code=code&state=${encodeURIComponent(state)}`, {}, env);

    expect(res.status).toBe(400);
  });

  test('oauth_statesに存在しないstateを拒否する', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const state = await signCalendarState(
      { staffId: 's1', accountId: 'acc1', exp, nonce: 'unknown-nonce' },
      googleEnv.GOOGLE_CLIENT_SECRET,
    );
    const db = oauthStateDb();
    const { app, env } = makeApp(db, oauthEnv);
    const res = await app.request(`/api/booking/gcal/callback?code=code&state=${encodeURIComponent(state)}`, {}, env);

    expect(res.status).toBe(400);
  });

  test('有効なstateは1回だけ受理する', async () => {
    const exp = Math.floor(Date.now() / 1000) + 600;
    const state = await signCalendarState(
      { staffId: 's1', accountId: 'acc1', exp, nonce: 'valid-nonce' },
      googleEnv.GOOGLE_CLIENT_SECRET,
    );
    const db = oauthStateDb([{
      nonce: 'valid-nonce',
      staffId: 's1',
      expiresAt: new Date(exp * 1000).toISOString(),
      consumedAt: null,
    }]);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      access_token: 'access-token',
      refresh_token: 'refresh-token',
      expires_in: 3600,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const { app, env } = makeApp(db, oauthEnv);
      const url = `/api/booking/gcal/callback?code=code&state=${encodeURIComponent(state)}`;
      const first = await app.request(url, {}, env);
      const replay = await app.request(url, {}, env);

      expect(first.status).toBe(200);
      expect(replay.status).toBe(400);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(db.connectionUpserts).toBe(1);
    } finally {
      vi.unstubAllGlobals();
    }
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
