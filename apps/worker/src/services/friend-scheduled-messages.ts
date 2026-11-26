import { getFriendById, jstNow, toJstString } from '@line-crm/db';
import type { Friend as DbFriend } from '@line-crm/db';
import { buildMessage } from './step-delivery.js';
import { sendDirectMessageToFriend, type DirectSendInput, type DirectSendResult } from './friend-direct-send.js';

/**
 * 友だち1人宛ての予約送信 (1:1 scheduled message)。
 *
 * - 作成: status='pending' で friend_scheduled_messages に入れる。
 * - 送信: cron (scheduled.ts) が送信時刻を過ぎた pending 行を1件ずつ
 *   「pending → sending」に条件付き UPDATE で確保してから送る。確保できた
 *   tick だけが送るので、cron と DO alarm が重なっても二重送信しない。
 * - sending のまま残った行 (送信途中で invocation が落ちた等) は、届いたか
 *   分からないので自動再送せず failed にする (二重送信より取りこぼしを選ぶ)。
 * - 予定時刻から長く遅れた行 (Worker 停止など) は古い案内を送らないよう failed。
 */

export const SCHEDULED_MESSAGE_STATUSES = ['pending', 'sending', 'sent', 'cancelled', 'failed'] as const;
export type ScheduledMessageStatus = (typeof SCHEDULED_MESSAGE_STATUSES)[number];
export const ALLOWED_SCHEDULED_MESSAGE_TYPES = ['text', 'image', 'flex'] as const;

/** 予定時刻からこれ以上遅れたら送らない。 */
export const SCHEDULED_MESSAGE_STALE_MS = 3 * 60 * 60 * 1000;
/** sending のまま止まった行をこの時間で failed (結果不明) にする。 */
export const SCHEDULED_MESSAGE_SENDING_TIMEOUT_MS = 30 * 60 * 1000;
/** 予約できる最長の先。 */
export const SCHEDULED_MESSAGE_MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;
export const SCHEDULED_MESSAGE_MAX_TEXT = 5000;

export interface ScheduledMessageRow {
  id: string;
  friend_id: string;
  line_account_id: string | null;
  message_type: string;
  content: string;
  alt_text: string | null;
  track_links: number;
  send_at: number;
  status: ScheduledMessageStatus;
  created_by: string | null;
  claim_token: string | null;
  claimed_at: number | null;
  sent_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  error: string | null;
  message_id: string | null;
  created_at: string;
  updated_at: string;
}

export function serializeScheduledMessage(row: ScheduledMessageRow & { friend_display_name?: string | null }) {
  return {
    id: row.id,
    friendId: row.friend_id,
    ...(row.friend_display_name !== undefined ? { friendDisplayName: row.friend_display_name } : {}),
    lineAccountId: row.line_account_id,
    messageType: row.message_type,
    content: row.content,
    altText: row.alt_text,
    trackLinks: Boolean(row.track_links),
    sendAt: new Date(row.send_at).toISOString(),
    sendAtJst: toJstString(new Date(row.send_at)),
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    sentAt: row.sent_at,
    cancelledAt: row.cancelled_at,
    cancelledBy: row.cancelled_by,
    error: row.error,
    messageId: row.message_id,
  };
}

export class ScheduledMessageValidationError extends Error {}

/** タイムゾーン付き ISO 8601 だけ受け付ける (タイムゾーン無しは JST/UTC の取り違え事故になる)。 */
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/;

export interface CreateScheduledMessageInput {
  content?: unknown;
  messageType?: unknown;
  altText?: unknown;
  trackLinks?: unknown;
  sendAt?: unknown;
}

