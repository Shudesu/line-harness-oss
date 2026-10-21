import type { Message } from '@line-crm/line-sdk';

// LINE retains retry keys for 24 hours. Stop an hour earlier so a retry is not
// started at the edge of that window. Expiry never creates a replacement key.
export const MAX_PENDING_BATCH_AGE_MS = 23 * 60 * 60 * 1000;
export const PENDING_BATCH_REVIEW = '未確定の送信計画を安全に再試行できません。計画を保持したまま自動送信を止めています。配信状況を確認してください。';
export const LEGACY_UNCERTAIN_REVIEW = '過去の受付結果が不明で送信計画が保存されていないため、自動再送を止めています。配信状況を確認してください。';
export const PENDING_BATCH_SAVE_ERROR = '送信計画を保存できなかったため、LINEへ送信せず再試行待ちにしました。';

export interface PendingMulticastBatch {
  version: 1;
  id: string;
  broadcastId: string;
  accountId: string | null;
  firstAttemptAt: number;
  offset: number;
  acceptedBefore: number;
  totalCount: number;
  recipients: Array<{ id: string; line_user_id: string }>;
  messageType: string;
  sourceKey: string;
  messages: Message[];
  unit: string;
  retryKey: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;

/** Only Worker-generated, versioned plans are replayable. Invalid data stays saved. */
export function parsePendingMulticastBatch(serialized: string, id: string, now: number): PendingMulticastBatch | null {
  try {
    const value: unknown = JSON.parse(serialized);
    if (!record(value) || value.version !== 1 || value.id !== id || !uuid.test(id)
      || typeof value.broadcastId !== 'string' || !value.broadcastId
      || !(value.accountId === null || typeof value.accountId === 'string')
      || !count(value.firstAttemptAt) || value.firstAttemptAt > now || now - value.firstAttemptAt >= MAX_PENDING_BATCH_AGE_MS
      || !count(value.offset) || !count(value.acceptedBefore) || !count(value.totalCount)
      || typeof value.messageType !== 'string' || typeof value.sourceKey !== 'string' || !uuid.test(value.sourceKey)
      || typeof value.unit !== 'string' || !value.unit
      || typeof value.retryKey !== 'string' || !uuid.test(value.retryKey)
      || !Array.isArray(value.recipients) || value.recipients.length < 1 || value.recipients.length > 500
      || !value.recipients.every(item => record(item) && typeof item.id === 'string' && !!item.id && typeof item.line_user_id === 'string' && !!item.line_user_id)
      || new Set(value.recipients.map(item => item.id)).size !== value.recipients.length
      || new Set(value.recipients.map(item => item.line_user_id)).size !== value.recipients.length
      || !Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > 5
      || !value.messages.every(item => record(item) && typeof item.type === 'string')) return null;
    return value as unknown as PendingMulticastBatch;
  } catch { return null; }
}

export async function savePendingMulticastBatch(db: D1Database, plan: PendingMulticastBatch): Promise<boolean> {
  const result = await db.prepare(
    `UPDATE broadcasts SET pending_batch_id = ?, pending_batch = ?
      WHERE id = ? AND status = 'sending' AND batch_offset = -1
        AND success_count = ? AND pending_batch_id IS NULL AND pending_batch IS NULL`,
  ).bind(plan.id, JSON.stringify(plan), plan.broadcastId, plan.acceptedBefore).run();
  return result.meta.changes === 1;
}

/** Release only this selected plan/claim. Never clear a newer execution's plan. */
export async function releasePendingMulticastClaim(
  db: D1Database, broadcastId: string, offset: number, acceptedBefore: number,
  id: string | null, serialized: string | null, lastError: string | undefined, clear = false,
): Promise<void> {
  await db.prepare(
    `UPDATE broadcasts SET batch_offset = ?, batch_lock_at = NULL
      ${lastError === undefined ? '' : ', last_error = ?'}
      ${clear ? ', pending_batch_id = NULL, pending_batch = NULL' : ''}
      WHERE id = ? AND status = 'sending' AND batch_offset = -1 AND success_count = ?
        AND pending_batch_id IS ? AND pending_batch IS ?`,
  ).bind(offset, ...(lastError === undefined ? [] : [lastError]), broadcastId, acceptedBefore, id, serialized).run();
}

/** Receipt logs and progress consume the same plan once, including stale recovery. */
export async function completePendingMulticastBatch(
  db: D1Database, plan: PendingMulticastBatch, messageContent: string, totalCount: number, createdAt: string,
  recordingError: string,
): Promise<{ owned: boolean; recordingFailed: boolean }> {
  try {
    // D1 permits 100 bound parameters per statement. Forty receipts use 80
    // row parameters plus eight shared values, avoiding one query per person.
    const statements: D1PreparedStatement[] = [];
    for (let offset = 0; offset < plan.recipients.length; offset += 40) {
      const recipients = plan.recipients.slice(offset, offset + 40);
      statements.push(db.prepare(
        `WITH receipts(id, friend_id) AS (VALUES ${recipients.map(() => '(?, ?)').join(', ')})
         INSERT INTO messages_log
           (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
         SELECT receipts.id, receipts.friend_id, 'outgoing', ?, ?, ?, NULL, 'broadcast', ?, ? FROM receipts
          WHERE EXISTS (SELECT 1 FROM broadcasts WHERE id = ? AND pending_batch_id = ?
            AND status = 'sending' AND batch_offset = -1 AND success_count = ?)`,
      ).bind(...recipients.flatMap(friend => [crypto.randomUUID(), friend.id]),
        plan.messageType, messageContent, plan.broadcastId, plan.accountId, createdAt,
        plan.broadcastId, plan.id, plan.acceptedBefore));
    }
    statements.push(db.prepare(
      `UPDATE broadcasts SET success_count = success_count + ?, total_count = MAX(total_count, ?),
          pending_batch_id = NULL, pending_batch = NULL
        WHERE id = ? AND pending_batch_id = ? AND status = 'sending'
          AND batch_offset = -1 AND success_count = ?`,
    ).bind(plan.recipients.length, totalCount, plan.broadcastId, plan.id, plan.acceptedBefore));
    const results = await db.batch(statements);
    return { owned: results[results.length - 1].meta.changes === 1, recordingFailed: false };
  } catch {
    // LINE already accepted. Retain the old no-resend behavior when log writes
    // fail but the accepted count can still be saved. If this also fails, the
    // plan stays durable for an identical retry; never invent successful logs.
    const result = await db.prepare(
      `UPDATE broadcasts SET success_count = success_count + ?, total_count = MAX(total_count, ?),
          pending_batch_id = NULL, pending_batch = NULL, last_error = ?
        WHERE id = ? AND pending_batch_id = ? AND status = 'sending'
          AND batch_offset = -1 AND success_count = ?`,
    ).bind(plan.recipients.length, totalCount, recordingError, plan.broadcastId, plan.id, plan.acceptedBefore).run();
    return { owned: result.meta.changes === 1, recordingFailed: true };
  }
}

/** Finalize only the receipt state this execution completed, in one transaction. */
export async function finishPendingMulticastBroadcast(db: D1Database, outcome: {
  broadcastId: string; acceptedCount: number; unit: string; sentAt: string;
  lastError: string | null; totalCount?: number;
}): Promise<boolean> {
  const owned = `id = ? AND status = 'sending' AND sent_at IS NULL
    AND batch_offset = -1 AND success_count = ?
    AND pending_batch_id IS NULL AND pending_batch IS NULL`;
  const results = await db.batch([
    db.prepare(
      `INSERT INTO broadcast_insights (id, broadcast_id, status)
       SELECT ?, id, 'pending' FROM broadcasts WHERE ${owned}
         AND NOT EXISTS (SELECT 1 FROM broadcast_insights WHERE broadcast_id = broadcasts.id)`,
    ).bind(crypto.randomUUID(), outcome.broadcastId, outcome.acceptedCount),
    db.prepare(
      `UPDATE broadcasts SET status = 'sent', sent_at = ?, batch_lock_at = NULL,
        dedup_progress = NULL, line_request_id = NULL, aggregation_unit = ?,
        last_error = ?, total_count = COALESCE(?, total_count)
       WHERE ${owned}`,
    ).bind(outcome.sentAt, outcome.unit, outcome.lastError, outcome.totalCount ?? null,
      outcome.broadcastId, outcome.acceptedCount),
  ]);
  return results[1].meta.changes === 1;
}
