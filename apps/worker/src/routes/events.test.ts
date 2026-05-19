import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

// Mock availability so LIFF /slots route tests don't need to re-implement
// the COUNT subquery — those are covered in event-availability.test.ts.
const availabilityMocks = {
  getSlotsWithRemaining: vi.fn(),
  getActiveBookingCountsBySlot: vi.fn(),
  getFriendActiveBookingCount: vi.fn(),
};
vi.mock('../services/event-availability.js', () => availabilityMocks);

const liffAuthMocks = {
  verifyCallerLineUserId: vi.fn(),
};
vi.mock('../services/liff-auth.js', () => liffAuthMocks);

const idempotencyMocks = {
  reserveEventIdempotency: vi.fn(),
  finalizeEventIdempotencyResponse: vi.fn(),
  purgeExpiredEventIdempotency: vi.fn(),
};
vi.mock('../services/event-booking-idempotency.js', () => idempotencyMocks);

const reminderMocks = {
  computeRemindersForBooking: vi.fn(() => []),
  insertRemindersForBooking: vi.fn(),
  cancelPendingRemindersFor: vi.fn(),
};
vi.mock('../services/event-booking-reminders.js', () => reminderMocks);

const notifierMocks = {
  sendEventBookingNotification: vi.fn(),
  renderEventNotificationText: vi.fn(),
};
vi.mock('../services/event-booking-notifier.js', () => notifierMocks);

const { default: events } = await import('./events.js');

type TestEnv = {
  Variables: { staff: { id: string; role: 'owner' | 'admin' | 'staff' } };
  Bindings: { DB: D1Database };
};

interface EventRow {
  id: string;
  line_account_id: string;
  name: string;
  venue_name: string | null;
  venue_url: string | null;
  image_url: string | null;
  description: string | null;
  description_centered: number;
  max_bookings_per_friend: number | null;
  requires_approval: number;
  cancel_deadline_hours_before: number | null;
  reminder_day_before_enabled: number;
  reminder_hours_before: number | null;
  is_published: number;
  folder_id: string | null;
  sort_order: number;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  target_type?: 'single' | 'multi-account-dedup';
  account_ids?: string | null;
  dedup_priority?: string | null;
  [k: string]: unknown;
}

interface SlotRow {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  is_active: number;
  sort_order: number;
  deleted_at: string | null;
  [k: string]: unknown;
}

interface BookingRow {
  id: string;
  event_id: string;
  status: string;
  slot_id?: string;
  friend_id?: string;
  [k: string]: unknown;
}

interface LineAccount {
  id: string;
  liff_id: string;
  is_active: number;
  channel_access_token?: string;
}

interface FriendRow {
  id: string;
  line_account_id: string;
  line_user_id: string;
  user_id?: string | null;
  picture_url?: string | null;
}

