import type { LineClient } from '@line-crm/line-sdk';
import type { Friend } from '@line-crm/db';
import { toJstString } from '@line-crm/db';
import { sendEmail } from './email.js';

export type Channel = 'line' | 'email' | 'none';

export interface ChannelInput {
  friendId: string | null;
  isFollowing: boolean;
  email: string | null;
}

export function pickChannel(input: ChannelInput): Channel {
  if (input.friendId && input.isFollowing) return 'line';
  if (input.email) return 'email';
  return 'none';
}

export interface BookingRow {
  id: string;
  friend_id: string | null;
  title: string;
  start_at: string;
  end_at: string;
  metadata: string | null;
}

export interface NotifyEnv {
  GAS_MAIL_URL?: string;
  GAS_MAIL_SECRET?: string;
  NOTIFY_CC_EMAIL?: string;
  /** 日程変更/再予約用のLIFF or Web URL（未設定なら変更ボタン非表示・本文記載なし） */
  BOOKING_RESCHEDULE_URL?: string;
}

export async function sendBookingConfirmation(
  env: NotifyEnv,
  booking: BookingRow,
  lineClient: LineClient,
  friend: Friend | null,
): Promise<{ channel: Channel; delivered: boolean }> {
  const meta = safeParseMetadata(booking.metadata);
  const channel = pickChannel({
    friendId: booking.friend_id,
    isFollowing: Boolean(friend?.is_following),
    email: meta.email ?? null,
  });

  if (channel === 'line' && friend) {
    const flex = buildConfirmationFlex(booking, meta.meet_url ?? null, env.BOOKING_RESCHEDULE_URL ?? null);
    await lineClient.pushMessage(friend.line_user_id, [
      {
        type: 'flex',
        altText: `【面談確定】${formatJstDateJa(booking.start_at)} ${formatJstTime(booking.start_at)}〜`,
        contents: flex,
      },
    ]);
    return { channel, delivered: true };
  }

  if (channel === 'email' && env.GAS_MAIL_URL && env.GAS_MAIL_SECRET && meta.email) {
    await sendEmail({
      webhookUrl: env.GAS_MAIL_URL,
      secret: env.GAS_MAIL_SECRET,
      to: meta.email,
      cc: env.NOTIFY_CC_EMAIL ? [env.NOTIFY_CC_EMAIL] : undefined,
      subject: `Fixx｜整備士面談 ${subjectStamp(booking.start_at)}〜`,
      html: buildConfirmationHtml(booking, meta.meet_url ?? null, env.BOOKING_RESCHEDULE_URL ?? null),
    });
    return { channel, delivered: true };
  }

  return { channel, delivered: false };
}

interface ParsedMeta {
  email?: string | null;
  reminder_24h_sent?: boolean;
  reminder_1h_sent?: boolean;
  reminder_5min_sent?: boolean;
  meet_url?: string | null;
}

export function safeParseMetadata(raw: string | null): ParsedMeta {
  if (!raw) return {};
  try { return JSON.parse(raw) as ParsedMeta; } catch { return {}; }
}

export function formatJstRange(startIso: string, endIso: string): string {
  const s = new Date(new Date(startIso).getTime() + 9 * 60 * 60_000);
  const e = new Date(new Date(endIso).getTime() + 9 * 60 * 60_000);
  const d = `${s.getUTCMonth() + 1}/${s.getUTCDate()}`;
  const hm = (x: Date) => `${String(x.getUTCHours()).padStart(2, '0')}:${String(x.getUTCMinutes()).padStart(2, '0')}`;
  return `${d} ${hm(s)}〜${hm(e)}`;
}

const JST_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

/** Returns "M/D (曜)" in JST regardless of host TZ */
export function formatJstDateJa(iso: string): string {
  const jst = new Date(new Date(iso).getTime() + 9 * 60 * 60_000);
  const dow = JST_WEEKDAYS[jst.getUTCDay()];
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()} (${dow})`;
}

/** Returns "HH:MM" in JST regardless of host TZ */
export function formatJstTime(iso: string): string {
  const jst = new Date(new Date(iso).getTime() + 9 * 60 * 60_000);
  return `${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
}

/** Subject-line date: "M/D HH:MM" in JST */
function subjectStamp(startIso: string): string {
  const jst = new Date(new Date(startIso).getTime() + 9 * 60 * 60_000);
  const d = `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}`;
  const hm = `${String(jst.getUTCHours()).padStart(2, '0')}:${String(jst.getUTCMinutes()).padStart(2, '0')}`;
  return `${d} ${hm}`;
}

