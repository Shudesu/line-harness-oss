// Event booking feature HTTP routes.
//
// LIFF endpoints:    /api/liff/events/*           (account resolved from liffId)
// Admin endpoints:   /api/events/admin/events/*   (account_id query param)
//
// All UUIDs via crypto.randomUUID(). Time columns (starts_at / ends_at /
// requested_at / scheduled_at / decided_at / cancelled_at / expires_at) are
// written by the Worker as UTC ISO8601 (Z-suffixed).
//
// See: docs/superpowers/specs/2026-05-09-event-booking-design.md

import { Hono, type Context } from 'hono';
import type { Env } from '../index.js';
import {
  EVENT_NAME_MAX,
  EVENT_DESCRIPTION_MAX,
  CUSTOMER_NOTE_MAX,
  EVENT_IDEMPOTENCY_TTL_MINUTES,
  type EventTargetType,
} from '../services/event-booking-types.js';
import { getSlotsWithRemaining } from '../services/event-availability.js';
import { verifyCallerLineUserId } from '../services/liff-auth.js';
import { computeIdentityKey } from '../lib/identity-key.js';
import {
  reserveEventIdempotency,
  finalizeEventIdempotencyResponse,
} from '../services/event-booking-idempotency.js';
import {
  computeRemindersForBooking,
  insertRemindersForBooking,
  cancelPendingRemindersFor,
} from '../services/event-booking-reminders.js';
import {
  sendEventBookingNotification,
  type EventNotificationKind,
} from '../services/event-booking-notifier.js';
import {
  canTransition,
  nextStatus,
  type EventBookingAction,
} from '../services/event-booking-state.js';

const events = new Hono<Env>();

// ----------------------------------------------------------------
// Helpers

function bad(c: Context<Env>, code: string, status = 422): Response {
  return c.json({ error: code }, status as 400 | 401 | 403 | 404 | 409 | 410 | 422 | 429);
}

function jsonB64(value: unknown): string {
  const json = JSON.stringify(value);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function fromJsonB64<T>(value: string): T | null {
  try {
    const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function telegramActionSecret(c: Context<Env>): string | null {
  return c.env.TELEGRAM_ACTION_SECRET || c.env.API_KEY || null;
}

async function signTelegramAction(c: Context<Env>, payload: Record<string, unknown>): Promise<string | null> {
  const secret = telegramActionSecret(c);
  if (!secret) return null;
  const p = jsonB64(payload);
  const s = await hmacSha256Hex(secret, p);
  return `${p}.${s}`;
}

async function verifyTelegramActionToken<T extends Record<string, unknown>>(
  c: Context<Env>,
  token: string | undefined,
): Promise<T | null> {
  if (!token) return null;
  const secret = telegramActionSecret(c);
  if (!secret) return null;
  const [p, s] = token.split('.');
  if (!p || !s) return null;
  const expected = await hmacSha256Hex(secret, p);
  if (!timingSafeEqual(expected, s)) return null;
  return fromJsonB64<T>(p);
}

function parseCustomerNote(note: string | null | undefined): Record<string, string> {
  const data: Record<string, string> = {};
  for (const line of String(note || '').replaceAll('\\n', '\n').split(/\r?\n/)) {
    const m = line.match(/^([^:：]+)[:：]\s*(.*)$/);
    if (m) data[m[1].trim()] = m[2].trim();
  }
  return data;
}

function adminTelegramText(args: {
  eventName: string;
  startsAt: string;
  venueName: string | null;
  friendDisplayName: string | null;
  customerNote: string | null;
  bookingId: string;
}): string {
  const note = parseCustomerNote(args.customerNote);
  return [
    '新しいイベント予約リクエストが届きました。',
    '',
    `イベント: ${args.eventName}`,
    `日時: ${startsAtJst(args.startsAt)}`,
    `会場: ${args.venueName || ''}`,
    `表示名: ${args.friendDisplayName || '未取得'}`,
    `名前: ${note['名前'] || note['お名前'] || ''}`,
    `電話番号: ${note['電話番号'] || ''}`,
    `人数: ${note['人数'] || ''}`,
    `同行者人数: ${note['同行者人数'] || ''}`,
    `同行者名: ${note['同行者名'] || ''}`,
    `X/SNS: ${note['Xアカウント'] || note['SNSアカウント'] || ''}`,
    `備考: ${note['備考'] || ''}`,
    '',
    `bookingId: ${args.bookingId}`,
  ].join('\n');
}

async function sendTelegramMessage(c: Context<Env>, payload: Record<string, unknown>): Promise<void> {
  if (!c.env.TELEGRAM_BOT_TOKEN || !c.env.TELEGRAM_CHAT_ID) return;
  const res = await fetch(`https://api.telegram.org/bot${c.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: c.env.TELEGRAM_CHAT_ID,
      ...payload,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Telegram sendMessage failed: ${res.status} ${text}`);
  }
}

async function notifyEventBookingTelegramAdmin(c: Context<Env>, args: {
  accountId: string;
  eventId: string;
  bookingId: string;
  eventName: string;
  startsAt: string;
  venueName: string | null;
  friendDisplayName: string | null;
  customerNote: string | null;
}): Promise<void> {
  if (!c.env.TELEGRAM_BOT_TOKEN || !c.env.TELEGRAM_CHAT_ID) return;
  const origin = new URL(c.req.url).origin;
  const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14;
  const approveToken = await signTelegramAction(c, {
    accountId: args.accountId,
    eventId: args.eventId,
    bookingId: args.bookingId,
    action: 'confirm',
    exp,
  });
  const rejectToken = await signTelegramAction(c, {
    accountId: args.accountId,
    eventId: args.eventId,
    bookingId: args.bookingId,
    action: 'reject',
    exp,
  });
  if (!approveToken || !rejectToken) return;
  await sendTelegramMessage(c, {
    text: adminTelegramText({
      eventName: args.eventName,
      startsAt: args.startsAt,
      venueName: args.venueName,
      friendDisplayName: args.friendDisplayName,
      customerNote: args.customerNote,
      bookingId: args.bookingId,
    }),
    reply_markup: {
      inline_keyboard: [[
        { text: '承認する', url: `${origin}/telegram/event-booking-action?t=${encodeURIComponent(approveToken)}` },
        { text: '拒否する', url: `${origin}/telegram/event-booking-action?t=${encodeURIComponent(rejectToken)}` },
      ]],
    },
  });
}

function getAccountId(c: Context<Env>): string | null {
  return c.req.query('account_id') ?? null;
}

async function resolveAccountIdFromLiff(c: Context<Env>): Promise<string | null> {
  const liffId = c.req.query('liffId');
  if (!liffId) return null;
  const acc = await c.env.DB
    .prepare(`SELECT id FROM line_accounts WHERE liff_id = ? AND is_active = 1`)
    .bind(liffId)
    .first<{ id: string }>();
  return acc?.id ?? null;
}

interface EventInput {
  name?: string;
  venue_name?: string | null;
  venue_url?: string | null;
  image_url?: string | null;
  description?: string | null;
  description_centered?: number;
  max_bookings_per_friend?: number | null;
  requires_approval?: number;
  cancel_deadline_hours_before?: number | null;
  reminder_day_before_enabled?: number;
  reminder_hours_before?: number | null;
  is_published?: number;
  sort_order?: number;
}

function validateEventInput(
  body: Record<string, unknown>,
  isCreate: boolean,
): { ok: true } | { ok: false; code: string } {
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k);
  if (isCreate || has('name')) {
    const name = body.name;
    if (typeof name !== 'string' || name.length === 0 || name.length > EVENT_NAME_MAX) {
      return { ok: false, code: 'invalid_name' };
    }
  }
  if (has('description') && body.description != null) {
    const d = body.description;
    if (typeof d !== 'string' || d.length > EVENT_DESCRIPTION_MAX) {
      return { ok: false, code: 'invalid_description' };
    }
  }
  for (const key of ['cancel_deadline_hours_before', 'reminder_hours_before', 'max_bookings_per_friend'] as const) {
    if (has(key) && body[key] != null) {
      const v = body[key];
      if (!Number.isInteger(v) || (v as number) < 0) {
        return { ok: false, code: `invalid_${key}` };
      }
    }
  }
  for (const key of ['description_centered', 'requires_approval', 'reminder_day_before_enabled', 'is_published'] as const) {
    if (has(key) && body[key] != null) {
      const v = body[key];
      if (v !== 0 && v !== 1) return { ok: false, code: `invalid_${key}` };
    }
  }
  if (has('sort_order') && body.sort_order != null) {
    if (!Number.isInteger(body.sort_order)) return { ok: false, code: 'invalid_sort_order' };
  }
  if (has('target_type') && body.target_type != null) {
    if (body.target_type !== 'single' && body.target_type !== 'multi-account-dedup') {
      return { ok: false, code: 'invalid_target_type' };
    }
  }
  if (body.target_type === 'multi-account-dedup') {
    const ids = body.account_ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((x) => typeof x === 'string' && x.length > 0)) {
      return { ok: false, code: 'invalid_account_ids' };
    }
    if (body.dedup_priority != null) {
      if (!Array.isArray(body.dedup_priority) || !body.dedup_priority.every((x) => typeof x === 'string')) {
        return { ok: false, code: 'invalid_dedup_priority' };
      }
      const idSet = new Set(ids as string[]);
      if (!(body.dedup_priority as string[]).every((x) => idSet.has(x))) {
        return { ok: false, code: 'dedup_priority_not_subset' };
      }
    }
  }
  return { ok: true };
}

