import { describe, it, expect } from 'vitest';
import { buildStepSchedule } from '../src/tools/scenario-schedule.js';

describe('buildStepSchedule', () => {
  it('relative: delay を分に変換', () => {
    expect(buildStepSchedule('relative', { delay: '24h' }, 0)).toEqual({ delayMinutes: 1440 });
  });
  it('absolute_time: 19:30 を deliveryTime として渡す', () => {
    expect(buildStepSchedule('absolute_time', { offsetDays: 1, deliveryTime: '19:30' }, 0)).toEqual({ offsetDays: 1, deliveryTime: '19:30' });
  });
  it('absolute_time: deliveryTime 欠落はエラー（09:00 に黙って戻さない）', () => {
    expect(() => buildStepSchedule('absolute_time', { offsetDays: 1 }, 0)).toThrow(/deliveryTime/);
  });
  it('absolute_time: delay 混在はエラー', () => {
    expect(() => buildStepSchedule('absolute_time', { offsetDays: 1, deliveryTime: '19:30', delay: '1h' }, 0)).toThrow();
  });
  it('relative: 時刻指定はエラー', () => {
    expect(() => buildStepSchedule('relative', { delay: '1h', deliveryTime: '19:30' }, 0)).toThrow(/absolute_time/);
  });
  it('elapsed: offsetMinutes 既定 0', () => {
    expect(buildStepSchedule('elapsed', { offsetDays: 2 }, 0)).toEqual({ offsetDays: 2, offsetMinutes: 0 });
  });
});
