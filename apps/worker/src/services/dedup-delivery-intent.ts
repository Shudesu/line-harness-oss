import { LineApiError, type LineClient, type Message } from '@line-crm/line-sdk';
import { getLineAccountById, jstNow } from '@line-crm/db';
import type { DedupPreviewResult, ProcessMultiAccountDedupResult } from './dedup-broadcast.js';
import { createBroadcastRetryKey } from './broadcast-retry-key.js';
import { buildMessages } from './message-group.js';
import { buildMessage } from './message-builder.js';
import { renderBroadcastMessageContent, assertNoUnresolvedBroadcastVariables, hasRecipientVariables } from './render-message.js';
import { addMessageVariation, calculateStaggerDelay, sleep } from './stealth.js';
import { getLinePlanQuotaShortfall, notifyQuotaAlert } from './quota-alert.js';
import { isQuotaExceeded, type QuotaEnv } from './quota.js';
import { URL_TOKEN_SQL } from '../lib/url-token.js';

const MAX_AGE_MS = 23 * 60 * 60 * 1000;
// Checked before each 500-recipient multicast / ten-person push group. One
// group's existing stagger, API calls and receipt writes may exceed this budget.
const DEFAULT_RUN_BUDGET_MS = 10_000;
export const DEDUP_INTENT_REVIEW = '未確定の複数アカウント配信を安全に再試行できません。送信計画を保持して自動送信を止めています。配信状況を確認してください。';
type Recipient = DedupPreviewResult['perAccount'][number]['recipients'][number];
interface Intent {
  version: 1;
  mode: 'multicast' | 'push';
  id: string;
  broadcastId: string;
  accountId: string;
  channelId: string | null;
  sourceKey: string;
  firstAttemptAt: number;
  recipients: Recipient[];
  messages: Message[];
  messageType: string;
  content: string;
  unit: string;
  retryKey: string;
}
interface Progress {
  // Shared across accounts: a logical identity remains sent if another channel
  // becomes its dedup winner. Provider-specific LINE IDs cannot replace this set.
  sentIdentKeys: string[];
  // Quota is rechecked on resume, while the existing alert is emitted once.
  quotaNotifiedAccountIds?: string[];
  pendingRequest?: Intent;
  journalVersion?: 1;
}
export interface DedupDeliverySource {
  id: string;
  title?: string | null;
  account_ids: string | null;
  dedup_priority: string | null;
  target_tag_id?: string | null;
  message_type: string;
  message_content: string;
  alt_text?: string | null;
  aggregation_unit?: string | null;
  dedup_progress?: string | null;
  success_count?: number;
}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === 'string' && !!item);
const uuid = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
function parseProgress(raw: string | null): Progress {
  if (raw === null) return { sentIdentKeys: [] };
  let value: unknown;
  try { value = JSON.parse(raw); } catch { throw new Error(DEDUP_INTENT_REVIEW); }
  if (!object(value) || !strings(value.sentIdentKeys)
    || new Set(value.sentIdentKeys).size !== value.sentIdentKeys.length
    || (value.journalVersion !== undefined && value.journalVersion !== 1)
    || (value.quotaNotifiedAccountIds !== undefined && !strings(value.quotaNotifiedAccountIds))) throw new Error(DEDUP_INTENT_REVIEW);
  return value as unknown as Progress;
}
function validIntent(value: unknown, now: number): value is Intent {
  return object(value) && value.version === 1 && typeof value.id === 'string' && uuid.test(value.id)
    && (value.mode === 'multicast' || value.mode === 'push')
    && typeof value.broadcastId === 'string' && typeof value.accountId === 'string'
    && (value.channelId === null || typeof value.channelId === 'string')
    && typeof value.sourceKey === 'string' && uuid.test(value.sourceKey)
    && typeof value.firstAttemptAt === 'number' && Number.isSafeInteger(value.firstAttemptAt)
    && value.firstAttemptAt <= now && now - value.firstAttemptAt < MAX_AGE_MS
    && typeof value.messageType === 'string' && typeof value.content === 'string'
    && typeof value.unit === 'string' && !!value.unit && typeof value.retryKey === 'string' && uuid.test(value.retryKey)
    && Array.isArray(value.recipients) && value.recipients.length > 0 && value.recipients.length <= 500
    && (value.mode !== 'push' || value.recipients.length === 1)
    && value.recipients.every(item => object(item) && ['friendId', 'lineUserId', 'identKey'].every(key => typeof item[key] === 'string' && !!item[key]))
    && new Set(value.recipients.map(item => item.identKey)).size === value.recipients.length
    && new Set(value.recipients.map(item => item.friendId)).size === value.recipients.length
    && new Set(value.recipients.map(item => item.lineUserId)).size === value.recipients.length
    && Array.isArray(value.messages) && value.messages.length > 0 && value.messages.length <= 5
    && value.messages.every(item => object(item) && typeof item.type === 'string');
}