// ============================================================
// Admin: events CRUD
// ============================================================

events.post('/api/events/admin/events', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const v = validateEventInput(body, true);
  if (!v.ok) return bad(c, v.code, 422);

  const id = crypto.randomUUID();
  const targetType = (body.target_type as EventTargetType | undefined) ?? 'single';
  const accountIds = targetType === 'multi-account-dedup' ? (body.account_ids as string[]) : null;
  const dedupPriority =
    targetType === 'multi-account-dedup' ? ((body.dedup_priority as string[] | undefined) ?? null) : null;
  // line_account_id sentinel: multi では account_ids[0] を保存 (NOT NULL 制約回避)
  const lineAccountIdToWrite = targetType === 'multi-account-dedup' ? accountIds![0] : account_id;

  await c.env.DB
    .prepare(
      `INSERT INTO events (
         id, line_account_id, name, venue_name, venue_url, image_url,
         description, description_centered,
         max_bookings_per_friend, requires_approval, cancel_deadline_hours_before,
         reminder_day_before_enabled, reminder_hours_before,
         is_published, sort_order,
         target_type, account_ids, dedup_priority
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      lineAccountIdToWrite,
      body.name as string,
      (body.venue_name as string | null) ?? null,
      (body.venue_url as string | null) ?? null,
      (body.image_url as string | null) ?? null,
      (body.description as string | null) ?? null,
      (body.description_centered as number | undefined) ?? 0,
      (body.max_bookings_per_friend as number | null | undefined) ?? null,
      (body.requires_approval as number | undefined) ?? 0,
      (body.cancel_deadline_hours_before as number | null | undefined) ?? null,
      (body.reminder_day_before_enabled as number | undefined) ?? 1,
      (body.reminder_hours_before as number | null | undefined) ?? null,
      (body.is_published as number | undefined) ?? 0,
      (body.sort_order as number | undefined) ?? 0,
      targetType,
      accountIds ? JSON.stringify(accountIds) : null,
      dedupPriority ? JSON.stringify(dedupPriority) : null,
    )
    .run();
  const row = await c.env.DB
    .prepare(`SELECT * FROM events WHERE id = ?`)
    .bind(id)
    .first();
  return c.json(row, 201);
});

events.get('/api/events/admin/events', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const { results } = await c.env.DB
    .prepare(
      `SELECT
         e.*,
         (SELECT MIN(s.starts_at)
            FROM event_slots s
           WHERE s.event_id = e.id
             AND s.deleted_at IS NULL
             AND s.is_active = 1
             AND s.starts_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now')
         ) AS next_slot_starts_at,
         (SELECT COALESCE(SUM(s.capacity), NULL)
            FROM event_slots s
           WHERE s.event_id = e.id AND s.deleted_at IS NULL AND s.is_active = 1
         ) AS total_capacity,
         (SELECT COUNT(*)
            FROM event_bookings b
           WHERE b.event_id = e.id AND b.status IN ('requested','confirmed')
         ) AS total_active,
         (SELECT COUNT(*)
            FROM event_bookings b
           WHERE b.event_id = e.id AND b.status = 'requested'
         ) AS pending_count
       FROM events e
       WHERE e.deleted_at IS NULL AND (
         (e.target_type = 'single' AND e.line_account_id = ?)
         OR (e.target_type = 'multi-account-dedup'
             AND EXISTS (SELECT 1 FROM json_each(e.account_ids) WHERE value = ?))
       )
       ORDER BY e.sort_order ASC, e.created_at DESC`,
    )
    .bind(account_id, account_id)
    .all();
  return c.json({ items: results ?? [] });
});

events.get('/api/events/admin/events/:id', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const row = await c.env.DB
    .prepare(
      `SELECT * FROM events
        WHERE id = ? AND deleted_at IS NULL AND (
          (target_type = 'single' AND line_account_id = ?)
          OR (target_type = 'multi-account-dedup'
              AND EXISTS (SELECT 1 FROM json_each(account_ids) WHERE value = ?))
        )`,
    )
    .bind(c.req.param('id'), account_id, account_id)
    .first();
  if (!row) return bad(c, 'not_found', 404);
  return c.json(row);
});

events.put('/api/events/admin/events/:id', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const id = c.req.param('id');
  const exists = await c.env.DB
    .prepare(
      `SELECT id FROM events
        WHERE id = ? AND deleted_at IS NULL AND (
          (target_type = 'single' AND line_account_id = ?)
          OR (target_type = 'multi-account-dedup'
              AND EXISTS (SELECT 1 FROM json_each(account_ids) WHERE value = ?))
        )`,
    )
    .bind(id, account_id, account_id)
    .first();
  if (!exists) return bad(c, 'not_found', 404);
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
  const v = validateEventInput(body, false);
  if (!v.ok) return bad(c, v.code, 422);

  const updatable = [
    'name',
    'venue_name',
    'venue_url',
    'image_url',
    'description',
    'description_centered',
    'max_bookings_per_friend',
    'requires_approval',
    'cancel_deadline_hours_before',
    'reminder_day_before_enabled',
    'reminder_hours_before',
    'is_published',
    'sort_order',
    'target_type',
  ] as const;
  const setClauses: string[] = [];
  const setValues: unknown[] = [];
  for (const k of updatable) {
    if (Object.prototype.hasOwnProperty.call(body, k)) {
      setClauses.push(`${k} = ?`);
      setValues.push(body[k]);
    }
  }
  // JSON-encoded columns (broadcasts と同じ扱い): account_ids / dedup_priority
  // null は NULL として書く、配列は JSON.stringify する。
  if (Object.prototype.hasOwnProperty.call(body, 'account_ids')) {
    setClauses.push('account_ids = ?');
    setValues.push(body.account_ids == null ? null : JSON.stringify(body.account_ids));
  }
  if (Object.prototype.hasOwnProperty.call(body, 'dedup_priority')) {
    setClauses.push('dedup_priority = ?');
    setValues.push(body.dedup_priority == null ? null : JSON.stringify(body.dedup_priority));
  }
  // multi-account-dedup に切り替わったら line_account_id sentinel を account_ids[0] に合わせる
  if (body.target_type === 'multi-account-dedup' && Array.isArray(body.account_ids) && (body.account_ids as string[]).length > 0) {
    setClauses.push('line_account_id = ?');
    setValues.push((body.account_ids as string[])[0]);
  }
  // multi → single に戻すときは line_account_id を caller account に書き戻す。
  // 他アカ admin が編集していた場合、古い sentinel のままだと自分の /events
  // 一覧から消えるため。target_type='single' かつ account_ids が null/省略
  // のケースを対象にする。
  if (body.target_type === 'single') {
    setClauses.push('line_account_id = ?');
    setValues.push(account_id);
  }
  if (setClauses.length === 0) {
    const row = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(id).first();
    return c.json(row);
  }
  setClauses.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  setValues.push(id);
  await c.env.DB
    .prepare(`UPDATE events SET ${setClauses.join(', ')} WHERE id = ?`)
    .bind(...setValues)
    .run();
  // If reminder settings changed, rebuild pending reminders for confirmed
  // bookings on this event so they reflect the new schedule.
  if (
    Object.prototype.hasOwnProperty.call(body, 'reminder_day_before_enabled') ||
    Object.prototype.hasOwnProperty.call(body, 'reminder_hours_before')
  ) {
    await rebuildRemindersForEvent(c.env.DB, id);
  }
  const row = await c.env.DB.prepare(`SELECT * FROM events WHERE id = ?`).bind(id).first();
  return c.json(row);
});

// Cancel all pending reminders for an event's confirmed bookings, then
// regenerate them from the latest event settings + slot starts_at.
async function rebuildRemindersForEvent(db: D1Database, event_id: string): Promise<void> {
  const ev = await db
    .prepare(
      `SELECT reminder_day_before_enabled, reminder_hours_before
         FROM events WHERE id = ?`,
    )
    .bind(event_id)
    .first<{ reminder_day_before_enabled: number; reminder_hours_before: number | null }>();
  if (!ev) return;
  const rows = await db
    .prepare(
      `SELECT b.id AS booking_id, s.starts_at
         FROM event_bookings b
         JOIN event_slots s ON s.id = b.slot_id
        WHERE b.event_id = ? AND b.status = 'confirmed'`,
    )
    .bind(event_id)
    .all<{ booking_id: string; starts_at: string }>();
  for (const r of rows.results ?? []) {
    await cancelPendingRemindersFor(db, r.booking_id);
    const reminders = computeRemindersForBooking({
      starts_at_utc: r.starts_at,
      reminder_day_before_enabled: ev.reminder_day_before_enabled === 1,
      reminder_hours_before: ev.reminder_hours_before,
    });
    await insertRemindersForBooking(db, r.booking_id, reminders);
  }
}

async function rebuildRemindersForSlot(db: D1Database, slot_id: string): Promise<void> {
  const slot = await db
    .prepare(`SELECT starts_at, event_id FROM event_slots WHERE id = ?`)
    .bind(slot_id)
    .first<{ starts_at: string; event_id: string }>();
  if (!slot) return;
  const ev = await db
    .prepare(
      `SELECT reminder_day_before_enabled, reminder_hours_before
         FROM events WHERE id = ?`,
    )
    .bind(slot.event_id)
    .first<{ reminder_day_before_enabled: number; reminder_hours_before: number | null }>();
  if (!ev) return;
  const rows = await db
    .prepare(
      `SELECT id AS booking_id FROM event_bookings
        WHERE slot_id = ? AND status = 'confirmed'`,
    )
    .bind(slot_id)
    .all<{ booking_id: string }>();
  for (const r of rows.results ?? []) {
    await cancelPendingRemindersFor(db, r.booking_id);
    const reminders = computeRemindersForBooking({
      starts_at_utc: slot.starts_at,
      reminder_day_before_enabled: ev.reminder_day_before_enabled === 1,
      reminder_hours_before: ev.reminder_hours_before,
    });
    await insertRemindersForBooking(db, r.booking_id, reminders);
  }
}

events.delete('/api/events/admin/events/:id', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const id = c.req.param('id');
  // Authorize via multi-account ownership: shared events can be deleted by
  // any account listed in account_ids, not only the sentinel line_account_id.
  if (!(await ownsEvent(c.env.DB, id, account_id))) return bad(c, 'not_found', 404);
  // Block deletion while live bookings exist — once the event row is
  // soft-deleted ownsEvent() hides it from admin endpoints, leaving any
  // requested/confirmed bookings unmanageable but still firing reminders.
  const active = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS c FROM event_bookings
        WHERE event_id = ? AND status IN ('requested','confirmed')`,
    )
    .bind(id)
    .first<{ c: number }>();
  if ((active?.c ?? 0) > 0) return bad(c, 'event_has_active_bookings', 409);
  const now = new Date().toISOString();
  const result = await c.env.DB
    .prepare(
      `UPDATE events SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
    )
    .bind(now, now, id)
    .run();
  if ((result.meta?.changes ?? 0) === 0) return bad(c, 'not_found', 404);
  return new Response(null, { status: 204 });
});

// ============================================================
// Admin: event_slots CRUD
// ============================================================

async function ownsEvent(
  db: D1Database,
  event_id: string,
  account_id: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM events
        WHERE id = ? AND deleted_at IS NULL AND (
          (target_type = 'single' AND line_account_id = ?)
          OR (target_type = 'multi-account-dedup'
              AND EXISTS (SELECT 1 FROM json_each(account_ids) WHERE value = ?))
        )`,
    )
    .bind(event_id, account_id, account_id)
    .first<{ id: string }>();
  return row != null;
}

