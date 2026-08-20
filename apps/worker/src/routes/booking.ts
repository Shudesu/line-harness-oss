// Booking feature HTTP routes.
//
// LIFF-facing endpoints live under /api/liff/booking/* (auth-bypassed by
// authMiddleware) and resolve the LINE account from the liffId query.
// Admin-facing endpoints live under /api/booking/admin/* and rely on the
// global authMiddleware for staff/owner authentication; they require an
// `account_id` query param to scope to a single LINE account.
//
// All UUIDs are generated via crypto.randomUUID(); UTC ISO timestamps for
// time-of-event columns (starts_at / ends_at / block_ends_at / requested_at /
// scheduled_at / decided_at / expires_at) are written from the Worker.

import { Hono, type Context } from 'hono';
import { getLineAccounts } from '@line-crm/db';
import type { Env } from '../index.js';
import { resolveCorsOrigin } from '../middleware/admin-auth-config.js';
import { canTransition, nextStatus, type BookingAction } from '../services/booking-state.js';
import { getAvailability } from '../services/availability.js';
import {
  removeBookingFromGoogle,
  syncConfirmedBookingToGoogle,
  verifyStaffCalendarConnection,
} from '../services/booking-calendar-sync.js';
import {
  findIdempotencyResponse,
  saveIdempotencyResponse,
} from '../services/booking-idempotency.js';
import { sendBookingNotification } from '../services/booking-notifier.js';
import { insertConfirmationReminders } from '../services/booking-confirm.js';
import { attachTagAndFireSideEffects } from '../services/friend-tag-attach.js';
import {
  DEFAULT_ACCOUNT_SETTINGS,
  IDEMPOTENCY_TTL_MINUTES,
  type BookingStatus,
} from '../services/booking-types.js';
import { awardActivityMileage } from '../services/activity-mileage.js';
import { GoogleCalendarClient } from '../services/google-calendar.js';
import {
  buildGoogleOAuthAuthorizationUrl,
  exchangeGoogleOAuthCode,
  googleOAuthConfigured,
  revokeGoogleOAuthToken,
  signGoogleOAuthState,
  verifyGoogleOAuthState,
} from '../services/google-oauth.js';

const booking = new Hono<Env>();
const GOOGLE_OAUTH_CALLBACK_PATH = '/api/booking/google-calendar/oauth/callback';
const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60_000;

function googleCredentials(env: Env['Bindings']) {
  return {
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    privateKey: env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
    oauthClientId: env.GOOGLE_OAUTH_CLIENT_ID,
    oauthClientSecret: env.GOOGLE_OAUTH_CLIENT_SECRET,
  };
}

function googleOAuthRedirectUri(requestUrl: string): string {
  return new URL(GOOGLE_OAUTH_CALLBACK_PATH, requestUrl).toString();
}

function adminCalendarReturnUrl(
  env: Env['Bindings'],
  staffId: string | null,
  result: 'connected' | 'denied' | 'error',
  adminOrigin?: string,
): string {
  const url = new URL(
    '/booking/staff/shifts',
    adminOrigin ?? env.ADMIN_PUBLIC_URL ?? 'https://your-admin.pages.dev',
  );
  if (staffId) url.searchParams.set('staff_id', staffId);
  url.searchParams.set('google', result);
  return url.toString();
}

// ----------------------------------------------------------------
// Helpers

const JST_OFFSET_MS = 9 * 3600_000;

function startsAtJst(utcIso: string): string {
  const jst = new Date(new Date(utcIso).getTime() + JST_OFFSET_MS).toISOString();
  return `${jst.slice(0, 10)} ${jst.slice(11, 16)}`;
}

// UTC [start, end) bounds covering a JST calendar day (YYYY-MM-DD in JST).
// The JST day runs [date 00:00 JST, date+1 00:00 JST) = [date-1 15:00Z, date 15:00Z).
// Used to fetch a staff member's existing bookings for slot computation.
// (Replaces a broken `${date}T-09:00:00.000Z`.replace('-09','00') that corrupted
//  any date string containing '-09'/'-11'/'-12' and dropped JST 00:00-09:00.)
export function jstDayWindowUtc(jstDate: string): { startUtc: string; endUtc: string } {
  return {
    startUtc: new Date(`${jstDate}T00:00:00+09:00`).toISOString(),
    endUtc: `${jstDate}T15:00:00Z`,
  };
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

// LIFF が送る id_token を LINE Login API で verify し、認証済み LINE userId を返す。
// 失敗時は null（呼び出し側で 401）。
//
// 候補チャンネル ID:
//   1. LINE_LOGIN_CHANNEL_ID env (デフォルトアカウント)
//   2. DB 内 line_accounts.login_channel_id (LINE Login channel)
//   3. DB 内 line_accounts.channel_id (Messaging channel) — LIFF を Login channel
//      ではなく Messaging channel に紐付けてる構成への保険
//   4. id_token の aud claim を base64 デコードして直接抽出 — どの DB 値とも
//      一致しない場合の最後の手段（LIFF が独自に発行する場合）
async function verifyCallerLineUserId(c: Context<Env>): Promise<string | null> {
  const auth = c.req.header('Authorization');
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const idToken = auth.slice('Bearer '.length).trim();
  if (!idToken) return null;

  const candidates: string[] = [];
  const push = (v: string | null | undefined) => {
    if (v && !candidates.includes(v)) candidates.push(v);
  };

  push(c.env.LINE_LOGIN_CHANNEL_ID);
  const dbAccounts = await getLineAccounts(c.env.DB);
  for (const a of dbAccounts) {
    const acc = a as unknown as {
      login_channel_id?: string | null;
      channel_id?: string | null;
      liff_id?: string | null;
    };
    push(acc.login_channel_id);
    push(acc.channel_id);
    // liff_id は "<channel_id>-<random>" 形式
    const liffPrefix = acc.liff_id?.split('-')[0];
    push(liffPrefix);
  }

  // id_token (JWT) の payload を base64url decode して aud を抽出
  // Cloudflare Workers の atob は base64 を扱う。base64url の文字置換が必要。
  try {
    const parts = idToken.split('.');
    if (parts.length === 3) {
      const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
      const json = JSON.parse(atob(padded));
      if (typeof json.aud === 'string') push(json.aud);
      else if (Array.isArray(json.aud)) for (const a of json.aud) push(String(a));
    }
  } catch {
    /* decode 失敗は無視: 候補 URL のみで verify を試す */
  }

  console.log('[verifyCallerLineUserId] candidates:', candidates.length, candidates.join(','));

  for (const channelId of candidates) {
    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
    });
    if (res.ok) {
      const verified = await res.json<{ sub?: string }>();
      if (verified.sub) return verified.sub;
    } else {
      const errBody = await res.text().catch(() => '');
      console.log(
        `[verifyCallerLineUserId] verify fail channel=${channelId} status=${res.status} body=${errBody.slice(0, 200)}`,
      );
    }
  }
  return null;
}

