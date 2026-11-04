import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Hono } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import events from './events.js';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { processDueEventReminders } from '../services/event-booking-reminders.js';

const NOW = new Date('2026-10-21T09:05:00.000Z');
const START = '2026-10-22T09:00:00.000Z';
const END = '2026-10-22T10:00:00.000Z';
const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');

describe('event reminder identity across admin saves', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  let app: Hono;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No real network allowed'));
    fixture = sqliteD1();
    fixture.sqlite.pragma('foreign_keys = ON');
    fixture.sqlite.exec(schema);
    fixture.sqlite.exec(`
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
        VALUES('account','channel','Test','local-token','local-secret');
      INSERT INTO friends(id,line_user_id,line_account_id) VALUES('friend','LINE-USER','account');
      INSERT INTO events(id,line_account_id,name,reminder_day_before_enabled,reminder_hours_before)
        VALUES('event','account','Test',1,2);
      INSERT INTO event_slots(id,event_id,starts_at,ends_at)
        VALUES('slot','event','${START}','${END}');
      INSERT INTO event_bookings(id,line_account_id,event_id,slot_id,friend_id,status,requested_at)
        VALUES('booking','account','event','slot','friend','confirmed','2026-10-01T00:00:00.000Z');
      INSERT INTO event_booking_reminders(id,booking_id,kind,scheduled_at)
        VALUES('day','booking','day_before','2026-10-21T09:00:00.000Z'),
              ('hours','booking','hours_before','2026-10-22T07:00:00.000Z');
    `);
    app = new Hono();
    app.route('/', events);
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    fixture.sqlite.close();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  function put(lane: 'event' | 'slot', body: unknown, account = 'account') {
    const suffix = lane === 'event' ? '' : '/slots/slot';
    return app.request(`https://worker.example/api/events/admin/events/event${suffix}?account_id=${account}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }, { DB: fixture.db });
  }
  const rows = () => fixture.sqlite.prepare('SELECT * FROM event_booking_reminders ORDER BY id').all();
  const active = () => fixture.sqlite.prepare("SELECT id,kind,scheduled_at FROM event_booking_reminders WHERE status='pending' ORDER BY kind").all();

  it.each([
    { reminder_day_before_enabled: 1 },
    { reminder_hours_before: 2 },
    { name: 'Updated title', reminder_day_before_enabled: 1, reminder_hours_before: 2 },
  ])('keeps retryable reminders when an admin save repeats settings %j', async body => {
    fixture.sqlite.exec("UPDATE event_booking_reminders SET status='failed',retry_count=1,last_error='response lost' WHERE id='day'");
    const original = rows();
    expect((await put('event', body)).status).toBe(200);
    expect(rows()).toEqual(original);
    if ('name' in body) expect(fixture.sqlite.prepare("SELECT name FROM events WHERE id='event'").get()).toEqual({ name: body.name });
  });

  it.each([START, '2026-10-22T09:00:00Z'])('keeps reminders for an unchanged slot instant %s', async starts_at => {
    fixture.sqlite.exec("UPDATE event_booking_reminders SET status='failed',retry_count=1 WHERE id='day'");
    const original = rows();
    expect((await put('slot', { starts_at, ends_at: END, capacity: 5 })).status).toBe(200);
    expect(rows()).toEqual(original);
    expect(fixture.sqlite.prepare("SELECT capacity FROM event_slots WHERE id='slot'").get()).toEqual({ capacity: 5 });
  });

  it('retries a due lost-response notification after a normal UI save', async () => {
    const sender = vi.fn().mockRejectedValueOnce(new Error('response lost')).mockResolvedValue(undefined);
    expect(await processDueEventReminders(fixture.db, { now: NOW, sender })).toEqual({ sent: 0, failed: 1 });
    expect((await put('event', { name: 'New title', reminder_day_before_enabled: 1, reminder_hours_before: 2 })).status).toBe(200);
    expect(await processDueEventReminders(fixture.db, { now: NOW, sender })).toEqual({ sent: 1, failed: 0 });
    expect(sender).toHaveBeenCalledTimes(2);
    expect(fixture.sqlite.prepare("SELECT status,retry_count FROM event_booking_reminders WHERE id='day'").get())
      .toEqual({ status: 'sent', retry_count: 2 });
  });

  it.each(['event', 'slot'] as const)('retains new reminder IDs when a changed %s request is replayed', async lane => {
    const body = lane === 'event'
      ? { reminder_hours_before: 3 }
      : { starts_at: '2026-10-23T09:00:00.000Z', ends_at: '2026-10-23T10:00:00.000Z' };
    expect((await put(lane, body)).status).toBe(200);
    const original = rows();
    const pending = active();
    expect(pending).not.toEqual([]);
    expect(pending).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: 'hours' })]));
    expect(pending).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: 'hours_before', scheduled_at: lane === 'event' ? '2026-10-22T06:00:00.000Z' : '2026-10-23T07:00:00.000Z',
    })]));
    expect(fixture.sqlite.prepare("SELECT status FROM event_booking_reminders WHERE id='hours'").get()).toEqual({ status: 'cancelled' });
    expect((await put(lane, body)).status).toBe(200);
    expect(rows()).toEqual(original);
  });

  it('still rebuilds when a reminder is disabled', async () => {
    const hours = fixture.sqlite.prepare("SELECT * FROM event_booking_reminders WHERE id='hours'").get();
    expect((await put('event', { reminder_day_before_enabled: 0 })).status).toBe(200);
    expect(active()).toEqual([expect.objectContaining({ kind: 'hours_before', scheduled_at: '2026-10-22T07:00:00.000Z' })]);
    expect(fixture.sqlite.prepare("SELECT * FROM event_booking_reminders WHERE id='hours'").get()).toEqual(hours);
    expect(fixture.sqlite.prepare("SELECT status FROM event_booking_reminders WHERE id='day'").get()).toEqual({ status: 'cancelled' });
  });

  it('keeps null disabled-hour settings and unrelated edits without rebuilding', async () => {
    fixture.sqlite.exec("UPDATE events SET reminder_hours_before=NULL WHERE id='event'; DELETE FROM event_booking_reminders WHERE id='hours'");
    const original = rows();
    expect((await put('event', { reminder_hours_before: null, description: 'Updated description' })).status).toBe(200);
    expect(rows()).toEqual(original);
    expect((await put('slot', { capacity: 20 })).status).toBe(200);
    expect(rows()).toEqual(original);
  });

  it('retains a due retry for an unchanged kind when only the other schedule changes', async () => {
    fixture.sqlite.exec("UPDATE event_booking_reminders SET status='failed',retry_count=1,last_error='response lost' WHERE id='day'");
    const day = fixture.sqlite.prepare("SELECT * FROM event_booking_reminders WHERE id='day'").get();
    expect((await put('event', { reminder_hours_before: 3 })).status).toBe(200);
    expect(fixture.sqlite.prepare("SELECT * FROM event_booking_reminders WHERE id='day'").get()).toEqual(day);
    expect(active()).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'hours_before', scheduled_at: '2026-10-22T06:00:00.000Z' })]));
  });

  it.each(['event', 'slot'] as const)('recovers a partially failed %s save when the request is replayed', async lane => {
    const body = lane === 'event' ? { reminder_hours_before: 3 }
      : { starts_at: '2026-10-23T09:00:00.000Z', ends_at: '2026-10-23T10:00:00.000Z' };
    fixture.sqlite.exec(`CREATE TRIGGER reject_reminder_insert BEFORE INSERT ON event_booking_reminders
      BEGIN SELECT RAISE(ABORT, 'local reminder insert failure'); END;`);
    expect((await put(lane, body)).status).toBe(500);
    fixture.sqlite.exec('DROP TRIGGER reject_reminder_insert');
    expect((await put(lane, body)).status).toBe(200);
    expect(active()).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: 'hours_before', scheduled_at: lane === 'event' ? '2026-10-22T06:00:00.000Z' : '2026-10-23T07:00:00.000Z',
    })]));
    const recovered = rows();
    expect((await put(lane, body)).status).toBe(200);
    expect(rows()).toEqual(recovered);
  });

  it('does not insert the same replacement twice for overlapping identical saves', async () => {
    const body = { reminder_hours_before: 3 };
    const responses = await Promise.all([put('event', body), put('event', body)]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    expect(active().filter(row => (row as { kind: string }).kind === 'hours_before'))
      .toEqual([expect.objectContaining({ scheduled_at: '2026-10-22T06:00:00.000Z' })]);
    const original = rows();
    expect((await put('event', body)).status).toBe(200);
    expect(rows()).toEqual(original);
  });

  it('repairs missing future reminders without creating a new notice already due in the past', async () => {
    fixture.sqlite.exec('DELETE FROM event_booking_reminders');
    expect((await put('event', { reminder_day_before_enabled: 1, reminder_hours_before: 2 })).status).toBe(200);
    expect(active()).toEqual([expect.objectContaining({ kind: 'hours_before', scheduled_at: '2026-10-22T07:00:00.000Z' })]);
  });

  it.each(['event', 'slot'] as const)('keeps account ownership checks for %s edits', async lane => {
    const original = rows();
    const body = lane === 'event' ? { reminder_hours_before: 3 } : { starts_at: START, capacity: 10 };
    expect((await put(lane, body, 'other-account')).status).toBe(404);
    expect(rows()).toEqual(original);
  });
});