function makeEventDb(state: {
  events: EventRow[];
  slots?: SlotRow[];
  bookings?: BookingRow[];
  accounts?: LineAccount[];
  friends?: FriendRow[];
}): D1Database {
  state.slots ??= [];
  state.bookings ??= [];
  state.accounts ??= [];
  state.friends ??= [];
  const db = {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T>() {
          // SELECT id FROM line_accounts WHERE liff_id = ? AND is_active = 1
          if (sql.startsWith('SELECT id FROM line_accounts')) {
            const [liff_id] = bound as [string];
            const acc = (state.accounts ?? []).find(
              (a) => a.liff_id === liff_id && a.is_active === 1,
            );
            return (acc ? { id: acc.id } : null) as T | null;
          }
          // SELECT channel_access_token FROM line_accounts WHERE id = ?
          if (sql.startsWith('SELECT channel_access_token FROM line_accounts')) {
            const [id] = bound as [string];
            const acc = (state.accounts ?? []).find((a) => a.id === id);
            return (acc ? { channel_access_token: acc.channel_access_token ?? '' } : null) as T | null;
          }
          // immediate booking notification: SELECT la.channel_access_token, e.confirmation_message_extra
          //   FROM line_accounts la JOIN events e ON e.id = ? WHERE la.id = ?
          if (sql.startsWith('SELECT la.channel_access_token, e.confirmation_message_extra')) {
            const [event_id, account_id] = bound as [string, string];
            const acc = (state.accounts ?? []).find((a) => a.id === account_id);
            const ev = state.events.find((x) => x.id === event_id);
            if (!acc || !ev) return null as T | null;
            return {
              channel_access_token: acc.channel_access_token ?? '',
              confirmation_message_extra: (ev as Record<string, unknown>).confirmation_message_extra ?? null,
            } as T;
          }
          // SELECT id [, user_id] FROM friends WHERE line_user_id = ? AND line_account_id = ?
          if (sql.includes('FROM friends')) {
            const [lineUserId, account] = bound as [string, string];
            const f = (state.friends ?? []).find(
              (x) => x.line_user_id === lineUserId && x.line_account_id === account,
            );
            if (!f) return null as T | null;
            // POST 予約用は is_following = 1 の filter があるが、テスト friend は
            // 既存テストで is_following を持たないため pass。SELECT が user_id を
            // 含めば返す。
            if (sql.includes('user_id') || sql.includes('picture_url')) {
              return {
                id: f.id,
                user_id: f.user_id ?? null,
                picture_url: f.picture_url ?? null,
              } as T;
            }
            return { id: f.id } as T;
          }
          // LIFF event row for booking creation: SELECT id, name, ... FROM events WHERE ...
          if (sql.includes('SELECT id, name, venue_name')) {
            const [id, account] = bound as [string, string];
            const e = state.events.find(
              (x) => x.id === id && x.line_account_id === account && x.deleted_at == null && x.is_published === 1,
            );
            return (e ?? null) as T | null;
          }
          // SELECT capacity FROM event_slots WHERE id = ?
          if (sql.startsWith('SELECT capacity FROM event_slots')) {
            const [id] = bound as [string];
            const s = (state.slots ?? []).find((x) => x.id === id);
            return (s ? { capacity: s.capacity } : null) as T | null;
          }
          // SELECT id, event_id, starts_at, is_active, deleted_at FROM event_slots WHERE id = ? AND event_id = ?
          if (sql.startsWith('SELECT id, event_id, starts_at, is_active, deleted_at')) {
            const [id, event_id] = bound as [string, string];
            const s = (state.slots ?? []).find(
              (x) => x.id === id && x.event_id === event_id && x.deleted_at == null,
            );
            return (s ?? null) as T | null;
          }
          // notification JOIN: SELECT e.name AS event_name, e.venue_name, ... line_accounts la
          if (sql.includes('FROM event_bookings b') && sql.includes('channel_access_token')) {
            const [bookingId] = bound as [string];
            const b = (state.bookings ?? []).find((x) => x.id === bookingId);
            if (!b) return null as T | null;
            const e = state.events.find((x) => x.id === b.event_id);
            const s = (state.slots ?? []).find((x) => x.id === (b as Record<string, unknown>).slot_id);
            const la = (state.accounts ?? []).find((x) => x.id === (b as Record<string, unknown>).line_account_id);
            const f = (state.friends ?? []).find((x) => x.id === (b as Record<string, unknown>).friend_id);
            if (!e || !s || !la || !f) return null as T | null;
            return {
              event_name: e.name,
              venue_name: e.venue_name,
              venue_url: e.venue_url,
              confirmation_message_extra: (e as Record<string, unknown>).confirmation_message_extra ?? null,
              slot_starts_at: s.starts_at,
              channel_access_token: la.channel_access_token ?? '',
              line_user_id: f.line_user_id,
            } as T;
          }
          // booking action loader: SELECT id, line_account_id, event_id, slot_id, friend_id, status, decided_at FROM event_bookings WHERE id = ? AND event_id = ?
          // (multi-account 対応で line_account_id 制約を削除)
          if (sql.includes('FROM event_bookings\n        WHERE id = ? AND event_id = ?')) {
            const [id, event_id] = bound as [string, string];
            const b = (state.bookings ?? []).find(
              (x) =>
                x.id === id &&
                (x as Record<string, unknown>).event_id === event_id,
            );
            if (!b) return null as T | null;
            return {
              id: b.id,
              line_account_id: (b as Record<string, unknown>).line_account_id as string,
              event_id: b.event_id,
              slot_id: (b as Record<string, unknown>).slot_id as string,
              friend_id: (b as Record<string, unknown>).friend_id as string,
              status: b.status,
              decided_at: ((b as Record<string, unknown>).decided_at as string | null) ?? null,
            } as T;
          }
          // SELECT * FROM event_bookings WHERE id = ?
          if (sql.startsWith('SELECT * FROM event_bookings')) {
            const [id] = bound as [string];
            const b = (state.bookings ?? []).find((x) => x.id === id);
            return (b ?? null) as T | null;
          }
          // SELECT starts_at FROM event_slots WHERE id = ?
          if (sql.startsWith('SELECT starts_at FROM event_slots')) {
            const [id] = bound as [string];
            const s = (state.slots ?? []).find((x) => x.id === id);
            return (s ? { starts_at: s.starts_at } : null) as T | null;
          }
          // SELECT reminder_day_before_enabled, reminder_hours_before FROM events WHERE id = ?
          if (sql.startsWith('SELECT reminder_day_before_enabled')) {
            const [id] = bound as [string];
            const e = state.events.find((x) => x.id === id);
            return (e ? {
              reminder_day_before_enabled: e.reminder_day_before_enabled,
              reminder_hours_before: e.reminder_hours_before,
            } : null) as T | null;
          }
          // notifications/pending count: SELECT COUNT(*) AS c FROM event_bookings WHERE line_account_id = ? AND status = 'requested'
          if (sql.includes('FROM event_bookings') && sql.includes("status = 'requested'")) {
            const [account_id] = bound as [string];
            const c = (state.bookings ?? []).filter(
              (b) =>
                (b as Record<string, unknown>).line_account_id === account_id &&
                b.status === 'requested',
            ).length;
            return { c } as T;
          }
          // POST の sameIdentityActive 検出 (window 関数 COUNT(*) OVER () で total を返す)
          if (sql.includes('FROM event_bookings b') && sql.includes('identity_key') && sql.includes('COUNT(*) OVER')) {
            const [event_id, idKey] = bound as [string, string];
            const matches = (state.bookings ?? [])
              .filter(
                (x) =>
                  x.event_id === event_id &&
                  (x as Record<string, unknown>).identity_key === idKey &&
                  (x.status === 'requested' || x.status === 'confirmed'),
              );
            if (matches.length === 0) return null as T | null;
            const b = matches[0];
            const s = (state.slots ?? []).find((x) => x.id === (b as Record<string, unknown>).slot_id);
            return {
              id: b.id,
              status: b.status,
              slot_starts_at: s?.starts_at ?? null,
              total: matches.length,
            } as T;
          }
          // POST post-insert verify: COUNT(*) AS c FROM event_bookings WHERE event_id = ? AND identity_key = ?
          if (sql.includes('FROM event_bookings') && sql.includes('COUNT(*) AS c') && sql.includes('identity_key')) {
            const [event_id, idKey] = bound as [string, string];
            const c = (state.bookings ?? []).filter(
              (x) =>
                x.event_id === event_id &&
                (x as Record<string, unknown>).identity_key === idKey &&
                (x.status === 'requested' || x.status === 'confirmed'),
            ).length;
            return { c } as T;
          }
          // self-cancel JOIN: SELECT b.id, b.status, e.cancel_deadline_hours_before, s.starts_at
          // LIFF GET event の my_existing_booking 検出:
          // SELECT b.id, b.status, b.line_account_id, s.starts_at FROM event_bookings b
          //   JOIN event_slots s WHERE b.event_id = ? AND b.identity_key = ?
          if (sql.includes('FROM event_bookings b') && sql.includes('identity_key')) {
            const [event_id, idKey] = bound as [string, string];
            const b = (state.bookings ?? []).find(
              (x) =>
                x.event_id === event_id &&
                (x as Record<string, unknown>).identity_key === idKey &&
                (x.status === 'requested' || x.status === 'confirmed'),
            );
            if (!b) return null as T | null;
            const s = (state.slots ?? []).find((x) => x.id === (b as Record<string, unknown>).slot_id);
            return {
              id: b.id,
              status: b.status,
              line_account_id: (b as Record<string, unknown>).line_account_id,
              slot_starts_at: s?.starts_at ?? null,
            } as T;
          }
          // booking detail: SELECT b.id, ... e.description AS event_description, CASE WHEN ... END AS confirmation_message_extra
          //   FROM event_bookings b JOIN events e JOIN event_slots s WHERE b.id = ? AND b.friend_id = ? AND b.line_account_id = ?
          if (sql.includes('FROM event_bookings b') && sql.includes('event_description') && sql.includes('cancel_deadline_hours_before')) {
            const [bookingId, friend_id, account_id] = bound as [string, string, string];
            const b = (state.bookings ?? []).find(
              (x) => x.id === bookingId && (x as Record<string, unknown>).friend_id === friend_id && (x as Record<string, unknown>).line_account_id === account_id,
            );
            if (!b) return null as T | null;
            const e = state.events.find((x) => x.id === b.event_id);
            const s = (state.slots ?? []).find((x) => x.id === (b as Record<string, unknown>).slot_id);
            if (!e || !s) return null as T | null;
            return {
              id: b.id,
              event_id: b.event_id,
              status: b.status,
              customer_note: (b as Record<string, unknown>).customer_note ?? null,
              requested_at: null,
              decided_at: null,
              cancelled_at: null,
              event_name: e.name,
              event_image_url: e.image_url,
              venue_name: e.venue_name,
              venue_url: e.venue_url,
              cancel_deadline_hours_before: e.cancel_deadline_hours_before,
              event_description: (e as Record<string, unknown>).description ?? null,
              confirmation_message_extra: b.status === 'confirmed' ? ((e as Record<string, unknown>).confirmation_message_extra ?? null) : null,
              slot_starts_at: s.starts_at,
              slot_ends_at: s.ends_at,
            } as T;
          }
          // self-cancel JOIN: SELECT b.id, b.status, e.cancel_deadline_hours_before, s.starts_at
          if (sql.includes('FROM event_bookings b') && sql.includes('cancel_deadline_hours_before')) {
            const [bookingId, friend_id, account_id] = bound as [string, string, string];
            const b = (state.bookings ?? []).find(
              (x) => x.id === bookingId && (x as Record<string, unknown>).friend_id === friend_id && (x as Record<string, unknown>).line_account_id === account_id,
            );
            if (!b) return null as T | null;
            const e = state.events.find((x) => x.id === b.event_id);
            const s = (state.slots ?? []).find((x) => x.id === (b as Record<string, unknown>).slot_id);
            if (!e || !s) return null as T | null;
            return {
              id: b.id,
              status: b.status,
              cancel_deadline_hours_before: e.cancel_deadline_hours_before,
              slot_starts_at: s.starts_at,
            } as T;
          }
          // SELECT id FROM event_slots WHERE id = ? AND event_id = ? AND deleted_at IS NULL
          if (sql.startsWith('SELECT id FROM event_slots')) {
            const [id, event_id] = bound as [string, string];
            const s = (state.slots ?? []).find(
              (x) => x.id === id && x.event_id === event_id && x.deleted_at == null,
            );
            return (s ? { id: s.id } : null) as T | null;
          }
          // SELECT * FROM event_slots WHERE id = ? AND event_id = ? AND deleted_at IS NULL
          if (sql.startsWith('SELECT * FROM event_slots') && sql.includes('event_id')) {
            const [id, event_id] = bound as [string, string];
            const s = (state.slots ?? []).find(
              (x) => x.id === id && x.event_id === event_id && x.deleted_at == null,
            );
            return (s ?? null) as T | null;
          }
          // SELECT * FROM event_slots WHERE id = ?
          if (sql.startsWith('SELECT * FROM event_slots')) {
            const [id] = bound as [string];
            const s = (state.slots ?? []).find((x) => x.id === id);
            return (s ?? null) as T | null;
          }
          // SELECT COUNT(*) AS c FROM event_bookings WHERE slot_id = ? AND status IN ('requested','confirmed')
          if (sql.includes('FROM event_bookings') && sql.includes('COUNT(*) AS c')) {
            const [slot_id] = bound as [string];
            const c = (state.bookings ?? []).filter(
              (b) => (b as BookingRow & { slot_id?: string }).slot_id === slot_id && (b.status === 'requested' || b.status === 'confirmed'),
            ).length;
            return { c } as T;
          }
          // Multi-account 対応の events lookup helper:
          // single モード → line_account_id 一致、multi-account-dedup モード
          // → account_ids JSON 配列に含まれる、のどちらか。
          const eventMatchesAccount = (e: EventRow, account: string): boolean => {
            if (e.target_type === 'multi-account-dedup') {
              const ids = e.account_ids
                ? (() => { try { return JSON.parse(e.account_ids as string) as string[]; } catch { return [] } })()
                : [];
              return ids.includes(account);
            }
            return e.line_account_id === account;
          };
          // LIFF SELECT id FROM events ... AND is_published = 1
          if (sql.includes('SELECT id FROM events') && sql.includes('is_published')) {
            const [id, account, account2] = bound as [string, string, string?];
            const acct = account2 ?? account;
            const e = state.events.find(
              (x) => x.id === id && x.deleted_at == null && x.is_published === 1 && eventMatchesAccount(x, acct),
            );
            return (e ? { id: e.id } : null) as T | null;
          }
          // admin SELECT id FROM events
          if (sql.includes('SELECT id FROM events')) {
            const [id, account, account2] = bound as [string, string, string?];
            const acct = account2 ?? account;
            const e = state.events.find(
              (x) => x.id === id && x.deleted_at == null && eventMatchesAccount(x, acct),
            );
            return (e ? { id: e.id } : null) as T | null;
          }
          // LIFF SELECT * FROM events ... AND is_published = 1
          if (sql.includes('SELECT * FROM events') && sql.includes('is_published')) {
            const [id, account, account2] = bound as [string, string, string?];
            const acct = account2 ?? account;
            const e = state.events.find(
              (x) => x.id === id && x.deleted_at == null && x.is_published === 1 && eventMatchesAccount(x, acct),
            );
            return (e ?? null) as T | null;
          }
          // admin SELECT * FROM events ... 単独 / multi 両対応
          if (sql.includes('SELECT * FROM events') && (sql.includes('line_account_id') || sql.includes('target_type'))) {
            const [id, account, account2] = bound as [string, string, string?];
            const acct = account2 ?? account;
            const e = state.events.find(
              (x) => x.id === id && x.deleted_at == null && eventMatchesAccount(x, acct),
            );
            return (e ?? null) as T | null;
          }
          // SELECT * FROM events WHERE id = ?
          if (sql.includes('SELECT * FROM events')) {
            const [id] = bound as [string];
            const e = state.events.find((x) => x.id === id);
            return (e ?? null) as T | null;
          }
          return null;
        },
        async all<T>() {
          // admin events list (must come before event_slots branch since
          // its sub-queries also reference event_slots s)
          if (sql.startsWith('SELECT\n         e.*') || (sql.includes('FROM events e') && (sql.includes('e.line_account_id') || sql.includes('e.target_type')))) {
            const [account] = bound as [string];
            const items = state.events
              .filter((e) => {
                if (e.deleted_at != null) return false;
                if (e.target_type === 'multi-account-dedup') {
                  const ids = e.account_ids
                    ? (() => { try { return JSON.parse(e.account_ids as string) as string[]; } catch { return [] } })()
                    : [];
                  return ids.includes(account);
                }
                return e.line_account_id === account;
              })
              .map((e) => {
                const slots = (state.slots ?? []).filter(
                  (s) => s.event_id === e.id && s.deleted_at == null && s.is_active === 1,
                );
                const futureSlots = slots.filter(
                  (s) => s.starts_at > new Date().toISOString(),
                );
                const next_slot_starts_at =
                  futureSlots.length > 0
                    ? futureSlots
                        .map((s) => s.starts_at)
                        .sort()[0]
                    : null;
                const cap = slots.reduce<number | null>((acc, s) => {
                  if (s.capacity == null) return acc;
                  return (acc ?? 0) + s.capacity;
                }, null);
                const total_active = (state.bookings ?? []).filter(
                  (b) => b.event_id === e.id && (b.status === 'requested' || b.status === 'confirmed'),
                ).length;
                const pending_count = (state.bookings ?? []).filter(
                  (b) => b.event_id === e.id && b.status === 'requested',
                ).length;
                return {
                  ...e,
                  next_slot_starts_at,
                  total_capacity: cap,
                  total_active,
                  pending_count,
                };
              })
              .sort((a, b) =>
                a.sort_order !== b.sort_order
                  ? a.sort_order - b.sort_order
                  : b.created_at.localeCompare(a.created_at),
              );
            return { results: items as unknown as T[] };
          }
          // admin bookings list: SELECT b.*, s.starts_at, ..., friends.display_name FROM event_bookings b JOIN event_slots s ...
          if (sql.includes('FROM event_bookings b') && sql.includes('friend_display_name')) {
            const event_id = bound[0] as string;
            const filterStatus = sql.includes('b.status = ?') ? (bound[1] as string) : null;
            const filterSlot = sql.includes('b.slot_id = ?')
              ? (bound[filterStatus ? 2 : 1] as string)
              : null;
            const items = (state.bookings ?? [])
              .filter((b) => b.event_id === event_id)
              .filter((b) => (filterStatus ? b.status === filterStatus : true))
              .filter((b) => (filterSlot ? (b as Record<string, unknown>).slot_id === filterSlot : true))
              .map((b) => {
                const s = (state.slots ?? []).find((x) => x.id === (b as Record<string, unknown>).slot_id);
                const f = (state.friends ?? []).find((x) => x.id === (b as Record<string, unknown>).friend_id);
                return {
                  ...b,
                  slot_starts_at: s?.starts_at ?? null,
                  slot_ends_at: s?.ends_at ?? null,
                  friend_display_name: (f as { display_name?: string } | undefined)?.display_name ?? null,
                  friend_line_user_id: f?.line_user_id ?? null,
                };
              });
            return { results: items as unknown as T[] };
          }
          // LIFF history JOIN: FROM event_bookings b JOIN events e JOIN event_slots s
          if (sql.includes('FROM event_bookings b') && sql.includes('event_name')) {
            const [friend_id, account_id, nowIso] = bound as [string, string, string];
            const isUpcoming = sql.includes("status IN ('requested','confirmed')\n            AND s.starts_at >=");
            const items = (state.bookings ?? [])
              .filter((b) => {
                const r = b as Record<string, unknown>;
                return r.friend_id === friend_id && r.line_account_id === account_id;
              })
              .map((b) => {
                const e = state.events.find((x) => x.id === b.event_id);
                const s = (state.slots ?? []).find((x) => x.id === (b as Record<string, unknown>).slot_id);
                if (!e || !s) return null;
                return {
                  id: b.id,
                  status: b.status,
                  customer_note: (b as Record<string, unknown>).customer_note ?? null,
                  requested_at: null,
                  decided_at: null,
                  cancelled_at: null,
                  event_name: e.name,
                  event_image_url: e.image_url,
                  venue_name: e.venue_name,
                  venue_url: e.venue_url,
                  cancel_deadline_hours_before: e.cancel_deadline_hours_before,
                  slot_starts_at: s.starts_at,
                  slot_ends_at: s.ends_at,
                };
              })
              .filter((r): r is NonNullable<typeof r> => r !== null)
              .filter((r) => {
                const isActive = r.status === 'requested' || r.status === 'confirmed';
                if (isUpcoming) return isActive && r.slot_starts_at >= nowIso;
                return !isActive || r.slot_starts_at < nowIso;
              })
              .sort((a, b) =>
                isUpcoming
                  ? a.slot_starts_at.localeCompare(b.slot_starts_at)
                  : b.slot_starts_at.localeCompare(a.slot_starts_at),
              );
            return { results: items as unknown as T[] };
          }
          // admin slots list: SELECT s.*, COUNT(...) AS active_count FROM event_slots s
          if (sql.includes('FROM event_slots s')) {
            const [event_id] = bound as [string];
            const items = (state.slots ?? [])
              .filter((s) => s.event_id === event_id && s.deleted_at == null)
              .map((s) => {
                const active_count = (state.bookings ?? []).filter(
                  (b) => (b as BookingRow & { slot_id?: string }).slot_id === s.id && (b.status === 'requested' || b.status === 'confirmed'),
                ).length;
                return { ...s, active_count };
              })
              .sort((a, b) =>
                a.sort_order !== b.sort_order
                  ? a.sort_order - b.sort_order
                  : a.starts_at.localeCompare(b.starts_at),
              );
            return { results: items as unknown as T[] };
          }
          return { results: [] };
        },
        async run() {
          if (sql.startsWith('UPDATE event_bookings') && sql.includes('internal_note = COALESCE')) {
            // reject reason append
            const [appended, _updated_at, id] = bound as [string, string, string];
            const b = (state.bookings ?? []).find((x) => x.id === id);
            if (!b) return { success: true, meta: { changes: 0 } };
            const cur = (b as Record<string, unknown>).internal_note as string | null;
            (b as Record<string, unknown>).internal_note = (cur ? cur + '\n' : '') + appended;
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE event_bookings') && sql.includes('decided_at = ?, decided_by_staff_id')) {
            // decide
            const [next, decided_at, decided_by, _updated_at, id] = bound as [string, string, string | null, string, string];
            const b = (state.bookings ?? []).find((x) => x.id === id);
            if (!b) return { success: true, meta: { changes: 0 } };
            b.status = next;
            (b as Record<string, unknown>).decided_at = decided_at;
            (b as Record<string, unknown>).decided_by_staff_id = decided_by;
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE event_bookings') && sql.includes("status = 'cancelled'")) {
            // admin or friend cancel
            const isFriend = sql.includes("cancelled_by = 'friend'");
            const [cancelled_at, _updated_at, id] = bound as [string, string, string];
            const b = (state.bookings ?? []).find((x) => x.id === id);
            if (!b) return { success: true, meta: { changes: 0 } };
            b.status = 'cancelled';
            (b as Record<string, unknown>).cancelled_at = cancelled_at;
            (b as Record<string, unknown>).cancelled_by = isFriend ? 'friend' : 'admin';
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE event_bookings SET ')) {
            // generic PUT — conditional on (id, expected status)
            // bound = [...setValues, id, expectedStatus]
            const expectedStatus = bound[bound.length - 1] as string;
            const id = bound[bound.length - 2] as string;
            const b = (state.bookings ?? []).find((x) => x.id === id);
            if (!b) return { success: true, meta: { changes: 0 } };
            if (b.status !== expectedStatus) return { success: true, meta: { changes: 0 } };
            const setPart = sql.substring('UPDATE event_bookings SET '.length, sql.indexOf(' WHERE'));
            const cols = setPart.split(',').map((x) => x.trim());
            let valIdx = 0;
            for (const col of cols) {
              const m = /^(\w+)\s*=\s*(\?|strftime)/.exec(col);
              if (!m) continue;
              const colName = m[1];
              if (m[2] === '?') {
                if (colName === 'status') b.status = bound[valIdx] as string;
                else (b as Record<string, unknown>)[colName] = bound[valIdx];
                valIdx++;
              }
            }
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('INSERT INTO event_bookings')) {
            const [
              id, line_account_id, event_id, slot_id, friend_id, status, customer_note, _requested_at, identity_key,
            ] = bound as [string, string, string, string, string, string, string | null, string, string | undefined];
            (state.bookings ?? []).push({
              id, event_id, status,
              slot_id, friend_id,
              line_account_id,
              customer_note,
              identity_key,
            } as BookingRow & Record<string, unknown>);
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('INSERT INTO event_slots')) {
            const [
              id, event_id, starts_at, ends_at, capacity, is_active, sort_order,
            ] = bound as [string, string, string, string, number | null, number, number];
            (state.slots ?? []).push({
              id, event_id, starts_at, ends_at, capacity,
              is_active, sort_order, deleted_at: null,
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE event_slots SET deleted_at')) {
            const [deleted_at, _updated, id] = bound as [string, string, string];
            const s = (state.slots ?? []).find((x) => x.id === id);
            if (!s) return { success: true, meta: { changes: 0 } };
            s.deleted_at = deleted_at;
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE event_slots SET ')) {
            const id = bound[bound.length - 1] as string;
            const s = (state.slots ?? []).find((x) => x.id === id);
            if (!s) return { success: true, meta: { changes: 0 } };
            const setPart = sql.substring('UPDATE event_slots SET '.length, sql.indexOf(' WHERE'));
            const cols = setPart.split(',').map((x) => x.trim());
            let valIdx = 0;
            for (const col of cols) {
              const m = /^(\w+)\s*=\s*(\?|strftime)/.exec(col);
              if (!m) continue;
              const colName = m[1];
              if (m[2] === '?') {
                (s as Record<string, unknown>)[colName] = bound[valIdx];
                valIdx++;
              }
            }
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('INSERT INTO events')) {
            const [
              id, line_account_id, name, venue_name, venue_url, image_url,
              description, description_centered,
              max_bookings_per_friend, requires_approval, cancel_deadline_hours_before,
              reminder_day_before_enabled, reminder_hours_before,
              is_published, sort_order,
              target_type, account_ids, dedup_priority,
            ] = bound as [
              string, string, string, string | null, string | null, string | null,
              string | null, number,
              number | null, number, number | null,
              number, number | null,
              number, number,
              string, string | null, string | null,
            ];
            const now = new Date().toISOString();
            state.events.push({
              id,
              line_account_id,
              name,
              venue_name,
              venue_url,
              image_url,
              description,
              description_centered,
              max_bookings_per_friend,
              requires_approval,
              cancel_deadline_hours_before,
              reminder_day_before_enabled,
              reminder_hours_before,
              is_published,
              folder_id: null,
              sort_order,
              deleted_at: null,
              created_at: now,
              updated_at: now,
              target_type: target_type as 'single' | 'multi-account-dedup',
              account_ids,
              dedup_priority,
            });
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE events SET deleted_at')) {
            // 認可は handler 内で ownsEvent 経由で済んでいるので、ここでは
            // id + deleted_at IS NULL のみで一致させる。
            const [deleted_at, updated_at, id] = bound as [
              string, string, string,
            ];
            const e = state.events.find(
              (x) => x.id === id && x.deleted_at == null,
            );
            if (!e) return { success: true, meta: { changes: 0 } };
            e.deleted_at = deleted_at;
            e.updated_at = updated_at;
            return { success: true, meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE events SET ')) {
            // Generic field update — parse SET ... WHERE id = ?
            const id = bound[bound.length - 1] as string;
            const e = state.events.find((x) => x.id === id);
            if (!e) return { success: true, meta: { changes: 0 } };
            // Extract column list from SET clause
            const setPart = sql.substring('UPDATE events SET '.length, sql.indexOf(' WHERE'));
            const cols = setPart.split(',').map((s) => s.trim());
            let valIdx = 0;
            for (const col of cols) {
              const m = /^(\w+)\s*=\s*(\?|strftime)/.exec(col);
              if (!m) continue;
              const colName = m[1];
              if (m[2] === '?') {
                (e as Record<string, unknown>)[colName] = bound[valIdx];
                valIdx++;
              } else {
                e.updated_at = new Date().toISOString();
              }
            }
            return { success: true, meta: { changes: 1 } };
          }
          return { success: true, meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return db;
}

function setupApp(state: { events: EventRow[]; slots?: SlotRow[]; bookings?: BookingRow[] }) {
  const app = new Hono<TestEnv>();
  const db = makeEventDb(state);
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', role: 'owner' });
    c.env = { DB: db } as TestEnv['Bindings'];
    await next();
  });
  app.route('/', events);
  return app;
}

beforeEach(() => {
  for (const fn of Object.values(availabilityMocks)) fn.mockReset();
  for (const fn of Object.values(liffAuthMocks)) fn.mockReset();
  liffAuthMocks.verifyCallerLineUserId.mockResolvedValue(null);
  for (const fn of Object.values(idempotencyMocks)) fn.mockReset();
  for (const fn of Object.values(reminderMocks)) fn.mockReset();
  for (const fn of Object.values(notifierMocks)) fn.mockReset();
  reminderMocks.computeRemindersForBooking.mockReturnValue([]);
});

describe('POST /api/events/admin/events', () => {
  test('creates an event with required fields and defaults', async () => {
    const state = { events: [] as EventRow[] };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'AAA説明会' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as EventRow;
    expect(body.name).toBe('AAA説明会');
    expect(body.line_account_id).toBe('la1');
    expect(body.is_published).toBe(0);
    expect(body.requires_approval).toBe(0);
    expect(body.reminder_day_before_enabled).toBe(1);
    expect(state.events).toHaveLength(1);
  });

  test('honors provided fields', async () => {
    const state = { events: [] as EventRow[] };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'X',
        venue_name: '渋谷',
        venue_url: 'https://example.com',
        description: 'hello',
        description_centered: 1,
        max_bookings_per_friend: 1,
        requires_approval: 1,
        cancel_deadline_hours_before: 12,
        reminder_day_before_enabled: 0,
        reminder_hours_before: 2,
        is_published: 1,
        sort_order: 5,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as EventRow;
    expect(body.requires_approval).toBe(1);
    expect(body.cancel_deadline_hours_before).toBe(12);
    expect(body.is_published).toBe(1);
  });

  test('400 when account_id missing', async () => {
    const app = setupApp({ events: [] });
    const res = await app.request('/api/events/admin/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    expect(res.status).toBe(400);
  });

  test('422 when name empty', async () => {
    const app = setupApp({ events: [] });
    const res = await app.request('/api/events/admin/events?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_name');
  });

  test('422 when name >255', async () => {
    const app = setupApp({ events: [] });
    const res = await app.request('/api/events/admin/events?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'a'.repeat(256) }),
    });
    expect(res.status).toBe(422);
  });

  test('422 when description >20000', async () => {
    const app = setupApp({ events: [] });
    const res = await app.request('/api/events/admin/events?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X', description: 'a'.repeat(20001) }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_description');
  });

  test('422 when requires_approval is not 0/1', async () => {
    const app = setupApp({ events: [] });
    const res = await app.request('/api/events/admin/events?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X', requires_approval: 2 }),
    });
    expect(res.status).toBe(422);
  });

  test('422 when cancel_deadline_hours_before is negative', async () => {
    const app = setupApp({ events: [] });
    const res = await app.request('/api/events/admin/events?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X', cancel_deadline_hours_before: -1 }),
    });
    expect(res.status).toBe(422);
  });

  test('multi-account-dedup creates event with account_ids JSON', async () => {
    const state = { events: [] as EventRow[] };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'X',
        target_type: 'multi-account-dedup',
        account_ids: ['la1', 'la2'],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as EventRow;
    expect(body.target_type).toBe('multi-account-dedup');
    expect(typeof body.account_ids === 'string' ? JSON.parse(body.account_ids) : body.account_ids).toEqual(['la1', 'la2']);
    // sentinel: line_account_id = account_ids[0]
    expect(body.line_account_id).toBe('la1');
  });

  test('422 invalid_target_type', async () => {
    const app = setupApp({ events: [] });
    const res = await app.request('/api/events/admin/events?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X', target_type: 'bogus' }),
    });
    expect(res.status).toBe(422);
  });

  test('422 multi-account-dedup with empty account_ids', async () => {
    const app = setupApp({ events: [] });
    const res = await app.request('/api/events/admin/events?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'X', target_type: 'multi-account-dedup', account_ids: [] }),
    });
    expect(res.status).toBe(422);
  });
});