async function resolveAccountIdAdmin(c: Context<Env>): Promise<string | null> {
  return c.req.query('account_id') ?? null;
}

// staff が指定 account に属することを保証する。属していなければ null を返す。
async function assertStaffInAccount(
  db: D1Database,
  staffId: string,
  accountId: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS ok FROM staff WHERE id = ? AND line_account_id = ? AND deleted_at IS NULL`)
    .bind(staffId, accountId)
    .first<{ ok: number }>();
  return Boolean(row?.ok);
}

// account-scope な friend 解決。friends.line_account_id が webhook で書き換わる
// マルチアカウント環境で、別 tenant の friend 行を再利用しないようにする。
// line_account_id が NULL の旧データ（multi-account 化前）は account 一致が判定できないので
// 安全側として除外（必要なら個別にバックフィルする）。
async function resolveFriendId(
  c: Context<Env>,
  lineUserId: string,
  accountId: string,
): Promise<string | null> {
  const f = await c.env.DB
    .prepare(
      `SELECT id FROM friends
        WHERE line_user_id = ? AND line_account_id = ?`,
    )
    .bind(lineUserId, accountId)
    .first<{ id: string }>();
  return f?.id ?? null;
}

async function notifyForBooking(
  db: D1Database,
  bookingId: string,
  kind: 'requested' | 'approved' | 'rejected',
): Promise<void> {
  const row = await db
    .prepare(
      `SELECT b.starts_at,
              m.name AS menu_name,
              s.display_name AS staff_name,
              la.channel_access_token,
              f.line_user_id
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         INNER JOIN line_accounts la ON la.id = b.line_account_id
         INNER JOIN friends f ON f.id = b.friend_id
        WHERE b.id = ?`,
    )
    .bind(bookingId)
    .first<{
      starts_at: string;
      menu_name: string;
      staff_name: string;
      channel_access_token: string;
      line_user_id: string;
    }>();
  if (!row) return;
  await sendBookingNotification({
    channelAccessToken: row.channel_access_token,
    toLineUserId: row.line_user_id,
    kind,
    ctx: {
      menuName: row.menu_name,
      staffName: row.staff_name,
      startsAtJst: startsAtJst(row.starts_at),
      hoursBefore: 0,
    },
  });
}

// ================================================================
// LIFF endpoints (/api/liff/booking/*)
// ================================================================

booking.get('/api/liff/booking/menus', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
  const rows = await c.env.DB
    .prepare(
      `SELECT id, name, category_label, description,
              duration_minutes, buffer_after_minutes,
              base_price, sort_order
         FROM menus
        WHERE line_account_id = ? AND is_active = 1 AND deleted_at IS NULL
        ORDER BY sort_order ASC, id ASC`,
    )
    .bind(accountId)
    .all();
  return c.json({ menus: rows.results });
});

booking.get('/api/liff/booking/menus/:id/staff', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
  const menuId = c.req.param('id');
  const rows = await c.env.DB
    .prepare(
      `SELECT s.id, s.display_name, s.role, s.profile_image_url, s.bio,
              s.is_designation_optional,
              COALESCE(sm.override_price, m.base_price) AS price,
              COALESCE(sm.override_duration_minutes, m.duration_minutes) AS duration_minutes
         FROM staff s
         INNER JOIN staff_menus sm ON sm.staff_id = s.id AND sm.menu_id = ?2 AND sm.is_offered = 1
         INNER JOIN menus m ON m.id = ?2
        WHERE s.line_account_id = ?1 AND s.is_active = 1 AND s.deleted_at IS NULL
        ORDER BY s.is_designation_optional DESC, s.sort_order ASC, s.id ASC`,
    )
    .bind(accountId, menuId)
    .all();
  return c.json({ staff: rows.results });
});

booking.get('/api/liff/booking/availability', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
  const menuId = c.req.query('menu_id');
  const staffId = c.req.query('staff_id') || undefined;
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!menuId || !from || !to) {
    return c.json({ error: 'missing_params' }, 400);
  }
  const fromD = new Date(`${from}T00:00:00Z`);
  const toD = new Date(`${to}T00:00:00Z`);
  if ((toD.getTime() - fromD.getTime()) / 86400_000 > 28) {
    return c.json({ error: 'range_too_wide' }, 400);
  }
  const result = await getAvailability(c.env.DB, {
    lineAccountId: accountId,
    menuId,
    staffId,
    from,
    to,
    now: new Date(),
    minLeadTimeMinutes: DEFAULT_ACCOUNT_SETTINGS.min_lead_time_minutes,
    googleCredentials: googleCredentials(c.env),
  });
  return c.json(result);
});

booking.post('/api/liff/booking/requests', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
  const idemKey = c.req.header('Idempotency-Key');
  if (!idemKey) return c.json({ error: 'missing_idempotency_key' }, 400);

  // 認証済み caller の LINE userId を Authorization: Bearer <id_token> から取得。
  const callerLineUserId = await verifyCallerLineUserId(c);
  if (!callerLineUserId) return c.json({ error: 'unauthorized' }, 401);

  const body = await c.req.json<{
    menu_id: string;
    staff_id: string;
    starts_at: string; // UTC ISO8601
    customer_note?: string;
  }>();
  if (!body.menu_id || !body.staff_id || !body.starts_at) {
    return c.json({ error: 'missing_params' }, 400);
  }
  const friendId = await resolveFriendId(c, callerLineUserId, accountId);
  if (!friendId) return c.json({ error: 'friend_not_found' }, 404);

  // Idempotency lookup は account+friend スコープ。同じ key を別 caller が送っても
  // それぞれの caller のキャッシュを返す（=cross-tenant leak 防止）。
  const cached = await findIdempotencyResponse(c.env.DB, {
    key: idemKey,
    lineAccountId: accountId,
    friendId,
    now: new Date(),
  });
  if (cached) {
    return c.json(cached.body as Record<string, unknown>, cached.status as 200 | 201 | 400 | 409 | 422);
  }

  // Block check: customer cannot book
  const friend = await c.env.DB
    .prepare(`SELECT is_following FROM friends WHERE id = ?`)
    .bind(friendId)
    .first<{ is_following: number }>();
  if (!friend || friend.is_following === 0) {
    return c.json({ error: 'cannot_book' }, 403);
  }

  // Menu + staff_menu lookup (must be offered)
  const menuRow = await c.env.DB
    .prepare(
      `SELECT m.id, m.duration_minutes, m.buffer_after_minutes, m.base_price,
              m.auto_tag_id,
              COALESCE(sm.override_duration_minutes, m.duration_minutes) AS dur,
              COALESCE(sm.override_price, m.base_price) AS price,
              sm.is_offered
         FROM menus m
         LEFT JOIN staff_menus sm ON sm.menu_id = m.id AND sm.staff_id = ?2
        WHERE m.id = ?1 AND m.line_account_id = ?3
          AND m.deleted_at IS NULL AND m.is_active = 1`,
    )
    .bind(body.menu_id, body.staff_id, accountId)
    .first<{ duration_minutes: number; buffer_after_minutes: number; auto_tag_id: string | null; dur: number; price: number; is_offered: number | null }>();
  if (!menuRow || menuRow.is_offered !== 1) {
    return c.json({ error: 'menu_not_offered' }, 422);
  }

  const startsAt = new Date(body.starts_at);
  if (Number.isNaN(startsAt.getTime())) {
    return c.json({ error: 'invalid_starts_at' }, 422);
  }
  if (startsAt < new Date()) {
    return c.json({ error: 'past_datetime' }, 422);
  }
  const endsAt = new Date(startsAt.getTime() + menuRow.dur * 60_000);
  const blockEndsAt = new Date(endsAt.getTime() + menuRow.buffer_after_minutes * 60_000);

  // Server-side availability 再検証: 曜日受付時間 / Google Calendar /
  // リードタイム / 既存予約を、確定直前にもう一度突合する。
  const startJstDate = new Date(startsAt.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const startJstHHMM = new Date(startsAt.getTime() + 9 * 3600_000).toISOString().slice(11, 16);
  const latestAvailability = await getAvailability(c.env.DB, {
    lineAccountId: accountId,
    menuId: body.menu_id,
    staffId: body.staff_id,
    from: startJstDate,
    to: startJstDate,
    now: new Date(),
    minLeadTimeMinutes: DEFAULT_ACCOUNT_SETTINGS.min_lead_time_minutes,
    googleCredentials: googleCredentials(c.env),
  });
  const slotMatched = latestAvailability.by_staff[0]?.slots.some(
    (slot) => slot.date === startJstDate && slot.start === startJstHHMM,
  );
  if (!slotMatched) return c.json({ error: 'slot_not_available' }, 422);

  const bookingId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  // 競合チェックと INSERT を 1 ステートメントで原子化する。
  // INSERT ... SELECT WHERE NOT EXISTS パターンで、同一スタッフの overlap 行がある場合は
  // 0 行 INSERT に落とす。changes=0 を 409 として扱う。
  const insertResult = await c.env.DB
    .prepare(
      `INSERT INTO bookings
        (id, line_account_id, friend_id, staff_id, menu_id,
         starts_at, ends_at, block_ends_at, status,
         customer_note, price_at_booking, requested_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?
        WHERE NOT EXISTS (
          SELECT 1 FROM bookings
           WHERE staff_id = ?
             AND status IN ('requested','confirmed')
             AND starts_at < ?
             AND block_ends_at > ?
        )`,
    )
    .bind(
      bookingId,
      accountId,
      friendId,
      body.staff_id,
      body.menu_id,
      startsAt.toISOString(),
      endsAt.toISOString(),
      blockEndsAt.toISOString(),
      'requested' satisfies BookingStatus,
      body.customer_note ?? null,
      menuRow.price,
      nowIso,
      // NOT EXISTS subquery params
      body.staff_id,
      blockEndsAt.toISOString(),
      startsAt.toISOString(),
    )
    .run();
  if ((insertResult.meta?.changes ?? 0) === 0) {
    const err = { error: 'slot_conflict' };
    await saveIdempotencyResponse(c.env.DB, {
      key: idemKey,
      lineAccountId: accountId,
      friendId,
      status: 409,
      body: err,
      ttlMinutes: IDEMPOTENCY_TTL_MINUTES,
      now: new Date(),
    });
    return c.json(err, 409);
  }

  c.executionCtx.waitUntil(
    awardActivityMileage(c.env.DB, {
      eventType: 'booking_created',
      source: 'booking',
      sourceEventId: bookingId,
      friendId,
      metadata: { bookingType: 'salon', menuId: body.menu_id, staffId: body.staff_id },
      occurredAt: nowIso,
    }),
  );

  // Fire-and-forget notification — failures must not roll back the booking.
  c.executionCtx.waitUntil(
    notifyForBooking(c.env.DB, bookingId, 'requested').catch((err) =>
      console.error('booking notify (requested) failed:', err),
    ),
  );

  // notifyForBooking と同じく fire-and-forget。タグ付与失敗は予約成功扱い。
  // attachTagAndFireSideEffects は POST /api/friends/:id/tags と同じ side effects
  // (tag_added シナリオ enrollment + tag_change イベント) を発火する。
  // INSERT OR IGNORE で重複を吸収し、新規付与のときだけ side effects を打つ。
  if (menuRow.auto_tag_id) {
    const tagId = menuRow.auto_tag_id;
    c.executionCtx.waitUntil(
      attachTagAndFireSideEffects(c.env.DB, friendId, tagId, {
        defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
        workerUrl: c.env.WORKER_URL,
      })
        .then(() => undefined)
        .catch((err) => console.error('booking auto-tag failed:', err)),
    );
  }

  const responseBody = { booking_id: bookingId, status: 'requested' };
  await saveIdempotencyResponse(c.env.DB, {
    key: idemKey,
    lineAccountId: accountId,
    friendId,
    status: 201,
    body: responseBody,
    ttlMinutes: IDEMPOTENCY_TTL_MINUTES,
    now: new Date(),
  });
  return c.json(responseBody, 201);
});

booking.get('/api/liff/booking/me', async (c) => {
  const accountId = await resolveAccountIdFromLiff(c);
  if (!accountId) return c.json({ error: 'unknown_liff' }, 404);
  // 履歴も idToken 検証必須。query の lineUserId に頼ると他人の履歴を覗けてしまう。
  const callerLineUserId = await verifyCallerLineUserId(c);
  if (!callerLineUserId) return c.json({ error: 'unauthorized' }, 401);
  const friendId = await resolveFriendId(c, callerLineUserId, accountId);
  if (!friendId) return c.json({ upcoming: [], past: [] });

  const upcoming = await c.env.DB
    .prepare(
      `SELECT b.id, b.starts_at, b.status, b.customer_note,
              m.name AS menu_name,
              s.display_name AS staff_name, s.profile_image_url
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
        WHERE b.friend_id = ? AND b.line_account_id = ?
          AND b.status IN ('requested','confirmed')
          AND b.starts_at >= ?
        ORDER BY b.starts_at ASC`,
    )
    .bind(friendId, accountId, new Date().toISOString())
    .all();

  const past = await c.env.DB
    .prepare(
      `SELECT b.id, b.starts_at, b.status,
              m.name AS menu_name,
              s.display_name AS staff_name, s.profile_image_url
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
        WHERE b.friend_id = ? AND b.line_account_id = ?
          AND (b.status NOT IN ('requested','confirmed') OR b.starts_at < ?)
        ORDER BY b.requested_at DESC
        LIMIT 50`,
    )
    .bind(friendId, accountId, new Date().toISOString())
    .all();

  return c.json({ upcoming: upcoming.results, past: past.results });
});

// ================================================================
// Admin endpoints (/api/booking/admin/*)
// authMiddleware enforces staff/owner auth at index.ts level.
// All endpoints require ?account_id= query.
// ================================================================

// ---- Menus CRUD ----

booking.get('/api/booking/admin/menus', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const rows = await c.env.DB
    .prepare(
      `SELECT id, name, category_label, description,
              duration_minutes, buffer_after_minutes,
              base_price, sort_order, is_active, auto_tag_id
         FROM menus
        WHERE line_account_id = ? AND deleted_at IS NULL
        ORDER BY sort_order ASC, id ASC`,
    )
    .bind(accountId)
    .all();
  return c.json({ menus: rows.results });
});

booking.post('/api/booking/admin/menus', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const b = await c.req.json<{
    name: string;
    category_label?: string | null;
    description?: string | null;
    duration_minutes: number;
    buffer_after_minutes?: number;
    base_price: number;
    sort_order?: number;
    auto_tag_id?: string | null;
  }>();
  const autoTagId = (b.auto_tag_id ?? '').trim() === '' ? null : (b.auto_tag_id as string);
  if (autoTagId) {
    const tagExists = await c.env.DB
      .prepare(`SELECT 1 FROM tags WHERE id = ?`)
      .bind(autoTagId)
      .first<{ 1: number }>();
    if (!tagExists) return c.json({ error: 'tag_not_found' }, 400);
  }
  const id = crypto.randomUUID();
  await c.env.DB
    .prepare(
      `INSERT INTO menus
        (id, line_account_id, name, category_label, description,
         duration_minutes, buffer_after_minutes, base_price, sort_order, auto_tag_id)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id,
      accountId,
      b.name,
      b.category_label ?? null,
      b.description ?? null,
      b.duration_minutes,
      b.buffer_after_minutes ?? 0,
      b.base_price,
      b.sort_order ?? 0,
      autoTagId,
    )
    .run();
  return c.json({ id }, 201);
});

