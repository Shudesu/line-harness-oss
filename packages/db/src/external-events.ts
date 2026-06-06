/**
 * L-TRACK 互換: 外部イベント (EC等から成果受信) の DB ヘルパ。
 */

import { jstNow } from './utils.js';

export interface ExternalEvent {
  id: string;
  event_key: string;
  name: string;
  line_account_id: string | null;
  is_active: number;
  capi_platform: 'meta' | 'google' | 'tiktok' | 'x' | null;
  capi_event_name: string | null;
  default_value: number | null;
  hmac_secret: string | null;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export interface ExternalEventReceipt {
  id: string;
  external_event_id: string;
  line_user_id: string;
  friend_id: string | null;
  fbclid: string | null;
  gclid: string | null;
  ttclid: string | null;
  twclid: string | null;
  event_value: number | null;
  raw_payload: string | null;
  status: 'received' | 'capi_sent' | 'capi_failed';
  error_message: string | null;
  received_at: string;
}

export async function getExternalEventByKey(
  db: D1Database,
  eventKey: string,
): Promise<ExternalEvent | null> {
  return db
    .prepare(`SELECT * FROM external_events WHERE event_key = ? AND is_active = 1`)
    .bind(eventKey)
    .first<ExternalEvent>();
}

export async function getExternalEvents(
  db: D1Database,
  opts: { lineAccountId?: string | null } = {},
): Promise<ExternalEvent[]> {
  if (opts.lineAccountId) {
    const r = await db
      .prepare(
        `SELECT * FROM external_events
          WHERE line_account_id IS NULL OR line_account_id = ?
          ORDER BY created_at DESC`,
      )
      .bind(opts.lineAccountId)
      .all<ExternalEvent>();
    return r.results;
  }
  const r = await db
    .prepare(`SELECT * FROM external_events ORDER BY created_at DESC`)
    .all<ExternalEvent>();
  return r.results;
}

export async function createExternalEvent(
  db: D1Database,
  input: {
    eventKey: string;
    name: string;
    lineAccountId?: string | null;
    capiPlatform?: 'meta' | 'google' | 'tiktok' | 'x' | null;
    capiEventName?: string | null;
    defaultValue?: number | null;
    hmacSecret?: string | null;
    memo?: string | null;
  },
): Promise<ExternalEvent> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO external_events
         (id, event_key, name, line_account_id, is_active,
          capi_platform, capi_event_name, default_value, hmac_secret, memo,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.eventKey,
      input.name,
      input.lineAccountId ?? null,
      input.capiPlatform ?? null,
      input.capiEventName ?? null,
      input.defaultValue ?? null,
      input.hmacSecret ?? null,
      input.memo ?? null,
      now,
      now,
    )
    .run();
  return (await db.prepare(`SELECT * FROM external_events WHERE id = ?`).bind(id).first<ExternalEvent>())!;
}

export async function logExternalEventReceipt(
  db: D1Database,
  input: {
    externalEventId: string;
    lineUserId: string;
    friendId: string | null;
    fbclid?: string | null;
    gclid?: string | null;
    ttclid?: string | null;
    twclid?: string | null;
    eventValue?: number | null;
    rawPayload?: string | null;
    status: 'received' | 'capi_sent' | 'capi_failed';
    errorMessage?: string | null;
  },
): Promise<void> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO external_event_receipts
         (id, external_event_id, line_user_id, friend_id,
          fbclid, gclid, ttclid, twclid, event_value, raw_payload,
          status, error_message, received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+9 hours'))`,
    )
    .bind(
      id,
      input.externalEventId,
      input.lineUserId,
      input.friendId,
      input.fbclid ?? null,
      input.gclid ?? null,
      input.ttclid ?? null,
      input.twclid ?? null,
      input.eventValue ?? null,
      input.rawPayload ?? null,
      input.status,
      input.errorMessage ?? null,
    )
    .run();
}

export async function getExternalEventReceipts(
  db: D1Database,
  opts: { limit?: number; eventId?: string } = {},
): Promise<ExternalEventReceipt[]> {
  const limit = opts.limit ?? 200;
  if (opts.eventId) {
    const r = await db
      .prepare(
        `SELECT * FROM external_event_receipts
          WHERE external_event_id = ?
          ORDER BY received_at DESC
          LIMIT ?`,
      )
      .bind(opts.eventId, limit)
      .all<ExternalEventReceipt>();
    return r.results;
  }
  const r = await db
    .prepare(
      `SELECT * FROM external_event_receipts
        ORDER BY received_at DESC
        LIMIT ?`,
    )
    .bind(limit)
    .all<ExternalEventReceipt>();
  return r.results;
}