// The exact serialized progress is an ownership token. Reserving a different
// request or consuming this request changes it; a late worker cannot overwrite it.
const owned = "id = ? AND status = 'sending' AND sent_at IS NULL AND batch_offset = -1 AND dedup_progress IS ?";
export async function releaseDedupDeliveryClaim(db: D1Database, id: string, progress: string | null, error?: string): Promise<void> {
  await db.prepare(`UPDATE broadcasts SET batch_offset = 0, batch_lock_at = NULL
    ${error === undefined ? '' : ', last_error = ?'} WHERE ${owned}`)
    .bind(...(error === undefined ? [] : [error]), id, progress).run();
}

/** No schema change: the existing private dedup_progress also holds one exact in-flight request. */
export async function processJournaledDedupBroadcast(
  db: D1Database, broadcast: DedupDeliverySource, preview: DedupPreviewResult,
  clientFactory: (token: string) => LineClient,
  opts: { maxRunMs?: number; now?: () => number; quotaEnv?: QuotaEnv; startedAt: number },
): Promise<ProcessMultiAccountDedupResult> {
  const clock = opts.now ?? Date.now;
  const started = opts.startedAt;
  const personalized = hasRecipientVariables(broadcast.message_content);
  let sentAny = false;
  let raw = broadcast.dedup_progress ?? null;
  try {
    if (raw === null && (broadcast.success_count ?? 0) > 0) throw new Error(DEDUP_INTENT_REVIEW);
    const progress = parseProgress(raw);
    const sent = new Set(progress.sentIdentKeys);
    const all = new Set(progress.sentIdentKeys);
    const knownFriends = new Set<string>();
    const knownAliases = new Set<string>();
    if (progress.sentIdentKeys.length > 0) {
      // A no-picture friend can move from solo:friend to uid:user during
      // registration. Anchor current identities to the actual accepted friends,
      // without adding aliases to the accepted count or rewriting old receipts.
      const receipts = await db.prepare(`SELECT ml.friend_id,
          COALESCE(${URL_TOKEN_SQL}, 'uid:' || f.user_id, 'solo:' || f.id) AS ident_key
        FROM messages_log ml JOIN friends f ON f.id = ml.friend_id
        WHERE ml.broadcast_id = ? AND ml.direction = 'outgoing'
          AND COALESCE(ml.delivery_type, '') != 'test' AND ml.source = 'broadcast'
          AND ml.line_account_id IN (SELECT value FROM json_each(?))`)
        .bind(broadcast.id, JSON.stringify(preview.perAccount.map(group => group.accountId)))
        .all<{ friend_id: string; ident_key: string }>();
      const rows = receipts.results;
      const complete = rows.length === progress.sentIdentKeys.length && new Set(rows.map(row => row.friend_id)).size === rows.length;
      if (!complete && progress.journalVersion === 1) throw new Error(DEDUP_INTENT_REVIEW);
      if (complete) for (const row of rows) {
        knownFriends.add(row.friend_id);
        knownAliases.add(row.ident_key);
        sent.add(row.ident_key);
      }
    }
    const failed: string[] = [];
    const quotaSkipped: string[] = [];
    const active = [];
    for (const group of preview.perAccount) {
      const account = await getLineAccountById(db, group.accountId);
      if (!account?.is_active) continue;
      active.push({ group, account });
      for (const friend of group.recipients) {
        if (!knownFriends.has(friend.friendId) && !knownAliases.has(friend.identKey)) all.add(friend.identKey);
      }
    }
    const unit = broadcast.aggregation_unit ?? `bcast_${broadcast.id.slice(0, 8).replace(/[^a-zA-Z0-9_]/g, '_')}`;
    const sourceKey = await createBroadcastRetryKey(broadcast.id, 'dedup-source', broadcast.account_ids ?? '',
      broadcast.dedup_priority ?? '', broadcast.target_tag_id ?? '', broadcast.message_type,
      broadcast.message_content, broadcast.alt_text ?? '', unit);
    const result = (complete: boolean): ProcessMultiAccountDedupResult => ({
      totalCount: all.size, successCount: progress.sentIdentKeys.length, failedAccountIds: failed,
      quotaSkippedSummary: quotaSkipped.length ? `LINEプラン月間クォータ不足のため一部アカウントをスキップ: ${quotaSkipped.join('、')}` : null,
      complete, journaledProgress: raw, journaledUnit: unit,
    });
    const save = async (next: Progress): Promise<boolean> => {
      next.journalVersion = 1;
      const serialized = JSON.stringify(next);
      const changed = await db.prepare(`UPDATE broadcasts SET dedup_progress = ?, total_count = MAX(total_count, ?) WHERE ${owned}`)
        .bind(serialized, all.size, broadcast.id, raw).run();
      if (changed.meta.changes !== 1) return false;
      raw = serialized;
      Object.assign(progress, next);
      if (!next.pendingRequest) delete progress.pendingRequest;
      return true;
    };
    const deliver = async (plan: Intent, client: LineClient): Promise<'accepted' | 'rejected' | 'pending' | 'lost'> => {
      const checked = await db.prepare(`UPDATE broadcasts SET dedup_progress = dedup_progress WHERE ${owned}`)
        .bind(broadcast.id, raw).run();
      if (checked.meta.changes !== 1) return 'lost';
      try {
        // An earlier unknown acceptance must be reconciled even if it used up the
        // current quota. A saved request never gets a new recipient list or key.
        if (plan.mode === 'push') {
          await client.pushMessage(plan.recipients[0].lineUserId, plan.messages, plan.retryKey, [plan.unit]);
        } else {
          await client.multicast(plan.recipients.map(friend => friend.lineUserId), plan.messages, [plan.unit], plan.retryKey);
        }
      } catch (error) {
        if (error instanceof LineApiError && error.status >= 400 && error.status < 500 && error.status !== 409) {
          const next = { ...progress }; delete next.pendingRequest;
          return await save(next) ? 'rejected' : 'lost';
        }
        await db.prepare(`UPDATE broadcasts SET last_error = ? WHERE ${owned}`)
          .bind(String(error), broadcast.id, raw).run();
        return 'pending';
      }
      const next: Progress = { ...progress, sentIdentKeys: [...progress.sentIdentKeys, ...plan.recipients.map(friend => friend.identKey)] };
      delete next.pendingRequest;
      const nextRaw = JSON.stringify(next);
      const statements: D1PreparedStatement[] = [];
      for (let offset = 0; offset < plan.recipients.length; offset += 40) {
        const recipients = plan.recipients.slice(offset, offset + 40);
        statements.push(db.prepare(`WITH receipts(id, friend_id) AS (VALUES ${recipients.map(() => '(?, ?)').join(', ')})
          INSERT INTO messages_log(id,friend_id,direction,message_type,content,broadcast_id,scenario_step_id,source,line_account_id,created_at)
          SELECT receipts.id,receipts.friend_id,'outgoing',?,?,?,NULL,'broadcast',?,? FROM receipts
          WHERE EXISTS(SELECT 1 FROM broadcasts WHERE ${owned})`)
          .bind(...recipients.flatMap(friend => [crypto.randomUUID(), friend.friendId]), plan.messageType,
            plan.content, broadcast.id, plan.accountId, jstNow(), broadcast.id, raw));
      }
      statements.push(db.prepare(`UPDATE broadcasts SET dedup_progress = ?, success_count = ? WHERE ${owned}`)
        .bind(nextRaw, next.sentIdentKeys.length, broadcast.id, raw));
      try {
        const recorded = await db.batch(statements);
        if (recorded[recorded.length - 1].meta.changes !== 1) return 'lost';
      } catch {
        // Keep the intent on rollback. A lost commit response may have consumed
        // it already, so the caller's conditional release must not change that row.
        await db.prepare(`UPDATE broadcasts SET last_error = ? WHERE ${owned}`)
          .bind('LINE受付後の記録を確認できないため、保存した送信計画で再試行待ちにしています。', broadcast.id, raw).run();
        return 'pending';
      }
      raw = nextRaw;
      Object.assign(progress, next);
      delete progress.pendingRequest;
      for (const friend of plan.recipients) { sent.add(friend.identKey); all.add(friend.identKey); }
      sentAny = true;
      return 'accepted';
    };
    if (progress.pendingRequest !== undefined) {
      const plan: unknown = progress.pendingRequest;
      const group = active.find(item => item.account.id === (object(plan) ? plan.accountId : undefined));
      const stopForReview = async () => {
        await db.prepare(`UPDATE broadcasts SET last_error = ? WHERE ${owned}`).bind(DEDUP_INTENT_REVIEW, broadcast.id, raw).run();
        return result(false);
      };
      if (!validIntent(plan, Date.now()) || plan.broadcastId !== broadcast.id || plan.sourceKey !== sourceKey || !group
        || plan.messageType !== broadcast.message_type || plan.unit !== unit
        || plan.channelId !== (group.account.channel_id ?? null)
        || plan.mode !== (personalized ? 'push' : 'multicast')
        || plan.recipients.some(friend => sent.has(friend.identKey) || knownFriends.has(friend.friendId) || !group.group.recipients.some(current =>
          current.friendId === friend.friendId && current.identKey === friend.identKey && current.lineUserId === friend.lineUserId))) {
        return stopForReview();
      }
      const currentFriend = group.group.recipients.find(friend => friend.friendId === plan.recipients[0].friendId)!;
      const content = renderBroadcastMessageContent(broadcast.message_type, broadcast.message_content, {
        liffId: group.account.liff_id ?? null,
        ...(personalized ? { displayName: currentFriend.displayName } : {}),
      });
      const key = personalized
        ? await createBroadcastRetryKey(broadcast.id, 'dedup-personalized-push', currentFriend.friendId, broadcast.message_type, content)
        : await createBroadcastRetryKey(broadcast.id, 'dedup-multicast', plan.accountId, ...plan.recipients.map(friend => friend.identKey), JSON.stringify(plan.messages));
      if (plan.content !== content || plan.retryKey !== key
        || (personalized && JSON.stringify(plan.messages) !== JSON.stringify(buildMessages(broadcast.message_type, content, buildMessage, broadcast.alt_text ?? undefined)))) return stopForReview();
      const outcome = await deliver(plan, clientFactory(group.account.channel_access_token));
      if (outcome === 'pending' || outcome === 'lost') return result(false);
      if (outcome === 'rejected') failed.push(plan.accountId);
    }
    for (const { group, account } of active) {
      if (failed.includes(account.id)) continue;
      const remaining = group.recipients.filter(friend => !sent.has(friend.identKey) && !knownFriends.has(friend.friendId));
      if (!remaining.length) continue;
      const client = clientFactory(account.channel_access_token);
      const shortfall = await getLinePlanQuotaShortfall(client, remaining.length);
      if (shortfall) {
        failed.push(account.id);
        quotaSkipped.push(`${account.name || account.id} (残り${shortfall.remaining}通 < 対象${remaining.length}人)`);
        if (!progress.quotaNotifiedAccountIds?.includes(account.id)) {
          await notifyQuotaAlert(db, { lineAccountId: account.id, accountName: account.name, shortfall, source: 'pre-send', broadcastId: broadcast.id, broadcastTitle: broadcast.title ?? undefined });
          if (!await save({ ...progress, quotaNotifiedAccountIds: [...progress.quotaNotifiedAccountIds ?? [], account.id] })) return result(false);
        }
        continue;
      }
      const accountContent = renderBroadcastMessageContent(broadcast.message_type, broadcast.message_content, { liffId: account.liff_id ?? null });
      if (!personalized) assertNoUnresolvedBroadcastVariables(accountContent);
      const messages = personalized ? [] : buildMessages(broadcast.message_type, accountContent, buildMessage, broadcast.alt_text ?? undefined);
      const groupSize = personalized ? 10 : 500;
      for (let offset = 0; offset < remaining.length; offset += groupSize) {
        if ((sentAny && clock() - started > (opts.maxRunMs ?? DEFAULT_RUN_BUDGET_MS)) || (opts.quotaEnv && await isQuotaExceeded(db, opts.quotaEnv))) return result(false);
        const index = Math.floor(offset / groupSize);
        if (index > 0) await sleep(calculateStaggerDelay(remaining.length, index));
        const batch = remaining.slice(offset, offset + groupSize);
        const requests = personalized ? batch.map(friend => [friend]) : [batch];
        for (const recipients of requests) {
          const content = personalized
            ? renderBroadcastMessageContent(broadcast.message_type, accountContent, { displayName: recipients[0].displayName })
            : accountContent;
          assertNoUnresolvedBroadcastVariables(content);
          const batchMessages = personalized
            ? buildMessages(broadcast.message_type, content, buildMessage, broadcast.alt_text ?? undefined)
            : remaining.length > 500 ? messages.map(item => item.type === 'text' ? { ...item, text: addMessageVariation(item.text, index) } : item) : messages;
          const retryKey = personalized
            ? await createBroadcastRetryKey(broadcast.id, 'dedup-personalized-push', recipients[0].friendId, broadcast.message_type, content)
            : await createBroadcastRetryKey(broadcast.id, 'dedup-multicast', account.id, ...recipients.map(friend => friend.identKey), JSON.stringify(batchMessages));
          const plan: Intent = { version: 1, mode: personalized ? 'push' : 'multicast', id: crypto.randomUUID(),
            broadcastId: broadcast.id, accountId: account.id, channelId: account.channel_id ?? null,
            sourceKey, firstAttemptAt: Date.now(), recipients, messages: batchMessages,
            messageType: broadcast.message_type, content, unit, retryKey };
          if (!await save({ ...progress, pendingRequest: plan })) return result(false);
          const outcome = await deliver(plan, client);
          if (outcome === 'pending' || outcome === 'lost') return result(false);
          if (outcome === 'rejected') { failed.push(account.id); break; }
        }
        if (failed.includes(account.id)) break;
      }
    }
    await db.prepare(`UPDATE broadcasts SET failed_account_ids = ?, aggregation_unit = CASE WHEN ? > 0 THEN ? ELSE aggregation_unit END WHERE ${owned}`)
      .bind(failed.length ? JSON.stringify(failed) : null, progress.sentIdentKeys.length, unit, broadcast.id, raw).run();
    return result(true);
  } catch (error) {
    try {
      const reason = error instanceof Error && error.message === DEDUP_INTENT_REVIEW
        ? DEDUP_INTENT_REVIEW
        : '配信処理を継続できませんでした。配信状況を確認してください。';
      await db.prepare(`UPDATE broadcasts SET last_error = ? WHERE ${owned}`)
        .bind(reason, broadcast.id, raw).run();
    } catch { /* preserve the current intent and lock if reporting also fails */ }
    throw error;
  }
}

