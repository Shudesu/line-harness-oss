import type { HarnessProxyDispatch } from './line-proxy-send.js';
import { pushViaHarnessProxy } from './line-proxy-send.js';

export type MeetReminderKind = 'day_before' | 'hour_before';

export interface RegisterMeetConsultationInput {
  externalEventId: string;
  friendId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  meetUrl: string;
}

export interface MeetReminderSchedule {
  kind: MeetReminderKind;
  scheduledAt: string;
}

export interface MeetReminderDeliveryOptions {
  now: Date;
  proxyBaseUrl: string;
  proxyDispatch?: HarnessProxyDispatch;
}

interface MeetConsultationRow {
  id: string;
  external_event_id: string;
  friend_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  meet_url: string;
  status: 'confirmed' | 'cancelled' | 'completed';
}

interface DueMeetReminderRow {
  id: string;
  consultation_id: string;
  kind: MeetReminderKind;
  retry_count: number;
  title: string;
  starts_at: string;
  meet_url: string;
  line_user_id: string;
  channel_access_token: string;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const MAX_RETRY = 3;
const MEET_URL_RE = /^https:\/\/meet\.google\.com\/[a-z0-9-]+(?:[/?#].*)?$/i;

function normalizeDate(value: string, field: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${field} must be a valid ISO datetime`);
  return date;
}

export function calculateMeetReminderSchedule(
  startsAt: string,
  now: Date,
): MeetReminderSchedule[] {
  const start = normalizeDate(startsAt, 'startsAt');
  const startMs = start.getTime();
  const nowMs = now.getTime();
  if (startMs <= nowMs) return [];

  const schedules: MeetReminderSchedule[] = [];
  const untilStart = startMs - nowMs;

  // 24時間以内に確定した予定は、前日通知を次のcronで即時送信する。
  // 開始1時間以内なら同時に2通送らず、1時間前通知だけにまとめる。
  if (untilStart > HOUR_MS) {
    schedules.push({
      kind: 'day_before',
      scheduledAt: new Date(Math.max(startMs - DAY_MS, nowMs)).toISOString(),
    });
  }
  schedules.push({
    kind: 'hour_before',
    scheduledAt: new Date(Math.max(startMs - HOUR_MS, nowMs)).toISOString(),
  });
  return schedules;
}

export function renderMeetReminderText(kind: MeetReminderKind, startsAt: string, meetUrl: string): string {
  const start = normalizeDate(startsAt, 'startsAt');
  const jst = new Date(start.getTime() + 9 * HOUR_MS);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  const iso = jst.toISOString();
  const month = Number(iso.slice(5, 7));
  const day = Number(iso.slice(8, 10));
  const time = iso.slice(11, 16);
  const dateLabel = `${month}月${day}日（${weekdays[jst.getUTCDay()]}）${time}`;
  const lead = kind === 'day_before'
    ? `明日${dateLabel}から`
    : `本日${dateLabel}から（開始約1時間前）`;

  return `【個別相談リマインド】\n${lead}、Google Meetで個別相談を予定しています。\n\nお時間になりましたら、こちらからご参加ください。\n${meetUrl}\n\nよろしくお願いいたします！`;
}

export async function registerMeetConsultation(
  db: D1Database,
  input: RegisterMeetConsultationInput,
  now = new Date(),
): Promise<{ id: string; reminders: MeetReminderSchedule[] }> {
  if (!input.externalEventId.trim()) throw new Error('externalEventId is required');
  if (!input.friendId.trim()) throw new Error('friendId is required');
  if (!input.title.trim()) throw new Error('title is required');
  if (!MEET_URL_RE.test(input.meetUrl)) throw new Error('meetUrl must be a Google Meet URL');

  const start = normalizeDate(input.startsAt, 'startsAt');
  const end = normalizeDate(input.endsAt, 'endsAt');
  if (end.getTime() <= start.getTime()) throw new Error('endsAt must be after startsAt');
  if (start.getTime() <= now.getTime()) throw new Error('startsAt must be in the future');

  const friend = await db
    .prepare('SELECT id FROM friends WHERE id = ? AND is_following = 1')
    .bind(input.friendId)
    .first<{ id: string }>();
  if (!friend) throw new Error('friend not found or not following');

  const existing = await db
    .prepare('SELECT * FROM meet_consultations WHERE external_event_id = ?')
    .bind(input.externalEventId)
    .first<MeetConsultationRow>();
  const consultationId = existing?.id ?? crypto.randomUUID();
  const normalizedStart = start.toISOString();
  const normalizedEnd = end.toISOString();
  const scheduleChanged = Boolean(
    existing &&
    (existing.friend_id !== input.friendId ||
      existing.starts_at !== normalizedStart ||
      existing.ends_at !== normalizedEnd ||
      existing.meet_url !== input.meetUrl),
  );
  const nowIso = now.toISOString();

  await db
    .prepare(
      `INSERT INTO meet_consultations
        (id, external_event_id, friend_id, title, starts_at, ends_at, meet_url, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)
       ON CONFLICT(external_event_id) DO UPDATE SET
         friend_id=excluded.friend_id,
         title=excluded.title,
         starts_at=excluded.starts_at,
         ends_at=excluded.ends_at,
         meet_url=excluded.meet_url,
         status='confirmed',
         updated_at=excluded.updated_at`,
    )
    .bind(
      consultationId,
      input.externalEventId,
      input.friendId,
      input.title,
      normalizedStart,
      normalizedEnd,
      input.meetUrl,
      nowIso,
      nowIso,
    )
    .run();

  const schedules = calculateMeetReminderSchedule(normalizedStart, now);
  const expectedKinds = new Set(schedules.map((item) => item.kind));
  for (const item of schedules) {
    const reminder = await db
      .prepare(
        'SELECT id, status FROM meet_consultation_reminders WHERE consultation_id = ? AND kind = ?',
      )
      .bind(consultationId, item.kind)
      .first<{ id: string; status: string }>();
    if (!reminder) {
      await db
        .prepare(
          `INSERT INTO meet_consultation_reminders
            (id, consultation_id, kind, scheduled_at, status, retry_count, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'pending', 0, ?, ?)`,
        )
        .bind(crypto.randomUUID(), consultationId, item.kind, item.scheduledAt, nowIso, nowIso)
        .run();
    } else if (scheduleChanged || reminder.status === 'cancelled') {
      await db
        .prepare(
          `UPDATE meet_consultation_reminders
              SET scheduled_at=?, status='pending', retry_count=0, sent_at=NULL,
                  last_error=NULL, updated_at=?
            WHERE id=?`,
        )
        .bind(item.scheduledAt, nowIso, reminder.id)
        .run();
    }
  }

  // 直前への日程変更などで不要になった種類は送らない。
  for (const kind of ['day_before', 'hour_before'] as const) {
    if (expectedKinds.has(kind)) continue;
    await db
      .prepare(
        `UPDATE meet_consultation_reminders
            SET status='cancelled', updated_at=?
          WHERE consultation_id=? AND kind=? AND status IN ('pending','failed')`,
      )
      .bind(nowIso, consultationId, kind)
      .run();
  }

  return { id: consultationId, reminders: schedules };
}

export async function cancelMeetConsultation(
  db: D1Database,
  externalEventId: string,
  now = new Date(),
): Promise<boolean> {
  const consultation = await db
    .prepare('SELECT id FROM meet_consultations WHERE external_event_id = ?')
    .bind(externalEventId)
    .first<{ id: string }>();
  if (!consultation) return false;
  const nowIso = now.toISOString();
  await db
    .prepare("UPDATE meet_consultations SET status='cancelled', updated_at=? WHERE id=?")
    .bind(nowIso, consultation.id)
    .run();
  await db
    .prepare(
      `UPDATE meet_consultation_reminders
          SET status='cancelled', updated_at=?
        WHERE consultation_id=? AND status IN ('pending','failed')`,
    )
    .bind(nowIso, consultation.id)
    .run();
  return true;
}

export async function processDueMeetConsultationReminders(
  db: D1Database,
  options: MeetReminderDeliveryOptions,
): Promise<{ sent: number; failed: number }> {
  const nowIso = options.now.toISOString();
  const due = await db
    .prepare(
      `SELECT r.id, r.consultation_id, r.kind, r.retry_count,
              c.title, c.starts_at, c.meet_url,
              f.line_user_id, la.channel_access_token
         FROM meet_consultation_reminders r
         INNER JOIN meet_consultations c ON c.id = r.consultation_id
         INNER JOIN friends f ON f.id = c.friend_id
         INNER JOIN line_accounts la ON la.id = f.line_account_id
        WHERE r.status IN ('pending','failed')
          AND r.retry_count < ?
          AND r.scheduled_at <= ?
          AND c.status = 'confirmed'
          AND c.starts_at > ?
          AND f.is_following = 1
          AND la.is_active = 1
        ORDER BY r.scheduled_at ASC
        LIMIT 100`,
    )
    .bind(MAX_RETRY, nowIso, nowIso)
    .all<DueMeetReminderRow>();

  let sent = 0;
  let failed = 0;
  for (const row of due.results ?? []) {
    try {
      const text = renderMeetReminderText(row.kind, row.starts_at, row.meet_url);
      await pushViaHarnessProxy(
        options.proxyBaseUrl,
        row.channel_access_token,
        row.line_user_id,
        [{ type: 'text', text }],
        row.id,
        options.proxyDispatch,
      );
      await db
        .prepare(
          `UPDATE meet_consultation_reminders
              SET status='sent', sent_at=?, last_error=NULL, updated_at=?
            WHERE id=?`,
        )
        .bind(nowIso, nowIso, row.id)
        .run();
      sent++;
    } catch (error) {
      const retryCount = row.retry_count + 1;
      await db
        .prepare(
          `UPDATE meet_consultation_reminders
              SET status='failed', retry_count=?, last_error=?, updated_at=?
            WHERE id=?`,
        )
        .bind(
          retryCount,
          error instanceof Error ? error.message.slice(0, 1000) : String(error).slice(0, 1000),
          nowIso,
          row.id,
        )
        .run();
      failed++;
    }
  }
  return { sent, failed };
}