export function validateScheduledMessageInput(input: CreateScheduledMessageInput, now: Date) {
  const messageType = input.messageType === undefined ? 'text' : input.messageType;
  if (typeof messageType !== 'string' || !(ALLOWED_SCHEDULED_MESSAGE_TYPES as readonly string[]).includes(messageType)) {
    throw new ScheduledMessageValidationError(`messageType must be one of ${ALLOWED_SCHEDULED_MESSAGE_TYPES.join(', ')}`);
  }
  if (typeof input.content !== 'string' || !input.content.trim()) {
    throw new ScheduledMessageValidationError('content is required');
  }
  if (messageType === 'text' && input.content.length > SCHEDULED_MESSAGE_MAX_TEXT) {
    throw new ScheduledMessageValidationError(`content must be ${SCHEDULED_MESSAGE_MAX_TEXT} characters or fewer`);
  }
  if (input.altText !== undefined && input.altText !== null && typeof input.altText !== 'string') {
    throw new ScheduledMessageValidationError('altText must be a string');
  }
  if (input.trackLinks !== undefined && typeof input.trackLinks !== 'boolean') {
    throw new ScheduledMessageValidationError('trackLinks must be a boolean');
  }
  if (typeof input.sendAt !== 'string' || !ISO_WITH_ZONE.test(input.sendAt)) {
    throw new ScheduledMessageValidationError('sendAt must be ISO 8601 with a timezone (e.g. 2026-11-20T19:00:00+09:00)');
  }
  const sendAtMs = Date.parse(input.sendAt);
  if (!Number.isFinite(sendAtMs)) {
    throw new ScheduledMessageValidationError('sendAt is not a valid date');
  }
  if (sendAtMs < now.getTime() + 60_000) {
    throw new ScheduledMessageValidationError('sendAt must be at least 1 minute in the future');
  }
  if (sendAtMs > now.getTime() + SCHEDULED_MESSAGE_MAX_AHEAD_MS) {
    throw new ScheduledMessageValidationError('sendAt must be within 366 days');
  }
  // 送信時に壊れていると分かるより、作成時に弾く (flex の JSON 崩れ等)。
  try {
    buildMessage(messageType, input.content, typeof input.altText === 'string' ? input.altText : undefined);
  } catch (e) {
    throw new ScheduledMessageValidationError(`content is invalid for ${messageType}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return {
    messageType,
    content: input.content,
    altText: typeof input.altText === 'string' ? input.altText : null,
    trackLinks: input.trackLinks !== false,
    sendAtMs,
  };
}

export async function createScheduledMessage(
  db: D1Database,
  friend: DbFriend,
  input: CreateScheduledMessageInput,
  opts: { now: Date; createdBy: string | null },
): Promise<ScheduledMessageRow> {
  const v = validateScheduledMessageInput(input, opts.now);
  const id = crypto.randomUUID();
  const ts = jstNow();
  const lineAccountId =
    ((friend as unknown as Record<string, unknown>).line_account_id as string | null) ?? null;
  await db
    .prepare(
      `INSERT INTO friend_scheduled_messages
         (id, friend_id, line_account_id, message_type, content, alt_text, track_links, send_at, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .bind(id, friend.id, lineAccountId, v.messageType, v.content, v.altText, v.trackLinks ? 1 : 0, v.sendAtMs, opts.createdBy, ts, ts)
    .run();
  const row = await getScheduledMessage(db, id);
  return row!;
}

export async function getScheduledMessage(db: D1Database, id: string): Promise<ScheduledMessageRow | null> {
  return db.prepare('SELECT * FROM friend_scheduled_messages WHERE id = ?').bind(id).first<ScheduledMessageRow>();
}

export async function listScheduledMessagesForFriend(
  db: D1Database,
  friendId: string,
  status?: ScheduledMessageStatus,
): Promise<ScheduledMessageRow[]> {
  const sql = status
    ? 'SELECT * FROM friend_scheduled_messages WHERE friend_id = ? AND status = ? ORDER BY send_at ASC LIMIT 200'
    : 'SELECT * FROM friend_scheduled_messages WHERE friend_id = ? ORDER BY send_at DESC LIMIT 200';
  const stmt = status ? db.prepare(sql).bind(friendId, status) : db.prepare(sql).bind(friendId);
  const res = await stmt.all<ScheduledMessageRow>();
  return res.results ?? [];
}

export async function listScheduledMessages(
  db: D1Database,
  opts: { status?: ScheduledMessageStatus; lineAccountId?: string; limit?: number },
): Promise<Array<ScheduledMessageRow & { friend_display_name: string | null }>> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (opts.status) { where.push('s.status = ?'); binds.push(opts.status); }
  if (opts.lineAccountId) { where.push('s.line_account_id = ?'); binds.push(opts.lineAccountId); }
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const order = opts.status === 'pending' ? 'ASC' : 'DESC';
  const res = await db
    .prepare(
      `SELECT s.*, f.display_name AS friend_display_name
         FROM friend_scheduled_messages s LEFT JOIN friends f ON f.id = s.friend_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY s.send_at ${order} LIMIT ${limit}`,
    )
    .bind(...binds)
    .all<ScheduledMessageRow & { friend_display_name: string | null }>();
  return res.results ?? [];
}

/** pending のものだけ取り消せる。戻り値: 'cancelled' | 'not_found' | 'not_pending'。 */
export async function cancelScheduledMessage(
  db: D1Database,
  friendId: string,
  id: string,
  cancelledBy: string | null,
): Promise<'cancelled' | 'not_found' | 'not_pending'> {
  const ts = jstNow();
  const res = await db
    .prepare(
      `UPDATE friend_scheduled_messages
          SET status = 'cancelled', cancelled_at = ?, cancelled_by = ?, updated_at = ?
        WHERE id = ? AND friend_id = ? AND status = 'pending'`,
    )
    .bind(ts, cancelledBy, ts, id, friendId)
    .run();
  if ((res.meta?.changes ?? 0) === 1) return 'cancelled';
  const row = await getScheduledMessage(db, id);
  if (!row || row.friend_id !== friendId) return 'not_found';
  return 'not_pending';
}

export type ScheduledMessageSender = (
  db: D1Database,
  defaultAccessToken: string,
  friend: DbFriend,
  input: DirectSendInput,
) => Promise<DirectSendResult>;

export interface ProcessScheduledMessagesOptions {
  now: Date;
  defaultAccessToken: string;
  workerUrl: string;
  limit?: number;
  sender?: ScheduledMessageSender;
}

export interface ProcessScheduledMessagesResult {
  sent: number;
  failed: number;
  expired: number;
  stuck: number;
  skipped: number;
}

async function markFailed(db: D1Database, id: string, error: string, fromStatus: 'pending' | 'sending', claimToken?: string) {
  const ts = jstNow();
  const sql = fromStatus === 'sending'
    ? `UPDATE friend_scheduled_messages SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'sending' AND claim_token = ?`
    : `UPDATE friend_scheduled_messages SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'pending'`;
  const stmt = fromStatus === 'sending'
    ? db.prepare(sql).bind(error.slice(0, 1000), ts, id, claimToken ?? '')
    : db.prepare(sql).bind(error.slice(0, 1000), ts, id);
  await stmt.run();
}

export async function processDueFriendScheduledMessages(
  db: D1Database,
  opts: ProcessScheduledMessagesOptions,
): Promise<ProcessScheduledMessagesResult> {
  const nowMs = opts.now.getTime();
  const sender = opts.sender ?? sendDirectMessageToFriend;
  const result: ProcessScheduledMessagesResult = { sent: 0, failed: 0, expired: 0, stuck: 0, skipped: 0 };

  // 1) sending のまま止まった行 → 結果不明として failed。自動再送はしない。
  const stuck = await db
    .prepare(
      `UPDATE friend_scheduled_messages
          SET status = 'failed', error = ?, updated_at = ?
        WHERE status = 'sending' AND claimed_at IS NOT NULL AND claimed_at < ?`,
    )
    .bind(
      'send result unknown: processing stopped after claim (not retried to avoid double send)',
      jstNow(),
      nowMs - SCHEDULED_MESSAGE_SENDING_TIMEOUT_MS,
    )
    .run();
  result.stuck = stuck.meta?.changes ?? 0;

  // 2) 期限が来た pending を古い順に。
  const due = await db
    .prepare(
      `SELECT * FROM friend_scheduled_messages
        WHERE status = 'pending' AND send_at <= ?
        ORDER BY send_at ASC LIMIT ?`,
    )
    .bind(nowMs, opts.limit ?? 50)
    .all<ScheduledMessageRow>();

  for (const row of due.results ?? []) {
    if (nowMs - row.send_at > SCHEDULED_MESSAGE_STALE_MS) {
      await markFailed(db, row.id, 'expired: more than 3 hours past send_at, not sent', 'pending');
      result.expired++;
      continue;
    }
    // 3) 行を確保。確保できなかった (他の tick が先に取った/取り消された) ら何もしない。
    const claimToken = crypto.randomUUID();
    const claim = await db
      .prepare(
        `UPDATE friend_scheduled_messages
            SET status = 'sending', claim_token = ?, claimed_at = ?, updated_at = ?
          WHERE id = ? AND status = 'pending'`,
      )
      .bind(claimToken, nowMs, jstNow(), row.id)
      .run();
    if ((claim.meta?.changes ?? 0) !== 1) {
      result.skipped++;
      continue;
    }

    const friend = await getFriendById(db, row.friend_id);
    if (!friend) {
      await markFailed(db, row.id, 'friend not found', 'sending', claimToken);
      result.failed++;
      continue;
    }
    if (!friend.is_following) {
      await markFailed(db, row.id, 'friend is not following (blocked or unfollowed)', 'sending', claimToken);
      result.failed++;
      continue;
    }

    try {
      const sent = await sender(db, opts.defaultAccessToken, friend, {
        messageType: row.message_type,
        content: row.content,
        altText: row.alt_text,
        trackLinks: Boolean(row.track_links),
        workerUrl: opts.workerUrl,
      });
      await db
        .prepare(
          `UPDATE friend_scheduled_messages
              SET status = 'sent', sent_at = ?, message_id = ?, line_account_id = COALESCE(?, line_account_id), error = NULL, updated_at = ?
            WHERE id = ? AND claim_token = ?`,
        )
        .bind(jstNow(), sent.messageId, sent.lineAccountId, jstNow(), row.id, claimToken)
        .run();
      result.sent++;
    } catch (e) {
      await markFailed(db, row.id, e instanceof Error ? e.message : String(e), 'sending', claimToken);
      result.failed++;
    }
  }
  return result;
}