interface SlotInput {
  starts_at?: string;
  ends_at?: string;
  capacity?: number | null;
  is_active?: number;
  sort_order?: number;
}

function validateSlotInput(s: SlotInput, isCreate: boolean): { ok: true } | { ok: false; code: string } {
  if (isCreate) {
    if (typeof s.starts_at !== 'string' || typeof s.ends_at !== 'string') {
      return { ok: false, code: 'invalid_slot_range' };
    }
    if (s.starts_at >= s.ends_at) return { ok: false, code: 'invalid_slot_range' };
  } else {
    if (s.starts_at != null && typeof s.starts_at !== 'string') return { ok: false, code: 'invalid_slot_range' };
    if (s.ends_at != null && typeof s.ends_at !== 'string') return { ok: false, code: 'invalid_slot_range' };
    if (s.starts_at != null && s.ends_at != null && s.starts_at >= s.ends_at) {
      return { ok: false, code: 'invalid_slot_range' };
    }
  }
  if (s.capacity != null && (!Number.isInteger(s.capacity) || (s.capacity as number) < 1)) {
    return { ok: false, code: 'invalid_capacity' };
  }
  if (s.is_active != null && s.is_active !== 0 && s.is_active !== 1) {
    return { ok: false, code: 'invalid_is_active' };
  }
  if (s.sort_order != null && !Number.isInteger(s.sort_order)) {
    return { ok: false, code: 'invalid_sort_order' };
  }
  return { ok: true };
}

events.get('/api/events/admin/events/:id/slots', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  if (!(await ownsEvent(c.env.DB, c.req.param('id'), account_id))) return bad(c, 'not_found', 404);
  const { results } = await c.env.DB
    .prepare(
      `SELECT
         s.*,
         (SELECT COUNT(*) FROM event_bookings b WHERE b.slot_id = s.id AND b.status IN ('requested','confirmed')) AS active_count
       FROM event_slots s
       WHERE s.event_id = ? AND s.deleted_at IS NULL
       ORDER BY s.sort_order ASC, s.starts_at ASC`,
    )
    .bind(c.req.param('id'))
    .all();
  return c.json({ items: results ?? [] });
});

