import { getAvailability } from './availability.js';
import {
  getStaffCalendarConnection,
  removeBookingFromGoogle,
  syncConfirmedBookingToGoogle,
} from './booking-calendar-sync.js';
import type { GoogleCalendarCredentials } from './google-oauth.js';
import {
  cancelMeetConsultation,
  registerMeetConsultation,
} from './meet-consultation-reminders.js';
import type { HarnessProxyDispatch } from './line-proxy-send.js';
import { pushViaHarnessProxy } from './line-proxy-send.js';

const JST_OFFSET_MS = 9 * 60 * 60_000;
const MIN_LEAD_TIME_MINUTES = 60;

export class WebinarConsultationError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: 400 | 403 | 404 | 409 | 422 | 503,
  ) {
    super(code);
  }
}

interface ConsultationContext {
  bookingUrl: string | null;
  menuId: string;
  menuName: string;
  durationMinutes: number;
  bufferAfterMinutes: number;
  price: number;
  staffId: string;
  staffName: string;
  calendarReady: boolean;
}

export interface ConsultationSlot {
  date: string;
  start: string;
  end: string;
  startsAt: string;
}

export interface ExistingConsultationBooking {
  bookingId: string;
  status: string;
  startsAt: string;
  meetUrl: string | null;
}

export interface WebinarConsultationAvailability {
  calendarReady: boolean;
  fallbackUrl: string | null;
  menu: { id: string; name: string; durationMinutes: number };
  staff: { id: string; name: string };
  slots: ConsultationSlot[];
  existingBooking: ExistingConsultationBooking | null;
}

export interface BookedWebinarConsultation {
  bookingId: string;
  status: 'confirmed';
  startsAt: string;
  endsAt: string;
  meetUrl: string;
  externalEventId: string;
  created: boolean;
}

function googleCredentialsConfigured(
  connection: {
    auth_type: string;
    access_token: string | null;
    refresh_token: string | null;
  },
  credentials: GoogleCalendarCredentials,
): boolean {
  if (connection.auth_type === 'service_account') {
    return Boolean(credentials.email && credentials.privateKey);
  }
  if (connection.auth_type === 'oauth') {
    return Boolean(
      connection.refresh_token && credentials.oauthClientId && credentials.oauthClientSecret,
    );
  }
  return Boolean(connection.access_token);
}

async function loadContext(
  db: D1Database,
  input: { webinarId: string; accountId: string | null; friendId: string },
  credentials: GoogleCalendarCredentials,
): Promise<ConsultationContext> {
  if (!input.accountId) throw new WebinarConsultationError('calendar_not_configured', 503);

  const config = await db
    .prepare(
      `SELECT booking_menu_id, booking_url
         FROM webinar_followup_configs
        WHERE webinar_id = ? AND is_active = 1`,
    )
    .bind(input.webinarId)
    .first<{ booking_menu_id: string | null; booking_url: string | null }>();
  if (!config?.booking_menu_id) {
    throw new WebinarConsultationError('consultation_not_configured', 404);
  }

  // ライブCTAのフォームを送信した本人だけが、そのまま相談枠を確定できる。
  const submitted = await db
    .prepare(
      `SELECT 1 AS ok
         FROM form_submissions fs
         INNER JOIN webinar_ctas wc ON wc.form_id = fs.form_id
        WHERE wc.webinar_id = ? AND fs.friend_id = ?
        LIMIT 1`,
    )
    .bind(input.webinarId, input.friendId)
    .first<{ ok: number }>();
  if (!submitted) throw new WebinarConsultationError('form_required', 403);

  const offered = await db
    .prepare(
      `SELECT m.id AS menu_id, m.name AS menu_name,
              COALESCE(sm.override_duration_minutes, m.duration_minutes) AS duration_minutes,
              m.buffer_after_minutes,
              COALESCE(sm.override_price, m.base_price) AS price,
              s.id AS staff_id, s.display_name AS staff_name
         FROM menus m
         INNER JOIN staff_menus sm ON sm.menu_id = m.id AND sm.is_offered = 1
         INNER JOIN staff s ON s.id = sm.staff_id
        WHERE m.id = ? AND m.line_account_id = ?
          AND m.is_active = 1 AND m.deleted_at IS NULL
          AND s.is_active = 1 AND s.deleted_at IS NULL
        ORDER BY s.is_designation_optional DESC, s.sort_order ASC, s.id ASC
        LIMIT 1`,
    )
    .bind(config.booking_menu_id, input.accountId)
    .first<{
      menu_id: string;
      menu_name: string;
      duration_minutes: number;
      buffer_after_minutes: number;
      price: number;
      staff_id: string;
      staff_name: string;
    }>();
  if (!offered) throw new WebinarConsultationError('consultation_not_available', 404);

  const connection = await getStaffCalendarConnection(db, input.accountId, offered.staff_id);
  const calendarReady = Boolean(
    connection && googleCredentialsConfigured(connection, credentials),
  );
  return {
    bookingUrl: config.booking_url,
    menuId: offered.menu_id,
    menuName: offered.menu_name,
    durationMinutes: offered.duration_minutes,
    bufferAfterMinutes: offered.buffer_after_minutes,
    price: offered.price,
    staffId: offered.staff_id,
    staffName: offered.staff_name,
    calendarReady,
  };
}

