import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { getBookingsInRange } from '../src/calendar.js';

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          const statement = sqlite.prepare(sql);
          return {
            async all<T>() {
              return { success: true, results: statement.all(...params) as T[], meta: {} };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('getBookingsInRange', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE calendar_bookings (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL,
        friend_id TEXT,
        event_id TEXT,
        title TEXT NOT NULL,
        start_at TEXT NOT NULL,
        end_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'confirmed',
        metadata TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO calendar_bookings
        (id, connection_id, title, start_at, end_at, status, created_at, updated_at)
      VALUES
        ('crosses-start', 'calendar-1', 'Crosses start',
         '2026-08-16T23:30:00Z', '2026-08-17T00:30:00Z', 'confirmed', '', ''),
        ('jst', 'calendar-1', 'JST booking',
         '2026-08-17T10:00:00+09:00', '2026-08-17T11:00:00+09:00', 'confirmed', '', ''),
        ('utc', 'calendar-1', 'UTC booking',
         '2026-08-17T02:00:00Z', '2026-08-17T03:00:00Z', 'confirmed', '', ''),
        ('at-end', 'calendar-1', 'Starts at range end',
         '2026-08-17T09:00:00Z', '2026-08-17T10:00:00Z', 'confirmed', '', ''),
        ('cancelled', 'calendar-1', 'Cancelled',
         '2026-08-17T04:00:00Z', '2026-08-17T05:00:00Z', 'cancelled', '', ''),
        ('other-calendar', 'calendar-2', 'Other calendar',
         '2026-08-17T04:00:00Z', '2026-08-17T05:00:00Z', 'confirmed', '', '');
    `);
  });

  afterEach(() => sqlite.close());

  it('normalizes UTC and JST timestamps and returns every overlapping booking', async () => {
    const bookings = await getBookingsInRange(
      asD1(sqlite),
      'calendar-1',
      '2026-08-17T09:00:00+09:00',
      '2026-08-17T18:00:00+09:00',
    );

    expect(bookings.map((booking) => booking.id)).toEqual([
      'crosses-start',
      'jst',
      'utc',
    ]);
  });
});
