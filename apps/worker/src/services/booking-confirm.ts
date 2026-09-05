// Confirmation side-effects shared by the admin approve route (PATCH
// /api/booking/admin/requests/:id) and the admin proxy-create route
// (POST /api/booking/admin/bookings).
//
// Reminders already in the past are skipped so that confirming a
// same-day booking does not immediately fire "明日のご予約" messages.

import { DEFAULT_ACCOUNT_SETTINGS } from './booking-types.js';

export async function insertConfirmationReminders(
  db: D1Database,
  args: {
    bookingId: string;
    startsAt: Date;
    now: Date;
    reminderHoursBefore?: number;
  },
): Promise<number> {
  const hours = args.reminderHoursBefore ?? DEFAULT_ACCOUNT_SETTINGS.reminder_hours_before;
  const dayBefore = new Date(args.startsAt.getTime() - 86400_000);
  const hoursBefore = new Date(args.startsAt.getTime() - hours * 3600_000);
  const inserts = [];
  if (dayBefore > args.now) {
    inserts.push(
      db
        .prepare(`INSERT INTO booking_reminders (id, booking_id, kind, scheduled_at) VALUES (?,?,?,?)`)
        .bind(crypto.randomUUID(), args.bookingId, 'day_before', dayBefore.toISOString()),
    );
  }
  if (hoursBefore > args.now) {
    inserts.push(
      db
        .prepare(`INSERT INTO booking_reminders (id, booking_id, kind, scheduled_at) VALUES (?,?,?,?)`)
        .bind(crypto.randomUUID(), args.bookingId, 'hours_before', hoursBefore.toISOString()),
    );
  }
  if (inserts.length > 0) {
    await db.batch(inserts);
  }
  return inserts.length;
}