describe('GET /api/events/admin/events', () => {
  test('lists events scoped to account', async () => {
    const state = {
      events: [
        baseEvent({ id: 'e1', line_account_id: 'la1', name: 'A' }),
        baseEvent({ id: 'e2', line_account_id: 'la1', name: 'B' }),
        baseEvent({ id: 'e3', line_account_id: 'la2', name: 'C' }),
      ],
      slots: [],
      bookings: [],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events?account_id=la1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: EventRow[] };
    expect(body.items).toHaveLength(2);
    expect(body.items.map((e) => e.id).sort()).toEqual(['e1', 'e2']);
  });

  test('lists includes multi-account event when account in account_ids', async () => {
    const state = {
      events: [
        baseEvent({ id: 'e1', line_account_id: 'la1', target_type: 'single', name: 'A' }),
        baseEvent({
          id: 'e2',
          line_account_id: 'la2',
          target_type: 'multi-account-dedup',
          account_ids: JSON.stringify(['la2', 'la1', 'la3']),
          name: 'B',
        }),
        baseEvent({
          id: 'e3',
          line_account_id: 'la3',
          target_type: 'multi-account-dedup',
          account_ids: JSON.stringify(['la3']),
          name: 'C',
        }),
      ],
      slots: [],
      bookings: [],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events?account_id=la1');
    const body = (await res.json()) as { items: EventRow[] };
    expect(body.items.map((x) => x.id).sort()).toEqual(['e1', 'e2']);
  });

  test('hides soft-deleted events', async () => {
    const state = {
      events: [
        baseEvent({ id: 'e1', line_account_id: 'la1', deleted_at: '2026-05-01T00:00:00Z' }),
        baseEvent({ id: 'e2', line_account_id: 'la1' }),
      ],
      slots: [],
      bookings: [],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events?account_id=la1');
    const body = (await res.json()) as { items: EventRow[] };
    expect(body.items.map((e) => e.id)).toEqual(['e2']);
  });

  test('returns aggregate columns for each item', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1' })],
      slots: [
        { id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: 5, is_active: 1, sort_order: 0, deleted_at: null },
        { id: 's2', event_id: 'e1', starts_at: '2099-06-02T10:00:00Z', ends_at: '2099-06-02T12:00:00Z', capacity: 3, is_active: 1, sort_order: 1, deleted_at: null },
      ],
      bookings: [
        { id: 'b1', event_id: 'e1', status: 'requested' },
        { id: 'b2', event_id: 'e1', status: 'confirmed' },
        { id: 'b3', event_id: 'e1', status: 'cancelled' },
      ],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events?account_id=la1');
    const body = (await res.json()) as { items: Array<EventRow & { next_slot_starts_at: string | null; total_capacity: number | null; total_active: number; pending_count: number }> };
    const e = body.items[0];
    expect(e.next_slot_starts_at).toBe('2099-06-01T10:00:00Z');
    expect(e.total_capacity).toBe(8);
    expect(e.total_active).toBe(2);
    expect(e.pending_count).toBe(1);
  });
});

describe('GET /api/events/admin/events/:id', () => {
  test('returns event when account matches', async () => {
    const state = { events: [baseEvent({ id: 'e1', line_account_id: 'la1' })] };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1?account_id=la1');
    expect(res.status).toBe(200);
  });

  test('404 when event belongs to other account', async () => {
    const state = { events: [baseEvent({ id: 'e1', line_account_id: 'la2' })] };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1?account_id=la1');
    expect(res.status).toBe(404);
  });
});

describe('PUT /api/events/admin/events/:id', () => {
  test('updates only provided fields', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', name: 'old', requires_approval: 0 })],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1?account_id=la1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'new', requires_approval: 1 }),
    });
    expect(res.status).toBe(200);
    expect(state.events[0].name).toBe('new');
    expect(state.events[0].requires_approval).toBe(1);
  });

  test('404 for cross-account update', async () => {
    const state = { events: [baseEvent({ id: 'e1', line_account_id: 'la2' })] };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1?account_id=la1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    });
    expect(res.status).toBe(404);
  });

  test('422 invalid description', async () => {
    const state = { events: [baseEvent({ id: 'e1', line_account_id: 'la1' })] };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1?account_id=la1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description: 'x'.repeat(20001) }),
    });
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/events/admin/events/:id', () => {
  test('soft deletes', async () => {
    const state = { events: [baseEvent({ id: 'e1', line_account_id: 'la1' })] };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1?account_id=la1', {
      method: 'DELETE',
    });
    expect(res.status).toBe(204);
    expect(state.events[0].deleted_at).not.toBeNull();
  });

  test('404 for cross-account', async () => {
    const state = { events: [baseEvent({ id: 'e1', line_account_id: 'la2' })] };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1?account_id=la1', {
      method: 'DELETE',
    });
    expect(res.status).toBe(404);
  });
});