booking.put('/api/booking/admin/menus/:id', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const id = c.req.param('id');
  const b = await c.req.json<{
    name: string;
    category_label?: string | null;
    description?: string | null;
    duration_minutes: number;
    buffer_after_minutes?: number;
    base_price: number;
    sort_order?: number;
    is_active?: boolean;
    auto_tag_id?: string | null;
  }>();
  // PUT は古いクライアントが auto_tag_id フィールドを送らない場合がある。`undefined` を
  // null として書き込むと既存設定を消してしまうため、key 存在チェックで「明示的に送られた
  // ときだけ」更新する。
  const hasAutoTagId = Object.prototype.hasOwnProperty.call(b, 'auto_tag_id');
  const autoTagId = hasAutoTagId
    ? ((b.auto_tag_id ?? '').trim() === '' ? null : (b.auto_tag_id as string))
    : null;
  if (hasAutoTagId && autoTagId) {
    const tagExists = await c.env.DB
      .prepare(`SELECT 1 FROM tags WHERE id = ?`)
      .bind(autoTagId)
      .first<{ 1: number }>();
    if (!tagExists) return c.json({ error: 'tag_not_found' }, 400);
  }
  if (hasAutoTagId) {
    await c.env.DB
      .prepare(
        `UPDATE menus
            SET name = ?, category_label = ?, description = ?,
                duration_minutes = ?, buffer_after_minutes = ?,
                base_price = ?, sort_order = ?, is_active = ?, auto_tag_id = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
          WHERE id = ? AND line_account_id = ?`,
      )
      .bind(
        b.name,
        b.category_label ?? null,
        b.description ?? null,
        b.duration_minutes,
        b.buffer_after_minutes ?? 0,
        b.base_price,
        b.sort_order ?? 0,
        b.is_active === false ? 0 : 1,
        autoTagId,
        id,
        accountId,
      )
      .run();
  } else {
    await c.env.DB
      .prepare(
        `UPDATE menus
            SET name = ?, category_label = ?, description = ?,
                duration_minutes = ?, buffer_after_minutes = ?,
                base_price = ?, sort_order = ?, is_active = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
          WHERE id = ? AND line_account_id = ?`,
      )
      .bind(
        b.name,
        b.category_label ?? null,
        b.description ?? null,
        b.duration_minutes,
        b.buffer_after_minutes ?? 0,
        b.base_price,
        b.sort_order ?? 0,
        b.is_active === false ? 0 : 1,
        id,
        accountId,
      )
      .run();
  }
  return c.json({ ok: true });
});

