import { describe, expect, test } from 'vitest';
import { isFiveMinuteTick } from './scheduled.js';

/** UTC の分を指定して tick イベントを作る。 */
function tick(cron: string, utcMinute: number) {
  return { cron, scheduledTime: Date.UTC(2026, 7, 26, 4, utcMinute) };
}

describe('isFiveMinuteTick', () => {
  test('分足の tick では5分ごとに1回だけ true になる', () => {
    expect(isFiveMinuteTick(tick('* * * * *', 0))).toBe(true);
    expect(isFiveMinuteTick(tick('* * * * *', 5))).toBe(true);
    expect(isFiveMinuteTick(tick('* * * * *', 55))).toBe(true);
  });

  test('5の倍数でない分では false', () => {
    expect(isFiveMinuteTick(tick('* * * * *', 1))).toBe(false);
    expect(isFiveMinuteTick(tick('* * * * *', 4))).toBe(false);
    expect(isFiveMinuteTick(tick('* * * * *', 59))).toBe(false);
  });

  test('5分足 cron の tick は分に関係なく true', () => {
    // インストーラや LHC のテナント生成が書く wrangler.toml は
    // crons = ["*/5 * * * *", "0 */6 * * *"]。分足 tick が一度も来ない構成なので、
    // 分足だけを見ていると 5分ジョブが永久に走らない。
    expect(isFiveMinuteTick(tick('*/5 * * * *', 0))).toBe(true);
    expect(isFiveMinuteTick(tick('*/5 * * * *', 3))).toBe(true);
  });

  test('6時間足の cron では false（同じ分に二重で走らせない）', () => {
    expect(isFiveMinuteTick(tick('0 */6 * * *', 0))).toBe(false);
  });
});