describe('event_slots admin', () => {
  test('GET /:id/slots returns slots with active_count', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1' })],
      slots: [
        { id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: 5, is_active: 1, sort_order: 0, deleted_at: null },
        { id: 's2', event_id: 'e1', starts_at: '2099-06-02T10:00:00Z', ends_at: '2099-06-02T12:00:00Z', capacity: null, is_active: 1, sort_order: 1, deleted_at: null },
      ],
      bookings: [
        { id: 'b1', event_id: 'e1', slot_id: 's1', status: 'confirmed' },
      ],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/slots?account_id=la1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<SlotRow & { active_count: number }> };
    expect(body.items).toHaveLength(2);
    expect(body.items[0].id).toBe('s1');
    expect(body.items[0].active_count).toBe(1);
    expect(body.items[1].active_count).toBe(0);
  });

  test('GET 404 for cross-account event', async () => {
    const state = { events: [baseEvent({ id: 'e1', line_account_id: 'la2' })] };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/slots?account_id=la1');
    expect(res.status).toBe(404);
  });

  test('POST creates multiple slots', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1' })],
      slots: [] as SlotRow[],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/slots?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slots: [
          { starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: 5 },
          { starts_at: '2099-06-02T10:00:00Z', ends_at: '2099-06-02T12:00:00Z', capacity: null },
        ],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { items: SlotRow[] };
    expect(body.items).toHaveLength(2);
    expect(state.slots).toHaveLength(2);
  });

  test('POST 422 when slots empty', async () => {
    const state = { events: [baseEvent({ id: 'e1', line_account_id: 'la1' })], slots: [] };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/slots?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slots: [] }),
    });
    expect(res.status).toBe(422);
  });

  test('POST 422 when starts_at >= ends_at', async () => {
    const state = { events: [baseEvent({ id: 'e1', line_account_id: 'la1' })], slots: [] };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/slots?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slots: [{ starts_at: '2099-06-01T12:00:00Z', ends_at: '2099-06-01T10:00:00Z' }],
      }),
    });
    expect(res.status).toBe(422);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_slot_range');
  });

  test('POST 422 when capacity invalid', async () => {
    const state = { events: [baseEvent({ id: 'e1', line_account_id: 'la1' })], slots: [] };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/slots?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        slots: [{ starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: 0 }],
      }),
    });
    expect(res.status).toBe(422);
  });

  test('PUT updates slot fields', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1' })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: 5, is_active: 1, sort_order: 0, deleted_at: null }],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/slots/s1?account_id=la1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ capacity: 10, is_active: 0 }),
    });
    expect(res.status).toBe(200);
    expect(state.slots[0].capacity).toBe(10);
    expect(state.slots[0].is_active).toBe(0);
  });

  test('PUT 422 when range becomes invalid (only ends_at provided)', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1' })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: 5, is_active: 1, sort_order: 0, deleted_at: null }],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/slots/s1?account_id=la1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ends_at: '2099-06-01T09:00:00Z' }),
    });
    expect(res.status).toBe(422);
  });

  test('DELETE soft-deletes when no active bookings', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1' })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: 5, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/slots/s1?account_id=la1', {
      method: 'DELETE',
    });
    expect(res.status).toBe(204);
    expect(state.slots[0].deleted_at).not.toBeNull();
  });

  test('DELETE 409 when active bookings exist', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1' })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: 5, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [{ id: 'b1', event_id: 'e1', slot_id: 's1', status: 'confirmed' }],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/slots/s1?account_id=la1', {
      method: 'DELETE',
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('slot_has_bookings');
    expect(state.slots[0].deleted_at).toBeNull();
  });

  test('DELETE 204 when only cancelled bookings exist', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1' })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: 5, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [{ id: 'b1', event_id: 'e1', slot_id: 's1', status: 'cancelled' }],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/slots/s1?account_id=la1', {
      method: 'DELETE',
    });
    expect(res.status).toBe(204);
  });
});