booking.delete('/api/booking/admin/menus/:id', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const id = c.req.param('id');
  await c.env.DB
    .prepare(
      `UPDATE menus
          SET deleted_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ? AND line_account_id = ?`,
    )
    .bind(id, accountId)
    .run();
  return c.json({ ok: true });
});

// ---- Staff CRUD ----

// Admin mirror of the LIFF menu-staff lookup — used by the iOS app's
// proxy-booking flow (operator books on behalf of a friend from chat).
booking.get('/api/booking/admin/menus/:id/staff', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const menuId = c.req.param('id');
  const rows = await c.env.DB
    .prepare(
      `SELECT s.id, s.display_name, s.role, s.profile_image_url, s.bio,
              s.is_designation_optional,
              COALESCE(sm.override_price, m.base_price) AS price,
              COALESCE(sm.override_duration_minutes, m.duration_minutes) AS duration_minutes
         FROM staff s
         INNER JOIN staff_menus sm ON sm.staff_id = s.id AND sm.menu_id = ?2 AND sm.is_offered = 1
         INNER JOIN menus m ON m.id = ?2
        WHERE s.line_account_id = ?1 AND s.is_active = 1 AND s.deleted_at IS NULL
        ORDER BY s.is_designation_optional DESC, s.sort_order ASC, s.id ASC`,
    )
    .bind(accountId, menuId)
    .all();
  return c.json({ staff: rows.results });
});

// Admin mirror of the LIFF availability lookup. minLeadTimeMinutes is 0:
// the operator is on the phone with the customer and may book a slot
// starting within the lead-time window that customers themselves cannot.
booking.get('/api/booking/admin/availability', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const menuId = c.req.query('menu_id');
  const staffId = c.req.query('staff_id') || undefined;
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!menuId || !from || !to) {
    return c.json({ error: 'missing_params' }, 400);
  }
  const fromD = new Date(`${from}T00:00:00Z`);
  const toD = new Date(`${to}T00:00:00Z`);
  if ((toD.getTime() - fromD.getTime()) / 86400_000 > 28) {
    return c.json({ error: 'range_too_wide' }, 400);
  }
  const result = await getAvailability(c.env.DB, {
    lineAccountId: accountId,
    menuId,
    staffId,
    from,
    to,
    now: new Date(),
    minLeadTimeMinutes: 0,
    googleCredentials: googleCredentials(c.env),
  });
  return c.json(result);
});

