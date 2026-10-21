import type { Message } from '@line-crm/line-sdk';
import type { Broadcast } from '@line-crm/db';
import { BROADCAST_RECORDING_ERROR } from './broadcast-delivery-error.js';

export const PERSONALIZED_EMPTY = JSON.stringify({ version: 1, kind: 'personalized-queue', pending: null });
export const PERSONALIZED_REVIEW = '要確認: 前回のLINE受付結果と配信条件を照合してください。安全な再試行期間を過ぎた、または送信条件が変わったため自動再送を保留しました。';
export const PERSONALIZED_LEGACY_REVIEW = '要確認: 過去のLINE受付結果が不明で元の送信計画が保存されていないため、自動再送を保留しました。受付状況を照合してください。';
export const PERSONALIZED_SAVE_ERROR = '送信前の準備・計画保存に失敗したため、LINEを呼ばずに再試行待ちにしました。';

export function isUnjournaledPersonalizedUncertainty(raw: string | null, reason: string | null | undefined): boolean {
  return raw === null && !!reason && (reason.includes('LINEの受付結果を確認できませんでした。')
    || reason.includes(BROADCAST_RECORDING_ERROR) || reason.includes(PERSONALIZED_LEGACY_REVIEW));
}

/** Before sender/receipt lookups: their failures must not erase uncertainty. */
export async function holdLegacyPersonalizedQueue(db: D1Database, broadcast: Broadcast, offset: number): Promise<void> {
  if (broadcast.last_error === PERSONALIZED_LEGACY_REVIEW) return;
  await db.prepare(`UPDATE broadcasts SET last_error = ? WHERE id = ? AND status = 'sending'
    AND sent_at IS NULL AND batch_offset = ? AND batch_lock_at IS ? AND success_count = ?
    AND dedup_progress IS NULL AND message_type = ? AND message_content = ? AND last_error IS ?`)
    .bind(PERSONALIZED_LEGACY_REVIEW, broadcast.id, offset,
      broadcast.batch_lock_at ?? null, broadcast.success_count, broadcast.message_type,
      broadcast.message_content, broadcast.last_error ?? null).run();
}
export interface PersonalizedIntent {
  version: 1; kind: 'personalized-queue';
  pending: null | {
    id: string; firstAttemptAt: number; source: string; friendId: string;
    to: string; messages: Message[]; retryKey: string; unit: string; content: string;
  };
}
/** An invalid journal is a review hold, never a reason to create a new request. */
export function readPersonalizedIntent(raw: string | null): PersonalizedIntent | null {
  if (raw === null) return { version: 1, kind: 'personalized-queue', pending: null };
  try {
    const parsed = JSON.parse(raw) as PersonalizedIntent;
    if (parsed.version !== 1 || parsed.kind !== 'personalized-queue') return null;
    if (parsed.pending === null) return raw === PERSONALIZED_EMPTY ? parsed : null;
    const p = parsed.pending;
    if (!p || !/^[\da-f-]{36}$/i.test(p.id) || !Number.isFinite(p.firstAttemptAt)
      || !p.source || !p.friendId || !p.to || !Array.isArray(p.messages) || !p.messages.length
      || typeof p.retryKey !== 'string' || !p.retryKey || !p.unit || typeof p.content !== 'string') return null;
    return parsed;
  } catch { return null; }
}
export function pendingMatches(saved: NonNullable<PersonalizedIntent['pending']>, expected: {
  source: string; friendId: string; to: string; messages: Message[]; retryKey: string; unit: string; content: string;
}): boolean {
  const age = Date.now() - saved.firstAttemptAt;
  return age >= 0 && age < 23 * 3600_000 && saved.source === expected.source
    && saved.friendId === expected.friendId && saved.to === expected.to
    && saved.retryKey === expected.retryKey && saved.unit === expected.unit
    && saved.content === expected.content && JSON.stringify(saved.messages) === JSON.stringify(expected.messages);
}
export async function writePersonalizedIntent(db: D1Database, id: string, claimAt: string,
  before: string | null, after: string | null): Promise<boolean> {
  const result = await db.prepare(`UPDATE broadcasts SET dedup_progress = ? WHERE id = ?
    AND status = 'sending' AND sent_at IS NULL AND batch_offset = -1 AND batch_lock_at = ?
    AND dedup_progress IS ?`).bind(after, id, claimAt, before).run();
  return result.meta.changes === 1;
}
export async function holdPersonalizedIntent(db: D1Database, id: string, claimAt: string,
  offset: number, raw: string | null, reason = PERSONALIZED_REVIEW): Promise<void> {
  await db.prepare(`UPDATE broadcasts SET batch_offset = ?, batch_lock_at = NULL, last_error = ?
    WHERE id = ? AND status = 'sending' AND sent_at IS NULL AND batch_offset = -1
      AND batch_lock_at = ? AND dedup_progress IS ?`)
    .bind(offset, reason, id, claimAt, raw).run();
}