describe('LIFF event detail', () => {
  test('GET returns published event', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1 })],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
    };
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1?liffId=L1');
    expect(res.status).toBe(200);
  });

  test('GET 404 when not published', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 0 })],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
    };
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1?liffId=L1');
    expect(res.status).toBe(404);
  });

  test('GET 404 when soft-deleted', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1, deleted_at: '2026-05-01T00:00:00Z' })],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
    };
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1?liffId=L1');
    expect(res.status).toBe(404);
  });

  test('GET 400 when liffId missing', async () => {
    const state = { events: [], accounts: [] };
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1');
    expect(res.status).toBe(400);
  });

  test('GET 400 when liffId not resolvable', async () => {
    const state = { events: [], accounts: [] };
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1?liffId=unknown');
    expect(res.status).toBe(400);
  });

  test('GET 404 when event belongs to another account (cross-tenant block)', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la2', is_published: 1 })],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
    };
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1?liffId=L1');
    expect(res.status).toBe(404);
  });

  test('GET multi-account event 404 when caller account not in account_ids', async () => {
    const state = {
      events: [
        baseEvent({
          id: 'e1',
          line_account_id: 'la2',
          target_type: 'multi-account-dedup',
          account_ids: JSON.stringify(['la2', 'la3']),
          is_published: 1,
        }),
      ],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
    };
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1?liffId=L1');
    expect(res.status).toBe(404);
  });

  test('GET multi-account event 200 when caller account in account_ids', async () => {
    const state = {
      events: [
        baseEvent({
          id: 'e1',
          line_account_id: 'la1',
          target_type: 'multi-account-dedup',
          account_ids: JSON.stringify(['la1', 'la2']),
          is_published: 1,
        }),
      ],
      accounts: [{ id: 'la2', liff_id: 'L2', is_active: 1 }],
    };
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1?liffId=L2');
    expect(res.status).toBe(200);
  });

  test('GET includes my_existing_booking when friend already has active booking', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1 })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [
        { id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'confirmed', identity_key: 'uid:U1-uuid' } as BookingRow & Record<string, unknown>,
      ],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1', user_id: 'U1-uuid' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1?liffId=L1', {
      headers: { 'Authorization': 'Bearer t' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { my_existing_booking: { id: string; status: string } | null };
    expect(body.my_existing_booking?.id).toBe('b1');
    expect(body.my_existing_booking?.status).toBe('confirmed');
  });

  test('GET my_existing_booking is null when caller has no booking', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1 })],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1', user_id: 'U1-uuid' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1?liffId=L1', {
      headers: { 'Authorization': 'Bearer t' },
    });
    const body = (await res.json()) as { my_existing_booking: null };
    expect(body.my_existing_booking).toBeNull();
  });
});