// Proxy booking: the operator creates a CONFIRMED booking on behalf of a
// friend, straight from the iOS chat screen. Same shift/slot/conflict
// validation as the LIFF flow, but NO min-lead-time check (the operator
// may book a slot starting sooner than customers are allowed to).
booking.post('/api/booking/admin/bookings', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const body = await c.req.json<{
    friend_id: string;
    menu_id: string;
    staff_id: string;
    starts_at: string; // UTC ISO8601
    customer_note?: string;
  }>();
  if (!body.friend_id || !body.menu_id || !body.staff_id || !body.starts_at) {
    return c.json({ error: 'missing_params' }, 400);
  }

  const friend = await c.env.DB
    .prepare(`SELECT id, is_following FROM friends WHERE id = ? AND line_account_id = ?`)
    .bind(body.friend_id, accountId)
    .first<{ id: string; is_following: number }>();
  if (!friend) return c.json({ error: 'friend_not_found' }, 404);
  if (friend.is_following === 0) return c.json({ error: 'cannot_book' }, 403);

  // staff が同じ account に属することを保証（別 tenant の staff への予約を防ぐ）。
  if (!(await assertStaffInAccount(c.env.DB, body.staff_id, accountId))) {
    return c.json({ error: 'staff_not_found' }, 404);
  }

  const menuRow = await c.env.DB
    .prepare(
      `SELECT m.id, m.duration_minutes, m.buffer_after_minutes, m.base_price,
              COALESCE(sm.override_duration_minutes, m.duration_minutes) AS dur,
              COALESCE(sm.override_price, m.base_price) AS price,
              sm.is_offered
         FROM menus m
         LEFT JOIN staff_menus sm ON sm.menu_id = m.id AND sm.staff_id = ?2
        WHERE m.id = ?1 AND m.line_account_id = ?3
          AND m.deleted_at IS NULL AND m.is_active = 1`,
    )
    .bind(body.menu_id, body.staff_id, accountId)
    .first<{ duration_minutes: number; buffer_after_minutes: number; dur: number; price: number; is_offered: number | null }>();
  if (!menuRow || menuRow.is_offered !== 1) {
    return c.json({ error: 'menu_not_offered' }, 422);
  }

  const startsAt = new Date(body.starts_at);
  if (Number.isNaN(startsAt.getTime())) {
    return c.json({ error: 'invalid_starts_at' }, 422);
  }
  if (startsAt < new Date()) {
    return c.json({ error: 'past_datetime' }, 422);
  }
  const endsAt = new Date(startsAt.getTime() + menuRow.dur * 60_000);
  const blockEndsAt = new Date(endsAt.getTime() + menuRow.buffer_after_minutes * 60_000);

  // Recurring-hours + Google Calendar + internal-booking validation.
  const startJstDate = new Date(startsAt.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
  const startJstHHMM = new Date(startsAt.getTime() + 9 * 3600_000).toISOString().slice(11, 16);
  const latestAvailability = await getAvailability(c.env.DB, {
    lineAccountId: accountId,
    menuId: body.menu_id,
    staffId: body.staff_id,
    from: startJstDate,
    to: startJstDate,
    now: new Date(),
    minLeadTimeMinutes: 0,
    googleCredentials: googleCredentials(c.env),
  });
  if (!latestAvailability.by_staff[0]?.slots.some(
    (slot) => slot.date === startJstDate && slot.start === startJstHHMM,
  )) {
    return c.json({ error: 'slot_not_available' }, 422);
  }

  const bookingId = crypto.randomUUID();
  const nowIso = new Date().toISOString();
  const insertResult = await c.env.DB
    .prepare(
      `INSERT INTO bookings
        (id, line_account_id, friend_id, staff_id, menu_id,
         starts_at, ends_at, block_ends_at, status,
         customer_note, price_at_booking, requested_at, decided_at)
       SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
        WHERE NOT EXISTS (
          SELECT 1 FROM bookings
           WHERE staff_id = ?
             AND status IN ('requested','confirmed')
             AND starts_at < ?
             AND block_ends_at > ?
        )`,
    )
    .bind(
      bookingId,
      accountId,
      body.friend_id,
      body.staff_id,
      body.menu_id,
      startsAt.toISOString(),
      endsAt.toISOString(),
      blockEndsAt.toISOString(),
      'confirmed' satisfies BookingStatus,
      body.customer_note ?? null,
      menuRow.price,
      nowIso,
      nowIso,
      // NOT EXISTS subquery params
      body.staff_id,
      blockEndsAt.toISOString(),
      startsAt.toISOString(),
    )
    .run();
  if ((insertResult.meta?.changes ?? 0) === 0) {
    return c.json({ error: 'slot_conflict' }, 409);
  }

  await insertConfirmationReminders(c.env.DB, {
    bookingId,
    startsAt,
    now: new Date(),
  });
  let calendarSync: 'not_configured' | 'synced' | 'failed' = 'not_configured';
  try {
    const synced = await syncConfirmedBookingToGoogle(
      c.env.DB,
      googleCredentials(c.env),
      bookingId,
    );
    calendarSync = synced.synced ? 'synced' : 'not_configured';
  } catch (error) {
    calendarSync = 'failed';
    console.error('Google Calendar sync (proxy-create) failed:', error);
  }
  c.executionCtx.waitUntil(
    notifyForBooking(c.env.DB, bookingId, 'approved').catch((err) =>
      console.error('booking notify (proxy-create) failed:', err),
    ),
  );
  return c.json({ booking_id: bookingId, status: 'confirmed', calendar_sync: calendarSync }, 201);
});

booking.get('/api/booking/admin/staff', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const rows = await c.env.DB
    .prepare(
      `SELECT id, name, display_name, role, profile_image_url, bio,
              sort_order, is_designation_optional, is_active
         FROM staff
        WHERE line_account_id = ? AND deleted_at IS NULL
        ORDER BY sort_order ASC, id ASC`,
    )
    .bind(accountId)
    .all();
  return c.json({ staff: rows.results });
});

