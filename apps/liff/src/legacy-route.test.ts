import { describe, expect, it } from 'vitest';
import { legacyQueryTarget } from './legacy-route.js';

describe('legacyQueryTarget', () => {
  it('converts an existing webinar query link to the Pages route', () => {
    expect(
      legacyQueryTarget(
        '?page=webinar&slug=ai-live&sessionStartAt=1800000000&liffId=123',
      ),
    ).toBe('/webinar/ai-live?sessionStartAt=1800000000&liffId=123');
  });

  it('converts event and event history links', () => {
    expect(legacyQueryTarget('?page=event&id=event-1&liffId=123')).toBe(
      '/events/event-1?liffId=123',
    );
    expect(legacyQueryTarget('?page=event-me&liffId=123')).toBe(
      '/events/me?liffId=123',
    );
  });

  it('keeps booking as the safe default', () => {
    expect(legacyQueryTarget('')).toBe('/booking');
    expect(legacyQueryTarget('?page=salon-book&liffId=123')).toBe(
      '/booking?liffId=123',
    );
  });
});
