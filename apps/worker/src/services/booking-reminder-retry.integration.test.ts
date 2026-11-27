import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { processDueReminders } from './booking-reminders.js';
import { cancelPendingRemindersFor, processDueEventReminders } from './event-booking-reminders.js';
import { sendBookingNotification } from './booking-notifier.js';
import { sendEventBookingNotification } from './event-booking-notifier.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const now = new Date('2026-08-09T09:00:00.000Z');
const firstId = '4bb700de-bc62-4db2-8c64-0a3429a975af';
const secondId = '19e00457-10a8-460d-a61c-f8d8a632fe10';

for (const lane of ['salon', 'event'] as const) {
  describe(`${lane} reminder retry delivery`, () => {
    let fixture: ReturnType<typeof sqliteD1>;
    const table = lane === 'salon' ? 'booking_reminders' : 'event_booking_reminders';
    beforeEach(() => {
      fixture = sqliteD1();
      fixture.sqlite.pragma('foreign_keys = ON');
      fixture.sqlite.exec(schema);
      fixture.sqlite.exec(`
        INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
          VALUES ('account', 'channel', 'Test', 'local-token', 'local-secret');
        INSERT INTO friends (id, line_user_id, line_account_id) VALUES ('friend', 'LINE-USER', 'account');
        INSERT INTO menus (id, line_account_id, name, duration_minutes, base_price)
          VALUES ('menu', 'account', '相談', 60, 1000);
        INSERT INTO staff (id, line_account_id, name, display_name) VALUES ('staff', 'account', 'Test', '担当者');
        INSERT INTO bookings (id, line_account_id, friend_id, staff_id, menu_id, starts_at, ends_at,
                              block_ends_at, status, price_at_booking, requested_at)
          VALUES ('booking', 'account', 'friend', 'staff', 'menu', '2026-08-10T09:00:00.000Z',
                  '2026-08-10T10:00:00.000Z', '2026-08-10T10:00:00.000Z', 'confirmed', 1000,
                  '2026-08-01T00:00:00.000Z');
        INSERT INTO events (id, line_account_id, name, reminder_hours_before) VALUES ('event', 'account', '相談会', 2);
        INSERT INTO event_slots (id, event_id, starts_at, ends_at)
          VALUES ('slot', 'event', '2026-08-10T09:00:00.000Z', '2026-08-10T10:00:00.000Z');
        INSERT INTO event_bookings (id, line_account_id, event_id, slot_id, friend_id, status, requested_at)
          VALUES ('booking', 'account', 'event', 'slot', 'friend', 'confirmed', '2026-08-01T00:00:00.000Z');
      `);
      fixture.sqlite.prepare(`INSERT INTO ${table} (id, booking_id, kind, scheduled_at) VALUES (?, 'booking', 'day_before', ?)`)
        .run(firstId, now.toISOString());
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      fixture.sqlite.close();
    });
    const run = (at = now) => lane === 'salon'
      ? processDueReminders(fixture.db, { now: at, sender: sendBookingNotification, reminderHoursBefore: 2 })
      : processDueEventReminders(fixture.db, { now: at, sender: sendEventBookingNotification });
    const state = () => fixture.sqlite.prepare(`SELECT status, retry_count FROM ${table} WHERE id = ?`)
      .get(firstId) as { status: string; retry_count: number };

    function lineFixture(options: { loseResponse?: boolean; holdResponse?: boolean; onAccepted?: () => Promise<void> } = {}) {
      const accepted: Array<{ key: string | null; body: unknown }> = [];
      const keys = new Set<string>();
      let first = true;
      let signalEntered!: () => void;
      let release!: () => void;
      const entered = new Promise<void>(resolve => { signalEntered = resolve; });
      const held = new Promise<void>(resolve => { release = resolve; });
      const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        expect(String(url)).toBe('https://api.line.me/v2/bot/message/push');
        const headers = new Headers(init?.headers);
        expect(headers.has('x-line-harness-source')).toBe(false);
        const key = headers.get('x-line-retry-key');
        if (key && keys.has(key)) return new Response('already accepted', {
          status: 409, headers: { 'x-line-accepted-request-id': 'original-request' },
        });
        accepted.push({ key, body: JSON.parse(String(init?.body)) });
        if (key) keys.add(key);
        if (first) {
          first = false;
          await options.onAccepted?.();
          signalEntered();
          if (options.holdResponse) await held;
          if (options.loseResponse) throw new Error('response lost after acceptance');
        }
        return new Response('{}', { status: 200 });
      });
      vi.stubGlobal('fetch', fetchMock);
      return { accepted, fetchMock, entered, release };
    }

    it('retries an accepted-but-lost response without a second accepted notification', async () => {
      const line = lineFixture({ loseResponse: true });
      expect(await run()).toEqual({ sent: 0, failed: 1 });
      expect(state()).toEqual({ status: 'failed', retry_count: 1 });
      expect(await run()).toEqual({ sent: 1, failed: 0 });
      expect(line.accepted).toHaveLength(1);
      expect(line.accepted[0].key).toBe(firstId);
      expect(line.fetchMock).toHaveBeenCalledTimes(2);
      expect(state().status).toBe('sent');
    });

    it('does not deliver twice when another cron reads while the first send is in flight', async () => {
      const line = lineFixture({ holdResponse: true });
      const first = run();
      await line.entered;
      let secondResult;
      try {
        secondResult = await run();
      } finally {
        line.release();
      }
      const firstResult = await first;
      expect(secondResult).toEqual({ sent: 1, failed: 0 });
      expect(firstResult).toEqual({ sent: 1, failed: 0 });
      expect(line.accepted).toHaveLength(1);
      expect(line.accepted[0].key).toBe(firstId);
      expect(state().status).toBe('sent');
    });

    it('allows the separate day-before and hours-before reminders to be accepted', async () => {
      const line = lineFixture();
      expect(await run()).toEqual({ sent: 1, failed: 0 });
      fixture.sqlite.prepare(`INSERT INTO ${table} (id, booking_id, kind, scheduled_at) VALUES (?, 'booking', 'hours_before', ?)`)
        .run(secondId, '2026-08-10T07:00:00.000Z');
      expect(await run(new Date('2026-08-10T07:00:00.000Z'))).toEqual({ sent: 1, failed: 0 });
      expect(line.accepted.map(item => item.key)).toEqual([firstId, secondId]);
    });

    it('keeps non-reminder notification calls without a retry key unchanged', async () => {
      const line = lineFixture();
      if (lane === 'salon') await sendBookingNotification({
        channelAccessToken: 'local-token', toLineUserId: 'LINE-USER', kind: 'approved',
        ctx: { menuName: '相談', staffName: '担当者', startsAtJst: '2026-08-10 18:00', hoursBefore: 2 },
      });
      else await sendEventBookingNotification({
        channelAccessToken: 'local-token', toLineUserId: 'LINE-USER', kind: 'confirmed',
        ctx: { eventName: '相談会', startsAtJst: '2026-08-10 18:00' },
      });
      expect(line.accepted).toHaveLength(1);
      expect(line.accepted[0].key).toBeNull();
    });

    it('rechecks a queued reminder after its parent was cancelled before child cleanup', async () => {
      fixture.sqlite.prepare(`INSERT INTO ${table} (id, booking_id, kind, scheduled_at) VALUES (?, 'booking', 'hours_before', ?)`)
        .run(secondId, now.toISOString());
      const parentTable = lane === 'salon' ? 'bookings' : 'event_bookings';
      const line = lineFixture({ onAccepted: async () => {
        // Cancellation writes the parent before awaiting child cleanup. The
        // second already-selected row must honor the committed parent status.
        fixture.sqlite.exec(`UPDATE ${parentTable} SET status='cancelled' WHERE id='booking'`);
      } });
      expect(await run()).toEqual({ sent: 1, failed: 0 });
      expect(line.accepted).toHaveLength(1);
      expect(line.fetchMock).toHaveBeenCalledTimes(1);
    });

    it.each(['accepted', 'failed'] as const)(
      'keeps cancellation when the in-flight response is %s', async outcome => {
        const parentTable = lane === 'salon' ? 'bookings' : 'event_bookings';
        const line = lineFixture({ loseResponse: outcome === 'failed', onAccepted: async () => {
          fixture.sqlite.exec(`UPDATE ${parentTable} SET status='cancelled' WHERE id='booking'`);
          if (lane === 'event') await cancelPendingRemindersFor(fixture.db, 'booking');
          else fixture.sqlite.exec(`UPDATE booking_reminders SET status='cancelled'
            WHERE booking_id='booking' AND status='pending'`);
        } });
        expect(await run()).toEqual(outcome === 'accepted' ? { sent: 1, failed: 0 } : { sent: 0, failed: 1 });
        expect(state()).toEqual({ status: 'cancelled', retry_count: lane === 'event' ? 1 : 0 });
        expect(await run()).toEqual({ sent: 0, failed: 0 });
        expect(line.fetchMock).toHaveBeenCalledTimes(1);
      },
    );

    it('does not replace a newer successful retry with an older lost-response failure', async () => {
      const line = lineFixture({ holdResponse: true, loseResponse: true });
      const oldAttempt = run();
      await line.entered;
      try {
        expect(await run()).toEqual({ sent: 1, failed: 0 });
        expect(state().status).toBe('sent');
      } finally { line.release(); }
      expect(await oldAttempt).toEqual({ sent: 0, failed: 1 });
      expect(state().status).toBe('sent');
      expect(line.accepted).toHaveLength(1);
    });

    it('records a late accepted response even when other retries exhausted the limit', async () => {
      const line = lineFixture({ holdResponse: true });
      const acceptedAttempt = run();
      await line.entered;
      // These attempts fail before their response can reach the client. The
      // first accepted request is still held, so its success arrives last.
      line.fetchMock.mockImplementation(async () => { throw new Error('retry network failure'); });
      try {
        for (let i = 0; i < (lane === 'salon' ? 3 : 2); i++) {
          expect(await run()).toEqual({ sent: 0, failed: 1 });
        }
        expect(state().status).toBe('failed_permanent');
      } finally { line.release(); }
      expect(await acceptedAttempt).toEqual({ sent: 1, failed: 0 });
      expect(state().status).toBe('sent');
      expect(line.accepted).toHaveLength(1);
    });
  });
}
