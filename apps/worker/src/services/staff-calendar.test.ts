import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  getValidAccessToken,
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
    const state = await signCalendarState({ staffId: 'S1', accountId: 'A1' }, ENV.GOOGLE_CLIENT_SECRET);

    await expect(verifyCalendarState(state, ENV.GOOGLE_CLIENT_SECRET)).resolves.toEqual({
      staffId: 'S1',
      accountId: 'A1',
    });
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
    staff_id: string;
    starts_at: string;
    ends_at: string;
    customer_note: string | null;
    external_event_id: string | null;
    menu_name: string;
    friend_name: string | null;
  };
}) {
  const bookingUpdates: unknown[][] = [];
  return {
    bookingUpdates,
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          return {
            first: async () => {
              if (sql.includes('FROM bookings b')) return options.booking;
              if (sql.includes('FROM bookings') && sql.includes('external_event_id')) {
                return {
                  id: options.booking.id,
                  staff_id: options.booking.staff_id,
                  external_event_id: options.booking.external_event_id,
                };
              }
              if (sql.includes('FROM staff_calendar_connections')) return options.connection;
              return null;
            },
            all: async () => ({ results: [] }),
            run: async () => {
              if (sql.includes('UPDATE bookings')) bookingUpdates.push(params);
              return { meta: { changes: 1 } };
            },
          };
        },
      };
    },
  } as unknown as D1Database & { bookingUpdates: unknown[][] };
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
        staff_id: 'S1',
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
    expect(body.summary).toBe('面接: 山田太郎');
    expect(body.description).toContain('一次面接');
    expect(body.description).toContain('履歴書確認');
    expect(db.bookingUpdates[0][0]).toBe('gcal-event-1');
  });

  test('キャンセル済み予約のGoogle Calendar eventを削除してexternal_event_idを消す', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const db = calendarSyncDb({
      connection,
      booking: {
        id: 'B1',
        staff_id: 'S1',
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
