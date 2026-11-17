import { describe, expect, test, vi } from 'vitest';
import {
  computeRemindersForBooking,
  insertRemindersForBooking,
  cancelPendingRemindersFor,
} from './event-booking-reminders.js';

describe('computeRemindersForBooking', () => {
  const now = new Date('2026-05-09T00:00:00Z');

  test('day_before only when enabled', () => {
    const out = computeRemindersForBooking({
      starts_at_utc: '2099-06-01T01:00:00Z', // 10:00 JST
      reminder_day_before_enabled: true,
      reminder_hours_before: null,
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('day_before');
    // 前日 18:00 JST = 09:00 UTC of 2099-05-31
    expect(out[0].scheduled_at).toBe('2099-05-31T09:00:00.000Z');
  });

  test('hours_before only when set', () => {
    const out = computeRemindersForBooking({
      starts_at_utc: '2099-06-01T10:00:00Z',
      reminder_day_before_enabled: false,
      reminder_hours_before: 2,
      now,
    });
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('hours_before');
    expect(out[0].scheduled_at).toBe('2099-06-01T08:00:00.000Z');
  });

  test('both when configured', () => {
    const out = computeRemindersForBooking({
      starts_at_utc: '2099-06-01T01:00:00Z',
      reminder_day_before_enabled: true,
      reminder_hours_before: 1,
      now,
    });
    expect(out).toHaveLength(2);
    expect(out.map((r) => r.kind).sort()).toEqual(['day_before', 'hours_before']);
  });

  test('past day_before is dropped', () => {
    const out = computeRemindersForBooking({
      starts_at_utc: '2026-05-08T10:00:00Z', // already past relative to now
      reminder_day_before_enabled: true,
      reminder_hours_before: null,
      now,
    });
    expect(out).toHaveLength(0);
  });

  test('past hours_before is dropped', () => {
    const out = computeRemindersForBooking({
      starts_at_utc: '2026-05-09T01:00:00Z',
      reminder_day_before_enabled: false,
      reminder_hours_before: 2,
      now,
    });
    expect(out).toHaveLength(0);
  });

  test('hours_before <= 0 is ignored', () => {
    const out = computeRemindersForBooking({
      starts_at_utc: '2099-06-01T10:00:00Z',
      reminder_day_before_enabled: false,
      reminder_hours_before: 0,
      now,
    });
    expect(out).toHaveLength(0);
  });

  test('日跨ぎ JST 23:00 → UTC 14:00 の前日計算が正しい', () => {
    // 2099-06-01 23:00 JST = 2099-06-01 14:00 UTC
    // day_before should be 2099-05-31 18:00 JST = 2099-05-31 09:00 UTC
    const out = computeRemindersForBooking({
      starts_at_utc: '2099-06-01T14:00:00Z',
      reminder_day_before_enabled: true,
      reminder_hours_before: null,
      now,
    });
    expect(out[0].scheduled_at).toBe('2099-05-31T09:00:00.000Z');
  });
});

interface ReminderRow {
  id: string;
  booking_id: string;
  kind: string;
  scheduled_at: string;
  status: string;
  retry_count: number;
}

function memDB(state: { rows: ReminderRow[] }): D1Database {
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T>() { return null as T | null; },
        async all() { return { results: [] }; },
        async run() {
          if (sql.startsWith('INSERT INTO event_booking_reminders')) {
            const [id, booking_id, kind, scheduled_at] = bound as [string, string, string, string];
            state.rows.push({ id, booking_id, kind, scheduled_at, status: 'pending', retry_count: 0 });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE event_booking_reminders')) {
            const [booking_id] = bound as [string];
            let n = 0;
            for (const r of state.rows) {
              if (r.booking_id === booking_id && r.status === 'pending') {
                r.status = 'cancelled';
                n++;
              }
            }
            return { success: true, meta: { changes: n } };
          }
          return { success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

describe('insertRemindersForBooking', () => {
  test('inserts each reminder with status=pending', async () => {
    const state = { rows: [] as ReminderRow[] };
    const db = memDB(state);
    await insertRemindersForBooking(db, 'b1', [
      { kind: 'day_before', scheduled_at: '2099-05-31T09:00:00.000Z' },
      { kind: 'hours_before', scheduled_at: '2099-06-01T08:00:00.000Z' },
    ]);
    expect(state.rows).toHaveLength(2);
    expect(state.rows.every((r) => r.status === 'pending')).toBe(true);
    expect(state.rows.every((r) => r.booking_id === 'b1')).toBe(true);
  });

  test('empty input is a no-op', async () => {
    const state = { rows: [] as ReminderRow[] };
    const db = memDB(state);
    await insertRemindersForBooking(db, 'b1', []);
    expect(state.rows).toHaveLength(0);
  });
});

describe('cancelPendingRemindersFor', () => {
  test('cancels only pending reminders for the given booking', async () => {
    const state = {
      rows: [
        { id: 'r1', booking_id: 'b1', kind: 'day_before', scheduled_at: 'x', status: 'pending', retry_count: 0 },
        { id: 'r2', booking_id: 'b1', kind: 'hours_before', scheduled_at: 'x', status: 'sent', retry_count: 0 },
        { id: 'r3', booking_id: 'b2', kind: 'day_before', scheduled_at: 'x', status: 'pending', retry_count: 0 },
      ],
    };
    const db = memDB(state);
    await cancelPendingRemindersFor(db, 'b1');
    expect(state.rows[0].status).toBe('cancelled');
    expect(state.rows[1].status).toBe('sent');
    expect(state.rows[2].status).toBe('pending');
  });
});

import { processDueEventReminders } from './event-booking-reminders.js';

interface DueRow {
  id: string;
  booking_id: string;
  kind: string;
  retry_count: number;
  event_name: string;
  venue_name: string | null;
  venue_url: string | null;
  starts_at: string;
  channel_access_token: string;
  line_user_id: string;
  reminder_hours_before: number | null;
  status: string;
  scheduled_at: string;
  sent_at: string | null;
  last_error: string | null;
}

function dueDB(state: { rows: DueRow[] }): D1Database {
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) { bound = args; return stmt; },
        async first<T>(): Promise<T | null> {
          const result = await stmt.all<DueRow>();
          return (result.results.find(row => row.id === bound[2]) ?? null) as T | null;
        },
        async all<T>() {
          if (sql.includes('FROM event_booking_reminders r')) {
            const [nowIso] = bound as [string];
            const items = state.rows.filter(
              (r) =>
                (r.status === 'pending' || r.status === 'failed') &&
                r.scheduled_at <= nowIso &&
                r.starts_at > nowIso,
            );
            return { results: items as unknown as T[] };
          }
          return { results: [] };
        },
        async run() {
          // CAS claim: bump retry_count if status pending/failed and current retry_count matches
          if (sql.includes('SET retry_count = retry_count + 1')) {
            const [id, expected] = bound as [string, number];
            const r = state.rows.find((x) => x.id === id);
            if (!r) return { success: true, meta: { changes: 0 } };
            if (r.retry_count !== expected) return { success: true, meta: { changes: 0 } };
            if (r.status !== 'pending' && r.status !== 'failed') return { success: true, meta: { changes: 0 } };
            r.retry_count = expected + 1;
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith("UPDATE event_booking_reminders SET status='sent'")) {
            const [sent_at, id] = bound as [string, string];
            const r = state.rows.find((x) => x.id === id);
            if (r) { r.status = 'sent'; r.sent_at = sent_at; }
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE event_booking_reminders SET status = ?, last_error = ?')) {
            const [status, last_error, id] = bound as [string, string, string];
            const r = state.rows.find((x) => x.id === id);
            if (r) { r.status = status; r.last_error = last_error; }
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: {} };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function dueRow(over: Partial<DueRow> = {}): DueRow {
  return {
    id: 'r1', booking_id: 'b1', kind: 'day_before', retry_count: 0,
    event_name: 'X', venue_name: null, venue_url: null,
    starts_at: '2099-06-01T10:00:00Z',
    channel_access_token: 'tok',
    line_user_id: 'U1',
    reminder_hours_before: null,
    status: 'pending',
    scheduled_at: '2026-05-09T00:00:00Z',
    sent_at: null,
    last_error: null,
    ...over,
  };
}

describe('processDueEventReminders', () => {
  test('sends due pending reminders', async () => {
    const state = { rows: [dueRow({ id: 'r1' })] };
    const db = dueDB(state);
    const sender = vi.fn(async () => undefined);
    const result = await processDueEventReminders(db, {
      now: new Date('2026-05-09T01:00:00Z'),
      sender,
    });
    expect(result).toEqual({ sent: 1, failed: 0 });
    expect(state.rows[0].status).toBe('sent');
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'reminder_day_before' }),
    );
  });

  test('skips future-scheduled reminders', async () => {
    const state = { rows: [dueRow({ id: 'r1', scheduled_at: '2099-06-01T00:00:00Z' })] };
    const db = dueDB(state);
    const sender = vi.fn(async () => undefined);
    const result = await processDueEventReminders(db, {
      now: new Date('2026-05-09T01:00:00Z'),
      sender,
    });
    expect(result).toEqual({ sent: 0, failed: 0 });
    expect(sender).not.toHaveBeenCalled();
  });

  test('marks failed_permanent after retry_count >= max', async () => {
    const state = {
      rows: [dueRow({ id: 'r1', retry_count: 2 })], // REMINDER_MAX_RETRY=3
    };
    const db = dueDB(state);
    const sender = vi.fn(async () => { throw new Error('boom'); });
    const result = await processDueEventReminders(db, {
      now: new Date('2026-05-09T01:00:00Z'),
      sender,
    });
    expect(result).toEqual({ sent: 0, failed: 1 });
    expect(state.rows[0].status).toBe('failed_permanent');
    expect(state.rows[0].retry_count).toBe(3);
  });

  test('marks failed (retryable) on first failure', async () => {
    const state = { rows: [dueRow({ id: 'r1', retry_count: 0 })] };
    const db = dueDB(state);
    const sender = vi.fn(async () => { throw new Error('temp'); });
    await processDueEventReminders(db, {
      now: new Date('2026-05-09T01:00:00Z'),
      sender,
    });
    expect(state.rows[0].status).toBe('failed');
    expect(state.rows[0].retry_count).toBe(1);
    expect(state.rows[0].last_error).toBe('temp');
  });

  test('hours_before kind passes hoursBefore from event setting', async () => {
    const state = { rows: [dueRow({ id: 'r1', kind: 'hours_before', reminder_hours_before: 2 })] };
    const db = dueDB(state);
    const sender = vi.fn(async () => undefined);
    await processDueEventReminders(db, {
      now: new Date('2026-05-09T01:00:00Z'),
      sender,
    });
    expect(sender).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'reminder_hours_before',
        ctx: expect.objectContaining({ hoursBefore: 2 }),
      }),
    );
  });
});