events.post('/api/events/admin/events/:id/slots', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const event_id = c.req.param('id');
  if (!(await ownsEvent(c.env.DB, event_id, account_id))) return bad(c, 'not_found', 404);

  const body = (await c.req.json().catch(() => ({}))) as { slots?: SlotInput[] };
  if (!Array.isArray(body.slots) || body.slots.length === 0) return bad(c, 'slots_required', 422);

  const inserted: Array<Record<string, unknown>> = [];
  for (const s of body.slots) {
    const v = validateSlotInput(s, true);
    if (!v.ok) return bad(c, v.code, 422);
    const id = crypto.randomUUID();
    await c.env.DB
      .prepare(
        `INSERT INTO event_slots
           (id, event_id, starts_at, ends_at, capacity, is_active, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        id,
        event_id,
        s.starts_at as string,
        s.ends_at as string,
        s.capacity ?? null,
        s.is_active ?? 1,
        s.sort_order ?? 0,
      )
      .run();
    const row = await c.env.DB.prepare(`SELECT * FROM event_slots WHERE id = ?`).bind(id).first();
    if (row) inserted.push(row as Record<string, unknown>);
  }
  return c.json({ items: inserted }, 201);
});

events.put('/api/events/admin/events/:id/slots/:slotId', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const event_id = c.req.param('id');
  const slot_id = c.req.param('slotId');
  if (!(await ownsEvent(c.env.DB, event_id, account_id))) return bad(c, 'not_found', 404);
  const slot = await c.env.DB
    .prepare(`SELECT * FROM event_slots WHERE id = ? AND event_id = ? AND deleted_at IS NULL`)
    .bind(slot_id, event_id)
    .first<Record<string, unknown>>();
  if (!slot) return bad(c, 'not_found', 404);
  const body = (await c.req.json().catch(() => ({}))) as SlotInput;
  // when only one of starts_at / ends_at is provided, range check uses existing values
  const merged: SlotInput = {
    starts_at: body.starts_at ?? (slot.starts_at as string),
    ends_at: body.ends_at ?? (slot.ends_at as string),
    capacity: body.capacity,
    is_active: body.is_active,
    sort_order: body.sort_order,
  };
  const v = validateSlotInput(merged, false);
  if (!v.ok) return bad(c, v.code, 422);

  const updatable = ['starts_at', 'ends_at', 'capacity', 'is_active', 'sort_order'] as const;
  const setClauses: string[] = [];
  const setValues: unknown[] = [];
  for (const k of updatable) {
    if (Object.prototype.hasOwnProperty.call(body, k)) {
      setClauses.push(`${k} = ?`);
      setValues.push((body as Record<string, unknown>)[k]);
    }
  }
  if (setClauses.length === 0) {
    return c.json(slot);
  }
  setClauses.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  setValues.push(slot_id);
  await c.env.DB
    .prepare(`UPDATE event_slots SET ${setClauses.join(', ')} WHERE id = ?`)
    .bind(...setValues)
    .run();
  // If the slot time moved, reminders for the slot's confirmed bookings are
  // now stale (they still point at the old starts_at).
  if (Object.prototype.hasOwnProperty.call(body, 'starts_at')) {
    await rebuildRemindersForSlot(c.env.DB, slot_id);
  }
  const row = await c.env.DB.prepare(`SELECT * FROM event_slots WHERE id = ?`).bind(slot_id).first();
  return c.json(row);
});

// ============================================================
// LIFF: my bookings (history) + self-cancel
// MUST be registered before /:id paths so "me" is not consumed as :id.
// ============================================================

events.get('/api/liff/events', async (c) => {
  const account_id = await resolveAccountIdFromLiff(c);
  if (!account_id) return bad(c, 'liff_account_resolution_failed', 400);
  const nowIso = new Date().toISOString();

  const { results } = await c.env.DB
    .prepare(
      `SELECT
         e.id,
         e.name,
         e.venue_name,
         e.venue_url,
         e.image_url,
         e.description,
         e.description_centered,
         e.max_bookings_per_friend,
         e.requires_approval,
         (
           SELECT s.starts_at
             FROM event_slots s
            WHERE s.event_id = e.id
              AND s.deleted_at IS NULL
              AND s.is_active = 1
              AND s.starts_at >= ?
            ORDER BY s.starts_at ASC
            LIMIT 1
         ) AS next_slot_starts_at,
         (
           SELECT s.ends_at
             FROM event_slots s
            WHERE s.event_id = e.id
              AND s.deleted_at IS NULL
              AND s.is_active = 1
              AND s.starts_at >= ?
            ORDER BY s.starts_at ASC
            LIMIT 1
         ) AS next_slot_ends_at,
         (
           SELECT COUNT(*)
             FROM event_slots s
            WHERE s.event_id = e.id
              AND s.deleted_at IS NULL
              AND s.is_active = 1
              AND s.starts_at >= ?
         ) AS future_slot_count
       FROM events e
       WHERE e.deleted_at IS NULL
         AND e.is_published = 1
         AND (
           (e.target_type = 'single' AND e.line_account_id = ?)
           OR (e.target_type = 'multi-account-dedup'
               AND EXISTS (SELECT 1 FROM json_each(e.account_ids) WHERE value = ?))
         )
         AND EXISTS (
           SELECT 1
             FROM event_slots s
            WHERE s.event_id = e.id
              AND s.deleted_at IS NULL
              AND s.is_active = 1
              AND s.starts_at >= ?
         )
       ORDER BY next_slot_starts_at ASC, e.sort_order ASC, e.created_at DESC`,
    )
    .bind(nowIso, nowIso, nowIso, account_id, account_id, nowIso)
    .all();

  return c.json({ items: results ?? [] });
});

events.get('/api/liff/events/me', async (c) => {
  const account_id = await resolveAccountIdFromLiff(c);
  if (!account_id) return bad(c, 'liff_account_resolution_failed', 400);
  const callerLineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
  if (!callerLineUserId) return bad(c, 'unauthorized', 401);
  const friend = await c.env.DB
    .prepare(`SELECT id FROM friends WHERE line_user_id = ? AND line_account_id = ?`)
    .bind(callerLineUserId, account_id)
    .first<{ id: string }>();
  if (!friend) return c.json({ items: [] });

  const tab = c.req.query('tab') === 'past' ? 'past' : 'upcoming';
  const nowIso = new Date().toISOString();
  const sql =
    tab === 'upcoming'
      ? `SELECT b.id, b.event_id, b.status, b.customer_note, b.requested_at, b.decided_at, b.cancelled_at,
                e.name AS event_name, e.image_url AS event_image_url,
                e.venue_name, e.venue_url, e.cancel_deadline_hours_before,
                s.starts_at AS slot_starts_at, s.ends_at AS slot_ends_at
           FROM event_bookings b
           JOIN events e ON e.id = b.event_id
           JOIN event_slots s ON s.id = b.slot_id
          WHERE b.friend_id = ?
            AND b.line_account_id = ?
            AND b.status IN ('requested','confirmed')
            AND s.starts_at >= ?
          ORDER BY s.starts_at ASC`
      : `SELECT b.id, b.event_id, b.status, b.customer_note, b.requested_at, b.decided_at, b.cancelled_at,
                e.name AS event_name, e.image_url AS event_image_url,
                e.venue_name, e.venue_url, e.cancel_deadline_hours_before,
                s.starts_at AS slot_starts_at, s.ends_at AS slot_ends_at
           FROM event_bookings b
           JOIN events e ON e.id = b.event_id
           JOIN event_slots s ON s.id = b.slot_id
          WHERE b.friend_id = ?
            AND b.line_account_id = ?
            AND (b.status NOT IN ('requested','confirmed') OR s.starts_at < ?)
          ORDER BY s.starts_at DESC`;
  const { results } = await c.env.DB
    .prepare(sql)
    .bind(friend.id, account_id, nowIso)
    .all();
  return c.json({ items: results ?? [] });
});

events.post('/api/liff/events/me/:bookingId/cancel', async (c) => {
  const account_id = await resolveAccountIdFromLiff(c);
  if (!account_id) return bad(c, 'liff_account_resolution_failed', 400);
  const callerLineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
  if (!callerLineUserId) return bad(c, 'unauthorized', 401);
  const friend = await c.env.DB
    .prepare(`SELECT id FROM friends WHERE line_user_id = ? AND line_account_id = ?`)
    .bind(callerLineUserId, account_id)
    .first<{ id: string }>();
  if (!friend) return bad(c, 'friend_not_found', 404);

  const row = await c.env.DB
    .prepare(
      `SELECT b.id, b.status, e.cancel_deadline_hours_before, s.starts_at AS slot_starts_at
         FROM event_bookings b
         JOIN events e ON e.id = b.event_id
         JOIN event_slots s ON s.id = b.slot_id
        WHERE b.id = ? AND b.friend_id = ? AND b.line_account_id = ?`,
    )
    .bind(c.req.param('bookingId'), friend.id, account_id)
    .first<{ id: string; status: string; cancel_deadline_hours_before: number | null; slot_starts_at: string }>();
  if (!row) return bad(c, 'not_found', 404);
  if (row.status !== 'requested' && row.status !== 'confirmed') return bad(c, 'invalid_state', 409);
  if (row.cancel_deadline_hours_before == null) return bad(c, 'cancel_not_allowed', 403);
  const deadlineMs =
    new Date(row.slot_starts_at).getTime() - row.cancel_deadline_hours_before * 3600_000;
  if (deadlineMs <= Date.now()) return bad(c, 'cancel_deadline_passed', 409);

  const nowIso = new Date().toISOString();
  await c.env.DB
    .prepare(
      `UPDATE event_bookings
          SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'friend', updated_at = ?
        WHERE id = ?`,
    )
    .bind(nowIso, nowIso, row.id)
    .run();
  await cancelPendingRemindersFor(c.env.DB, row.id);
  return c.json({ ok: true });
});

// ============================================================
// LIFF: read-only event/slots
// ============================================================

events.get('/api/liff/events/:id', async (c) => {
  const account_id = await resolveAccountIdFromLiff(c);
  if (!account_id) return bad(c, 'liff_account_resolution_failed', 400);
  const row = await c.env.DB
    .prepare(
      `SELECT * FROM events
        WHERE id = ? AND deleted_at IS NULL AND is_published = 1 AND (
          (target_type = 'single' AND line_account_id = ?)
          OR (target_type = 'multi-account-dedup'
              AND EXISTS (SELECT 1 FROM json_each(account_ids) WHERE value = ?))
        )`,
    )
    .bind(c.req.param('id'), account_id, account_id)
    .first<Record<string, unknown>>();
  if (!row) return bad(c, 'not_found', 404);

  // 既存予約検出: caller が認証済 + friend が存在するなら identity_key で
  // active 予約を引いて my_existing_booking としてレスポンスに含める。
  // LIFF 詳細画面が「予約済」表示に分岐できるよう、POST 前に検出する。
  let myExistingBooking:
    | { id: string; status: string; slot_starts_at: string; line_account_id: string }
    | null = null;
  let caller: string | null = null;
  try {
    caller = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
  } catch {
    caller = null;
  }
  if (caller) {
    const friend = await c.env.DB
      .prepare(`SELECT id, user_id, picture_url FROM friends WHERE line_user_id = ? AND line_account_id = ?`)
      .bind(caller, account_id)
      .first<{ id: string; user_id: string | null; picture_url: string | null }>();
    if (friend) {
      // url_token > 'uid:<user_id>' > 'solo:<friend.id>' の順 (broadcasts dedup
      // と同じ識別ロジック)。picture_url 経由の url_token を加えることで、
      // url_token が一致する複数アカ友だち間でも既予約を検出できる。
      const idKey = computeIdentityKey(friend);
      const existing = await c.env.DB
        .prepare(
          `SELECT b.id, b.status, b.line_account_id, s.starts_at AS slot_starts_at
             FROM event_bookings b
             JOIN event_slots s ON s.id = b.slot_id
            WHERE b.event_id = ?
              AND b.identity_key = ?
              AND b.status IN ('requested','confirmed')
            LIMIT 1`,
        )
        .bind(c.req.param('id'), idKey)
        .first<{ id: string; status: string; slot_starts_at: string; line_account_id: string }>();
      if (existing) myExistingBooking = existing;
    }
  }

  return c.json({ ...row, my_existing_booking: myExistingBooking });
});

events.get('/api/liff/events/:id/slots', async (c) => {
  const account_id = await resolveAccountIdFromLiff(c);
  if (!account_id) return bad(c, 'liff_account_resolution_failed', 400);
  const ev = await c.env.DB
    .prepare(
      `SELECT id FROM events
        WHERE id = ? AND deleted_at IS NULL AND is_published = 1 AND (
          (target_type = 'single' AND line_account_id = ?)
          OR (target_type = 'multi-account-dedup'
              AND EXISTS (SELECT 1 FROM json_each(account_ids) WHERE value = ?))
        )`,
    )
    .bind(c.req.param('id'), account_id, account_id)
    .first<{ id: string }>();
  if (!ev) return bad(c, 'not_found', 404);
  const items = await getSlotsWithRemaining(c.env.DB, c.req.param('id'), {
    only_active: true,
    only_future: true,
  });
  return c.json({
    items: items.map((slot) => ({
      id: slot.id,
      event_id: slot.event_id,
      starts_at: slot.starts_at,
      ends_at: slot.ends_at,
      capacity: slot.capacity,
      is_active: slot.is_active,
      sort_order: slot.sort_order,
      is_full: slot.remaining != null && slot.remaining <= 0,
    })),
  });
});

// ----------------------------------------------------------------
// LIFF: create booking
// ----------------------------------------------------------------

interface EventDbRow {
  id: string;
  name: string;
  venue_name: string | null;
  venue_url: string | null;
  requires_approval: number;
  max_bookings_per_friend: number | null;
  reminder_day_before_enabled: number;
  reminder_hours_before: number | null;
}

interface SlotDbRow {
  id: string;
  event_id: string;
  starts_at: string;
  is_active: number;
  deleted_at: string | null;
}

const JST_OFFSET_MS = 9 * 3600_000;

function startsAtJst(utcIso: string): string {
  const jst = new Date(new Date(utcIso).getTime() + JST_OFFSET_MS).toISOString();
  return `${jst.slice(0, 10)} ${jst.slice(11, 16)}`;
}

events.post('/api/liff/events/:id/bookings', async (c) => {
  const account_id = await resolveAccountIdFromLiff(c);
  if (!account_id) return bad(c, 'liff_account_resolution_failed', 400);
  const resolvedAccountId = account_id;
  const idemKey = c.req.header('Idempotency-Key');
  if (!idemKey) return bad(c, 'idempotency_key_required', 400);
  const callerLineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
  if (!callerLineUserId) return bad(c, 'unauthorized', 401);

  // is_following=1 必須: フォロー解除した友だちは push が届かない。
  // Salon booking と同じ防御を入れる。user_id / picture_url は identity_key
  // 算出に必要 (broadcasts dedup と同じ識別ロジック)。
  const friend = await c.env.DB
    .prepare(
      `SELECT id, user_id, picture_url FROM friends
        WHERE line_user_id = ? AND line_account_id = ? AND is_following = 1`,
    )
    .bind(callerLineUserId, account_id)
    .first<{ id: string; user_id: string | null; picture_url: string | null }>();
  if (!friend) return bad(c, 'friend_not_found', 404);
  const bookingFriend = friend;
  const bookingLineUserId = callerLineUserId;

  // Reserve idempotency key BEFORE the booking work to dedupe concurrent
  // double-taps (the key is held for the full TTL window).
  const reservation = await reserveEventIdempotency(c.env.DB, {
    key: idemKey,
    lineAccountId: account_id,
    friendId: bookingFriend.id,
    ttlMinutes: EVENT_IDEMPOTENCY_TTL_MINUTES,
    now: new Date(),
  });
  if (reservation.kind === 'cached') {
    return c.json(
      reservation.body as Record<string, unknown>,
      reservation.status as 200 | 201 | 400 | 409 | 410 | 422,
    );
  }
  if (reservation.kind === 'in_progress') {
    return bad(c, 'idempotent_in_progress', 429);
  }

  // Helper that finalizes the reservation row before returning. Wraps every
  // exit path so retries after this point hit the cached branch above.
  const finalize = async (status: number, body: unknown): Promise<Response> => {
    await finalizeEventIdempotencyResponse(c.env.DB, {
      key: idemKey,
      lineAccountId: account_id,
      friendId: bookingFriend.id,
      status,
      body,
    });
    return c.json(body as Record<string, unknown>, status as 200 | 201 | 400 | 409 | 410 | 422);
  };
  // try/catch wrapper so an unexpected DB error does not strand the
  // idempotency reservation in the in_progress state for the full TTL.
  try {
    return await runBookingFlow();
  } catch (e) {
    console.error('[event-booking] booking flow threw', e);
    return finalize(500, { error: 'internal_error' });
  }

  async function runBookingFlow(): Promise<Response> {

  const event = await c.env.DB
    .prepare(
      `SELECT id, name, venue_name, venue_url, requires_approval, max_bookings_per_friend,
              reminder_day_before_enabled, reminder_hours_before
         FROM events
        WHERE id = ? AND deleted_at IS NULL AND is_published = 1 AND (
          (target_type = 'single' AND line_account_id = ?)
          OR (target_type = 'multi-account-dedup'
              AND EXISTS (SELECT 1 FROM json_each(account_ids) WHERE value = ?))
        )`,
    )
    .bind(c.req.param('id'), account_id, account_id)
    .first<EventDbRow>();
  if (!event) return finalize(409, { error: 'event_unpublished' });

  const body = (await c.req.json().catch(() => ({}))) as { slot_id?: string; customer_note?: string | null };
  if (typeof body.slot_id !== 'string' || body.slot_id.length === 0) {
    return finalize(422, { error: 'invalid_slot_id' });
  }
  if (body.customer_note != null) {
    if (typeof body.customer_note !== 'string' || body.customer_note.length > CUSTOMER_NOTE_MAX) {
      return finalize(422, { error: 'invalid_customer_note' });
    }
  }

  const slot = await c.env.DB
    .prepare(
      `SELECT id, event_id, starts_at, is_active, deleted_at
         FROM event_slots WHERE id = ? AND event_id = ? AND deleted_at IS NULL`,
    )
    .bind(body.slot_id, event.id)
    .first<SlotDbRow>();
  if (!slot || slot.is_active !== 1) return finalize(409, { error: 'slot_inactive' });
  if (new Date(slot.starts_at).getTime() <= Date.now()) return finalize(410, { error: 'slot_started' });

  // Pre-flight friend-limit check は identity_key ベースに統合済 (後段の
  // sameIdentityActive ブロック参照)。friend_id ベースの単一アカウント
  // 内カウントは cross-account 同一人物を捉えられないので使わない。
  // Pre-flight capacity check (also a cheap rejection).
  const slotRow = await c.env.DB
    .prepare(`SELECT capacity FROM event_slots WHERE id = ?`)
    .bind(slot.id)
    .first<{ capacity: number | null }>();
  if (slotRow?.capacity != null) {
    const cnt = await c.env.DB
      .prepare(
        `SELECT COUNT(*) AS c FROM event_bookings
          WHERE slot_id = ? AND status IN ('requested','confirmed')`,
      )
      .bind(slot.id)
      .first<{ c: number }>();
    if ((cnt?.c ?? 0) >= slotRow.capacity) return finalize(409, { error: 'slot_full' });
  }

  // identity_key 算出: broadcasts dedup と同じ式 (url_token > uid > solo)。
  // computeIdentityKey は friends.picture_url の url_token を最優先、なければ
  // user_id (UUID)、ともになければ自分自身のみ ('solo:'+id) にフォールバック。
  const identityKey = computeIdentityKey(bookingFriend);

  // 同一人物 (cross-account) の active 予約数を identity_key ベースでカウント。
  // 重複制限ロジック:
  //   - max=null: 制限なし (admin UI の「制限なし」と整合)、チェックスキップ
  //   - max=1: 同一人物の 2 件目を duplicate_friend_booking で弾く
  //   - max=N (>1): N 件まで許可、N+1 件目以降は over_friend_limit
  // UNIQUE INDEX を貼らないので max>1 の event も正しく動作する。
  if (event.max_bookings_per_friend != null) {
    const sameIdentityActive = await c.env.DB
      .prepare(
        `SELECT b.id, b.status, s.starts_at AS slot_starts_at, COUNT(*) OVER () AS total
           FROM event_bookings b
           JOIN event_slots s ON s.id = b.slot_id
          WHERE b.event_id = ?
            AND b.identity_key = ?
            AND b.status IN ('requested','confirmed')
          ORDER BY b.requested_at ASC
          LIMIT 1`,
      )
      .bind(event.id, identityKey)
      .first<{ id: string; status: string; slot_starts_at: string; total: number }>();
    if (sameIdentityActive && sameIdentityActive.total >= event.max_bookings_per_friend) {
      if (event.max_bookings_per_friend === 1) {
        return finalize(409, {
          error: 'duplicate_friend_booking',
          existing: {
            id: sameIdentityActive.id,
            status: sameIdentityActive.status,
            slot_starts_at: sameIdentityActive.slot_starts_at,
          },
        });
      }
      return finalize(409, { error: 'over_friend_limit' });
    }
  }

  // Insert-then-verify pattern: Cloudflare D1 doesn't expose multi-statement
  // transactions, so we INSERT first, then re-COUNT. If concurrent inserts
  // pushed us over the limit we DELETE this row and return 409. Determinism
  // is enforced by the INSERT timestamp (newest row loses).
  const status = event.requires_approval === 1 ? 'requested' : 'confirmed';
  const id = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  await c.env.DB
    .prepare(
      `INSERT INTO event_bookings
         (id, line_account_id, event_id, slot_id, friend_id, status, customer_note, requested_at, identity_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, account_id, event.id, slot.id, bookingFriend.id, status, body.customer_note ?? null, nowIso, identityKey)
    .run();

  // Verify capacity again. If there is a race winner ahead of us — i.e. an
  // earlier (smaller requested_at, then smaller id) row — we are the loser
  // and roll back our row.
  if (slotRow?.capacity != null) {
    const cnt = await c.env.DB
      .prepare(
        `SELECT COUNT(*) AS c FROM event_bookings
          WHERE slot_id = ? AND status IN ('requested','confirmed')`,
      )
      .bind(slot.id)
      .first<{ c: number }>();
    if ((cnt?.c ?? 0) > slotRow.capacity) {
      const winner = await c.env.DB
        .prepare(
          `SELECT id FROM event_bookings
            WHERE slot_id = ? AND status IN ('requested','confirmed')
            ORDER BY requested_at ASC, id ASC
            LIMIT ?`,
        )
        .bind(slot.id, slotRow.capacity)
        .all<{ id: string }>();
      const winners = new Set((winner.results ?? []).map((r) => r.id));
      if (!winners.has(id)) {
        await c.env.DB
          .prepare(`DELETE FROM event_bookings WHERE id = ?`)
          .bind(id)
          .run();
        return finalize(409, { error: 'slot_full' });
      }
    }
  }

  // Verify friend-limit again (identity_key ベース、cross-account 同一人物
  // を含めて再 COUNT)。並走 race の loser は DELETE してロールバック。
  // effectiveMax = max_bookings_per_friend ?? 1 (max=null は 1 件まで)。
  {
    const effectiveMax = event.max_bookings_per_friend ?? 1;
    const cnt2 = await c.env.DB
      .prepare(
        `SELECT COUNT(*) AS c FROM event_bookings
          WHERE event_id = ? AND identity_key = ? AND status IN ('requested','confirmed')`,
      )
      .bind(event.id, identityKey)
      .first<{ c: number }>();
    if ((cnt2?.c ?? 0) > effectiveMax) {
      const winner = await c.env.DB
        .prepare(
          `SELECT id FROM event_bookings
            WHERE event_id = ? AND identity_key = ? AND status IN ('requested','confirmed')
            ORDER BY requested_at ASC, id ASC
            LIMIT ?`,
        )
        .bind(event.id, identityKey, effectiveMax)
        .all<{ id: string }>();
      const winners = new Set((winner.results ?? []).map((r) => r.id));
      if (!winners.has(id)) {
        await c.env.DB
          .prepare(`DELETE FROM event_bookings WHERE id = ?`)
          .bind(id)
          .run();
        const code = effectiveMax === 1 ? 'duplicate_friend_booking' : 'over_friend_limit';
        return finalize(409, { error: code });
      }
    }
  }

  if (status === 'confirmed') {
    const reminders = computeRemindersForBooking({
      starts_at_utc: slot.starts_at,
      reminder_day_before_enabled: event.reminder_day_before_enabled === 1,
      reminder_hours_before: event.reminder_hours_before,
    });
    await insertRemindersForBooking(c.env.DB, id, reminders);
  }

  // best-effort notification: do not fail the booking if push fails.
  try {
    const acc = await c.env.DB
      .prepare(`SELECT channel_access_token, liff_id FROM line_accounts WHERE id = ?`)
      .bind(account_id)
      .first<{ channel_access_token: string; liff_id: string | null }>();
    if (acc?.channel_access_token) {
      const kind: EventNotificationKind =
        status === 'requested' ? 'received_pending' : 'received_confirmed';
      await sendEventBookingNotification({
        channelAccessToken: acc.channel_access_token,
        toLineUserId: bookingLineUserId,
        kind,
        ctx: {
          eventName: event.name,
          startsAtJst: startsAtJst(slot.starts_at),
          venueName: event.venue_name,
          venueUrl: event.venue_url,
          liffId: acc.liff_id,
        },
      });
    }
  } catch (e) {
    console.error('[event-booking] notify failed', e);
  }

  if (status === 'requested') {
    try {
      await notifyEventBookingTelegramAdmin(c, {
        accountId: resolvedAccountId,
        eventId: event.id,
        bookingId: id,
        eventName: event.name,
        startsAt: slot.starts_at,
        venueName: event.venue_name,
        friendDisplayName: null,
        customerNote: body.customer_note ?? null,
      });
    } catch (e) {
      console.error('[event-booking] telegram admin notify failed', e);
    }
  }

  return finalize(201, { id, status });
  } // close runBookingFlow
});


