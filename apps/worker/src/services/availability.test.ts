import { afterEach, describe, expect, test, vi } from 'vitest';
import { computeSlots, getAvailability, type Interval } from './availability.js';

const MENU_60 = { duration_minutes: 60, buffer_after_minutes: 0 };
const MENU_60_BUF15 = { duration_minutes: 60, buffer_after_minutes: 15 };

describe('computeSlots', () => {
  test('シフトのみ、予約なし → 30分刻みで列挙', () => {
    const working: Interval[] = [{ start: '10:00', end: '12:00' }];
    const slots = computeSlots({ working, busy: [], menu: MENU_60, granularityMinutes: 30 });
    expect(slots).toEqual([
      { start: '10:00', end: '11:00' },
      { start: '10:30', end: '11:30' },
      { start: '11:00', end: '12:00' },
    ]);
  });

  test('既存予約と重なるスロットは除外', () => {
    const working: Interval[] = [{ start: '10:00', end: '13:00' }];
    const busy: Interval[] = [{ start: '11:00', end: '12:00' }];
    const slots = computeSlots({ working, busy, menu: MENU_60, granularityMinutes: 30 });
    expect(slots).toEqual([
      { start: '10:00', end: '11:00' },
      { start: '12:00', end: '13:00' },
    ]);
  });

  test('buffer_after が次のスロットへ波及', () => {
    const working: Interval[] = [{ start: '10:00', end: '12:00' }];
    const slots = computeSlots({
      working,
      busy: [],
      menu: MENU_60_BUF15,
      granularityMinutes: 30,
    });
    expect(slots).toEqual([
      { start: '10:00', end: '11:00' },
      { start: '10:30', end: '11:30' },
    ]);
  });

  test('working の終端でメニューが収まらないと除外', () => {
    const working: Interval[] = [{ start: '10:00', end: '11:00' }];
    expect(
      computeSlots({ working, busy: [], menu: MENU_60, granularityMinutes: 30 }),
    ).toEqual([{ start: '10:00', end: '11:00' }]);
  });

  test('working なし → 空配列', () => {
    expect(
      computeSlots({ working: [], busy: [], menu: MENU_60, granularityMinutes: 30 }),
    ).toEqual([]);
  });

  test('複数の working 区間（昼休みあり）', () => {
    const working: Interval[] = [
      { start: '10:00', end: '12:00' },
      { start: '13:00', end: '15:00' },
    ];
    const slots = computeSlots({ working, busy: [], menu: MENU_60, granularityMinutes: 30 });
    expect(slots.map((s) => s.start)).toEqual([
      '10:00',
      '10:30',
      '11:00',
      '13:00',
      '13:30',
      '14:00',
    ]);
  });

  test('busy 完全包含 → working 全部消える', () => {
    const working: Interval[] = [{ start: '10:00', end: '12:00' }];
    const busy: Interval[] = [{ start: '09:00', end: '13:00' }];
    expect(
      computeSlots({ working, busy, menu: MENU_60, granularityMinutes: 30 }),
    ).toEqual([]);
  });

  test('busy 完全交差なし → working 全部残る', () => {
    const working: Interval[] = [{ start: '10:00', end: '12:00' }];
    const busy: Interval[] = [{ start: '13:00', end: '14:00' }];
    expect(
      computeSlots({ working, busy, menu: MENU_60, granularityMinutes: 30 }),
    ).toEqual([
      { start: '10:00', end: '11:00' },
      { start: '10:30', end: '11:30' },
      { start: '11:00', end: '12:00' },
    ]);
  });

  test('busy が working 末尾にかかる', () => {
    const working: Interval[] = [{ start: '10:00', end: '13:00' }];
    const busy: Interval[] = [{ start: '12:30', end: '14:00' }];
    expect(
      computeSlots({ working, busy, menu: MENU_60, granularityMinutes: 30 }).map(
        (s) => s.start,
      ),
    ).toEqual(['10:00', '10:30', '11:00', '11:30']);
  });

  test('複数 busy が連続', () => {
    const working: Interval[] = [{ start: '10:00', end: '15:00' }];
    const busy: Interval[] = [
      { start: '11:00', end: '12:00' },
      { start: '12:00', end: '13:00' },
    ];
    expect(
      computeSlots({ working, busy, menu: MENU_60, granularityMinutes: 30 }).map(
        (s) => s.start,
      ),
    ).toEqual(['10:00', '13:00', '13:30', '14:00']);
  });

  test('30分刻みでない busy にも対応 (10:15-10:45)', () => {
    const working: Interval[] = [{ start: '10:00', end: '12:00' }];
    const busy: Interval[] = [{ start: '10:15', end: '10:45' }];
    expect(
      computeSlots({ working, busy, menu: MENU_60, granularityMinutes: 30 }).map(
        (s) => s.start,
      ),
    ).toEqual(['11:00']);
  });
});

