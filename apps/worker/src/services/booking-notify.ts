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
  meet_url?: string | null;
  // Legacy hardcoded-window flags (preserved for in-flight bookings created before migration 029).
  // New flags use `reminder_step_<step_id>_sent` keyed by reminder_steps.id.
  reminder_24h_sent?: boolean;
  reminder_1h_sent?: boolean;
  reminder_5min_sent?: boolean;
  // Flexible string-key flags so we can stamp `reminder_step_<id>_sent` per template step.
  [key: string]: unknown;
}

export function safeParseMetadata(raw: string | null): ParsedMeta {
  if (!raw) return {};
  try { return JSON.parse(raw) as ParsedMeta; } catch { return {}; }
}

export function reminderStepFlagKey(stepId: string): string {
  return `reminder_step_${stepId}_sent`;
}

/** Stored spec for a booking-reminder Flex step (reminder_steps.message_content JSON). */
export interface BookingFlexSpec {
  kind: 'booking_flex_v1';
  heading: string;
  noteText?: string | null;
  primaryButton?: { label: string; uri: string } | null;
  secondaryButton?: { label: string; uri: string } | null;
}

/** Loaded booking-reminder step row + parsed spec. */
export interface BookingReminderStep {
  id: string;
  reminder_id: string;
  offset_minutes: number;
  message_type: string;
  message_content: string;
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
  /**
   * Loads enabled booking-reminder steps from DB.
   * (reminders.trigger_type='booking' AND reminders.is_active=1, joined to reminder_steps.)
   * Replaces the previous hardcoded WINDOWS array — admins can now edit timings + content
   * via /reminders without a deploy.
   */
  getBookingReminderSteps: (db: D1Database) => Promise<BookingReminderStep[]>;
}

/** Per-tick window during which a step's offset is considered "due". Matches the 5-min cron tick. */
const STEP_WINDOW_MIN = 5;

export async function processBookingReminders(
  env: NotifyEnv,
  deps: ReminderDeps,
): Promise<{ delivered: number; skipped: number; failed: number }> {
  let delivered = 0, skipped = 0, failed = 0;

  const steps = await deps.getBookingReminderSteps(deps.db);

  for (const step of steps) {
    const windowStart = new Date(deps.now.getTime() + step.offset_minutes * 60_000);
    const windowEnd = new Date(windowStart.getTime() + STEP_WINDOW_MIN * 60_000);
    // NOTE: booked start_at strings use `+09:00` (JST) format (see packages/db toJstString).
    // Lexicographic compare against `Z` (UTC) bounds would silently filter everything out,
    // so pass the window bounds in the same JST format the column uses.
    const rows = await deps.getBookingsForReminder(deps.db, {
      startFrom: toJstString(windowStart),
      startTo: toJstString(windowEnd),
    });

    const flagKey = reminderStepFlagKey(step.id);
    const legacyFlag = legacyFlagForOffset(step.offset_minutes);

    for (const b of rows) {
      const startMs = new Date(b.start_at).getTime();
      if (startMs < windowStart.getTime() || startMs >= windowEnd.getTime()) continue;
      const meta = safeParseMetadata(b.metadata);
      // Skip if either the per-step flag OR the legacy hardcoded-window flag has fired.
      // Prevents double-send for bookings created during the WINDOWS-array era.
      if (meta[flagKey] || (legacyFlag && meta[legacyFlag])) { skipped++; continue; }

      // Delivery semantics: send first, flag second.
      // If the UPDATE fails after a successful send, next tick re-delivers within
      // the same window. For reminders we prefer "duplicate > missed" — a user
      // getting two "明日予約です" messages is annoying, a missed appointment is worse.
      try {
        const friend = b.friend_id ? await deps.getFriendById(deps.db, b.friend_id) : null;
        const channel = pickChannel({
          friendId: b.friend_id,
          isFollowing: Boolean(friend?.is_following),
          email: meta.email ?? null,
        });

        const ctx: PlaceholderCtx = {
          dateTime: `${formatJstDateJa(b.start_at)} ${formatJstTime(b.start_at)}〜`,
          date: formatJstDateJa(b.start_at),
          time: formatJstTime(b.start_at),
          meetUrl: meta.meet_url ?? null,
          rescheduleUrl: env.BOOKING_RESCHEDULE_URL ?? null,
          displayName: friend?.display_name ?? null,
        };

        if (channel === 'line' && friend) {
          const flex = renderStepAsFlex(step, ctx);
          await deps.lineClient.pushMessage(friend.line_user_id, [
            {
              type: 'flex',
              altText: `${altLeadForOffset(step.offset_minutes)}整備士面談 ${ctx.dateTime}`,
              contents: flex,
            },
          ]);
        } else if (channel === 'email' && env.GAS_MAIL_URL && env.GAS_MAIL_SECRET && meta.email) {
          await sendEmail({
            webhookUrl: env.GAS_MAIL_URL,
            secret: env.GAS_MAIL_SECRET,
            to: meta.email,
            cc: env.NOTIFY_CC_EMAIL ? [env.NOTIFY_CC_EMAIL] : undefined,
            subject: `Fixx｜${emailSubjectLabelForOffset(step.offset_minutes)}整備士面談 ${subjectStamp(b.start_at)}〜`,
            html: renderStepAsHtml(step, ctx),
          });
        } else {
          skipped++;
          continue;
        }

        await deps.updateBookingMetadata(deps.db, b.id, { ...meta, [flagKey]: true });
        delivered++;
      } catch (err) {
        console.warn(`booking reminder failed for ${b.id}:`, err);
        failed++;
      }
    }
  }

  return { delivered, skipped, failed };
}

