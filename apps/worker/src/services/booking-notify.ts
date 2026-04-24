import type { LineClient } from '@line-crm/line-sdk';
import type { Friend } from '@line-crm/db';
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
  RESEND_API_KEY?: string;
  NOTIFY_FROM_EMAIL?: string;
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

  if (channel === 'email' && env.RESEND_API_KEY && env.NOTIFY_FROM_EMAIL && meta.email) {
    await sendEmail({
      apiKey: env.RESEND_API_KEY,
      from: env.NOTIFY_FROM_EMAIL,
      to: meta.email,
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

function formatRange(b: BookingRow): string {
  const start = new Date(b.start_at);
  const end = new Date(b.end_at);
  const d = `${start.getMonth() + 1}/${start.getDate()}`;
  const hm = (x: Date) => `${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`;
  return `${d} ${hm(start)}〜${hm(end)}`;
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