events.delete('/api/events/admin/events/:id/slots/:slotId', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const event_id = c.req.param('id');
  const slot_id = c.req.param('slotId');
  if (!(await ownsEvent(c.env.DB, event_id, account_id))) return bad(c, 'not_found', 404);
  const slot = await c.env.DB
    .prepare(`SELECT id FROM event_slots WHERE id = ? AND event_id = ? AND deleted_at IS NULL`)
    .bind(slot_id, event_id)
    .first<{ id: string }>();
  if (!slot) return bad(c, 'not_found', 404);
  const active = await c.env.DB
    .prepare(`SELECT COUNT(*) AS c FROM event_bookings WHERE slot_id = ? AND status IN ('requested','confirmed')`)
    .bind(slot_id)
    .first<{ c: number }>();
  if ((active?.c ?? 0) > 0) return bad(c, 'slot_has_bookings', 409);
  const now = new Date().toISOString();
  await c.env.DB
    .prepare(`UPDATE event_slots SET deleted_at = ?, updated_at = ? WHERE id = ?`)
    .bind(now, now, slot_id)
    .run();
  return new Response(null, { status: 204 });
});

// ============================================================
// Admin: bookings management
// ============================================================

events.get('/api/events/admin/events/notifications/pending', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const row = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS c
         FROM event_bookings
        WHERE line_account_id = ? AND status = 'requested'`,
    )
    .bind(account_id)
    .first<{ c: number }>();
  return c.json({ count: row?.c ?? 0 });
});

function buildManualEventCustomerNote(body: {
  name: string;
  phone?: string | null;
  x_account?: string | null;
  participant_count?: number;
  companion_count?: number;
  companion_names?: string | null;
  note?: string | null;
  source?: string | null;
}): string {
  const rows = [
    ['受付区分', body.source || '管理者追加'],
    ['名前', body.name],
    ['Xアカウント', body.x_account || ''],
    ['電話番号', body.phone || ''],
    ['人数', String(body.participant_count ?? 1)],
    ['同行者人数', String(body.companion_count ?? 0)],
    ['同行者名', body.companion_names || ''],
    ['備考', body.note || ''],
  ];
  return rows.map(([k, v]) => `${k}: ${v}`).join('\n');
}

events.post('/api/events/admin/events/:id/bookings', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const event_id = c.req.param('id');
  if (!(await ownsEvent(c.env.DB, event_id, account_id))) return bad(c, 'not_found', 404);

  const body = (await c.req.json().catch(() => ({}))) as {
    slot_id?: string;
    name?: string;
    phone?: string;
    x_account?: string | null;
    participant_count?: number;
    companion_count?: number;
    companion_names?: string | null;
    note?: string | null;
    source?: string | null;
  };
  const name = body.name?.trim();
  const phone = body.phone?.trim() || '';
  if (!body.slot_id) return bad(c, 'invalid_slot_id', 422);
  if (!name) return bad(c, 'name_required', 422);
  const participantCount = Number.isFinite(body.participant_count)
    ? Math.max(1, Math.floor(body.participant_count ?? 1))
    : 1;
  const companionCount = Number.isFinite(body.companion_count)
    ? Math.max(0, Math.floor(body.companion_count ?? 0))
    : 0;
  if (participantCount > 30 || companionCount > 29) return bad(c, 'invalid_party_size', 422);

  const slot = await c.env.DB
    .prepare(
      `SELECT id, starts_at, capacity, is_active, deleted_at
         FROM event_slots WHERE id = ? AND event_id = ? AND deleted_at IS NULL`,
    )
    .bind(body.slot_id, event_id)
    .first<{ id: string; starts_at: string; capacity: number | null; is_active: number; deleted_at: string | null }>();
  if (!slot || slot.is_active !== 1) return bad(c, 'slot_inactive', 409);

  if (slot.capacity != null) {
    const cnt = await c.env.DB
      .prepare(
        `SELECT COUNT(*) AS c FROM event_bookings
          WHERE slot_id = ? AND status IN ('requested','confirmed')`,
      )
      .bind(slot.id)
      .first<{ c: number }>();
    if ((cnt?.c ?? 0) >= slot.capacity) return bad(c, 'slot_full', 409);
  }

  const nowIso = new Date().toISOString();
  const friendId = crypto.randomUUID();
  const bookingId = crypto.randomUUID();
  const manualLineUserId = `manual:${account_id}:${bookingId}`;
  const staff = c.get('staff');
  await c.env.DB
    .prepare(
      `INSERT INTO friends
         (id, line_account_id, line_user_id, display_name, is_following, user_id, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    )
    .bind(
      friendId,
      account_id,
      manualLineUserId,
      name,
      crypto.randomUUID(),
      JSON.stringify({ source: 'event_admin_manual' }),
      nowIso,
      nowIso,
    )
    .run();

  const source = body.source?.trim() || '管理者追加';
  const customerNote = buildManualEventCustomerNote({
    ...body,
    name,
    phone,
    participant_count: participantCount,
    companion_count: companionCount,
    source,
  });
  if (customerNote.length > CUSTOMER_NOTE_MAX) return bad(c, 'invalid_customer_note', 422);

  await c.env.DB
    .prepare(
      `INSERT INTO event_bookings
         (id, line_account_id, event_id, slot_id, friend_id, status, customer_note, internal_note,
          requested_at, decided_at, decided_by_staff_id, identity_key)
       VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      bookingId,
      account_id,
      event_id,
      slot.id,
      friendId,
      customerNote,
      `受付区分: ${source}`,
      nowIso,
      nowIso,
      staff?.id ?? null,
      `manual:${bookingId}`,
    )
    .run();

  const row = await c.env.DB
    .prepare(
      `SELECT b.*,
              s.starts_at AS slot_starts_at, s.ends_at AS slot_ends_at,
              f.display_name AS friend_display_name, f.line_user_id AS friend_line_user_id
         FROM event_bookings b
         JOIN event_slots s ON s.id = b.slot_id
         LEFT JOIN friends f ON f.id = b.friend_id
        WHERE b.id = ?`,
    )
    .bind(bookingId)
    .first();
  return c.json(row, 201);
});

events.get('/api/events/admin/events/:id/bookings', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const event_id = c.req.param('id');
  if (!(await ownsEvent(c.env.DB, event_id, account_id))) return bad(c, 'not_found', 404);
  const status = c.req.query('status');
  const slot_id = c.req.query('slot_id');
  const conditions = ['b.event_id = ?'];
  const params: unknown[] = [event_id];
  if (status && status !== 'all') {
    conditions.push('b.status = ?');
    params.push(status);
  }
  if (slot_id) {
    conditions.push('b.slot_id = ?');
    params.push(slot_id);
  }
  const { results } = await c.env.DB
    .prepare(
      `SELECT b.*,
              s.starts_at AS slot_starts_at, s.ends_at AS slot_ends_at,
              f.display_name AS friend_display_name, f.line_user_id AS friend_line_user_id
         FROM event_bookings b
         JOIN event_slots s ON s.id = b.slot_id
         LEFT JOIN friends f ON f.id = b.friend_id
        WHERE ${conditions.join(' AND ')}
        ORDER BY b.requested_at DESC`,
    )
    .bind(...params)
    .all();
  return c.json({ items: results ?? [] });
});

interface BookingActionRow {
  id: string;
  line_account_id: string;
  event_id: string;
  slot_id: string;
  friend_id: string;
  status: string;
  decided_at: string | null;
}

async function loadBookingForAction(
  db: D1Database,
  _account_id: string,
  event_id: string,
  booking_id: string,
): Promise<BookingActionRow | null> {
  // 認可は呼び出し元の ownsEvent (event の account_ids / line_account_id に
  // caller account が含まれるか) で実施済。booking.line_account_id は通知の
  // 送信元アカ識別用なので、ここでは event_id だけで booking を一意取得する。
  // multi-account event では booking が別アカ経由で作られていても admin から
  // 操作可能にする。
  const row = await db
    .prepare(
      `SELECT id, line_account_id, event_id, slot_id, friend_id, status, decided_at
         FROM event_bookings
        WHERE id = ? AND event_id = ?`,
    )
    .bind(booking_id, event_id)
    .first<BookingActionRow>();
  return row ?? null;
}

async function notifyBookingFriend(
  db: D1Database,
  booking_id: string,
  kind: EventNotificationKind,
): Promise<void> {
  try {
    const row = await db
      .prepare(
        `SELECT e.name AS event_name, e.venue_name, e.venue_url,
                s.starts_at AS slot_starts_at,
                la.channel_access_token,
                la.liff_id,
                f.line_user_id
           FROM event_bookings b
           JOIN events e ON e.id = b.event_id
           JOIN event_slots s ON s.id = b.slot_id
           JOIN line_accounts la ON la.id = b.line_account_id
           JOIN friends f ON f.id = b.friend_id
          WHERE b.id = ?`,
      )
      .bind(booking_id)
      .first<{
        event_name: string;
        venue_name: string | null;
        venue_url: string | null;
        slot_starts_at: string;
        channel_access_token: string;
        liff_id: string | null;
        line_user_id: string;
      }>();
    if (!row || !row.channel_access_token) return;
    await sendEventBookingNotification({
      channelAccessToken: row.channel_access_token,
      toLineUserId: row.line_user_id,
      kind,
      ctx: {
        eventName: row.event_name,
        startsAtJst: startsAtJst(row.slot_starts_at),
        venueName: row.venue_name,
        venueUrl: row.venue_url,
        liffId: row.liff_id,
      },
    });
  } catch (e) {
    console.error('[event-booking] notify failed', e);
  }
}

async function decideEventBooking(
  c: Context<Env>,
  args: {
    account_id: string;
    event_id: string;
    booking_id: string;
    action: EventBookingAction;
    reason?: string;
  },
): Promise<Response> {
  if (!(await ownsEvent(c.env.DB, args.event_id, args.account_id))) return bad(c, 'not_found', 404);
  const booking = await loadBookingForAction(c.env.DB, args.account_id, args.event_id, args.booking_id);
  if (!booking) return bad(c, 'not_found', 404);
  if (booking.decided_at != null) return bad(c, 'already_decided', 409);
  if (!canTransition(booking.status as never, args.action)) return bad(c, 'invalid_state', 409);
  const next = nextStatus(booking.status as never, args.action);

  const nowIso = new Date().toISOString();
  const staff = c.get('staff');
  // Conditional UPDATE so two concurrent admins can't both transition the
  // same `requested` row. The losing request gets changes=0 and treats the
  // booking as already decided.
  const upd = await c.env.DB
    .prepare(
      `UPDATE event_bookings
          SET status = ?, decided_at = ?, decided_by_staff_id = ?, updated_at = ?
        WHERE id = ? AND status = ? AND decided_at IS NULL`,
    )
    .bind(next, nowIso, staff?.id ?? null, nowIso, booking.id, booking.status)
    .run();
  if ((upd.meta?.changes ?? 0) === 0) return bad(c, 'already_decided', 409);

  if (args.action === 'reject' && args.reason) {
    await c.env.DB
      .prepare(
        `UPDATE event_bookings
            SET internal_note = COALESCE(internal_note || char(10), '') || ?,
                updated_at = ?
          WHERE id = ?`,
      )
      .bind(`[reject reason] ${args.reason}`, nowIso, booking.id)
      .run();
  }

  if (args.action === 'confirm') {
    const slot = await c.env.DB
      .prepare(`SELECT starts_at FROM event_slots WHERE id = ?`)
      .bind(booking.slot_id)
      .first<{ starts_at: string }>();
    const evRow = await c.env.DB
      .prepare(
        `SELECT reminder_day_before_enabled, reminder_hours_before FROM events WHERE id = ?`,
      )
      .bind(booking.event_id)
      .first<{ reminder_day_before_enabled: number; reminder_hours_before: number | null }>();
    if (slot && evRow) {
      const reminders = computeRemindersForBooking({
        starts_at_utc: slot.starts_at,
        reminder_day_before_enabled: evRow.reminder_day_before_enabled === 1,
        reminder_hours_before: evRow.reminder_hours_before,
      });
      await insertRemindersForBooking(c.env.DB, booking.id, reminders);
    }
  }

  await notifyBookingFriend(c.env.DB, booking.id, args.action === 'confirm' ? 'confirmed' : 'rejected');
  const updated = await c.env.DB
    .prepare(`SELECT * FROM event_bookings WHERE id = ?`)
    .bind(booking.id)
    .first();
  return c.json(updated);
}

events.get('/telegram/event-booking-action', async (c) => {
  const payload = await verifyTelegramActionToken<{
    accountId?: string;
    eventId?: string;
    bookingId?: string;
    action?: string;
    exp?: number;
  }>(c, c.req.query('t'));
  if (
    !payload ||
    typeof payload.accountId !== 'string' ||
    typeof payload.eventId !== 'string' ||
    typeof payload.bookingId !== 'string' ||
    (payload.action !== 'confirm' && payload.action !== 'reject') ||
    typeof payload.exp !== 'number' ||
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    return c.html(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;padding:24px"><h2>リンクが無効です</h2><p>期限切れ、または不正なリンクです。管理画面から確認してください。</p></body>',
      400,
    );
  }

  const res = await decideEventBooking(c, {
    account_id: payload.accountId,
    event_id: payload.eventId,
    booking_id: payload.bookingId,
    action: payload.action,
  });
  if (res.status === 409) {
    return c.html(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;padding:24px"><h2>処理済みです</h2><p>この予約はすでに承認または拒否されています。</p></body>',
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[event-booking] telegram action failed', res.status, text);
    return c.html(
      '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;padding:24px"><h2>処理に失敗しました</h2><p>管理画面から確認してください。</p></body>',
      500,
    );
  }
  const label = payload.action === 'confirm' ? '承認しました' : '拒否しました';
  try {
    await sendTelegramMessage(c, {
      text: payload.action === 'confirm'
        ? `イベント予約を承認しました。\nbookingId: ${payload.bookingId}`
        : `イベント予約を拒否しました。\nbookingId: ${payload.bookingId}`,
    });
  } catch (e) {
    console.error('[event-booking] telegram action result notify failed', e);
  }
  return c.html(
    `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;padding:24px"><h2>${label}</h2><p>LINE Harnessへ反映しました。この画面は閉じて大丈夫です。</p></body>`,
  );
});

