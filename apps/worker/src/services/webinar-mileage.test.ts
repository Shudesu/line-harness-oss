import { describe, expect, it } from 'vitest';
import { webinarMileageMilestones } from './webinar-mileage.js';

describe('webinarMileageMilestones', () => {
  it('selects cumulative 5m, 15m and 90% completion milestones', () => {
    expect(webinarMileageMilestones(299, 1200)).toEqual([]);
    expect(webinarMileageMilestones(300, 1200).map((m) => m.key)).toEqual(['5m']);
    expect(webinarMileageMilestones(900, 1200).map((m) => m.key)).toEqual(['5m', '15m']);
    expect(webinarMileageMilestones(1080, 1200).map((m) => m.key)).toEqual([
      '5m', '15m', 'complete',
    ]);
  });

  it('does not mark zero-duration webinars complete', () => {
    expect(webinarMileageMilestones(0, 0)).toEqual([]);
  });
});