/** Maps a step's offset_minutes back onto the legacy hardcoded flag, if any. */
function legacyFlagForOffset(offsetMin: number): string | null {
  if (offsetMin === 24 * 60) return 'reminder_24h_sent';
  if (offsetMin === 60) return 'reminder_1h_sent';
  if (offsetMin === 5) return 'reminder_5min_sent';
  return null;
}

// ============================================================================
// Template-driven rendering (DB-backed booking reminders)
// ============================================================================

/** Context passed to placeholder substitution. Keys map to {{snake_case}} placeholders. */
export interface PlaceholderCtx {
  dateTime: string;
  date: string;
  time: string;
  meetUrl: string | null;
  rescheduleUrl: string | null;
  displayName: string | null;
}

/**
 * Substitutes {{date_time}}, {{date}}, {{time}}, {{meet_url}}, {{reschedule_url}}, {{display_name}}.
 * Empty values render as empty string (not "undefined") so admin-authored templates degrade gracefully.
 */
export function expandPlaceholders(input: string, ctx: PlaceholderCtx): string {
  return input
    .replace(/\{\{\s*date_time\s*\}\}/g, ctx.dateTime)
    .replace(/\{\{\s*date\s*\}\}/g, ctx.date)
    .replace(/\{\{\s*time\s*\}\}/g, ctx.time)
    .replace(/\{\{\s*meet_url\s*\}\}/g, ctx.meetUrl ?? '')
    .replace(/\{\{\s*reschedule_url\s*\}\}/g, ctx.rescheduleUrl ?? '')
    .replace(/\{\{\s*display_name\s*\}\}/g, ctx.displayName ?? '');
}

function parseBookingFlexSpec(raw: string): BookingFlexSpec | null {
  try {
    const obj = JSON.parse(raw) as BookingFlexSpec;
    if (obj && obj.kind === 'booking_flex_v1' && typeof obj.heading === 'string') return obj;
  } catch { /* fall through */ }
  return null;
}