events.post('/api/events/admin/events/:id/bookings/:bookingId/decide', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const event_id = c.req.param('id');

  const body = (await c.req.json().catch(() => ({}))) as { action?: string; reason?: string };
  if (body.action !== 'confirm' && body.action !== 'reject') {
    return bad(c, 'invalid_action', 422);
  }
  return decideEventBooking(c, {
    account_id,
    event_id,
    booking_id: c.req.param('bookingId'),
    action: body.action,
    reason: body.reason,
  });
});

events.post('/api/events/admin/events/:id/bookings/:bookingId/cancel', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const event_id = c.req.param('id');
  if (!(await ownsEvent(c.env.DB, event_id, account_id))) return bad(c, 'not_found', 404);
  const booking = await loadBookingForAction(c.env.DB, account_id, event_id, c.req.param('bookingId'));
  if (!booking) return bad(c, 'not_found', 404);
  if (!canTransition(booking.status as never, 'cancel')) return bad(c, 'invalid_state', 409);

  const nowIso = new Date().toISOString();
  // Conditional UPDATE: another concurrent action (mark_attended /
  // mark_no_show / friend cancel) may have already changed status.
  const upd = await c.env.DB
    .prepare(
      `UPDATE event_bookings
          SET status = 'cancelled', cancelled_at = ?, cancelled_by = 'admin', updated_at = ?
        WHERE id = ? AND status = ?`,
    )
    .bind(nowIso, nowIso, booking.id, booking.status)
    .run();
  if ((upd.meta?.changes ?? 0) === 0) return bad(c, 'invalid_state', 409);
  await cancelPendingRemindersFor(c.env.DB, booking.id);
  await notifyBookingFriend(c.env.DB, booking.id, 'cancelled_by_admin');
  return c.json({ ok: true });
});