// ----------------------------------------------------------------
// getAvailability (DB 層 + リードタイム + 仮想スタッフ)
// ----------------------------------------------------------------

interface StubData {
  menu?: {
    duration_minutes: number;
    buffer_after_minutes: number;
    override_duration: number | null;
    override_price: number | null;
  };
  staff?: Array<{ id: string; display_name: string; is_designation_optional: number }>;
  shifts?: Array<{ staff_id: string; work_date: string; start_time: string; end_time: string }>;
  bookings?: Array<{ staff_id: string; starts_at: string; block_ends_at: string }>;
  blocks?: Array<{ staff_id: string; block_date: string; start_time: string; end_time: string }>;
  calendarConnection?: {
    id: string;
    staff_id: string;
    google_calendar_id: string;
    refresh_token: string;
    access_token: string | null;
    access_token_expires_at: string | null;
    sync_events: number;
    created_at: string;
    updated_at: string;
  };
}

function stubDB(data: StubData): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind() { return this; },
        async first() {
          if (sql.includes('FROM menus')) return data.menu ?? null;
          if (sql.includes('FROM staff_calendar_connections')) {
            return data.calendarConnection ?? null;
          }
          return null;
        },
        async all() {
          if (sql.includes('FROM staff') && sql.includes('staff_menus')) {
            return { results: data.staff ?? [] };
          }
          if (sql.includes('FROM staff_shifts')) {
            return { results: data.shifts ?? [] };
          }
          if (sql.includes('FROM staff_blocks')) {
            return { results: data.blocks ?? [] };
          }
          if (sql.includes('FROM bookings')) {
            return { results: data.bookings ?? [] };
          }
          if (sql.includes('FROM staff_calendar_connections')) {
            return {
              results: data.calendarConnection
                ? [{ staff_id: data.calendarConnection.staff_id }]
                : [],
            };
          }
          return { results: [] };
        },
        async run() { return { success: true, meta: {} }; },
      };
    },
  } as unknown as D1Database;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('getAvailability', () => {
  test('指名なしで 1 スタッフ 1 日、シフト内で空き', async () => {
    const db = stubDB({
      menu: {
        duration_minutes: 60,
        buffer_after_minutes: 0,
        override_duration: null,
        override_price: null,
      },
      staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      bookings: [],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 60,
    });
    expect(result.by_staff).toHaveLength(1);
    expect(result.by_staff[0].slots.map((s) => `${s.date} ${s.start}`)).toEqual([
      '2026-05-09 10:00',
      '2026-05-09 10:30',
      '2026-05-09 11:00',
    ]);
  });

  test('リードタイム未満のスロットは除外', async () => {
    const db = stubDB({
      menu: {
        duration_minutes: 60,
        buffer_after_minutes: 0,
        override_duration: null,
        override_price: null,
      },
      staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      bookings: [],
    });
    // 現在: 2026-05-09 10:30 JST = 2026-05-09 01:30 UTC
    // リードタイム 60 分 → 11:30 JST 以降だが、10:00/10:30/11:00 開始しか枠が無い → 全除外
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-09T01:30:00Z'),
      minLeadTimeMinutes: 60,
    });
    expect(result.by_staff[0].slots).toEqual([]);
  });

  test('既存予約があるとその時間帯は除外', async () => {
    const db = stubDB({
      menu: {
        duration_minutes: 60,
        buffer_after_minutes: 0,
        override_duration: null,
        override_price: null,
      },
      staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '13:00' }],
      // 11:00-12:00 JST = 02:00-03:00 UTC
      bookings: [{ staff_id: 'S1', starts_at: '2026-05-09T02:00:00Z', block_ends_at: '2026-05-09T03:00:00Z' }],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 60,
    });
    // 11:00-12:00 が busy なので 10:00 / 12:00 だけが残るはず
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['10:00', '12:00']);
  });

  test('staff_blocks があるとその時間帯は除外', async () => {
    const db = stubDB({
      menu: {
        duration_minutes: 60,
        buffer_after_minutes: 0,
        override_duration: null,
        override_price: null,
      },
      staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '13:00' }],
      blocks: [{ staff_id: 'S1', block_date: '2026-05-09', start_time: '11:00', end_time: '12:00' }],
      bookings: [],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 60,
    });
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['10:00', '12:00']);
  });

  test('Google FreeBusy のbusy区間を合流してスロットを除外する', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          calendars: {
            primary: {
              // 11:00-12:00 JST
              busy: [{ start: '2026-05-09T02:00:00.000Z', end: '2026-05-09T03:00:00.000Z' }],
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const db = stubDB({
      menu: {
        duration_minutes: 60,
        buffer_after_minutes: 0,
        override_duration: null,
        override_price: null,
      },
      staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '13:00' }],
      bookings: [],
      calendarConnection: {
        id: 'C1',
        staff_id: 'S1',
        google_calendar_id: 'primary',
        refresh_token: 'refresh-token',
        access_token: 'valid-access',
        access_token_expires_at: '2026-05-10T00:00:00.000Z',
        sync_events: 1,
        created_at: '2026-05-08T00:00:00.000Z',
        updated_at: '2026-05-08T00:00:00.000Z',
      },
    });

    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 60,
      googleOAuth: {
        GOOGLE_CLIENT_ID: 'google-client',
        GOOGLE_CLIENT_SECRET: 'google-secret',
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['10:00', '12:00']);
  });

  test('Google FreeBusy が失敗してもfail-openで既存スロットを返す', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('google down');
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const db = stubDB({
      menu: {
        duration_minutes: 60,
        buffer_after_minutes: 0,
        override_duration: null,
        override_price: null,
      },
      staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      bookings: [],
      calendarConnection: {
        id: 'C1',
        staff_id: 'S1',
        google_calendar_id: 'primary',
        refresh_token: 'refresh-token',
        access_token: 'valid-access',
        access_token_expires_at: '2026-05-10T00:00:00.000Z',
        sync_events: 1,
        created_at: '2026-05-08T00:00:00.000Z',
        updated_at: '2026-05-08T00:00:00.000Z',
      },
    });

    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 60,
      googleOAuth: {
        GOOGLE_CLIENT_ID: 'google-client',
        GOOGLE_CLIENT_SECRET: 'google-secret',
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalled();
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['10:00', '10:30', '11:00']);
  });

  test('staff_blocks と隣接する非重複スロットは残る', async () => {
    const db = stubDB({
      menu: {
        duration_minutes: 60,
        buffer_after_minutes: 0,
        override_duration: null,
        override_price: null,
      },
      staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '14:00' }],
      blocks: [{ staff_id: 'S1', block_date: '2026-05-09', start_time: '11:00', end_time: '12:00' }],
      bookings: [],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 60,
    });
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual([
      '10:00',
      '12:00',
      '12:30',
      '13:00',
    ]);
  });

  test('終日 staff_blocks は 00:00-24:00 busy として扱う', async () => {
    const db = stubDB({
      menu: {
        duration_minutes: 60,
        buffer_after_minutes: 0,
        override_duration: null,
        override_price: null,
      },
      staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '13:00' }],
      blocks: [{ staff_id: 'S1', block_date: '2026-05-09', start_time: '00:00', end_time: '24:00' }],
      bookings: [],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 60,
    });
    expect(result.by_staff[0].slots).toEqual([]);
  });

  test('シフト無い日はスロット出ない', async () => {
    const db = stubDB({
      menu: {
        duration_minutes: 60,
        buffer_after_minutes: 0,
        override_duration: null,
        override_price: null,
      },
      staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
      shifts: [],
      bookings: [],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 60,
    });
    expect(result.by_staff[0].slots).toEqual([]);
  });

  test('staff_id 指定 → そのスタッフのみ', async () => {
    const db = stubDB({
      menu: {
        duration_minutes: 60,
        buffer_after_minutes: 0,
        override_duration: null,
        override_price: null,
      },
      staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      bookings: [],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'M1',
      staffId: 'S1',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 60,
    });
    expect(result.by_staff).toHaveLength(1);
    expect(result.by_staff[0].staff_id).toBe('S1');
  });

  test('メニュー無し → 空 by_staff', async () => {
    const db = stubDB({});
    const result = await getAvailability(db, {
      lineAccountId: 'A1',
      menuId: 'NOPE',
      from: '2026-05-09',
      to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'),
      minLeadTimeMinutes: 60,
    });
    expect(result.by_staff).toEqual([]);
  });
});