function buildConfirmationFlex(b: BookingRow, meetUrl: string | null, rescheduleUrl: string | null): object {
  const dateTimeText = `${formatJstDateJa(b.start_at)} ${formatJstTime(b.start_at)}〜`;
  const meetBlock = meetUrl
    ? { type: 'text', text: meetUrl, size: 'sm', color: '#304070', wrap: true, action: { type: 'uri', label: 'open', uri: meetUrl } }
    : { type: 'text', text: '面談前日までに別途ご案内いたします。', size: 'sm', color: '#888888', wrap: true };

  const noteText = rescheduleUrl
    ? '日程を変更したい場合は下のボタンから、その他のご質問はこのトークへ。'
    : 'ご質問・変更はこのトークからご連絡ください。';

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        { type: 'text', text: '整備士面談 予約確定', weight: 'bold', size: 'lg', color: '#304070' },
        { type: 'separator' },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'xs',
          contents: [
            { type: 'text', text: '日時', size: 'xs', color: '#888888' },
            { type: 'text', text: dateTimeText, weight: 'bold', size: 'md', wrap: true },
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'xs',
          contents: [
            { type: 'text', text: 'Google Meet', size: 'xs', color: '#888888' },
            meetBlock,
          ],
        },
        { type: 'text', text: noteText, size: 'xs', color: '#888888', wrap: true, margin: 'md' },
      ],
    },
  };

  const footerButtons: object[] = [];
  if (meetUrl) {
    footerButtons.push({ type: 'button', style: 'primary', color: '#304070', action: { type: 'uri', label: 'Google Meetを開く', uri: meetUrl } });
  }
  if (rescheduleUrl) {
    footerButtons.push({ type: 'button', style: 'secondary', margin: 'md', action: { type: 'uri', label: '日程を変更する', uri: rescheduleUrl } });
  }
  if (footerButtons.length > 0) {
    bubble.footer = { type: 'box', layout: 'vertical', spacing: 'md', contents: footerButtons };
  }

  return bubble;
}

