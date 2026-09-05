import { beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAvailability: vi.fn(),
  getStaffCalendarConnection: vi.fn(),
  syncConfirmedBookingToGoogle: vi.fn(),
  removeBookingFromGoogle: vi.fn(),
  registerMeetConsultation: vi.fn(),
  cancelMeetConsultation: vi.fn(),
  pushViaHarnessProxy: vi.fn(),
}));

vi.mock('./availability.js', () => ({ getAvailability: mocks.getAvailability }));
vi.mock('./booking-calendar-sync.js', () => ({
  getStaffCalendarConnection: mocks.getStaffCalendarConnection,
  syncConfirmedBookingToGoogle: mocks.syncConfirmedBookingToGoogle,
  removeBookingFromGoogle: mocks.removeBookingFromGoogle,
}));
vi.mock('./meet-consultation-reminders.js', () => ({
  registerMeetConsultation: mocks.registerMeetConsultation,
  cancelMeetConsultation: mocks.cancelMeetConsultation,
}));
vi.mock('./line-proxy-send.js', () => ({ pushViaHarnessProxy: mocks.pushViaHarnessProxy }));

const {
  bookWebinarConsultation,
  getWebinarConsultationAvailability,
  WebinarConsultationError,
} = await import('./webinar-consultation-booking.js');

interface DbOptions {
  existing?: {
    id: string;
    status: string;
    starts_at: string;
    meet_url: string | null;
  } | null;
  insertChanges?: number;
}

function fakeDb(options: DbOptions = {}): D1Database {
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn((..._args: unknown[]) => ({
      first: vi.fn(async () => {
        if (sql.includes('FROM webinar_followup_configs')) {
          return { booking_menu_id: 'menu-1', booking_url: 'https://example.com/fallback' };
        }
        if (sql.includes('FROM form_submissions fs')) return { ok: 1 };
        if (sql.includes('FROM menus m') && sql.includes('INNER JOIN staff_menus')) {
          return {
            menu_id: 'menu-1', menu_name: '個別相談', duration_minutes: 15,
            buffer_after_minutes: 0, price: 0, staff_id: 'staff-1', staff_name: '野田',
          };
        }
        if (sql.includes('FROM bookings b') && sql.includes('LEFT JOIN meet_consultations')) {
          return options.existing ?? null;
        }
        if (sql.includes('SELECT ends_at, external_event_id')) {
          return { ends_at: '2026-08-20T01:15:00.000Z', external_event_id: 'event-existing' };
        }
        if (sql.includes('SELECT f.line_user_id')) {
          return { line_user_id: 'U123', channel_access_token: 'line-token' };
        }
        return null;
      }),
      run: vi.fn(async () => ({ meta: { changes: options.insertChanges ?? 1 } })),
      all: vi.fn(async () => ({ results: [] })),
    })),
  }));
  return { prepare } as unknown as D1Database;
}

const base = {
  webinarId: 'webinar-1',
  webinarTitle: 'NODA AI LIVE',
  accountId: 'account-1',
  friendId: 'friend-1',
  now: new Date('2026-08-14T00:00:00.000Z'),
  credentials: { email: 'calendar@example.iam.gserviceaccount.com', privateKey: 'secret' },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getStaffCalendarConnection.mockResolvedValue({
    id: 'connection-1', calendar_id: 'primary', auth_type: 'service_account', access_token: null,
  });
  mocks.getAvailability.mockResolvedValue({
    by_staff: [{
      staff_id: 'staff-1', display_name: '野田',
      slots: [{ date: '2026-08-20', start: '10:00', end: '10:15' }],
    }],
  });
  mocks.syncConfirmedBookingToGoogle.mockResolvedValue({
    synced: true,
    eventId: 'event-1',
    meetUrl: 'https://meet.google.com/abc-defg-hij',
    calendarId: 'primary',
  });
  mocks.registerMeetConsultation.mockResolvedValue({ id: 'consult-1', reminders: [] });
  mocks.pushViaHarnessProxy.mockResolvedValue(undefined);
  mocks.cancelMeetConsultation.mockResolvedValue(true);
  mocks.removeBookingFromGoogle.mockResolvedValue(undefined);
});

