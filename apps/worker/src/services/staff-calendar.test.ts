import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  getValidAccessToken,
  reconcileBookingCalendarEvents,
  signCalendarState,
  syncBookingEventCreate,
  syncBookingEventDelete,
  verifyCalendarState,
  type StaffCalendarConnectionRow,
} from './staff-calendar.js';

const ENV = {
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function tokenDb(row: StaffCalendarConnectionRow) {
  const updates: { accessToken?: string; expiresAt?: string } = {};
  return {
    updates,
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            first: async () => {
              if (sql.includes('FROM staff_calendar_connections')) return row;
              return null;
            },
            all: async () => ({ results: [] }),
            run: async () => {
              if (sql.includes('UPDATE staff_calendar_connections')) {
                updates.accessToken = String(params[0]);
                updates.expiresAt = String(params[1]);
              }
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database & { updates: typeof updates };
}

describe('staff calendar OAuth state', () => {
  test('HMAC署名したstateを検証でき、改ざんは拒否する', async () => {
    const payload = {
      staffId: 'S1',
      accountId: 'A1',
      exp: Math.floor(Date.now() / 1000) + 600,
      nonce: 'nonce-1',
    };
    const state = await signCalendarState(payload, ENV.GOOGLE_CLIENT_SECRET);

    await expect(verifyCalendarState(state, ENV.GOOGLE_CLIENT_SECRET)).resolves.toEqual(payload);
    await expect(verifyCalendarState(`${state}x`, ENV.GOOGLE_CLIENT_SECRET)).resolves.toBeNull();
  });
});

describe('getValidAccessToken', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test('期限切れaccess_tokenをrefresh_tokenで更新する', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ access_token: 'new-access', expires_in: 3600 }));
    vi.stubGlobal('fetch', fetchMock);
    const db = tokenDb({
      id: 'C1',
      staff_id: 'S1',
      google_calendar_id: 'primary',
      refresh_token: 'refresh-token',
      access_token: 'old-access',
      access_token_expires_at: '2026-05-09T00:00:00.000Z',
      sync_events: 1,
      created_at: '2026-05-08T00:00:00.000Z',
      updated_at: '2026-05-08T00:00:00.000Z',
    });

    const token = await getValidAccessToken(
      db,
      'S1',
      ENV,
      new Date('2026-05-09T01:00:00.000Z'),
    );

    expect(token).toEqual({ accessToken: 'new-access', calendarId: 'primary', syncEvents: true });
    expect(db.updates.accessToken).toBe('new-access');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = init.body as URLSearchParams;
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('refresh-token');
  });
});