booking.post('/api/booking/admin/staff', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const b = await c.req.json<{
    name: string;
    display_name: string;
    role?: string | null;
    profile_image_url?: string | null;
    bio?: string | null;
    sort_order?: number;
    is_designation_optional?: boolean;
  }>();
  const id = crypto.randomUUID();
  await c.env.DB
    .prepare(
      `INSERT INTO staff
        (id, line_account_id, name, display_name, role, profile_image_url, bio,
         sort_order, is_designation_optional)
       VALUES (?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id,
      accountId,
      b.name,
      b.display_name,
      b.role ?? null,
      b.profile_image_url ?? null,
      b.bio ?? null,
      b.sort_order ?? 0,
      b.is_designation_optional ? 1 : 0,
    )
    .run();
  return c.json({ id }, 201);
});

booking.put('/api/booking/admin/staff/:id', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const id = c.req.param('id');
  const b = await c.req.json<{
    name: string;
    display_name: string;
    role?: string | null;
    profile_image_url?: string | null;
    bio?: string | null;
    sort_order?: number;
    is_designation_optional?: boolean;
    is_active?: boolean;
  }>();
  await c.env.DB
    .prepare(
      `UPDATE staff
          SET name = ?, display_name = ?, role = ?, profile_image_url = ?, bio = ?,
              sort_order = ?, is_designation_optional = ?, is_active = ?,
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ? AND line_account_id = ?`,
    )
    .bind(
      b.name,
      b.display_name,
      b.role ?? null,
      b.profile_image_url ?? null,
      b.bio ?? null,
      b.sort_order ?? 0,
      b.is_designation_optional ? 1 : 0,
      b.is_active === false ? 0 : 1,
      id,
      accountId,
    )
    .run();
  return c.json({ ok: true });
});

booking.delete('/api/booking/admin/staff/:id', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const id = c.req.param('id');
  await c.env.DB
    .prepare(
      `UPDATE staff
          SET deleted_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ? AND line_account_id = ?`,
    )
    .bind(id, accountId)
    .run();
  return c.json({ ok: true });
});

// ---- staff_menus matrix ----

booking.get('/api/booking/admin/staff/:id/menus', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const rows = await c.env.DB
    .prepare(
      `SELECT m.id AS menu_id, m.name,
              COALESCE(sm.is_offered, 0) AS is_offered,
              sm.override_duration_minutes,
              sm.override_price
         FROM menus m
         LEFT JOIN staff_menus sm ON sm.staff_id = ?2 AND sm.menu_id = m.id
        WHERE m.line_account_id = ?1 AND m.deleted_at IS NULL
        ORDER BY m.sort_order ASC`,
    )
    .bind(accountId, staffId)
    .all();
  return c.json({ matrix: rows.results });
});

booking.put('/api/booking/admin/staff/:id/menus', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const b = await c.req.json<{
    menus: Array<{
      menu_id: string;
      is_offered: boolean;
      override_duration_minutes?: number | null;
      override_price?: number | null;
    }>;
  }>();
  // menu_id も同 account のものに限定。account 外の menu_id は無視。
  const validMenuIds = new Set(
    (
      await c.env.DB
        .prepare(`SELECT id FROM menus WHERE line_account_id = ? AND deleted_at IS NULL`)
        .bind(accountId)
        .all<{ id: string }>()
    ).results.map((r) => r.id),
  );
  await c.env.DB.prepare(`DELETE FROM staff_menus WHERE staff_id = ?`).bind(staffId).run();
  const filtered = b.menus.filter((m) => validMenuIds.has(m.menu_id));
  if (filtered.length > 0) {
    const stmts = filtered.map((m) =>
      c.env.DB
        .prepare(
          `INSERT INTO staff_menus
            (staff_id, menu_id, is_offered, override_duration_minutes, override_price)
           VALUES (?,?,?,?,?)`,
        )
        .bind(
          staffId,
          m.menu_id,
          m.is_offered ? 1 : 0,
          m.override_duration_minutes ?? null,
          m.override_price ?? null,
        ),
    );
    await c.env.DB.batch(stmts);
  }
  return c.json({ ok: true });
});

// ---- shifts ----

booking.get('/api/booking/admin/staff/:id/availability-rules', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const rows = await c.env.DB
    .prepare(
      `SELECT id, weekday, start_time, end_time, is_active
         FROM staff_availability_rules
        WHERE staff_id = ?
        ORDER BY weekday ASC`,
    )
    .bind(staffId)
    .all();
  return c.json({ rules: rows.results });
});

booking.put('/api/booking/admin/staff/:id/availability-rules', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const body = await c.req.json<{
    rules: Array<{ weekday: number; start_time: string; end_time: string }>;
  }>();
  if (!Array.isArray(body.rules)) return c.json({ error: 'invalid_rules' }, 400);
  const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
  const weekdays = new Set<number>();
  for (const rule of body.rules) {
    if (!Number.isInteger(rule.weekday) || rule.weekday < 0 || rule.weekday > 6) {
      return c.json({ error: 'invalid_weekday' }, 422);
    }
    if (weekdays.has(rule.weekday)) return c.json({ error: 'duplicate_weekday' }, 422);
    weekdays.add(rule.weekday);
    if (!hhmm.test(rule.start_time) || !hhmm.test(rule.end_time) || rule.start_time >= rule.end_time) {
      return c.json({ error: 'invalid_time_range' }, 422);
    }
  }
  const statements: D1PreparedStatement[] = [
    c.env.DB.prepare(`DELETE FROM staff_availability_rules WHERE staff_id = ?`).bind(staffId),
    ...body.rules.map((rule) =>
      c.env.DB
        .prepare(
          `INSERT INTO staff_availability_rules
            (id, staff_id, weekday, start_time, end_time, is_active)
           VALUES (?, ?, ?, ?, ?, 1)`,
        )
        .bind(crypto.randomUUID(), staffId, rule.weekday, rule.start_time, rule.end_time),
    ),
  ];
  await c.env.DB.batch(statements);
  return c.json({ ok: true, count: body.rules.length });
});

// OAuth start is admin-authenticated and CSRF protected. Only the signed, short-lived
// state crosses Google's authorization page; API_KEY and client secret never leave Worker.
booking.post('/api/booking/admin/staff/:id/google-calendar/oauth/start', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const credentials = googleCredentials(c.env);
  if (!googleOAuthConfigured(credentials)) {
    return c.json({ error: 'google_oauth_not_configured' }, 503);
  }
  const state = await signGoogleOAuthState({
    accountId,
    staffId,
    expiresAt: Date.now() + GOOGLE_OAUTH_STATE_TTL_MS,
    adminOrigin: (() => {
      const origin = c.req.header('Origin');
      return resolveCorsOrigin(c.env, origin, c.req.url) === origin ? origin : undefined;
    })(),
  }, c.env.API_KEY);
  const authorizationUrl = buildGoogleOAuthAuthorizationUrl({
    clientId: credentials.oauthClientId!,
    redirectUri: googleOAuthRedirectUri(c.req.url),
    state,
  });
  return c.json({ authorization_url: authorizationUrl });
});

// Google redirects here without an admin Authorization header. authMiddleware has a narrow
// GET-only exception for this exact path; signed state binds the callback to staff/account.
booking.get(GOOGLE_OAUTH_CALLBACK_PATH, async (c) => {
  let staffId: string | null = null;
  let adminOrigin: string | undefined;
  try {
    const state = c.req.query('state');
    if (!state) throw new Error('google_oauth_state_missing');
    const payload = await verifyGoogleOAuthState(state, c.env.API_KEY);
    staffId = payload.staffId;
    adminOrigin = payload.adminOrigin;
    if (c.req.query('error')) {
      return c.redirect(adminCalendarReturnUrl(c.env, staffId, 'denied', adminOrigin));
    }
    const code = c.req.query('code');
    const credentials = googleCredentials(c.env);
    if (!code || !googleOAuthConfigured(credentials)) {
      throw new Error('google_oauth_callback_invalid');
    }
    if (!(await assertStaffInAccount(c.env.DB, payload.staffId, payload.accountId))) {
      throw new Error('google_oauth_staff_invalid');
    }
    const token = await exchangeGoogleOAuthCode({
      code,
      clientId: credentials.oauthClientId!,
      clientSecret: credentials.oauthClientSecret!,
      redirectUri: googleOAuthRedirectUri(c.req.url),
    });

    // Verify the granted account immediately before persisting the long-lived token.
    const client = new GoogleCalendarClient({ calendarId: 'primary', accessToken: token.accessToken });
    const now = new Date();
    await client.getFreeBusy(now.toISOString(), new Date(now.getTime() + 60_000).toISOString());

    const existing = await c.env.DB
      .prepare(
        `SELECT id FROM google_calendar_connections
          WHERE line_account_id = ? AND staff_id = ? LIMIT 1`,
      )
      .bind(payload.accountId, payload.staffId)
      .first<{ id: string }>();
    const connectionId = existing?.id ?? crypto.randomUUID();
    const nowIso = now.toISOString();
    if (existing) {
      await c.env.DB
        .prepare(
          `UPDATE google_calendar_connections
              SET calendar_id='primary', auth_type='oauth', access_token=?, refresh_token=?,
                  api_key=NULL, is_active=1, last_verified_at=?, last_error=NULL, updated_at=?
            WHERE id=? AND line_account_id=? AND staff_id=?`,
        )
        .bind(
          token.accessToken,
          token.refreshToken,
          nowIso,
          nowIso,
          connectionId,
          payload.accountId,
          payload.staffId,
        )
        .run();
    } else {
      await c.env.DB
        .prepare(
          `INSERT INTO google_calendar_connections
            (id, calendar_id, line_account_id, staff_id, access_token, refresh_token,
             auth_type, is_active, last_verified_at, created_at, updated_at)
           VALUES (?, 'primary', ?, ?, ?, ?, 'oauth', 1, ?, ?, ?)`,
        )
        .bind(
          connectionId,
          payload.accountId,
          payload.staffId,
          token.accessToken,
          token.refreshToken,
          nowIso,
          nowIso,
          nowIso,
        )
        .run();
    }
    return c.redirect(adminCalendarReturnUrl(c.env, staffId, 'connected', adminOrigin));
  } catch (error) {
    console.error('Google Calendar OAuth callback failed:', error);
    return c.redirect(adminCalendarReturnUrl(c.env, staffId, 'error', adminOrigin));
  }
});

booking.get('/api/booking/admin/staff/:id/google-calendar', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const connection = await c.env.DB
    .prepare(
      `SELECT id, calendar_id, auth_type, is_active, last_verified_at, last_error
         FROM google_calendar_connections
        WHERE line_account_id = ? AND staff_id = ? AND is_active = 1
        LIMIT 1`,
    )
    .bind(accountId, staffId)
    .first();
  return c.json({
    connection,
    service_account: {
      configured: Boolean(
        c.env.GOOGLE_SERVICE_ACCOUNT_EMAIL && c.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY,
      ),
      email: c.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null,
    },
    oauth: {
      configured: googleOAuthConfigured(googleCredentials(c.env)),
    },
  });
});

booking.put('/api/booking/admin/staff/:id/google-calendar', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const body = await c.req.json<{ calendar_id?: string }>();
  const calendarId = body.calendar_id?.trim();
  if (!calendarId || calendarId.length > 1024 || /[\r\n]/.test(calendarId)) {
    return c.json({ error: 'invalid_calendar_id' }, 422);
  }
  const existing = await c.env.DB
    .prepare(
      `SELECT id FROM google_calendar_connections
        WHERE line_account_id = ? AND staff_id = ? LIMIT 1`,
    )
    .bind(accountId, staffId)
    .first<{ id: string }>();
  const connectionId = existing?.id ?? crypto.randomUUID();
  try {
    await verifyStaffCalendarConnection({
      id: connectionId,
      calendar_id: calendarId,
      auth_type: 'service_account',
      access_token: null,
      refresh_token: null,
    }, googleCredentials(c.env));
  } catch (error) {
    console.error('Google Calendar verification failed:', error);
    const message = error instanceof Error ? error.message : String(error);
    const status = message === 'google_service_account_not_configured' ? 503 : 422;
    return c.json({ error: status === 503 ? 'service_account_not_configured' : 'calendar_not_accessible' }, status);
  }
  const now = new Date().toISOString();
  if (existing) {
    await c.env.DB
      .prepare(
        `UPDATE google_calendar_connections
            SET calendar_id = ?, auth_type = 'service_account',
                access_token = NULL, refresh_token = NULL, is_active = 1,
                last_verified_at = ?, last_error = NULL, updated_at = ?
          WHERE id = ? AND line_account_id = ? AND staff_id = ?`,
      )
      .bind(calendarId, now, now, connectionId, accountId, staffId)
      .run();
  } else {
    await c.env.DB
      .prepare(
        `INSERT INTO google_calendar_connections
          (id, calendar_id, line_account_id, staff_id, auth_type, is_active,
           last_verified_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'service_account', 1, ?, ?, ?)`,
      )
      .bind(connectionId, calendarId, accountId, staffId, now, now, now)
      .run();
  }
  return c.json({ ok: true, calendar_id: calendarId, last_verified_at: now });
});

booking.delete('/api/booking/admin/staff/:id/google-calendar', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const connection = await c.env.DB
    .prepare(
      `SELECT auth_type, access_token, refresh_token
         FROM google_calendar_connections
        WHERE line_account_id = ? AND staff_id = ? AND is_active = 1
        LIMIT 1`,
    )
    .bind(accountId, staffId)
    .first<{
      auth_type: string;
      access_token: string | null;
      refresh_token: string | null;
    }>();
  if (connection?.auth_type === 'oauth') {
    const token = connection.refresh_token ?? connection.access_token;
    if (token) {
      await revokeGoogleOAuthToken(token).catch((error) =>
        console.error('Google OAuth revoke failed during disconnect:', error));
    }
  }
  await c.env.DB
    .prepare(
      `UPDATE google_calendar_connections
          SET is_active = 0, access_token = NULL, refresh_token = NULL,
              updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE line_account_id = ? AND staff_id = ? AND is_active = 1`,
    )
    .bind(accountId, staffId)
    .run();
  return c.json({ ok: true });
});

booking.get('/api/booking/admin/staff/:id/shifts', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const from = c.req.query('from');
  const to = c.req.query('to');
  const sql = from && to
    ? `SELECT id, work_date, start_time, end_time
         FROM staff_shifts
        WHERE staff_id = ? AND work_date BETWEEN ? AND ?
        ORDER BY work_date ASC`
    : `SELECT id, work_date, start_time, end_time
         FROM staff_shifts
        WHERE staff_id = ?
        ORDER BY work_date ASC`;
  const stmt = c.env.DB.prepare(sql);
  const rows = await (from && to ? stmt.bind(staffId, from, to) : stmt.bind(staffId)).all();
  return c.json({ shifts: rows.results });
});

booking.put('/api/booking/admin/staff/:id/shifts', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const b = await c.req.json<{
    shifts: Array<{ work_date: string; start_time: string; end_time: string }>;
  }>();
  // Upsert each row
  for (const s of b.shifts) {
    await c.env.DB
      .prepare(
        `INSERT INTO staff_shifts (id, staff_id, work_date, start_time, end_time)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(staff_id, work_date) DO UPDATE
            SET start_time = excluded.start_time,
                end_time = excluded.end_time,
                updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')`,
      )
      .bind(crypto.randomUUID(), staffId, s.work_date, s.start_time, s.end_time)
      .run();
  }
  return c.json({ ok: true, count: b.shifts.length });
});

