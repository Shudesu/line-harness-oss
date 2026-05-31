import { describe, expect, it } from 'vitest';
import { buildGmailQuery } from './gmail-jalan-import.js';

describe('buildGmailQuery', () => {
  it('adds newer_than when query has no date guard', () => {
    expect(buildGmailQuery({ from_email: 'reservation@activityboard.jp', query: null }))
      .toBe('from:reservation@activityboard.jp newer_than:30d');
  });

  it('keeps explicit query from condition without duplicating from', () => {
    expect(buildGmailQuery({
      from_email: 'reservation@activityboard.jp',
      query: '{from:reservation@activityboard.jp from:reservation_cancel@activityboard.jp} newer_than:14d',
    })).toBe('{from:reservation@activityboard.jp from:reservation_cancel@activityboard.jp} newer_than:14d');
  });

  it('turns comma-separated fromEmail into Gmail OR query', () => {
    expect(buildGmailQuery({
      from_email: 'reservation@activityboard.jp, reservation_cancel@activityboard.jp',
      query: '',
    })).toBe('{from:reservation@activityboard.jp from:reservation_cancel@activityboard.jp} newer_than:30d');
  });
});