describe('LIFF event slots', () => {
  test('GET returns slots from getSlotsWithRemaining', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1 })],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
    };
    availabilityMocks.getSlotsWithRemaining.mockResolvedValue([
      { id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: 5, is_active: 1, sort_order: 0, active_count: 1, remaining: 4 },
    ]);
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1/slots?liffId=L1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string; remaining: number }> };
    expect(body.items[0].remaining).toBe(4);
    expect(availabilityMocks.getSlotsWithRemaining).toHaveBeenCalledWith(
      expect.anything(),
      'e1',
      { only_active: true, only_future: true },
    );
  });

  test('GET 404 when event not published', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 0 })],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
    };
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1/slots?liffId=L1');
    expect(res.status).toBe(404);
    expect(availabilityMocks.getSlotsWithRemaining).not.toHaveBeenCalled();
  });
});

describe('LIFF POST /api/liff/events/:id/bookings', () => {
  test('creates confirmed booking when requires_approval=0', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1, requires_approval: 0 })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: 5, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1, channel_access_token: 'tok' }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    idempotencyMocks.reserveEventIdempotency.mockResolvedValue({ kind: 'inserted' });
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1/bookings?liffId=L1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'k1', 'Authorization': 'Bearer t' },
      body: JSON.stringify({ slot_id: 's1' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; status: string };
    expect(body.status).toBe('confirmed');
    expect(state.bookings).toHaveLength(1);
    expect(reminderMocks.computeRemindersForBooking).toHaveBeenCalled();
    expect(notifierMocks.sendEventBookingNotification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'received_confirmed' }),
    );
    expect(idempotencyMocks.finalizeEventIdempotencyResponse).toHaveBeenCalled();
  });

  test('creates requested booking when requires_approval=1', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1, requires_approval: 1 })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1, channel_access_token: 'tok' }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    idempotencyMocks.reserveEventIdempotency.mockResolvedValue({ kind: 'inserted' });
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1/bookings?liffId=L1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'k1', 'Authorization': 'Bearer t' },
      body: JSON.stringify({ slot_id: 's1' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('requested');
    expect(reminderMocks.computeRemindersForBooking).not.toHaveBeenCalled();
    expect(notifierMocks.sendEventBookingNotification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'received_pending' }),
    );
  });

  test('returns idempotent cached response on repeat', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1 })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: 5, is_active: 1, sort_order: 0, deleted_at: null }],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1, channel_access_token: 'tok' }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    idempotencyMocks.reserveEventIdempotency.mockResolvedValue({ kind: 'cached', status: 201, body: { id: 'cached', status: 'confirmed' } });
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1/bookings?liffId=L1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'k1', 'Authorization': 'Bearer t' },
      body: JSON.stringify({ slot_id: 's1' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('cached');
  });

  test('401 when Authorization missing', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1 })],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue(null);
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1/bookings?liffId=L1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'k1' },
      body: JSON.stringify({ slot_id: 's1' }),
    });
    expect(res.status).toBe(401);
  });

  test('400 when Idempotency-Key missing', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1 })],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
    };
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1/bookings?liffId=L1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Authorization': 'Bearer t' },
      body: JSON.stringify({ slot_id: 's1' }),
    });
    expect(res.status).toBe(400);
  });

  test('409 slot_full when capacity reached', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1 })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: 1, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [{ id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'fx', status: 'confirmed' } as BookingRow],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    idempotencyMocks.reserveEventIdempotency.mockResolvedValue({ kind: 'inserted' });
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1/bookings?liffId=L1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'k1', 'Authorization': 'Bearer t' },
      body: JSON.stringify({ slot_id: 's1' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('slot_full');
  });

  test('409 over_friend_limit when max_bookings_per_friend (>1) reached', async () => {
    // max=2 で同一 identity_key の既存 2 件 → 3 件目で over_friend_limit
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1, max_bookings_per_friend: 2 })],
      slots: [
        { id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: null, is_active: 1, sort_order: 0, deleted_at: null },
        { id: 's2', event_id: 'e1', starts_at: '2099-06-02T10:00:00Z', ends_at: '2099-06-02T12:00:00Z', capacity: null, is_active: 1, sort_order: 1, deleted_at: null },
      ],
      bookings: [
        { id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'confirmed', identity_key: 'uid:U1-uuid' } as BookingRow & Record<string, unknown>,
        { id: 'b2', event_id: 'e1', slot_id: 's2', friend_id: 'f1', line_account_id: 'la1', status: 'confirmed', identity_key: 'uid:U1-uuid' } as BookingRow & Record<string, unknown>,
      ],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1', user_id: 'U1-uuid' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    idempotencyMocks.reserveEventIdempotency.mockResolvedValue({ kind: 'inserted' });
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1/bookings?liffId=L1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'k1', 'Authorization': 'Bearer t' },
      body: JSON.stringify({ slot_id: 's1' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('over_friend_limit');
  });

  test('410 slot_started for past slot', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1 })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2000-01-01T00:00:00Z', ends_at: '2000-01-01T02:00:00Z', capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    idempotencyMocks.reserveEventIdempotency.mockResolvedValue({ kind: 'inserted' });
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1/bookings?liffId=L1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'k1', 'Authorization': 'Bearer t' },
      body: JSON.stringify({ slot_id: 's1' }),
    });
    expect(res.status).toBe(410);
  });

  test('422 customer_note over 5000 chars', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1 })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    idempotencyMocks.reserveEventIdempotency.mockResolvedValue({ kind: 'inserted' });
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1/bookings?liffId=L1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'k1', 'Authorization': 'Bearer t' },
      body: JSON.stringify({ slot_id: 's1', customer_note: 'a'.repeat(5001) }),
    });
    expect(res.status).toBe(422);
  });

  test('409 duplicate_friend_booking when same identity_key already booked (cross-account)', async () => {
    const state = {
      events: [
        baseEvent({
          id: 'e1',
          line_account_id: 'la1',
          target_type: 'multi-account-dedup',
          account_ids: JSON.stringify(['la1', 'la2']),
          // max=null は「制限なし」。重複検知を働かせるには 1 を明示する。
          max_bookings_per_friend: 1,
          is_published: 1,
        }),
      ],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [
        // 同一人物 (uid:U1-uuid) が別アカ la2 経由で既予約
        { id: 'b-old', event_id: 'e1', slot_id: 's1', friend_id: 'f-la2', line_account_id: 'la2', status: 'confirmed', identity_key: 'uid:U1-uuid' } as BookingRow & Record<string, unknown>,
      ],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1, channel_access_token: 'tok' }],
      friends: [{ id: 'f-la1', line_account_id: 'la1', line_user_id: 'U1', user_id: 'U1-uuid' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    idempotencyMocks.reserveEventIdempotency.mockResolvedValue({ kind: 'inserted' });
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/e1/bookings?liffId=L1', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': 'k1', 'Authorization': 'Bearer t' },
      body: JSON.stringify({ slot_id: 's1' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; existing?: { id: string } };
    expect(body.error).toBe('duplicate_friend_booking');
    expect(body.existing?.id).toBe('b-old');
  });
});