booking.delete('/api/booking/admin/staff/:id/shifts/:shiftId', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const shiftId = c.req.param('shiftId');
  await c.env.DB
    .prepare(`DELETE FROM staff_shifts WHERE id = ? AND staff_id = ?`)
    .bind(shiftId, staffId)
    .run();
  return c.json({ ok: true });
});

booking.post('/api/booking/admin/staff/:id/shifts/generate', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const staffId = c.req.param('id');
  if (!(await assertStaffInAccount(c.env.DB, staffId, accountId))) {
    return c.json({ error: 'staff_not_found_in_account' }, 404);
  }
  const b = await c.req.json<{
    from_date: string; // YYYY-MM-DD
    weeks: number;
    weekly_template: Record<
      'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat',
      { start: string; end: string } | null
    >;
  }>();
  if (!b.from_date || !b.weeks || !b.weekly_template) {
    return c.json({ error: 'missing_params' }, 400);
  }
  const dayKeys: Array<keyof typeof b.weekly_template> = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const start = new Date(`${b.from_date}T00:00:00Z`);
  const stmts: D1PreparedStatement[] = [];
  for (let i = 0; i < b.weeks * 7; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const tpl = b.weekly_template[dayKeys[d.getUTCDay()]];
    if (!tpl) continue;
    stmts.push(
      c.env.DB
        .prepare(
          `INSERT INTO staff_shifts (id, staff_id, work_date, start_time, end_time)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(staff_id, work_date) DO NOTHING`,
        )
        .bind(crypto.randomUUID(), staffId, d.toISOString().slice(0, 10), tpl.start, tpl.end),
    );
  }
  if (stmts.length === 0) return c.json({ inserted: 0 });
  await c.env.DB.batch(stmts);
  return c.json({ inserted: stmts.length });
});