/** Completion and insight creation consume exactly the last receipt state. */
export async function finishJournaledDedupBroadcast(db: D1Database, id: string, result: ProcessMultiAccountDedupResult): Promise<void> {
  try {
    await db.batch([
    db.prepare(`INSERT INTO broadcast_insights(id,broadcast_id,status) SELECT ?,id,'pending' FROM broadcasts
      WHERE ${owned} AND NOT EXISTS(SELECT 1 FROM broadcast_insights WHERE broadcast_id = broadcasts.id)`)
      .bind(crypto.randomUUID(), id, result.journaledProgress ?? null),
    db.prepare(`UPDATE broadcasts SET status = 'sent', sent_at = ?, batch_lock_at = NULL, dedup_progress = NULL,
      total_count = ?, success_count = ?, last_error = ?, failed_account_ids = ?,
      aggregation_unit = CASE WHEN ? > 0 THEN ? ELSE aggregation_unit END,
      line_request_id = CASE WHEN ? > 0 THEN NULL ELSE line_request_id END WHERE ${owned}`)
      .bind(jstNow(), result.totalCount, result.successCount, result.quotaSkippedSummary,
        result.failedAccountIds.length ? JSON.stringify(result.failedAccountIds) : null,
        result.successCount, result.journaledUnit ?? null, result.successCount, id, result.journaledProgress ?? null),
    ]);
  } catch (error) {
    await db.prepare(`UPDATE broadcasts SET last_error = ? WHERE ${owned}`)
      .bind('配信の完了記録を確認できません。保存済みの進捗から再開を待っています。', id, result.journaledProgress ?? null).run();
    throw error;
  }
}