describe('LIFF GET /api/liff/events/me', () => {
  test('upcoming returns only active future bookings', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1, name: 'X' })],
      slots: [
        { id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: null, is_active: 1, sort_order: 0, deleted_at: null },
        { id: 's2', event_id: 'e1', starts_at: '2000-01-01T10:00:00Z', ends_at: '2000-01-01T12:00:00Z', capacity: null, is_active: 1, sort_order: 1, deleted_at: null },
      ],
      bookings: [
        { id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'confirmed' } as BookingRow & Record<string, unknown>,
        { id: 'b2', event_id: 'e1', slot_id: 's2', friend_id: 'f1', line_account_id: 'la1', status: 'confirmed' } as BookingRow & Record<string, unknown>,
        { id: 'b3', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'cancelled' } as BookingRow & Record<string, unknown>,
      ],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/me?liffId=L1&tab=upcoming', {
      headers: { 'Authorization': 'Bearer t' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items.map((x) => x.id)).toEqual(['b1']);
  });

  test('past returns cancelled and past confirmed', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1 })],
      slots: [
        { id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: null, is_active: 1, sort_order: 0, deleted_at: null },
        { id: 's2', event_id: 'e1', starts_at: '2000-01-01T10:00:00Z', ends_at: '2000-01-01T12:00:00Z', capacity: null, is_active: 1, sort_order: 1, deleted_at: null },
      ],
      bookings: [
        { id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'confirmed' } as BookingRow & Record<string, unknown>,
        { id: 'b2', event_id: 'e1', slot_id: 's2', friend_id: 'f1', line_account_id: 'la1', status: 'confirmed' } as BookingRow & Record<string, unknown>,
        { id: 'b3', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'cancelled' } as BookingRow & Record<string, unknown>,
      ],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/me?liffId=L1&tab=past', {
      headers: { 'Authorization': 'Bearer t' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items.map((x) => x.id).sort()).toEqual(['b2', 'b3']);
  });

  test('returns empty when friend not registered', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1 })],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
      friends: [],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/me?liffId=L1', {
      headers: { 'Authorization': 'Bearer t' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  test('401 unauthorized', async () => {
    const state = { events: [], accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }] };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue(null);
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/me?liffId=L1');
    expect(res.status).toBe(401);
  });
});

describe('LIFF GET /api/liff/events/me/:bookingId', () => {
  test('returns booking detail for owner friend', async () => {
    const futureMs = Date.now() + 7 * 24 * 3600_000;
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1, name: 'テストイベント' })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: new Date(futureMs).toISOString(), ends_at: new Date(futureMs + 7200_000).toISOString(), capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [{ id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'confirmed' } as BookingRow & Record<string, unknown>],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/me/b1?liffId=L1', {
      headers: { 'Authorization': 'Bearer t' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; event_name: string };
    expect(body.id).toBe('b1');
    expect(body.event_name).toBe('テストイベント');
  });

  test('404 for cross-friend booking access', async () => {
    const futureMs = Date.now() + 7 * 24 * 3600_000;
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1 })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: new Date(futureMs).toISOString(), ends_at: new Date(futureMs + 7200_000).toISOString(), capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [{ id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f2', line_account_id: 'la1', status: 'confirmed' } as BookingRow & Record<string, unknown>],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/me/b1?liffId=L1', {
      headers: { 'Authorization': 'Bearer t' },
    });
    expect(res.status).toBe(404);
  });

  test('404 for non-existent booking id', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1 })],
      slots: [],
      bookings: [],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/me/nonexistent?liffId=L1', {
      headers: { 'Authorization': 'Bearer t' },
    });
    expect(res.status).toBe(404);
  });

  test('401 unauthorized', async () => {
    const state = { events: [], accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }] };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue(null);
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/me/b1?liffId=L1');
    expect(res.status).toBe(401);
  });
});

describe('LIFF POST /api/liff/events/me/:bookingId/cancel', () => {
  test('cancels confirmed booking when within deadline', async () => {
    const futureMs = Date.now() + 7 * 24 * 3600_000;
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1, cancel_deadline_hours_before: 24 })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: new Date(futureMs).toISOString(), ends_at: new Date(futureMs + 7200_000).toISOString(), capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [{ id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'confirmed' } as BookingRow & Record<string, unknown>],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/me/b1/cancel?liffId=L1', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer t' },
    });
    expect(res.status).toBe(200);
    expect(state.bookings[0].status).toBe('cancelled');
    expect(reminderMocks.cancelPendingRemindersFor).toHaveBeenCalledWith(expect.anything(), 'b1');
  });

  test('403 cancel_not_allowed when cancel_deadline_hours_before is null', async () => {
    const futureMs = Date.now() + 7 * 24 * 3600_000;
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1, cancel_deadline_hours_before: null })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: new Date(futureMs).toISOString(), ends_at: new Date(futureMs + 7200_000).toISOString(), capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [{ id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'confirmed' } as BookingRow & Record<string, unknown>],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/me/b1/cancel?liffId=L1', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer t' },
    });
    expect(res.status).toBe(403);
  });

  test('409 cancel_deadline_passed when too late', async () => {
    const soonMs = Date.now() + 60_000; // 1 minute from now
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1, cancel_deadline_hours_before: 24 })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: new Date(soonMs).toISOString(), ends_at: new Date(soonMs + 7200_000).toISOString(), capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [{ id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'confirmed' } as BookingRow & Record<string, unknown>],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/me/b1/cancel?liffId=L1', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer t' },
    });
    expect(res.status).toBe(409);
  });

  test('409 invalid_state for already-cancelled booking', async () => {
    const futureMs = Date.now() + 7 * 24 * 3600_000;
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1, cancel_deadline_hours_before: 24 })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: new Date(futureMs).toISOString(), ends_at: new Date(futureMs + 7200_000).toISOString(), capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [{ id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'cancelled' } as BookingRow & Record<string, unknown>],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/me/b1/cancel?liffId=L1', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer t' },
    });
    expect(res.status).toBe(409);
  });

  test('404 cross-friend cancel', async () => {
    const futureMs = Date.now() + 7 * 24 * 3600_000;
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', is_published: 1, cancel_deadline_hours_before: 24 })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: new Date(futureMs).toISOString(), ends_at: new Date(futureMs + 7200_000).toISOString(), capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [{ id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f2', line_account_id: 'la1', status: 'confirmed' } as BookingRow & Record<string, unknown>],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1' }],
    };
    liffAuthMocks.verifyCallerLineUserId.mockResolvedValue('U1');
    const app = setupApp(state);
    const res = await app.request('/api/liff/events/me/b1/cancel?liffId=L1', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer t' },
    });
    expect(res.status).toBe(404);
  });
});