function calendarSyncDb(options: {
  connection: StaffCalendarConnectionRow;
  booking: {
    id: string;
    line_account_id: string;
    staff_id: string;
    status: string;
    starts_at: string;
    ends_at: string;
    customer_note: string | null;
    external_event_id: string | null;
    menu_name: string;
    friend_name: string | null;
  };
  statusReads?: string[];
  eventSummaryTemplate?: string | null;
}) {
  const bookingUpdates: Array<{ sql: string; params: unknown[] }> = [];
  const statusReads = [...(options.statusReads ?? [options.booking.status, options.booking.status])];
  return {
    bookingUpdates,
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            first: async () => {
              if (sql.includes('FROM bookings b')) return options.booking;
              if (sql.includes('SELECT status FROM bookings')) {
                return { status: statusReads.shift() ?? options.booking.status };
              }
              if (sql.includes('FROM bookings') && sql.includes('external_event_id')) {
                return {
                  id: options.booking.id,
                  staff_id: options.booking.staff_id,
                  external_event_id: options.booking.external_event_id,
                };
              }
              if (sql.includes('FROM account_settings')) {
                return options.eventSummaryTemplate == null
                  ? null
                  : { value: options.eventSummaryTemplate };
              }
              if (sql.includes('FROM staff_calendar_connections')) return options.connection;
              return null;
            },
            all: async () => ({ results: [] }),
            run: async () => {
              if (sql.includes('UPDATE bookings')) bookingUpdates.push({ sql, params });
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database & {
    bookingUpdates: Array<{ sql: string; params: unknown[] }>;
  };
}

describe('booking Google Calendar event sync', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const connection: StaffCalendarConnectionRow = {
    id: 'C1',
    staff_id: 'S1',
    google_calendar_id: 'primary',
    refresh_token: 'refresh-token',
    access_token: 'valid-access',
    access_token_expires_at: '2027-05-09T10:00:00.000Z',
    sync_events: 1,
    created_at: '2026-05-08T00:00:00.000Z',
    updated_at: '2026-05-08T00:00:00.000Z',
  };

  test('確定予約をGoogle Calendar eventとして作成しevent idを保存する', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'gcal-event-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const db = calendarSyncDb({
      connection,
      booking: {
        id: 'B1',
        line_account_id: 'A1',
        staff_id: 'S1',
        status: 'confirmed',
        starts_at: '2026-05-09T02:00:00.000Z',
        ends_at: '2026-05-09T03:00:00.000Z',
        customer_note: '履歴書確認',
        external_event_id: null,
        menu_name: '一次面接',
        friend_name: '山田太郎',
      },
    });

    await syncBookingEventCreate(db, 'B1', ENV);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/calendars/primary/events');
    const body = JSON.parse(String(init.body)) as { summary: string; description: string };
    expect(body.summary).toBe('一次面接: 山田太郎');
    expect(body.description).toContain('一次面接');
    expect(body.description).toContain('履歴書確認');
    expect(db.bookingUpdates[0].params[0]).toBe('gcal-event-1');
  });

  test('設定した件名テンプレートの{friend}と{menu}を置換する', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ id: 'gcal-event-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const db = calendarSyncDb({
      connection,
      eventSummaryTemplate: '{friend} 様 / {menu}',
      booking: {
        id: 'B1',
        line_account_id: 'A1',
        staff_id: 'S1',
        status: 'confirmed',
        starts_at: '2026-05-09T02:00:00.000Z',
        ends_at: '2026-05-09T03:00:00.000Z',
        customer_note: null,
        external_event_id: null,
        menu_name: '一次面接',
        friend_name: '山田太郎',
      },
    });

    await syncBookingEventCreate(db, 'B1', ENV);

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body)).summary).toBe('山田太郎 様 / 一次面接');
  });

  test('作成直前に予約がconfirmedでなければeventを作成しない', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const db = calendarSyncDb({
      connection,
      statusReads: ['cancelled'],
      booking: {
        id: 'B1',
        line_account_id: 'A1',
        staff_id: 'S1',
        status: 'confirmed',
        starts_at: '2026-05-09T02:00:00.000Z',
        ends_at: '2026-05-09T03:00:00.000Z',
        customer_note: null,
        external_event_id: null,
        menu_name: '一次面接',
        friend_name: '山田太郎',
      },
    });

    await syncBookingEventCreate(db, 'B1', ENV);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(db.bookingUpdates).toHaveLength(0);
  });

  test('event作成中に予約がcancelledへ変わったら作成eventを削除する', async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : jsonResponse({ id: 'gcal-event-1' }));
    vi.stubGlobal('fetch', fetchMock);
    const db = calendarSyncDb({
      connection,
      statusReads: ['confirmed', 'cancelled'],
      booking: {
        id: 'B1',
        line_account_id: 'A1',
        staff_id: 'S1',
        status: 'confirmed',
        starts_at: '2026-05-09T02:00:00.000Z',
        ends_at: '2026-05-09T03:00:00.000Z',
        customer_note: null,
        external_event_id: null,
        menu_name: '一次面接',
        friend_name: '山田太郎',
      },
    });

    await syncBookingEventCreate(db, 'B1', ENV);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST');
    expect(fetchMock.mock.calls[1][1]?.method).toBe('DELETE');
    expect(db.bookingUpdates).toHaveLength(0);
  });

  test('キャンセル済み予約のGoogle Calendar eventを削除してexternal_event_idを消す', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const db = calendarSyncDb({
      connection,
      booking: {
        id: 'B1',
        line_account_id: 'A1',
        staff_id: 'S1',
        status: 'cancelled',
        starts_at: '2026-05-09T02:00:00.000Z',
        ends_at: '2026-05-09T03:00:00.000Z',
        customer_note: null,
        external_event_id: 'gcal-event-1',
        menu_name: '一次面接',
        friend_name: '山田太郎',
      },
    });

    await syncBookingEventDelete(db, 'B1', ENV);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.method).toBe('DELETE');
    expect(url).toContain('/events/gcal-event-1');
    expect(db.bookingUpdates).toHaveLength(1);
  });
});

describe('booking Google Calendar reconciliation', () => {
  test('作成・削除を各20件に制限し、1件失敗しても残りを継続する', async () => {
    const queries: string[] = [];
    const db = {
      prepare(sql: string) {
        queries.push(sql);
        return {
          bind: () => ({
            all: async () => ({
              results: Array.from({ length: 25 }, (_, i) => ({
                id: `${sql.includes("b.status = 'confirmed'") ? 'create' : 'delete'}-${i}`,
              })),
            }),
          }),
        };
      },
    } as unknown as D1Database;
    const createEvent = vi.fn(async (_db: D1Database, bookingId: string) => {
      if (bookingId === 'create-0') throw new Error('temporary create failure');
    });
    const deleteEvent = vi.fn(async () => undefined);
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const result = await reconcileBookingCalendarEvents(db, ENV, {
      now: new Date('2026-07-10T00:00:00.000Z'),
      createEvent,
      deleteEvent,
    });

    expect(createEvent).toHaveBeenCalledTimes(20);
    expect(deleteEvent).toHaveBeenCalledTimes(20);
    expect(queries).toHaveLength(2);
    expect(queries.every((sql) => sql.includes('LIMIT 20'))).toBe(true);
    expect(result).toEqual({
      createAttempts: 20,
      createSucceeded: 19,
      deleteAttempts: 20,
      deleteSucceeded: 20,
      failed: 1,
    });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
