import { describe, expect, test, vi } from 'vitest';
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
  rules?: Array<{ staff_id: string; weekday: number; start_time: string; end_time: string }>;
  bookings?: Array<{ staff_id: string; starts_at: string; block_ends_at: string }>;
  calendarConnection?: {
    id: string;
    calendar_id: string;
    auth_type: string;
    access_token: string | null;
  };
}

function stubDB(data: StubData): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind() { return this; },
        async first() {
          if (sql.includes('FROM menus')) return data.menu ?? null;
          if (sql.includes('FROM google_calendar_connections')) return data.calendarConnection ?? null;
          return null;
        },
        async all() {
          if (sql.includes('FROM staff') && sql.includes('staff_menus')) {
            return { results: data.staff ?? [] };
          }
          if (sql.includes('FROM staff_shifts')) {
            return { results: data.shifts ?? [] };
          }
          if (sql.includes('FROM staff_availability_rules')) {
            return { results: data.rules ?? [] };
          }
          if (sql.includes('FROM bookings')) {
            return { results: data.bookings ?? [] };
          }
          return { results: [] };
        },
        async run() { return { success: true, meta: {} }; },
      };
    },
  } as unknown as D1Database;
}

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
    expect(result.by_staff[0].has_working_hours).toBe(false);
  });

  test('曜日ルールがあれば枠ゼロでも has_working_hours=true（満席と未設定を区別）', async () => {
    const db = stubDB({
      menu: { duration_minutes: 60, buffer_after_minutes: 0, override_duration: null, override_price: null },
      staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
      shifts: [],
      // 2026-05-09 is Saturday
      rules: [{ staff_id: 'S1', weekday: 6, start_time: '10:00', end_time: '11:00' }],
      // 10:00-11:00 JST fully booked = 01:00-02:00 UTC
      bookings: [{ staff_id: 'S1', starts_at: '2026-05-09T01:00:00Z', block_ends_at: '2026-05-09T02:00:00Z' }],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1', menuId: 'M1', from: '2026-05-09', to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'), minLeadTimeMinutes: 0,
    });
    expect(result.by_staff[0].slots).toEqual([]);
    expect(result.by_staff[0].has_working_hours).toBe(true);
  });

  test('範囲内シフトがあれば has_working_hours=true', async () => {
    const db = stubDB({
      menu: { duration_minutes: 60, buffer_after_minutes: 0, override_duration: null, override_price: null },
      staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      bookings: [],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1', menuId: 'M1', from: '2026-05-09', to: '2026-05-09',
      now: new Date('2026-05-08T00:00:00Z'), minLeadTimeMinutes: 60,
    });
    expect(result.by_staff[0].has_working_hours).toBe(true);
  });

  test('曜日ルールは有限シフトなしでも将来の日付に適用される', async () => {
    const db = stubDB({
      menu: { duration_minutes: 60, buffer_after_minutes: 0, override_duration: null, override_price: null },
      staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
      shifts: [],
      // 2030-01-05 is Saturday. This verifies the rule does not expire.
      rules: [{ staff_id: 'S1', weekday: 6, start_time: '10:00', end_time: '12:00' }],
      bookings: [],
    });
    const result = await getAvailability(db, {
      lineAccountId: 'A1', menuId: 'M1', from: '2030-01-05', to: '2030-01-05',
      now: new Date('2029-12-01T00:00:00Z'), minLeadTimeMinutes: 0,
    });
    expect(result.by_staff[0].slots.map((slot) => slot.start)).toEqual(['10:00', '10:30', '11:00']);
  });

  test('Googleカレンダーのbusy時間を予約候補から除外する', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      calendars: { 'cal@example.com': { busy: [{ start: '2026-05-09T02:00:00Z', end: '2026-05-09T03:00:00Z' }] } },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    try {
      const db = stubDB({
        menu: { duration_minutes: 60, buffer_after_minutes: 0, override_duration: null, override_price: null },
        staff: [{ id: 'S1', display_name: '山田', is_designation_optional: 0 }],
        shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '13:00' }],
        bookings: [],
        calendarConnection: { id: 'GC1', calendar_id: 'cal@example.com', auth_type: 'oauth', access_token: 'token' },
      });
      const result = await getAvailability(db, {
        lineAccountId: 'A1', menuId: 'M1', from: '2026-05-09', to: '2026-05-09',
        now: new Date('2026-05-08T00:00:00Z'), minLeadTimeMinutes: 0,
      });
      expect(result.by_staff[0].slots.map((slot) => slot.start)).toEqual(['10:00', '12:00']);
    } finally {
      vi.unstubAllGlobals();
    }
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