// ---- Bookings (requests) ----

booking.get('/api/booking/admin/requests', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const status = c.req.query('status');
  const sql = status === 'all'
    ? `SELECT b.*,
              m.name AS menu_name,
              s.display_name AS staff_name,
              f.display_name AS friend_name
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         LEFT JOIN friends f ON f.id = b.friend_id
        WHERE b.line_account_id = ?
        ORDER BY b.requested_at DESC
        LIMIT 500`
    : `SELECT b.*,
              m.name AS menu_name,
              s.display_name AS staff_name,
              f.display_name AS friend_name
         FROM bookings b
         INNER JOIN menus m ON m.id = b.menu_id
         INNER JOIN staff s ON s.id = b.staff_id
         LEFT JOIN friends f ON f.id = b.friend_id
        WHERE b.line_account_id = ? AND b.status = ?
        ORDER BY b.starts_at DESC
        LIMIT 500`;
  const stmt = c.env.DB.prepare(sql);
  const rows = await (status === 'all' || !status
    ? (status === 'all' ? stmt.bind(accountId) : stmt.bind(accountId, 'requested'))
    : stmt.bind(accountId, status)).all();
  return c.json({ requests: rows.results });
});

booking.patch('/api/booking/admin/requests/:id', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const id = c.req.param('id');
  const b = await c.req.json<{ action: BookingAction }>();
  const row = await c.env.DB
    .prepare(`SELECT id, status, starts_at FROM bookings WHERE id = ? AND line_account_id = ?`)
    .bind(id, accountId)
    .first<{ id: string; status: BookingStatus; starts_at: string }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (!canTransition(row.status, b.action)) {
    return c.json({ error: 'invalid_transition' }, 409);
  }
  const next = nextStatus(row.status, b.action);
  // 条件付き UPDATE: 同時 PATCH の race を防ぐ。changes=0 のときは別オペレータが先に
  // 状態を変えたので 409 を返し、副作用（reminders 作成・通知）は走らせない。
  const updateResult = await c.env.DB
    .prepare(
      `UPDATE bookings SET status = ?, decided_at = ?,
                            updated_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')
        WHERE id = ? AND status = ?`,
    )
    .bind(next, new Date().toISOString(), id, row.status)
    .run();
  if ((updateResult.meta?.changes ?? 0) === 0) {
    return c.json({ error: 'concurrent_update' }, 409);
  }

  if (next === 'confirmed') {
    await insertConfirmationReminders(c.env.DB, {
      bookingId: id,
      startsAt: new Date(row.starts_at),
      now: new Date(),
    });
    try {
      await syncConfirmedBookingToGoogle(c.env.DB, googleCredentials(c.env), id);
    } catch (error) {
      console.error('Google Calendar sync (approve) failed:', error);
    }
    c.executionCtx.waitUntil(
      notifyForBooking(c.env.DB, id, 'approved').catch((err) =>
        console.error('booking notify (approved) failed:', err),
      ),
    );
  } else if (next === 'rejected') {
    c.executionCtx.waitUntil(
      notifyForBooking(c.env.DB, id, 'rejected').catch((err) =>
        console.error('booking notify (rejected) failed:', err),
      ),
    );
  } else if (next === 'cancelled' || next === 'expired') {
    await c.env.DB
      .prepare(
        `UPDATE booking_reminders SET status='cancelled' WHERE booking_id = ? AND status = 'pending'`,
      )
      .bind(id)
      .run();
    c.executionCtx.waitUntil(
      removeBookingFromGoogle(c.env.DB, googleCredentials(c.env), id).catch((error) =>
        console.error('Google Calendar delete failed:', error),
      ),
    );
  }

  return c.json({ status: next });
});

// Pending count for sidebar badge.
booking.get('/api/booking/admin/pending-count', async (c) => {
  const accountId = await resolveAccountIdAdmin(c);
  if (!accountId) return c.json({ error: 'missing_account_id' }, 400);
  const row = await c.env.DB
    .prepare(
      `SELECT COUNT(*) AS cnt FROM bookings
        WHERE line_account_id = ? AND status = 'requested'`,
    )
    .bind(accountId)
    .first<{ cnt: number }>();
  return c.json({ count: row?.cnt ?? 0 });
});

export default booking;
