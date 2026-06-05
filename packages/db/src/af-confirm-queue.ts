/**
 * L-TRACK 互換: AF確定キュー (af_confirm_queue) の操作
 *
 * skip-liff matcher 等で友だちと clickID が紐付いた直後、tracked_link の
 * af_confirm_type が 1h / 3h / 24h のときに INSERT する。cron が
 * scheduled_at <= now の pending を引いて確定処理を実行する。
 */

import { jstNow, toJstString } from './utils.js';
import type { AfConfirmType } from './tracked-links.js';

/** delayed-only な確定タイプ (tracked-links の 'immediate' を除く) */
export type AfConfirmDelayedType = Exclude<AfConfirmType, 'immediate'>;
export type AfConfirmStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';

export interface AfConfirmQueueEntry {
  id: string;
  friend_id: string;
  tracked_link_id: string | null;
  ref_tracking_id: string | null;
  af_confirm_type: AfConfirmDelayedType;
  scheduled_at: string;
  status: AfConfirmStatus;
  attempts: number;
  last_error: string | null;
  processed_at: string | null;
  created_at: string;
}

const DELAY_HOURS: Record<AfConfirmDelayedType, number> = {
  '1h': 1,
  '3h': 3,
  '24h': 24,
};

/**
 * AF確定キューに enqueue。冪等（ref_tracking_id で UNIQUE）。
 * tracked_link が即時(`immediate`)の場合は呼び側で除外すること。
 */
export async function enqueueAfConfirm(
  db: D1Database,
  opts: {
    friendId: string;
    trackedLinkId: string | null;
    refTrackingId: string | null;
    afConfirmType: AfConfirmDelayedType;
    /** 基準時刻（friend 追加時刻）。省略時は now */
    baseAt?: Date;
  },
): Promise<void> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const base = opts.baseAt ?? new Date();
  const scheduled = new Date(base.getTime() + DELAY_HOURS[opts.afConfirmType] * 3600 * 1000);
  const scheduledAt = toJstString(scheduled);

  await db
    .prepare(
      `INSERT OR IGNORE INTO af_confirm_queue
         (id, friend_id, tracked_link_id, ref_tracking_id, af_confirm_type,
          scheduled_at, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
    )
    .bind(
      id,
      opts.friendId,
      opts.trackedLinkId,
      opts.refTrackingId,
      opts.afConfirmType,
      scheduledAt,
      now,
    )
    .run();
}

/**
 * cron が引く対象 = pending かつ scheduled_at <= now のもの。
 * 一度に取りすぎないよう limit。
 */
export async function getDueAfConfirms(
  db: D1Database,
  limit: number = 100,
): Promise<AfConfirmQueueEntry[]> {
  const now = jstNow();
  const result = await db
    .prepare(
      `SELECT * FROM af_confirm_queue
       WHERE status = 'pending' AND scheduled_at <= ?
       ORDER BY scheduled_at ASC
       LIMIT ?`,
    )
    .bind(now, limit)
    .all<AfConfirmQueueEntry>();
  return result.results;
}

/**
 * pending → processing への自分の claim。同じ行を別 tick が同時に取らないため。
 * 戻り値 true = 取得成功（このプロセスが処理する）、false = 他が既に取った。
 */
export async function claimAfConfirm(db: D1Database, id: string): Promise<boolean> {
  const now = jstNow();
  const r = await db
    .prepare(
      `UPDATE af_confirm_queue
          SET status = 'processing', processed_at = ?, attempts = attempts + 1
        WHERE id = ? AND status = 'pending'`,
    )
    .bind(now, id)
    .run();
  // D1: meta.changes が 1 のときだけ自分が取れた
  const changes = (r as { meta?: { changes?: number } }).meta?.changes ?? 0;
  return changes > 0;
}

/**
 * 処理結果の記録。
 * - 'sent' = CAPI送信成功
 * - 'failed' = 送信失敗（リトライ余地あり: processing → pending に戻す）
 * - 'cancelled' = friend が is_following=0（ブロック）等で確定取り消し
 */
export async function markAfConfirmProcessed(
  db: D1Database,
  id: string,
  status: 'sent' | 'failed' | 'cancelled',
  errorMessage?: string,
): Promise<void> {
  const now = jstNow();
  if (status === 'failed') {
    // claim 時に attempts を増やしているのでここでは増やさない。
    // 失敗時は pending に戻して次の tick で再試行できるようにする。
    await db
      .prepare(
        `UPDATE af_confirm_queue
           SET status = 'pending',
               last_error = ?,
               processed_at = ?
         WHERE id = ?`,
      )
      .bind(errorMessage ?? null, now, id)
      .run();
  } else {
    await db
      .prepare(
        `UPDATE af_confirm_queue
           SET status = ?,
               processed_at = ?,
               last_error = ?
         WHERE id = ?`,
      )
      .bind(status, now, errorMessage ?? null, id)
      .run();
  }
}

/**
 * リトライ上限を超えた failed エントリを永続的に failed として確定する。
 */
export async function failoverStuckAfConfirms(
  db: D1Database,
  maxAttempts: number = 5,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE af_confirm_queue
         SET status = 'failed',
             processed_at = ?
       WHERE status = 'pending'
         AND attempts >= ?`,
    )
    .bind(now, maxAttempts)
    .run();
}
