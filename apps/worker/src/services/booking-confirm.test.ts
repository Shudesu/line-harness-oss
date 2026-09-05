import { describe, expect, test } from 'vitest';
import { insertConfirmationReminders } from './booking-confirm.js';

function fakeDb() {
  const bound: { sql: string; params: unknown[] }[] = [];
  const batched: unknown[] = [];
  const db = {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          const stmt = { sql, params };
          bound.push(stmt);
          return stmt;
        },
      };
    },
    async batch(stmts: unknown[]) {
      batched.push(...stmts);
    },
  } as unknown as D1Database;
  return { db, bound, batched };
}

const NOW = new Date('2026-07-07T00:00:00Z');

describe('insertConfirmationReminders', () => {
  test('starts in 3 days: day_before + hours_before both inserted', async () => {
    const { db, bound, batched } = fakeDb();
    const n = await insertConfirmationReminders(db, {
      bookingId: 'bk1',
      startsAt: new Date('2026-07-10T02:00:00Z'),
      now: NOW,
    });
    expect(n).toBe(2);
    expect(batched).toHaveLength(2);
    expect(bound.map((b) => b.params[2])).toEqual(['day_before', 'hours_before']);
    // day_before = starts - 24h
    expect(bound[0].params[3]).toBe('2026-07-09T02:00:00.000Z');
    // hours_before = starts - 2h (DEFAULT reminder_hours_before)
    expect(bound[1].params[3]).toBe('2026-07-10T00:00:00.000Z');
  });

  test('starts in 3 hours: only hours_before', async () => {
    const { db, batched } = fakeDb();
    const n = await insertConfirmationReminders(db, {
      bookingId: 'bk1',
      startsAt: new Date('2026-07-07T03:00:00Z'),
      now: NOW,
    });
    expect(n).toBe(1);
    expect(batched).toHaveLength(1);
  });

  test('starts in 1 hour: no reminders (both in the past)', async () => {
    const { db, batched } = fakeDb();
    const n = await insertConfirmationReminders(db, {
      bookingId: 'bk1',
      startsAt: new Date('2026-07-07T01:00:00Z'),
      now: NOW,
    });
    expect(n).toBe(0);
    expect(batched).toHaveLength(0);
  });
});