describe('getAvailability — 指名なし枠', () => {
  const MENU = {
    duration_minutes: 60,
    buffer_after_minutes: 0,
    override_duration: null,
    override_price: null,
  };
  const params = {
    lineAccountId: 'A1',
    menuId: 'M1',
    from: '2026-05-09',
    to: '2026-05-09',
    now: new Date('2026-05-08T00:00:00Z'),
    minLeadTimeMinutes: 60,
  };

  test('実スタッフの空きの和集合になる（重複は除く）', async () => {
    const db = stubDB({
      menu: MENU,
      staff: [
        { id: 'ANY', display_name: '指名なし', is_designation_optional: 1 },
        { id: 'S1', display_name: '山田', is_designation_optional: 0 },
        { id: 'S2', display_name: '田中', is_designation_optional: 0 },
      ],
      shifts: [
        { staff_id: 'S1', work_date: '2026-05-09', start_time: '09:00', end_time: '11:00' },
        { staff_id: 'S2', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' },
      ],
      bookings: [],
    });
    const result = await getAvailability(db, { ...params, staffId: 'ANY' });
    expect(result.by_staff).toHaveLength(1);
    expect(result.by_staff[0].staff_id).toBe('ANY');
    // S1 (09:00-11:00): 09:00 09:30 10:00 / S2 (10:00-12:00): 10:00 10:30 11:00
    // → 和集合を時刻順に、10:00 の重複は 1 つに畳む
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual([
      '09:00', '09:30', '10:00', '10:30', '11:00',
    ]);
  });

  test('1 人が埋まっていてももう 1 人が空いていれば枠は残る', async () => {
    const db = stubDB({
      menu: MENU,
      staff: [
        { id: 'ANY', display_name: '指名なし', is_designation_optional: 1 },
        { id: 'S1', display_name: '山田', is_designation_optional: 0 },
        { id: 'S2', display_name: '田中', is_designation_optional: 0 },
      ],
      shifts: [
        { staff_id: 'S1', work_date: '2026-05-09', start_time: '09:00', end_time: '11:00' },
        { staff_id: 'S2', work_date: '2026-05-09', start_time: '09:00', end_time: '11:00' },
      ],
      bookings: [
        // S1 の 09:00-10:00 が埋まっている
        { staff_id: 'S1', starts_at: '2026-05-09T00:00:00.000Z', block_ends_at: '2026-05-09T01:00:00.000Z' },
      ],
    });
    const result = await getAvailability(db, { ...params, staffId: 'ANY' });
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['09:00', '09:30', '10:00']);
  });

  test('指名なし枠は自分のシフトを持たなくてよい', async () => {
    const db = stubDB({
      menu: MENU,
      staff: [
        { id: 'ANY', display_name: '指名なし', is_designation_optional: 1 },
        { id: 'S1', display_name: '山田', is_designation_optional: 0 },
      ],
      shifts: [{ staff_id: 'S1', work_date: '2026-05-09', start_time: '10:00', end_time: '12:00' }],
      bookings: [],
    });
    const result = await getAvailability(db, { ...params, staffId: 'ANY' });
    expect(result.by_staff[0].has_working_hours).toBe(true);
    expect(result.by_staff[0].slots.length).toBe(3);
  });

  test('実スタッフを指名したときは自分の枠だけ返る', async () => {
    const db = stubDB({
      menu: MENU,
      staff: [
        { id: 'ANY', display_name: '指名なし', is_designation_optional: 1 },
        { id: 'S1', display_name: '山田', is_designation_optional: 0 },
        { id: 'S2', display_name: '田中', is_designation_optional: 0 },
      ],
      shifts: [
        { staff_id: 'S1', work_date: '2026-05-09', start_time: '09:00', end_time: '10:00' },
        { staff_id: 'S2', work_date: '2026-05-09', start_time: '14:00', end_time: '16:00' },
      ],
      bookings: [],
    });
    const result = await getAvailability(db, { ...params, staffId: 'S2' });
    expect(result.by_staff).toHaveLength(1);
    expect(result.by_staff[0].staff_id).toBe('S2');
    expect(result.by_staff[0].slots.map((s) => s.start)).toEqual(['14:00', '14:30', '15:00']);
  });
});