describe('admin bookings management', () => {
  test('GET /:id/bookings aggregates multi-account bookings with line_account_id', async () => {
    const state = {
      events: [
        baseEvent({
          id: 'e1',
          line_account_id: 'la1',
          target_type: 'multi-account-dedup',
          account_ids: JSON.stringify(['la1', 'la2']),
        }),
      ],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [
        { id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f-la1', line_account_id: 'la1', status: 'requested' } as BookingRow & Record<string, unknown>,
        { id: 'b2', event_id: 'e1', slot_id: 's1', friend_id: 'f-la2', line_account_id: 'la2', status: 'confirmed' } as BookingRow & Record<string, unknown>,
      ],
      friends: [
        { id: 'f-la1', line_account_id: 'la1', line_user_id: 'U1' },
        { id: 'f-la2', line_account_id: 'la2', line_user_id: 'U2' },
      ],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/bookings?account_id=la1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string; line_account_id: string }> };
    expect(body.items).toHaveLength(2);
    expect(body.items.map((x) => x.line_account_id).sort()).toEqual(['la1', 'la2']);
  });

  test('GET /:id/bookings filters by status and slot', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1' })],
      slots: [
        { id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: null, is_active: 1, sort_order: 0, deleted_at: null },
        { id: 's2', event_id: 'e1', starts_at: '2099-06-02T10:00:00Z', ends_at: '2099-06-02T12:00:00Z', capacity: null, is_active: 1, sort_order: 1, deleted_at: null },
      ],
      bookings: [
        { id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'requested' } as BookingRow & Record<string, unknown>,
        { id: 'b2', event_id: 'e1', slot_id: 's2', friend_id: 'f1', line_account_id: 'la1', status: 'confirmed' } as BookingRow & Record<string, unknown>,
        { id: 'b3', event_id: 'e1', slot_id: 's1', friend_id: 'f2', line_account_id: 'la1', status: 'cancelled' } as BookingRow & Record<string, unknown>,
      ],
      friends: [
        { id: 'f1', line_account_id: 'la1', line_user_id: 'U1' },
        { id: 'f2', line_account_id: 'la1', line_user_id: 'U2' },
      ],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/bookings?account_id=la1&status=requested');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ id: string }> };
    expect(body.items.map((x) => x.id)).toEqual(['b1']);
  });

  test('POST decide confirm transitions to confirmed and creates reminders', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1', reminder_day_before_enabled: 1, reminder_hours_before: 2 })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [{ id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'requested' } as BookingRow & Record<string, unknown>],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1, channel_access_token: 'tok' }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1' }],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/bookings/b1/decide?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    });
    expect(res.status).toBe(200);
    expect(state.bookings[0].status).toBe('confirmed');
    expect(reminderMocks.computeRemindersForBooking).toHaveBeenCalled();
    expect(notifierMocks.sendEventBookingNotification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'confirmed' }),
    );
  });

  test('POST decide reject transitions to rejected and appends reason to internal_note', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1' })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [{ id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'requested' } as BookingRow & Record<string, unknown>],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1, channel_access_token: 'tok' }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1' }],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/bookings/b1/decide?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'reject', reason: '定員満員' }),
    });
    expect(res.status).toBe(200);
    expect(state.bookings[0].status).toBe('rejected');
    expect((state.bookings[0] as Record<string, unknown>).internal_note).toContain('定員満員');
    expect(notifierMocks.sendEventBookingNotification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'rejected' }),
    );
  });

  test('POST decide returns 409 already_decided', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1' })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [{ id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'confirmed', decided_at: '2026-05-09T00:00:00Z' } as BookingRow & Record<string, unknown>],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1 }],
      friends: [],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/bookings/b1/decide?account_id=la1', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'confirm' }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('already_decided');
  });

  test('POST admin cancel transitions to cancelled by admin', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1' })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [{ id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'confirmed' } as BookingRow & Record<string, unknown>],
      accounts: [{ id: 'la1', liff_id: 'L1', is_active: 1, channel_access_token: 'tok' }],
      friends: [{ id: 'f1', line_account_id: 'la1', line_user_id: 'U1' }],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/bookings/b1/cancel?account_id=la1', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(state.bookings[0].status).toBe('cancelled');
    expect((state.bookings[0] as Record<string, unknown>).cancelled_by).toBe('admin');
    expect(reminderMocks.cancelPendingRemindersFor).toHaveBeenCalled();
    expect(notifierMocks.sendEventBookingNotification).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'cancelled_by_admin' }),
    );
  });

  test('PUT internal_note update', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1' })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [{ id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'requested' } as BookingRow & Record<string, unknown>],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/bookings/b1?account_id=la1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ internal_note: 'check VIP' }),
    });
    expect(res.status).toBe(200);
    expect((state.bookings[0] as Record<string, unknown>).internal_note).toBe('check VIP');
  });

  test('PUT status=attended transitions confirmed→attended', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1' })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [{ id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'confirmed' } as BookingRow & Record<string, unknown>],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/bookings/b1?account_id=la1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'attended' }),
    });
    expect(res.status).toBe(200);
    expect(state.bookings[0].status).toBe('attended');
  });

  test('PUT status=no_show on requested booking returns 409', async () => {
    const state = {
      events: [baseEvent({ id: 'e1', line_account_id: 'la1' })],
      slots: [{ id: 's1', event_id: 'e1', starts_at: '2099-06-01T10:00:00Z', ends_at: '2099-06-01T12:00:00Z', capacity: null, is_active: 1, sort_order: 0, deleted_at: null }],
      bookings: [{ id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'requested' } as BookingRow & Record<string, unknown>],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/e1/bookings/b1?account_id=la1', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'no_show' }),
    });
    expect(res.status).toBe(409);
  });

  test('GET notifications/pending counts requested across the account', async () => {
    const state = {
      events: [
        baseEvent({ id: 'e1', line_account_id: 'la1' }),
        baseEvent({ id: 'e2', line_account_id: 'la1' }),
        baseEvent({ id: 'e3', line_account_id: 'la2' }),
      ],
      bookings: [
        { id: 'b1', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'requested' } as BookingRow & Record<string, unknown>,
        { id: 'b2', event_id: 'e2', slot_id: 's2', friend_id: 'f1', line_account_id: 'la1', status: 'requested' } as BookingRow & Record<string, unknown>,
        { id: 'b3', event_id: 'e1', slot_id: 's1', friend_id: 'f1', line_account_id: 'la1', status: 'confirmed' } as BookingRow & Record<string, unknown>,
        { id: 'b4', event_id: 'e3', slot_id: 's3', friend_id: 'f3', line_account_id: 'la2', status: 'requested' } as BookingRow & Record<string, unknown>,
      ],
    };
    const app = setupApp(state);
    const res = await app.request('/api/events/admin/events/notifications/pending?account_id=la1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number };
    expect(body.count).toBe(2);
  });
});

function baseEvent(over: Partial<EventRow>): EventRow {
  const now = new Date().toISOString();
  return {
    id: 'e1',
    line_account_id: 'la1',
    name: 'X',
    venue_name: null,
    venue_url: null,
    image_url: null,
    description: null,
    description_centered: 0,
    max_bookings_per_friend: null,
    requires_approval: 0,
    cancel_deadline_hours_before: null,
    reminder_day_before_enabled: 1,
    reminder_hours_before: null,
    is_published: 0,
    folder_id: null,
    sort_order: 0,
    deleted_at: null,
    created_at: now,
    updated_at: now,
    target_type: 'single',
    account_ids: null,
    dedup_priority: null,
    ...over,
  };
}