describe('getWebinarConsultationAvailability', () => {
  test('実際の空き枠をUTC日時付きで返す', async () => {
    const result = await getWebinarConsultationAvailability(fakeDb(), base);
    expect(result).toMatchObject({
      calendarReady: true,
      menu: { id: 'menu-1', durationMinutes: 15 },
      slots: [{
        date: '2026-08-20', start: '10:00', startsAt: '2026-08-20T01:00:00.000Z',
      }],
    });
  });

  test('カレンダー未接続時は既存予約URLへフォールバック可能と返す', async () => {
    mocks.getStaffCalendarConnection.mockResolvedValue(null);
    const result = await getWebinarConsultationAvailability(fakeDb(), base);
    expect(result.calendarReady).toBe(false);
    expect(result.fallbackUrl).toBe('https://example.com/fallback');
  });
});

describe('bookWebinarConsultation', () => {
  test('確定予約、Meet発行、相談登録、Harness通知まで一括で行う', async () => {
    const db = fakeDb();
    const result = await bookWebinarConsultation(db, {
      ...base,
      startsAt: '2026-08-20T01:00:00.000Z',
      proxyBaseUrl: 'https://worker.example.com',
    });
    expect(result).toMatchObject({
      status: 'confirmed',
      meetUrl: 'https://meet.google.com/abc-defg-hij',
      externalEventId: 'event-1',
      created: true,
    });
    expect(mocks.syncConfirmedBookingToGoogle).toHaveBeenCalledWith(
      db, base.credentials, expect.any(String), { addGoogleMeet: true },
    );
    expect(mocks.registerMeetConsultation).toHaveBeenCalledWith(
      db,
      expect.objectContaining({
        externalEventId: 'event-1', friendId: 'friend-1',
        meetUrl: 'https://meet.google.com/abc-defg-hij',
      }),
      base.now,
    );
    expect(mocks.pushViaHarnessProxy).toHaveBeenCalledWith(
      'https://worker.example.com', 'line-token', 'U123',
      expect.arrayContaining([expect.objectContaining({ type: 'text' })]),
      expect.any(String), undefined,
    );
  });

  test('Googleカレンダー未接続なら内部予約を作らない', async () => {
    mocks.getStaffCalendarConnection.mockResolvedValue(null);
    const db = fakeDb();
    await expect(bookWebinarConsultation(db, {
      ...base,
      startsAt: '2026-08-20T01:00:00.000Z',
      proxyBaseUrl: 'https://worker.example.com',
    })).rejects.toMatchObject({ code: 'calendar_not_configured', status: 503 });
    expect(mocks.syncConfirmedBookingToGoogle).not.toHaveBeenCalled();
  });

  test('Meet発行に失敗した予約はcancelledへ戻す', async () => {
    mocks.syncConfirmedBookingToGoogle.mockRejectedValue(new Error('google down'));
    const db = fakeDb();
    await expect(bookWebinarConsultation(db, {
      ...base,
      startsAt: '2026-08-20T01:00:00.000Z',
      proxyBaseUrl: 'https://worker.example.com',
    })).rejects.toBeInstanceOf(WebinarConsultationError);
    const prepare = db.prepare as unknown as ReturnType<typeof vi.fn>;
    expect(prepare.mock.calls.some(([sql]) => String(sql).includes("status='cancelled'"))).toBe(true);
    expect(mocks.pushViaHarnessProxy).not.toHaveBeenCalled();
  });

  test('LINE通知だけ失敗してもMeet付き確定予約は取り消さない', async () => {
    mocks.pushViaHarnessProxy.mockRejectedValue(new Error('LINE unavailable'));
    const db = fakeDb();
    await expect(bookWebinarConsultation(db, {
      ...base,
      startsAt: '2026-08-20T01:00:00.000Z',
      proxyBaseUrl: 'https://worker.example.com',
    })).resolves.toMatchObject({ status: 'confirmed', created: true });
    expect(mocks.removeBookingFromGoogle).not.toHaveBeenCalled();
  });
});
