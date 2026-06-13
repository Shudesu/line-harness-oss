import { listReservations, updateReservationStatus } from '@line-crm/db';

export interface ReservationAutoCompleteResult {
  skipped: boolean;
  date: string;
  total: number;
  completed: number;
  failed: number;
}

export function shouldRunReservationAutoComplete(now = new Date()): boolean {
  const jst = toJstParts(now);
  return jst.hour === 19 && jst.minute < 10;
}

export function reservationAutoCompleteDate(now = new Date()): string {
  return toJstParts(now).date;
}

export async function processReservationAutoCompleteAtNight(
  db: D1Database,
  now = new Date(),
): Promise<ReservationAutoCompleteResult> {
  const date = reservationAutoCompleteDate(now);
  if (!shouldRunReservationAutoComplete(now)) {
    return { skipped: true, date, total: 0, completed: 0, failed: 0 };
  }

  const reservations = await listReservations(db, {
    date,
    status: 'confirmed',
    limit: 500,
  });

  let completed = 0;
  let failed = 0;
  for (const reservation of reservations) {
    const result = await updateReservationStatus(db, reservation.id, {
      status: 'completed',
      actorType: 'system',
      actorId: 'cron:auto-complete-nightly',
    });
    if (result.ok && result.changed !== false) {
      completed += 1;
    } else if (!result.ok) {
      failed += 1;
    }
  }

  return {
    skipped: false,
    date,
    total: reservations.length,
    completed,
    failed,
  };
}

function toJstParts(date: Date): { date: string; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}
