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
    const flex = buildConfirmationFlex(booking);
    await lineClient.pushMessage(friend.line_user_id, [
      { type: 'flex', altText: `【予約確定】${formatRange(booking)}`, contents: flex },
    ]);
    return { channel, delivered: true };
  }

  if (channel === 'email' && env.GAS_MAIL_URL && env.GAS_MAIL_SECRET && meta.email) {
    await sendEmail({
      webhookUrl: env.GAS_MAIL_URL,
      secret: env.GAS_MAIL_SECRET,
      to: meta.email,
      cc: env.NOTIFY_CC_EMAIL ? [env.NOTIFY_CC_EMAIL] : undefined,
      subject: `【予約確定】${formatRange(booking)}`,
      html: buildConfirmationHtml(booking),
    });
    return { channel, delivered: true };
  }

  return { channel, delivered: false };
}

interface ParsedMeta { email?: string | null; reminder_24h_sent?: boolean; reminder_1h_sent?: boolean }

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

function formatRange(b: BookingRow): string {
  return formatJstRange(b.start_at, b.end_at);
}

function buildConfirmationFlex(b: BookingRow): object {
  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: '予約が確定しました', weight: 'bold', size: 'lg' },
        { type: 'separator', margin: 'md' },
        { type: 'text', text: b.title, margin: 'md' },
        { type: 'text', text: formatRange(b), size: 'md', color: '#304070', weight: 'bold' },
        { type: 'text', text: '当日は担当者からご連絡します。', size: 'xs', color: '#888888', wrap: true, margin: 'md' },
      ],
    },
  };
}

function buildConfirmationHtml(b: BookingRow): string {
  return `<p>ご予約ありがとうございます。以下の内容で確定しました。</p>
<p><strong>${escapeHtml(b.title)}</strong><br>${escapeHtml(formatRange(b))}</p>
<p>当日は担当者からご連絡いたします。</p>`;
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
  label: '24h' | '1h';
  flag: 'reminder_24h_sent' | 'reminder_1h_sent';
  beforeStartMin: number;
  windowMin: number;
}

const WINDOWS: WindowSpec[] = [
  { label: '24h', flag: 'reminder_24h_sent', beforeStartMin: 24 * 60, windowMin: 10 },
  { label: '1h',  flag: 'reminder_1h_sent',  beforeStartMin: 60,      windowMin: 10 },
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
          await deps.lineClient.pushMessage(friend.line_user_id, [
            { type: 'text', text: buildReminderText(b, w.label) },
          ]);
        } else if (channel === 'email' && env.GAS_MAIL_URL && env.GAS_MAIL_SECRET && meta.email) {
          await sendEmail({
            webhookUrl: env.GAS_MAIL_URL,
            secret: env.GAS_MAIL_SECRET,
            to: meta.email,
            cc: env.NOTIFY_CC_EMAIL ? [env.NOTIFY_CC_EMAIL] : undefined,
            subject: `【リマインダー】${formatRange(b)} の予約`,
            html: `<p>${escapeHtml(buildReminderText(b, w.label)).replace(/\n/g, '<br>')}</p>`,
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

function buildReminderText(b: BookingRow, label: '24h' | '1h'): string {
  const lead = label === '24h' ? '明日' : 'まもなく（1時間後）';
  return `${lead}のご予約リマインダーです。\n${b.title}\n${formatRange(b)}\n\nご都合が変わった場合はこのトークからご連絡ください。`;
}
