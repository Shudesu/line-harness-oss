import { describe, expect, test } from 'vitest';
import { resolveSession, parseScheduleRules } from './webinar-schedule.js';

/** JST の日時 → epoch 秒 (JST = UTC+9 固定) */
function jst(y: number, mo: number, d: number, h: number, mi = 0): number {
  return Math.floor(Date.UTC(y, mo - 1, d, h - 9, mi) / 1000);
}

const DUR = 7200; // 2時間

describe('resolveSession daily', () => {
  const rules = parseScheduleRules('[{"type":"daily","time":"20:00"}]');

  test('開始30分後はライブ中 offset=1800', () => {
    const s = resolveSession(rules, DUR, jst(2026, 7, 29, 20, 30));
    expect(s.live).toBe(true);
    expect(s.sessionStartAt).toBe(jst(2026, 7, 29, 20, 0));
    expect(s.offsetSeconds).toBe(1800);
  });

  test('開始1分前は待機・nextSessionAt は今日20時', () => {
    const s = resolveSession(rules, DUR, jst(2026, 7, 29, 19, 59));
    expect(s.live).toBe(false);
    expect(s.nextSessionAt).toBe(jst(2026, 7, 29, 20, 0));
  });

  test('終了直後(22:00ちょうど)は待機・next は翌日20時', () => {
    const s = resolveSession(rules, DUR, jst(2026, 7, 29, 22, 0));
    expect(s.live).toBe(false);
    expect(s.nextSessionAt).toBe(jst(2026, 7, 30, 20, 0));
  });

  test('開始ちょうどはライブ offset=0', () => {
    const s = resolveSession(rules, DUR, jst(2026, 7, 29, 20, 0));
    expect(s.live).toBe(true);
    expect(s.offsetSeconds).toBe(0);
  });

  test('日付跨ぎ: 23時開始で翌1時はまだライブ', () => {
    const r = parseScheduleRules('[{"type":"daily","time":"23:00"}]');
    const s = resolveSession(r, DUR, jst(2026, 7, 30, 0, 30));
    expect(s.live).toBe(true);
    expect(s.sessionStartAt).toBe(jst(2026, 7, 29, 23, 0));
  });
});

describe('resolveSession weekly / once', () => {
  test('weekly: 土曜(day=6)10時ルール、土曜11時はライブ', () => {
    // 2026-08-01 は土曜
    const r = parseScheduleRules('[{"type":"weekly","days":[6],"time":"10:00"}]');
    const s = resolveSession(r, DUR, jst(2026, 8, 1, 11, 0));
    expect(s.live).toBe(true);
    expect(s.sessionStartAt).toBe(jst(2026, 8, 1, 10, 0));
  });

  test('weekly: 平日は待機で next が次の土曜', () => {
    const r = parseScheduleRules('[{"type":"weekly","days":[6],"time":"10:00"}]');
    const s = resolveSession(r, DUR, jst(2026, 7, 29, 12, 0)); // 水曜
    expect(s.live).toBe(false);
    expect(s.nextSessionAt).toBe(jst(2026, 8, 1, 10, 0));
  });

  test('once: 指定時刻中はライブ', () => {
    const r = parseScheduleRules('[{"type":"once","at":"2026-08-01T20:00:00+09:00"}]');
    const s = resolveSession(r, DUR, jst(2026, 8, 1, 21, 0));
    expect(s.live).toBe(true);
    expect(s.offsetSeconds).toBe(3600);
  });

  test('複数ルール重複時は最新開始が勝つ', () => {
    const r = parseScheduleRules(
      '[{"type":"daily","time":"20:00"},{"type":"daily","time":"21:00"}]',
    );
    const s = resolveSession(r, DUR, jst(2026, 7, 29, 21, 30));
    expect(s.sessionStartAt).toBe(jst(2026, 7, 29, 21, 0));
  });
});

describe('parseScheduleRules', () => {
  test('不正 JSON は空配列', () => {
    expect(parseScheduleRules('not json')).toEqual([]);
  });
  test('不正ルール(時刻形式ミス・未知type)は除外', () => {
    const r = parseScheduleRules(
      '[{"type":"daily","time":"25:99"},{"type":"nope"},{"type":"daily","time":"20:00"}]',
    );
    expect(r).toHaveLength(1);
  });
  test('スケジュール空なら常に待機・next null', () => {
    const s = resolveSession([], DUR, jst(2026, 7, 29, 20, 0));
    expect(s).toEqual({ live: false, sessionStartAt: null, offsetSeconds: null, nextSessionAt: null });
  });
});