/** Builds a Flex bubble from a stored booking_flex_v1 spec, expanding placeholders. */
export function buildBookingFlexFromSpec(spec: BookingFlexSpec, ctx: PlaceholderCtx): object {
  const heading = expandPlaceholders(spec.heading, ctx);
  const noteText = spec.noteText ? expandPlaceholders(spec.noteText, ctx) : null;

  const meetBlock = ctx.meetUrl
    ? { type: 'text', text: ctx.meetUrl, size: 'sm', color: '#304070', wrap: true, action: { type: 'uri', label: 'open', uri: ctx.meetUrl } }
    : { type: 'text', text: '別途ご案内のURLよりご参加ください。', size: 'sm', color: '#888888', wrap: true };

  const bodyContents: object[] = [
    { type: 'text', text: heading, weight: 'bold', size: 'lg', color: '#304070', wrap: true },
    { type: 'separator' },
    {
      type: 'box',
      layout: 'vertical',
      spacing: 'xs',
      contents: [
        { type: 'text', text: '日時', size: 'xs', color: '#888888' },
        { type: 'text', text: ctx.dateTime, weight: 'bold', size: 'md', wrap: true },
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
  ];
  if (noteText) {
    bodyContents.push({ type: 'text', text: noteText, size: 'xs', color: '#888888', wrap: true, margin: 'md' });
  }

  const bubble: Record<string, unknown> = {
    type: 'bubble',
    body: { type: 'box', layout: 'vertical', spacing: 'md', contents: bodyContents },
  };

  // Buttons render only when both label is present AND the resolved URI is non-empty
  // (so {{meet_url}} on a booking that never got a Meet URL gracefully omits the button).
  const footerButtons: object[] = [];
  if (spec.primaryButton?.label) {
    const uri = expandPlaceholders(spec.primaryButton.uri, ctx);
    if (uri) footerButtons.push({ type: 'button', style: 'primary', color: '#304070', action: { type: 'uri', label: spec.primaryButton.label, uri } });
  }
  if (spec.secondaryButton?.label) {
    const uri = expandPlaceholders(spec.secondaryButton.uri, ctx);
    if (uri) footerButtons.push({ type: 'button', style: 'secondary', margin: 'md', action: { type: 'uri', label: spec.secondaryButton.label, uri } });
  }
  if (footerButtons.length > 0) {
    bubble.footer = { type: 'box', layout: 'vertical', spacing: 'md', contents: footerButtons };
  }

  return bubble;
}

function renderStepAsFlex(step: BookingReminderStep, ctx: PlaceholderCtx): object {
  if (step.message_type === 'flex') {
    const spec = parseBookingFlexSpec(step.message_content);
    if (spec) return buildBookingFlexFromSpec(spec, ctx);
  }
  // Plain-text step → wrap in a minimal Flex bubble so the channel stays consistent
  const text = expandPlaceholders(step.message_content, ctx);
  return {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      contents: [{ type: 'text', text, wrap: true, size: 'sm' }],
    },
  };
}

function renderStepAsHtml(step: BookingReminderStep, ctx: PlaceholderCtx): string {
  if (step.message_type === 'flex') {
    const spec = parseBookingFlexSpec(step.message_content);
    if (spec) {
      const heading = expandPlaceholders(spec.heading, ctx);
      const noteText = spec.noteText ? expandPlaceholders(spec.noteText, ctx) : null;
      const meetLine = ctx.meetUrl
        ? `<a href="${escapeHtml(ctx.meetUrl)}">${escapeHtml(ctx.meetUrl)}</a>`
        : '別途ご案内のURLよりご参加ください。';
      const rescheduleBlock = spec.secondaryButton && ctx.rescheduleUrl
        ? `<p><strong>【${escapeHtml(spec.secondaryButton.label)}】</strong><br><a href="${escapeHtml(ctx.rescheduleUrl)}">${escapeHtml(ctx.rescheduleUrl)}</a></p>`
        : '';
      const note = noteText ? `<p>${escapeHtml(noteText)}</p>` : '';
      return `<p><strong>${escapeHtml(heading)}</strong></p>
<p><strong>【日時】</strong><br>${escapeHtml(ctx.dateTime)}</p>
<p><strong>【Google Meet】</strong><br>${meetLine}</p>
${rescheduleBlock}${note}`;
    }
  }
  return `<p>${escapeHtml(expandPlaceholders(step.message_content, ctx)).replace(/\n/g, '<br>')}</p>`;
}

/** Email subject prefix derived from offset_minutes (matches old hardcoded labels). */
function emailSubjectLabelForOffset(offsetMin: number): string {
  if (offsetMin >= 60 * 12) return '【リマインダー】';
  if (offsetMin >= 30) return '【まもなく】';
  return '【5分前】';
}

/** LINE altText prefix derived from offset_minutes. */
function altLeadForOffset(offsetMin: number): string {
  if (offsetMin >= 60 * 12) return '【明日】';
  if (offsetMin >= 30) return '【1時間前】';
  return '【5分前】';
}
