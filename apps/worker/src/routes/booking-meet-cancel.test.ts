import { beforeEach, describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { Hono } from 'hono';
import type Database from 'better-sqlite3';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { registerMeetConsultation } from '../services/meet-consultation-reminders.js';
import booking from './booking.js';

// Regression (#440): オートウェビナーの即時予約は、予約の Google Calendar 予定に
// Meet 個別相談とリマインドを紐づけている。管理画面で予約を取り消したら、
// 相談とリマインドも取り消し、Meet の参加リンクを送り続けないこと。

const ACCOUNT = 'acc-meet';
const EVENT_ID = 'google-event-1';
const NOW = new Date('2026-08-08T00:00:00.000Z');

function seed(sqlite: Database.Database, externalEventId: string | null) {
  sqlite
    .prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)')
    .run(ACCOUNT, 'ch-meet', 'Meet Account', 'token', 'secret');
  sqlite
    .prepare('INSERT INTO friends(id,line_user_id,display_name,is_following,line_account_id) VALUES(?,?,?,1,?)')
    .run('friend-1', 'U-meet', 'Meet Friend', ACCOUNT);
  sqlite
    .prepare('INSERT INTO staff(id,line_account_id,name,display_name) VALUES(?,?,?,?)')
    .run('staff-1', ACCOUNT, 'staff', 'Staff');
  sqlite
    .prepare('INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES(?,?,?,?,?)')
    .run('menu-1', ACCOUNT, 'consultation', 60, 0);
  sqlite
    .prepare(
      `INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,
                            status,price_at_booking,requested_at,external_event_id)
       VALUES(?,?,?,?,?,?,?,?,'confirmed',0,?,?)`,
    )
    .run(
      'booking-1', ACCOUNT, 'friend-1', 'staff-1', 'menu-1',
      '2026-08-10T10:00:00.000Z', '2026-08-10T11:00:00.000Z', '2026-08-10T11:00:00.000Z',
      NOW.toISOString(), externalEventId,
    );
}

async function cancelBooking(db: D1Database) {
  const app = new Hono();
  app.route('/', booking);
  return app.request(
    `/api/booking/admin/requests/booking-1?account_id=${ACCOUNT}`,
    { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }) },
    { DB: db },
    { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as unknown as ExecutionContext,
  );
}

describe('PATCH /api/booking/admin/requests/:id cancel', () => {
  let db: D1Database;
  let sqlite: Database.Database;

  beforeEach(() => {
    ({ db, sqlite } = sqliteD1());
    sqlite.exec(readFileSync(new NodeURL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8'));
  });

  test('cancels the linked Meet consultation and its pending reminders', async () => {
    seed(sqlite, EVENT_ID);
    await registerMeetConsultation(db, {
      externalEventId: EVENT_ID,
      friendId: 'friend-1',
      title: '個別相談',
      startsAt: '2026-08-10T10:00:00.000Z',
      endsAt: '2026-08-10T11:00:00.000Z',
      meetUrl: 'https://meet.google.com/abc-defg-hij',
    }, NOW);

    const res = await cancelBooking(db);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'cancelled' });
    expect(sqlite.prepare('SELECT status FROM bookings WHERE id = ?').get('booking-1')).toEqual({ status: 'cancelled' });
    expect(sqlite.prepare('SELECT status FROM meet_consultations WHERE external_event_id = ?').get(EVENT_ID))
      .toEqual({ status: 'cancelled' });
    expect(sqlite.prepare('SELECT DISTINCT status FROM meet_consultation_reminders').all())
      .toEqual([{ status: 'cancelled' }]);
  });

  test('still cancels a booking that has no calendar event', async () => {
    seed(sqlite, null);

    const res = await cancelBooking(db);

    expect(res.status).toBe(200);
    expect(sqlite.prepare('SELECT status FROM bookings WHERE id = ?').get('booking-1')).toEqual({ status: 'cancelled' });
  });
});
