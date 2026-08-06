import { describe, expect, test } from 'vitest';
import {
  getActivityDigest,
  parseActivityDigestHours,
} from './activity-digest.js';
import type { UnansweredInboxResult } from './unanswered-inbox.js';

type ResultsByMarker = Record<string, unknown[]>;

function mockDb(resultsByMarker: ResultsByMarker, bindings: unknown[][]): D1Database {
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const statement = {
        bind(...values: unknown[]) {
          bound = values;
          return statement;
        },
        async all<T>() {
          bindings.push(bound);
          const marker = Object.keys(resultsByMarker).find((key) => sql.includes(`activity-digest:${key}`));
          return { results: (marker ? resultsByMarker[marker] : []) as T[] };
        },
      };
      return statement;
    },
  } as unknown as D1Database;
}

const noUnanswered: UnansweredInboxResult = {
  total: 0,
  page: 1,
  pageSize: 2000,
  rows: [],
};

describe('parseActivityDigestHours', () => {
  test('defaults to three hours', () => {
    expect(parseActivityDigestHours(undefined)).toBe(3);
  });

  test('accepts 1..168 and rejects malformed values', () => {
    expect(parseActivityDigestHours('1')).toBe(1);
    expect(parseActivityDigestHours('168')).toBe(168);
    expect(parseActivityDigestHours('0')).toBeNull();
    expect(parseActivityDigestHours('169')).toBeNull();
    expect(parseActivityDigestHours('3.5')).toBeNull();
    expect(parseActivityDigestHours('abc')).toBeNull();
  });
});

describe('getActivityDigest', () => {
  test('aggregates user actions and current unanswered rows', async () => {
    const bindings: unknown[][] = [];
    const db = mockDb({
      friends: [{
        id: 'friend-1', display_name: '田中', line_account_id: 'account-1',
        account_name: '本店', created_at: '2026-08-05T17:30:00.000',
      }],
      messages: [{
        id: 'message-1', friend_id: 'friend-1', display_name: '田中',
        line_account_id: 'account-1', account_name: '本店', message_type: 'text',
        content: '予約したいです', source: null, created_at: '2026-08-05T17:45:00.000',
      }],
      forms: [{
        id: 'submission-1', form_id: 'form-1', form_name: '相談フォーム',
        friend_id: 'friend-1', display_name: '田中', line_account_id: 'account-1',
        account_name: '本店', data: '{"interest":"AI"}',
        created_at: '2026-08-05T17:50:00.000',
      }],
      bookings: [{
        id: 'booking-1', friend_id: 'friend-1', display_name: '田中',
        line_account_id: 'account-1', account_name: '本店', menu_name: '初回相談',
        staff_name: '佐藤', starts_at: '2026-08-06T01:00:00Z', status: 'requested',
        customer_note: null, requested_at: '2026-08-05T08:55:00Z',
      }],
      'event-bookings': [{
        id: 'event-booking-1', friend_id: 'friend-1', display_name: '田中',
        line_account_id: 'account-1', account_name: '本店', event_name: 'セミナー',
        starts_at: '2026-08-10T01:00:00Z', status: 'confirmed', customer_note: '参加希望',
        requested_at: '2026-08-05T08:58:00Z',
      }],
    }, bindings);
    const unanswered: UnansweredInboxResult = {
      total: 1,
      page: 1,
      pageSize: 2000,
      rows: [{
        friendId: 'friend-1', displayName: '田中', pictureUrl: null,
        accountId: 'account-1', accountName: '本店',
        lastIncomingAt: '2026-08-05T17:45:00.000+09:00',
        lastManualAt: null, lastMachineAt: null, lastIncomingType: 'text',
        lastIncomingContent: '予約したいです',
      }],
    };

    const result = await getActivityDigest(db, {
      hours: 3,
      now: new Date('2026-08-05T09:00:00Z'),
      unansweredLoader: async () => unanswered,
    });

    expect(result.window.since).toBe('2026-08-05T06:00:00.000Z');
    expect(result.summary).toMatchObject({
      totalNewActions: 5,
      newFriends: 1,
      incomingMessages: 1,
      formSubmissions: 1,
      bookingRequests: 1,
      eventBookingRequests: 1,
      unansweredTotal: 1,
    });
    expect(result.newActions.friends.items[0].occurredAt).toBe('2026-08-05T08:30:00.000Z');
    expect(result.newActions.formSubmissions.items[0].data).toEqual({ interest: 'AI' });
    expect(result.summary.newActionsByAccount).toEqual([
      { accountId: 'account-1', accountName: '本店', count: 5 },
    ]);
    expect(result.unanswered.oldestWaitMinutes).toBe(15);
    expect(bindings).toEqual([
      ['2026-08-05T15:00:00.000', 501],
      ['2026-08-05T15:00:00.000', 501],
      ['2026-08-05T15:00:00.000', 501],
      ['2026-08-05T06:00:00.000Z', 501],
      ['2026-08-05T06:00:00.000Z', 501],
    ]);
  });

  test('marks a category as truncated without over-counting returned actions', async () => {
    const messages = Array.from({ length: 501 }, (_, index) => ({
      id: `message-${index}`,
      friend_id: 'friend-1',
      display_name: '田中',
      line_account_id: 'account-1',
      account_name: '本店',
      message_type: 'text',
      content: String(index),
      source: null,
      created_at: '2026-08-05T17:45:00.000',
    }));
    const db = mockDb({ messages }, []);

    const result = await getActivityDigest(db, {
      now: new Date('2026-08-05T09:00:00Z'),
      unansweredLoader: async () => noUnanswered,
    });

    expect(result.newActions.incomingMessages.items).toHaveLength(500);
    expect(result.newActions.incomingMessages.truncated).toBe(true);
    expect(result.summary.totalNewActions).toBe(500);
  });
});