async function findExistingBooking(
  db: D1Database,
  friendId: string,
  menuId: string,
  now: Date,
): Promise<ExistingConsultationBooking | null> {
  const row = await db
    .prepare(
      `SELECT b.id, b.status, b.starts_at, mc.meet_url
         FROM bookings b
         LEFT JOIN meet_consultations mc
           ON mc.external_event_id = b.external_event_id AND mc.status = 'confirmed'
        WHERE b.friend_id = ? AND b.menu_id = ?
          AND b.status IN ('requested','confirmed') AND b.starts_at >= ?
        ORDER BY b.starts_at ASC
        LIMIT 1`,
    )
    .bind(friendId, menuId, now.toISOString())
    .first<{ id: string; status: string; starts_at: string; meet_url: string | null }>();
  return row
    ? { bookingId: row.id, status: row.status, startsAt: row.starts_at, meetUrl: row.meet_url }
    : null;
}

function jstDateRange(now: Date): { from: string; to: string } {
  const from = new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
  const end = new Date(`${from}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + 13);
  return { from, to: end.toISOString().slice(0, 10) };
}

function slotStartsAt(date: string, start: string): string {
  return new Date(`${date}T${start}:00+09:00`).toISOString();
}

export async function getWebinarConsultationAvailability(
  db: D1Database,
  input: {
    webinarId: string;
    accountId: string | null;
    friendId: string;
    now: Date;
    credentials: GoogleCalendarCredentials;
  },
): Promise<WebinarConsultationAvailability> {
  const context = await loadContext(db, input, input.credentials);
  const existingBooking = await findExistingBooking(
    db, input.friendId, context.menuId, input.now,
  );
  const { from, to } = jstDateRange(input.now);
  const availability = await getAvailability(db, {
    lineAccountId: input.accountId!,
    menuId: context.menuId,
    staffId: context.staffId,
    from,
    to,
    now: input.now,
    minLeadTimeMinutes: MIN_LEAD_TIME_MINUTES,
    googleCredentials: input.credentials,
  });
  const slots = (availability.by_staff[0]?.slots ?? []).map((slot) => ({
    ...slot,
    startsAt: slotStartsAt(slot.date, slot.start),
  }));
  return {
    calendarReady: context.calendarReady,
    fallbackUrl: context.bookingUrl,
    menu: {
      id: context.menuId,
      name: context.menuName,
      durationMinutes: context.durationMinutes,
    },
    staff: { id: context.staffId, name: context.staffName },
    slots,
    existingBooking,
  };
}

function renderConfirmationText(startsAt: string, meetUrl: string): string {
  const jst = new Date(new Date(startsAt).getTime() + JST_OFFSET_MS);
  const iso = jst.toISOString();
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const dateLabel = `${Number(iso.slice(5, 7))}月${Number(iso.slice(8, 10))}日` +
    `（${weekdays[jst.getUTCDay()]}）${iso.slice(11, 16)}`;
  return `個別相談の日程が確定しました✅\n\n日時：${dateLabel}\nGoogle Meet：${meetUrl}` +
    `\n\n前日と開始1時間前にも、このLINEへ参加リンクをお送りします。`;
}

export async function bookWebinarConsultation(
  db: D1Database,
  input: {
    webinarId: string;
    webinarTitle: string;
    accountId: string | null;
    friendId: string;
    startsAt: string;
    now: Date;
    credentials: GoogleCalendarCredentials;
    proxyBaseUrl: string;
    proxyDispatch?: HarnessProxyDispatch;
  },
): Promise<BookedWebinarConsultation> {
  const context = await loadContext(db, input, input.credentials);
  if (!context.calendarReady) {
    throw new WebinarConsultationError('calendar_not_configured', 503);
  }

  const existing = await findExistingBooking(db, input.friendId, context.menuId, input.now);
  if (existing) {
    if (existing.status === 'confirmed' && existing.meetUrl) {
      const booking = await db
        .prepare('SELECT ends_at, external_event_id FROM bookings WHERE id = ?')
        .bind(existing.bookingId)
        .first<{ ends_at: string; external_event_id: string }>();
      if (booking?.external_event_id) {
        return {
          bookingId: existing.bookingId,
          status: 'confirmed',
          startsAt: existing.startsAt,
          endsAt: booking.ends_at,
          meetUrl: existing.meetUrl,
          externalEventId: booking.external_event_id,
          created: false,
        };
      }
    }
    throw new WebinarConsultationError('consultation_already_booked', 409);
  }

  const startsAt = new Date(input.startsAt);
  if (!Number.isFinite(startsAt.getTime()) || startsAt <= input.now) {
    throw new WebinarConsultationError('invalid_starts_at', 422);
  }
  const startJst = new Date(startsAt.getTime() + JST_OFFSET_MS).toISOString();
  const date = startJst.slice(0, 10);
  const time = startJst.slice(11, 16);
  const availability = await getAvailability(db, {
    lineAccountId: input.accountId!,
    menuId: context.menuId,
    staffId: context.staffId,
    from: date,
    to: date,
    now: input.now,
    minLeadTimeMinutes: MIN_LEAD_TIME_MINUTES,
    googleCredentials: input.credentials,
  });
  const slotExists = availability.by_staff[0]?.slots.some(
    (slot) => slot.date === date && slot.start === time,
  );
  if (!slotExists) throw new WebinarConsultationError('slot_not_available', 409);

  const endsAt = new Date(startsAt.getTime() + context.durationMinutes * 60_000);
  const blockEndsAt = new Date(endsAt.getTime() + context.bufferAfterMinutes * 60_000);
  const bookingId = crypto.randomUUID();
  const nowIso = input.now.toISOString();
  const inserted = await db
    .prepare(
      `INSERT INTO bookings
        (id, line_account_id, friend_id, staff_id, menu_id,
         starts_at, ends_at, block_ends_at, status,
         customer_note, price_at_booking, requested_at, decided_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
        WHERE NOT EXISTS (
          SELECT 1 FROM bookings
           WHERE staff_id = ? AND status IN ('requested','confirmed')
             AND starts_at < ? AND block_ends_at > ?
        )
          AND NOT EXISTS (
          SELECT 1 FROM bookings
           WHERE friend_id = ? AND menu_id = ? AND status IN ('requested','confirmed')
             AND starts_at >= ?
        )`,
    )
    .bind(
      bookingId,
      input.accountId,
      input.friendId,
      context.staffId,
      context.menuId,
      startsAt.toISOString(),
      endsAt.toISOString(),
      blockEndsAt.toISOString(),
      'confirmed',
      `オートウェビナー「${input.webinarTitle}」CTAから即時予約`,
      context.price,
      nowIso,
      nowIso,
      context.staffId,
      blockEndsAt.toISOString(),
      startsAt.toISOString(),
      input.friendId,
      context.menuId,
      nowIso,
    )
    .run();
  if ((inserted.meta?.changes ?? 0) === 0) {
    throw new WebinarConsultationError('slot_not_available', 409);
  }

  let externalEventId: string | null = null;
  let meetUrl: string | null = null;
  try {
    const synced = await syncConfirmedBookingToGoogle(
      db,
      input.credentials,
      bookingId,
      { addGoogleMeet: true },
    );
    if (!synced.synced || !synced.eventId || !synced.meetUrl) {
      throw new Error('calendar_or_meet_not_created');
    }
    externalEventId = synced.eventId;
    meetUrl = synced.meetUrl;
    await registerMeetConsultation(db, {
      externalEventId: synced.eventId,
      friendId: input.friendId,
      title: `${input.webinarTitle}｜個別相談`,
      startsAt: startsAt.toISOString(),
      endsAt: endsAt.toISOString(),
      meetUrl: synced.meetUrl,
    }, input.now);

  } catch (error) {
    if (externalEventId) {
      await cancelMeetConsultation(db, externalEventId, input.now).catch(() => false);
      await removeBookingFromGoogle(db, input.credentials, bookingId).catch(() => undefined);
    }
    await db
      .prepare(
        `UPDATE bookings SET status='cancelled',
          updated_at=strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours') WHERE id=?`,
      )
      .bind(bookingId)
      .run();
    console.error('webinar consultation provisioning failed:', error);
    throw new WebinarConsultationError('calendar_provisioning_failed', 503);
  }

  // LINE通知は予約・Google Meet作成の成否とは分離する。一時的なLINE障害で
  // 確定済みイベントまで取り消さず、リマインドの正規レコードも維持する。
  try {
    const recipient = await db
      .prepare(
        `SELECT f.line_user_id, la.channel_access_token
           FROM friends f
           INNER JOIN line_accounts la ON la.id = f.line_account_id
          WHERE f.id = ? AND f.is_following = 1 AND la.is_active = 1`,
      )
      .bind(input.friendId)
      .first<{ line_user_id: string; channel_access_token: string }>();
    if (recipient) {
      await pushViaHarnessProxy(
        input.proxyBaseUrl,
        recipient.channel_access_token,
        recipient.line_user_id,
        [{ type: 'text', text: renderConfirmationText(startsAt.toISOString(), meetUrl!) }],
        bookingId,
        input.proxyDispatch,
      );
    }
  } catch (error) {
    console.error('webinar consultation confirmation LINE failed:', error);
  }

  return {
    bookingId,
    status: 'confirmed',
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    meetUrl: meetUrl!,
    externalEventId: externalEventId!,
    created: true,
  };
}
