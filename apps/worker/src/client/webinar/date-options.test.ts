import { describe, expect, test } from 'vitest';
import { buildMeetingDateOptions } from './date-options.js';

describe('buildMeetingDateOptions', () => {
  test('本日から指定日数分の値と見えるラベルを返す', () => {
    const options = buildMeetingDateOptions('2026-08-06', 3);

    expect(options).toEqual([
      { value: '2026-08-06', label: '8/6(木)（本日）' },
      { value: '2026-08-07', label: '8/7(金)' },
      { value: '2026-08-08', label: '8/8(土)' },
    ]);
  });

  test('月をまたいでも日付値が崩れない', () => {
    expect(buildMeetingDateOptions('2026-08-31', 2).map((option) => option.value)).toEqual([
      '2026-08-31',
      '2026-09-01',
    ]);
  });
});
