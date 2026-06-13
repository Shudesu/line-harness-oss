import { describe, expect, it } from 'vitest';
import {
  reservationAutoCompleteDate,
  shouldRunReservationAutoComplete,
} from './reservation-auto-complete.js';

describe('reservation nightly auto-complete timing', () => {
  it('runs during the first 10 minutes after 19:00 JST', () => {
    expect(shouldRunReservationAutoComplete(new Date('2026-06-13T10:00:00.000Z'))).toBe(true);
    expect(shouldRunReservationAutoComplete(new Date('2026-06-13T10:05:00.000Z'))).toBe(true);
  });

  it('does not run outside the 19:00 JST window', () => {
    expect(shouldRunReservationAutoComplete(new Date('2026-06-13T09:55:00.000Z'))).toBe(false);
    expect(shouldRunReservationAutoComplete(new Date('2026-06-13T10:10:00.000Z'))).toBe(false);
    expect(shouldRunReservationAutoComplete(new Date('2026-06-13T11:00:00.000Z'))).toBe(false);
  });

  it('uses the JST calendar date', () => {
    expect(reservationAutoCompleteDate(new Date('2026-06-13T15:05:00.000Z'))).toBe('2026-06-14');
  });
});
