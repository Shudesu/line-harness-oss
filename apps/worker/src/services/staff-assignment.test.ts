import { describe, expect, test } from 'vitest';
import { orderAssignmentCandidates, countBookingsByStaffForDate } from './staff-assignment.js';

describe('orderAssignmentCandidates', () => {
  test('当日の予約件数が少ないスタッフを優先する', () => {
    expect(
      orderAssignmentCandidates([
        { staffId: 'b', dayBookingCount: 3 },
        { staffId: 'a', dayBookingCount: 1 },
        { staffId: 'c', dayBookingCount: 2 },
      ]),
    ).toEqual(['a', 'c', 'b']);
  });

  test('同数ならスタッフ ID 順（決定性のため）', () => {
    expect(
      orderAssignmentCandidates([
        { staffId: 'c', dayBookingCount: 0 },
        { staffId: 'a', dayBookingCount: 0 },
        { staffId: 'b', dayBookingCount: 0 },
      ]),
    ).toEqual(['a', 'b', 'c']);
  });

  test('入力を破壊しない', () => {
    const input = [
      { staffId: 'b', dayBookingCount: 1 },
      { staffId: 'a', dayBookingCount: 0 },
    ];
    orderAssignmentCandidates(input);
    expect(input[0].staffId).toBe('b');
  });

  test('候補なしなら空', () => {
    expect(orderAssignmentCandidates([])).toEqual([]);
  });
});

describe('countBookingsByStaffForDate', () => {
  function stubDB(rows: Array<{ staff_id: string; n: number }>, capture?: (sql: string) => void) {
    return {
      prepare(sql: string) {
        capture?.(sql);
        return { bind() { return this; }, async all() { return { results: rows }; } };
      },
    } as unknown as D1Database;
  }

  test('返らなかったスタッフは 0 で埋める', async () => {
    const counts = await countBookingsByStaffForDate(stubDB([{ staff_id: 's1', n: 2 }]), ['s1', 's2'], '2026-05-09');
    expect(counts.get('s1')).toBe(2);
    expect(counts.get('s2')).toBe(0);
  });

  test('スタッフ 0 件ならクエリを投げない', async () => {
    let called = false;
    const counts = await countBookingsByStaffForDate(stubDB([], () => { called = true; }), [], '2026-05-09');
    expect(counts.size).toBe(0);
    expect(called).toBe(false);
  });

  test('枠を占有しないステータスは数えない', async () => {
    let sql = '';
    await countBookingsByStaffForDate(stubDB([], (s) => { sql = s; }), ['s1'], '2026-05-09');
    expect(sql).toContain("status IN ('requested','confirmed')");
    // JST 日付で比較していること（starts_at は UTC 保存）
    expect(sql).toContain("+9 hours");
  });
});