function buildConfirmationHtml(b: BookingRow, meetUrl: string | null, rescheduleUrl: string | null): string {
  const dateLine = `${formatJstDateJa(b.start_at)} ${formatJstTime(b.start_at)}〜`;
  const meetLine = meetUrl
    ? `<a href="${escapeHtml(meetUrl)}">${escapeHtml(meetUrl)}</a>`
    : '面談前日までに別途ご案内いたします。';
  const rescheduleBlock = rescheduleUrl
    ? `<p><strong>【日程変更・キャンセル】</strong><br><a href="${escapeHtml(rescheduleUrl)}">${escapeHtml(rescheduleUrl)}</a></p>`
    : '';

  return `<p>この度は整備士面談のご予約をいただき、ありがとうございます。<br>以下の内容で日程を確定いたしましたのでご案内いたします。</p>
<p><strong>【日時】</strong><br>${escapeHtml(dateLine)}</p>
<p><strong>【Google Meet】</strong><br>${meetLine}</p>
${rescheduleBlock}<p><strong>【当日のご案内】</strong><br>
  ・開始時刻になりましたら上記Google MeetのURLからご入室ください<br>
  ・面談は15分から20分程度を予定しております<br>
  ・服装はカジュアルで問題ございません<br>
  ・キャンセル・日時変更は上記リンク、またはLINEよりご連絡ください
</p>
<p>当日お会いできるのを楽しみにしております。<br>どうぞよろしくお願いいたします。</p>
<p style="color:#888;font-size:12px">── 株式会社Fixx</p>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

export interface ReminderDeps {
  now: Date;
  db: D1Database;
  lineClient: LineClient;
  getBookingsForReminder: (db: D1Database, opts: { startFrom: string; startTo: string }) => Promise<BookingRow[]>;
  updateBookingMetadata: (db: D1Database, id: string, metadata: Record<string, unknown>) => Promise<void>;
  getFriendById: (db: D1Database, id: string) => Promise<Friend | null>;
}

interface WindowSpec {
  label: '24h' | '1h' | '5min';
  flag: 'reminder_24h_sent' | 'reminder_1h_sent' | 'reminder_5min_sent';
  beforeStartMin: number;
  windowMin: number;
}

const WINDOWS: WindowSpec[] = [
  { label: '24h',  flag: 'reminder_24h_sent',  beforeStartMin: 24 * 60, windowMin: 10 },
  { label: '1h',   flag: 'reminder_1h_sent',   beforeStartMin: 60,      windowMin: 10 },
  // Cron fires every 5 minutes; with beforeStartMin=5 and windowMin=5 a booking at 10:00
  // is caught by the 9:55 tick (window 9:55–10:00). windowMin=5 leaves no overlap with
  // the 1h window since they're 55 minutes apart.
  { label: '5min', flag: 'reminder_5min_sent', beforeStartMin: 5,       windowMin: 5  },
];

export async function processBookingReminders(
  env: NotifyEnv,
  deps: ReminderDeps,
): Promise<{ delivered: number; skipped: number; failed: number }> {
  let delivered = 0, skipped = 0, failed = 0;

  for (const w of WINDOWS) {
    const windowStart = new Date(deps.now.getTime() + w.beforeStartMin * 60_000);
    const windowEnd = new Date(windowStart.getTime() + w.windowMin * 60_000);
    // NOTE: booked start_at strings use `+09:00` (JST) format (see packages/db toJstString).
    // Lexicographic compare against `Z` (UTC) bounds would silently filter everything out,
    // so pass the window bounds in the same JST format the column uses.
    const rows = await deps.getBookingsForReminder(deps.db, {
      startFrom: toJstString(windowStart),
      startTo: toJstString(windowEnd),
    });

    for (const b of rows) {
      const startMs = new Date(b.start_at).getTime();
      if (startMs < windowStart.getTime() || startMs >= windowEnd.getTime()) continue;
      const meta = safeParseMetadata(b.metadata);
      if (meta[w.flag]) { skipped++; continue; }

      // Delivery semantics: send first, flag second.
      // If the UPDATE fails after a successful send, next tick re-delivers within
      // the 10-min window. For reminders we prefer "duplicate > missed" — a user
      // getting two "明日予約です" messages is annoying, a missed appointment is worse.
      try {
        const friend = b.friend_id ? await deps.getFriendById(deps.db, b.friend_id) : null;
        const channel = pickChannel({
          friendId: b.friend_id,
          isFollowing: Boolean(friend?.is_following),
          email: meta.email ?? null,
        });

        if (channel === 'line' && friend) {
          const flex = buildReminderFlex(b, meta.meet_url ?? null, env.BOOKING_RESCHEDULE_URL ?? null, w.label);
          await deps.lineClient.pushMessage(friend.line_user_id, [
            {
              type: 'flex',
              altText: `${reminderAltLead(w.label)}整備士面談 ${formatJstDateJa(b.start_at)} ${formatJstTime(b.start_at)}〜`,
              contents: flex,
            },
          ]);
        } else if (channel === 'email' && env.GAS_MAIL_URL && env.GAS_MAIL_SECRET && meta.email) {
          const subjectLabel = reminderEmailSubjectLabel(w.label);
          await sendEmail({
            webhookUrl: env.GAS_MAIL_URL,
            secret: env.GAS_MAIL_SECRET,
            to: meta.email,
            cc: env.NOTIFY_CC_EMAIL ? [env.NOTIFY_CC_EMAIL] : undefined,
            subject: `Fixx｜${subjectLabel}整備士面談 ${subjectStamp(b.start_at)}〜`,
            html: buildReminderHtml(b, meta.meet_url ?? null, env.BOOKING_RESCHEDULE_URL ?? null, w.label),
          });
        } else {
          skipped++;
          continue;
        }

        await deps.updateBookingMetadata(deps.db, b.id, { ...meta, [w.flag]: true });
        delivered++;
      } catch (err) {
        console.warn(`booking reminder failed for ${b.id}:`, err);
        failed++;
      }
    }
  }

  return { delivered, skipped, failed };
}

type ReminderLabel = '24h' | '1h' | '5min';

function reminderTextLead(label: ReminderLabel): string {
  if (label === '24h') return '明日';
  if (label === '1h') return 'まもなく（1時間後）';
  return 'まもなく（5分後）';
}

function reminderHeading(label: ReminderLabel): string {
  if (label === '24h') return '面談リマインド｜明日';
  if (label === '1h') return '面談リマインド｜1時間前';
  return '面談まもなく開始｜5分前';
}

function reminderAltLead(label: ReminderLabel): string {
  if (label === '24h') return '【明日】';
  if (label === '1h') return '【1時間前】';
  return '【5分前】';
}

function reminderEmailSubjectLabel(label: ReminderLabel): string {
  if (label === '24h') return '【リマインダー】';
  if (label === '1h') return '【まもなく】';
  return '【5分前】';
}

function buildReminderText(b: BookingRow, meetUrl: string | null, rescheduleUrl: string | null, label: ReminderLabel): string {
  const lead = reminderTextLead(label);
  const dateTimeLine = `${formatJstDateJa(b.start_at)} ${formatJstTime(b.start_at)}〜`;
  const meetLine = meetUrl ?? '別途ご案内のURLよりご参加ください。';
  const rescheduleLine = rescheduleUrl ? `\n\n【日程変更・キャンセル】\n${rescheduleUrl}` : '';
  return `${lead}、整備士面談のお時間です。\n\n【日時】\n${dateTimeLine}\n\n【Google Meet】\n${meetLine}${rescheduleLine}\n\n開始時刻になりましたら上記URLよりご入室ください。\nご都合が変わった場合は上記リンク、またはこのトークからご連絡ください。`;
}

function buildReminderHtml(b: BookingRow, meetUrl: string | null, rescheduleUrl: string | null, label: ReminderLabel): string {
  const lead = reminderTextLead(label);
  const dateTimeLine = `${formatJstDateJa(b.start_at)} ${formatJstTime(b.start_at)}〜`;
  const meetLine = meetUrl
    ? `<a href="${escapeHtml(meetUrl)}">${escapeHtml(meetUrl)}</a>`
    : '別途ご案内のURLよりご参加ください。';
  const rescheduleBlock = rescheduleUrl
    ? `<p><strong>【日程変更・キャンセル】</strong><br><a href="${escapeHtml(rescheduleUrl)}">${escapeHtml(rescheduleUrl)}</a></p>`
    : '';
  return `<p>${escapeHtml(lead)}、整備士面談のお時間です。</p>
<p><strong>【日時】</strong><br>${escapeHtml(dateTimeLine)}</p>
<p><strong>【Google Meet】</strong><br>${meetLine}</p>
${rescheduleBlock}<p>開始時刻になりましたら上記URLよりご入室ください。<br>ご都合が変わった場合は上記リンク、またはLINEよりご連絡ください。</p>`;
}

function buildReminderFlex(b: BookingRow, meetUrl: string | null, rescheduleUrl: string | null, label: ReminderLabel): object {
  const dateTimeText = `${formatJstDateJa(b.start_at)} ${formatJstTime(b.start_at)}〜`;
  const heading = reminderHeading(label);
  const meetBlock = meetUrl
    ? { type: 'text', text: meetUrl, size: 'sm', color: '#304070', wrap: true, action: { type: 'uri', label: 'open', uri: meetUrl } }
    : { type: 'text', text: '別途ご案内のURLよりご参加ください。', size: 'sm', color: '#888888', wrap: true };
  const noteText = rescheduleUrl
    ? '日程変更は下のボタン、その他のご相談はこのトークへ。'
    : 'ご都合が変わった場合はこのトークからご連絡ください。';

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        { type: 'text', text: heading, weight: 'bold', size: 'lg', color: '#304070', wrap: true },
        { type: 'separator' },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'xs',
          contents: [
            { type: 'text', text: '日時', size: 'xs', color: '#888888' },
            { type: 'text', text: dateTimeText, weight: 'bold', size: 'md', wrap: true },
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'xs',
          contents: [
            { type: 'text', text: 'Google Meet', size: 'xs', color: '#888888' },
            meetBlock,
          ],
        },
        { type: 'text', text: noteText, size: 'xs', color: '#888888', wrap: true, margin: 'md' },
      ],
    },
  };

  const footerButtons: object[] = [];
  if (meetUrl) {
    footerButtons.push({ type: 'button', style: 'primary', color: '#304070', action: { type: 'uri', label: 'Google Meetを開く', uri: meetUrl } });
  }
  if (rescheduleUrl) {
    footerButtons.push({ type: 'button', style: 'secondary', margin: 'md', action: { type: 'uri', label: '日程を変更する', uri: rescheduleUrl } });
  }
  if (footerButtons.length > 0) {
    bubble.footer = { type: 'box', layout: 'vertical', spacing: 'md', contents: footerButtons };
  }

  return bubble;
}