events.put('/api/events/admin/events/:id/bookings/:bookingId', async (c) => {
  const account_id = getAccountId(c);
  if (!account_id) return bad(c, 'account_id_required', 400);
  const event_id = c.req.param('id');
  if (!(await ownsEvent(c.env.DB, event_id, account_id))) return bad(c, 'not_found', 404);
  const booking = await loadBookingForAction(c.env.DB, account_id, event_id, c.req.param('bookingId'));
  if (!booking) return bad(c, 'not_found', 404);

  const body = (await c.req.json().catch(() => ({}))) as { internal_note?: string | null; status?: string };
  const setClauses: string[] = [];
  const setValues: unknown[] = [];

  if ('internal_note' in body) {
    setClauses.push('internal_note = ?');
    setValues.push(body.internal_note ?? null);
  }
  if (body.status === 'no_show' || body.status === 'attended') {
    const action: EventBookingAction = body.status === 'attended' ? 'mark_attended' : 'mark_no_show';
    if (!canTransition(booking.status as never, action)) return bad(c, 'invalid_state', 409);
    setClauses.push('status = ?');
    setValues.push(body.status);
  } else if (body.status != null) {
    return bad(c, 'invalid_status', 422);
  }
  if (setClauses.length === 0) {
    const row = await c.env.DB.prepare(`SELECT * FROM event_bookings WHERE id = ?`).bind(booking.id).first();
    return c.json(row);
  }
  setClauses.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  setValues.push(booking.id, booking.status);
  // Conditional UPDATE on (id, status) — same race protection as the
  // decide / cancel handlers.
  const upd = await c.env.DB
    .prepare(`UPDATE event_bookings SET ${setClauses.join(', ')} WHERE id = ? AND status = ?`)
    .bind(...setValues)
    .run();
  if ((upd.meta?.changes ?? 0) === 0) return bad(c, 'invalid_state', 409);
  const row = await c.env.DB.prepare(`SELECT * FROM event_bookings WHERE id = ?`).bind(booking.id).first();
  return c.json(row);
});

export default events;
