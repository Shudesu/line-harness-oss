import { extractFlexAltText } from '../utils/flex-alt-text.js';
import {
  getBroadcastById,
  getBroadcasts,
  getQueuedBroadcasts,
  updateBroadcastStatus,
  updateBroadcastBatchProgress,
  getFriendsByTag,
  jstNow,
  updateBroadcastLineRequestId,
  createBroadcastInsight,
  setBroadcastLastError,
} from '@line-crm/db';
import type { Broadcast } from '@line-crm/db';
import type { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import { calculateStaggerDelay, sleep, addMessageVariation } from './stealth.js';
import {
  assertNoUnresolvedBroadcastVariables,
  getUnsupportedBroadcastVariables,
  hasRecipientVariables,
  renderBroadcastMessageContent,
} from './render-message.js';
import { createBroadcastRetryKey } from './broadcast-retry-key.js';
import {
  isQuotaExceeded,
  quotaEnabled,
  getQuotaUsage,
  estimateSendAudience,
  personalizedAudienceCount,
  wouldExceedMonthlyQuota,
  type QuotaEnv,
} from './quota.js';

import {
  allTargetGuardAudience,
  getLinePlanQuotaShortfall,
  isLineMonthlyLimit429,
  LinePlanQuotaError,
  notifyQuotaAlert,
  readPlanQuotaSnapshot,
} from './quota-alert.js';

const MULTICAST_BATCH_SIZE = 500;
const PERSONALIZED_PUSH_BATCH_SIZE = 10;

/**
 * LINE プラン月間クォータの送信前ガード (2026-09-01 事故対応)。
 * 不足が確定したら broadcasts.last_error に理由を記録し、オペレーターへ通知した
 * 上で LinePlanQuotaError を投げる。足りていれば何もしない。
 * クォータ確認 API の失敗は fail-open (getLinePlanQuotaShortfall 内) — 送信は
 * 止めない。audience は lazy 関数でも渡せる (上限なしプランなら COUNT が走らない)。
 */
async function assertLinePlanQuota(
  db: D1Database,
  lineClient: LineClient,
  broadcast: Broadcast,
  audience: number | (() => Promise<number>),
): Promise<void> {
  const shortfall = await getLinePlanQuotaShortfall(lineClient, audience);
  if (!shortfall) return;

  const accountId = broadcast.line_account_id ?? null;
  let accountName: string | null = null;
  if (accountId) {
    try {
      const { getLineAccountById } = await import('@line-crm/db');
      accountName = (await getLineAccountById(db, accountId))?.name ?? null;
    } catch {
      // 名前解決は通知の見栄えのためだけ。失敗しても ID 表記で続行する。
    }
  }

  const reason =
    `LINEプラン月間クォータ不足のため送信を中止: ` +
    `残り${shortfall.remaining}通 < 配信対象${shortfall.audience}人 ` +
    `(上限${shortfall.limit}通・消費${shortfall.consumption}通)`;
  await setBroadcastLastError(db, broadcast.id, reason);
  // 単一アカウント運用 (line_account_id NULL) は通知キーとして 'default' を使う
  // (env トークンの既定アカウントに相当)。pre-send 通知は dedup されないので、
  // ban-monitor 側の実 ID キーと分かれていても通知が消えることはない。
  await notifyQuotaAlert(db, {
    lineAccountId: accountId ?? 'default',
    accountName,
    shortfall,
    source: 'pre-send',
    broadcastId: broadcast.id,
    broadcastTitle: broadcast.title,
  });
  throw new LinePlanQuotaError(shortfall);
}

/**
 * queue 経路用の送信前ガード。throw するとロック (batch_offset=-1) が残って
 * recover 待ちになるため、不足時は draft へ戻して true を返す (理由は
 * last_error + 通知に記録済み。draft なので次 tick 以降は拾われない)。
 */
async function revertQueuedBroadcastOnQuotaShortfall(
  db: D1Database,
  lineClient: LineClient,
  broadcast: Broadcast,
  audience: number | (() => Promise<number>),
): Promise<boolean> {
  try {
    await assertLinePlanQuota(db, lineClient, broadcast, audience);
    return false;
  } catch (err) {
    if (!(err instanceof LinePlanQuotaError)) throw err;
    await db.prepare(
      `UPDATE broadcasts SET status = 'draft', batch_offset = 0, batch_lock_at = NULL WHERE id = ?`,
    ).bind(broadcast.id).run();
    return true;
  }
}

/**
 * ガード通過後に LINE 本体がクォータ超過 429 を返したときの記録 + 通知。
 * ここに来るのは送信前ガードが fail-open した (quota API の一時失敗) か、
 * audience を過小見積もりしたケース — 記録しないと「配信が silent に draft へ
 * 落ちた」という 2026-09-01 事故の形が内部経路で再演される (プロキシ経路には
 * line-proxy.ts に同種の網がある)。best-effort: この関数の失敗が本来のエラー
 * 処理 (draft 戻し) を壊さないよう例外はすべて握りつぶす。
 */
async function recordInternalUpstreamQuota429(
  db: D1Database,
  lineClient: LineClient,
  broadcast: Broadcast,
  outcome: { kind: 'reverted' } | { kind: 'partial'; successCount: number; totalCount: number },
): Promise<void> {
  try {
    let snapshot: Awaited<ReturnType<typeof readPlanQuotaSnapshot>> = null;
    try {
      snapshot = await readPlanQuotaSnapshot(lineClient);
    } catch {
      // 残量詳細が取れなくても「超過した」事実は通知する (limit=0 の合成 shortfall)
    }
    // audience=0 は「対象人数は算出していない」印 (notifyQuotaAlert が人数の節を省く)。
    const shortfall = snapshot
      ? { ...snapshot, audience: 0 }
      : { limit: 0, consumption: 0, remaining: 0, audience: 0 };

    const accountId = broadcast.line_account_id ?? null;
    let accountName: string | null = null;
    if (accountId) {
      try {
        const { getLineAccountById } = await import('@line-crm/db');
        accountName = (await getLineAccountById(db, accountId))?.name ?? null;
      } catch {
        // 名前解決は見栄えのためだけ。失敗しても ID 表記で続行する。
      }
    }

    const quotaNote = snapshot ? ` (残り${snapshot.remaining}通 / 上限${snapshot.limit}通)` : '';
    await setBroadcastLastError(
      db,
      broadcast.id,
      outcome.kind === 'reverted'
        ? `LINEがクォータ超過 (429) で送信を拒否したため下書きに戻しました${quotaNote}`
        : `LINEがクォータ超過 (429) を返したため残りのバッチを中止しました` +
            ` (送信済み${outcome.successCount}/${outcome.totalCount}人)${quotaNote}`,
    );
    await notifyQuotaAlert(db, {
      lineAccountId: accountId ?? 'default',
      accountName,
      shortfall,
      source: 'upstream-429',
      broadcastId: broadcast.id,
      broadcastTitle: broadcast.title,
    });
  } catch (err) {
    console.error(`upstream 429 の記録に失敗 (broadcast ${broadcast.id}):`, err);
  }
}

export async function processBroadcastSend(
  db: D1Database,
  lineClient: LineClient,
  broadcastId: string,
  workerUrl?: string,
): Promise<Broadcast> {
  // Mark as sending
  await updateBroadcastStatus(db, broadcastId, 'sending');

  const broadcast = await getBroadcastById(db, broadcastId);
  if (!broadcast) {
    throw new Error(`Broadcast ${broadcastId} not found`);
  }

  const unsupportedVariables = getUnsupportedBroadcastVariables(broadcast.message_content);
  if (unsupportedVariables.length > 0) {
    throw new Error(
      `Unsupported broadcast variables: ${unsupportedVariables.map((v) => `{{${v}}}`).join(', ')}`,
    );
  }

  // A recipient variable cannot be delivered through LINE broadcast or
  // multicast because those endpoints accept one shared Message object.
  // Convert scheduled/direct sends into the resumable queue path.
  if (hasRecipientVariables(broadcast.message_content)
    && broadcast.target_type !== 'multi-account-dedup') {
    const raw = broadcast as unknown as Record<string, unknown>;
    const accountId = raw.line_account_id as string | null;
    const where: string[] = ['f.is_following = 1'];
    const binds: unknown[] = [];
    if (accountId) {
      where.push('f.line_account_id = ?');
      binds.push(accountId);
    }
    if (broadcast.target_type === 'tag') {
      if (!broadcast.target_tag_id) throw new Error('target_tag_id is required for personalized tag broadcast');
      where.push('EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)');
      binds.push(broadcast.target_tag_id);
    }
    const audience = await db.prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN f.display_name IS NULL OR trim(f.display_name) = '' THEN 1 ELSE 0 END) AS missing_name
         FROM friends f WHERE ${where.join(' AND ')}`,
    ).bind(...binds).first<{ total: number; missing_name: number | null }>();
    if (Number(audience?.missing_name ?? 0) > 0) {
      throw new Error(`Cannot personalize broadcast: ${audience!.missing_name} recipient(s) have no display name`);
    }
    const conditions = broadcast.target_type === 'tag'
      ? { operator: 'AND', rules: [
          { type: 'is_following', value: true },
          { type: 'tag_exists', value: broadcast.target_tag_id },
        ] }
      : { operator: 'AND', rules: [{ type: 'is_following', value: true }] };
    await db.prepare(
      `UPDATE broadcasts
          SET status = 'sending', batch_offset = 0, total_count = ?, segment_conditions = ?
        WHERE id = ?`,
    ).bind(Number(audience?.total ?? 0), JSON.stringify(conditions), broadcast.id).run();
    return (await getBroadcastById(db, broadcastId))!;
  }

  // multi-account-dedup は inline 送信せず cron queue (processQueuedBroadcasts) に委譲する。
  // この関数は scheduled / 即時の単一 account 経路用で、毎回 auto-track を実行する。dedup を
  // ここで送ると (1) auto-track がここと queue 側で二重実行されて tracked link が重複し、
  // (2) 分割送信 (chunking) の継続が queue 側にあるため partial-sent のまま sent 扱いになる。
  // よって total_count だけ確定して status='sending', batch_offset=0 にし、queue に渡す。
  // total_count は executor が inactive を skip するのに合わせ、active アカウントの当選者数で
  // 計算する (routes 即時送信パスと同じロジック)。
  if (broadcast.target_type === 'multi-account-dedup') {
    const { computeDedupBroadcastPreview } = await import('./dedup-broadcast.js');
    const accountIds = (broadcast.account_ids ? JSON.parse(broadcast.account_ids) : []) as string[];
    const dedupPriority = (broadcast.dedup_priority ? JSON.parse(broadcast.dedup_priority) : []) as string[];
    const preview = await computeDedupBroadcastPreview(db, accountIds, dedupPriority, broadcast.target_tag_id ?? null);
    let projectedTotal = 0;
    const { getLineAccountById } = await import('@line-crm/db');
    for (const a of preview.perAccount) {
      const account = await getLineAccountById(db, a.accountId);
      if (account && account.is_active) projectedTotal += a.recipients.length;
    }
    await db
      .prepare(`UPDATE broadcasts SET status = 'sending', batch_offset = 0, total_count = ? WHERE id = ?`)
      .bind(projectedTotal, broadcast.id)
      .run();
    return (await getBroadcastById(db, broadcastId))!;
  }

  // Auto-wrap URLs with tracking links (text with URLs → Flex with button)
  // track_links=0 の broadcast は明示的に短縮 OFF (URL をそのまま送る)。
  const broadcastAccountId = (broadcast as unknown as Record<string, unknown>).line_account_id as string | null;
  let finalType: string = broadcast.message_type;
  let finalContent = broadcast.message_content;
  if (workerUrl && broadcast.track_links !== 0) {
    const { autoTrackContent } = await import('./auto-track.js');
    const tracked = await autoTrackContent(db, broadcast.message_type, broadcast.message_content, workerUrl, {
      lineAccountId: broadcastAccountId,
    });
    finalType = tracked.messageType;
    finalContent = tracked.content;
  }
  // {{liff_id}} 置換: broadcast の line_account_id に紐付く LIFF ID で替える。
  // ここは tag / all 系の単一 account 経路のみ (multi-account-dedup は冒頭で queue に
  // 委譲済みで到達しない。dedup の {{liff_id}} 置換は dedup-broadcast.ts 側で per-account
  // に行う)。
  if (broadcastAccountId) {
    const { getLineAccountById: getLA } = await import('@line-crm/db');
    const acct = await getLA(db, broadcastAccountId);
    const liffId = (acct as unknown as { liff_id?: string | null } | null)?.liff_id ?? null;
    finalContent = renderBroadcastMessageContent(finalType, finalContent, { liffId });
  }
  assertNoUnresolvedBroadcastVariables(finalContent);
  const altText = (broadcast as unknown as Record<string, unknown>).alt_text as string | undefined;
  const message = buildMessage(finalType, finalContent, altText || undefined);
  let totalCount = 0;
  let successCount = 0;
  // tag 経路のバッチ送信中に LINE の月間クォータ超過 429 に当たった印。
  // partial 確定 (status='sent') 後に理由の記録と通知を行う。
  let hitUpstreamQuota429 = false;

  try {
    if (broadcast.target_type === 'all') {
      // LINE's broadcast API does not report a recipient count and writes no
      // per-recipient messages_log rows. Record the known follower count so
      // monthly usage tallies (services/quota.ts) can include these sends.
      // The COUNT runs BEFORE the broadcast call: it is a snapshot taken just
      // ahead of the send, and a failing D1 read here aborts with nothing
      // sent. After LINE accepts the broadcast a failure would reset the row
      // to draft and a retry would re-send to everyone — so no D1 read may
      // sit between acceptance and the status update that can be avoided.
      // Legacy friends rows may have a NULL line_account_id yet still follow
      // (and receive) this account's broadcast, so include them. In
      // multi-account setups a NULL row can thus be counted toward more than
      // one account's send — over-counting is the safe direction for a
      // limiting feature (never lets a send slip under the limit uncounted).
      const followerRow = broadcastAccountId
        ? await db
            .prepare('SELECT COUNT(*) as count FROM friends WHERE is_following = 1 AND (line_account_id = ? OR line_account_id IS NULL)')
            .bind(broadcastAccountId)
            .first<{ count: number }>()
        : await db
            .prepare('SELECT COUNT(*) as count FROM friends WHERE is_following = 1')
            .first<{ count: number }>();
      // 送信前クォータガード: 残量が全員配信1回分に満たなければ中止する。
      // throw → 下の catch が draft へ戻す (last_error に理由記録済み)。
      await assertLinePlanQuota(db, lineClient, broadcast, allTargetGuardAudience(db, broadcastAccountId));
      // Use LINE broadcast API (sends to all followers)
      const retryKey = await createBroadcastRetryKey(
        broadcast.id,
        'broadcast',
        finalType,
        finalContent,
      );
      const { requestId } = await lineClient.broadcast([message], retryKey);
      await updateBroadcastLineRequestId(db, broadcast.id, requestId, null);
      totalCount = followerRow?.count ?? 0;
      successCount = totalCount;
    } else if (broadcast.target_type === 'tag') {
      if (!broadcast.target_tag_id) {
        throw new Error('target_tag_id is required for tag-targeted broadcasts');
      }

      const friends = await getFriendsByTag(db, broadcast.target_tag_id);
      const followingFriends = friends.filter((f) => f.is_following);
      totalCount = followingFriends.length;

      // 送信前クォータガード (all と同じ)。バッチ途中でのクォータ切れによる
      // 部分送信をここで未然に防ぐ (タグ対象は followingFriends が実母数なので
      // そのまま渡す)。
      await assertLinePlanQuota(db, lineClient, broadcast, totalCount);

      // Send in batches with stealth delays to mimic human patterns
      const now = jstNow();
      const totalBatches = Math.ceil(followingFriends.length / MULTICAST_BATCH_SIZE);
      const unit = `bcast_${broadcast.id.slice(0, 8)}`;
      for (let i = 0; i < followingFriends.length; i += MULTICAST_BATCH_SIZE) {
        const batchIndex = Math.floor(i / MULTICAST_BATCH_SIZE);
        const batch = followingFriends.slice(i, i + MULTICAST_BATCH_SIZE);
        const lineUserIds = batch.map((f) => f.line_user_id);

        // Stealth: add staggered delay between batches
        if (batchIndex > 0) {
          const delay = calculateStaggerDelay(followingFriends.length, batchIndex);
          await sleep(delay);
        }

        // Stealth: add slight variation to text messages
        let batchMessage = message;
        if (message.type === 'text' && totalBatches > 1) {
          batchMessage = { ...message, text: addMessageVariation(message.text, batchIndex) };
        }

        try {
          const retryKey = await createBroadcastRetryKey(
            broadcast.id,
            'multicast',
            ...batch.map((f) => f.id),
            JSON.stringify(batchMessage),
          );
          await lineClient.multicast(lineUserIds, [batchMessage], [unit], retryKey);
          successCount += batch.length;

          // Log only successfully sent messages (batch insert for performance)
          // line_account_id は broadcast 設定時のアカウントを記録 (送信時点の固定値)。
          // friends.line_account_id は webhook で書き換わる mutable なので使わない。
          const broadcastAccount = (broadcast as unknown as Record<string, unknown>).line_account_id as string | null;
          const logStmts = batch.map(friend =>
            db.prepare(
              `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
               VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, 'broadcast', ?, ?)`,
            ).bind(crypto.randomUUID(), friend.id, broadcast.message_type, broadcast.message_content, broadcastId, broadcastAccount, now),
          );
          await db.batch(logStmts);
        } catch (err) {
          // LINE 由来の月間クォータ超過はバッチ個別の一過性エラーではない —
          // 残りのバッチも全て 429 になるので続行せず中止し、通知して残りを
          // 諦める (status は 'sent' のまま partial として確定。draft へ戻すと
          // リトライで送信済みバッチの友だちに重複配信される)。理由は
          // updateBroadcastStatus('sent') が last_error を clear した後に書く。
          if (isLineMonthlyLimit429(err)) {
            console.error(
              `Multicast aborted at batch ${i / MULTICAST_BATCH_SIZE}: LINE monthly quota exceeded`,
            );
            hitUpstreamQuota429 = true;
            break;
          }
          console.error(`Multicast batch ${i / MULTICAST_BATCH_SIZE} failed:`, err);
          // Continue with next batch; failed batch is not logged
        }
      }
      await updateBroadcastLineRequestId(db, broadcast.id, null, unit);
    }
    // multi-account-dedup はこの関数の冒頭で queue に委譲済み (ここには到達しない)。

    await createBroadcastInsight(db, broadcast.id);
    await updateBroadcastStatus(db, broadcastId, 'sent', { totalCount, successCount });
    // 'sent' 遷移が last_error を clear するので、クォータ 429 の記録はその後に書く。
    if (hitUpstreamQuota429) {
      await recordInternalUpstreamQuota429(db, lineClient, broadcast, {
        kind: 'partial',
        successCount,
        totalCount,
      });
    }
  } catch (err) {
    // ガードを通過した後に LINE 本体がクォータ超過 429 を返したケース
    // ('all' の broadcast API 等)。silent に draft へ落とすと 2026-09-01 事故の
    // 再演になるため、理由の記録と通知を済ませてから戻す。
    if (isLineMonthlyLimit429(err)) {
      await recordInternalUpstreamQuota429(db, lineClient, broadcast, { kind: 'reverted' });
    }
    // On failure, reset to draft so it can be retried
    await updateBroadcastStatus(db, broadcastId, 'draft');
    throw err;
  }

  return (await getBroadcastById(db, broadcastId))!;
}

export async function processScheduledBroadcasts(
  db: D1Database,
  lineClient: LineClient,
  workerUrl?: string,
  quotaEnv?: QuotaEnv,
): Promise<void> {
  const allBroadcasts = await getBroadcasts(db);

  const nowMs = Date.now();
  const scheduled = allBroadcasts.filter(
    (b) =>
      b.status === 'scheduled' &&
      b.scheduled_at !== null &&
      new Date(b.scheduled_at).getTime() <= nowMs,
  );

  for (const broadcast of scheduled) {
    // Bulk sends pause while over quota. Re-checked per broadcast (not once
    // per tick) because an earlier due send in this same loop can cross the
    // limit. The check runs before the claim, so remaining rows stay
    // 'scheduled' and are picked up again once back under the limit.
    if (quotaEnv && quotaEnabled(quotaEnv)) {
      const usage = await getQuotaUsage(db, quotaEnv);
      if (usage.exceeded) return;
      // Same projected-audience refusal as the /send route: a due send whose
      // estimate would cross the monthly limit is skipped before the claim
      // (it stays 'scheduled' and is re-evaluated next tick). Dedup targets
      // have no cheap COUNT (estimateSendAudience → null), so they get the
      // same preview-based projected total as the /send route — computed only
      // when a dedup broadcast is actually due, so normal ticks pay nothing
      // extra. All estimate queries run only while a monthly limit is
      // configured.
      if (usage.monthlyMessages.max > 0) {
        // Each target is estimated against its real send population: dedup
        // uses the preview projection, personalized sends use their exact
        // account-filtered audience (same figure as the /send guard — the
        // generic tag estimate is deliberately unfiltered and would
        // over-estimate them), and everything else uses the cheap generic
        // estimate.
        let estimate: number | null;
        if (broadcast.target_type === 'multi-account-dedup') {
          estimate = await (await import('./dedup-broadcast.js')).projectedDedupAudience(db, broadcast);
        } else if (hasRecipientVariables(broadcast.message_content)) {
          estimate = await personalizedAudienceCount(db, broadcast);
        } else {
          estimate = await estimateSendAudience(db, broadcast);
        }
        if (wouldExceedMonthlyQuota(usage, estimate)) continue;
      }
    }
    try {
      // Optimistic lock: claim this broadcast (scheduled → sending)
      const lockResult = await db
        .prepare(`UPDATE broadcasts SET status = 'sending' WHERE id = ? AND status = 'scheduled'`)
        .bind(broadcast.id)
        .run();
      if (!lockResult.meta.changes || lockResult.meta.changes === 0) continue;

      // Resolve correct lineClient for this broadcast's account
      let deliveryClient = lineClient;
      const accountId = (broadcast as unknown as Record<string, unknown>).line_account_id as string | null;
      if (accountId) {
        const { getLineAccountById } = await import('@line-crm/db');
        const account = await getLineAccountById(db, accountId);
        if (account) {
          const { LineClient: LC } = await import('@line-crm/line-sdk');
          deliveryClient = new LC(account.channel_access_token);
        }
      }

      await processBroadcastSend(db, deliveryClient, broadcast.id, workerUrl);
    } catch (err) {
      console.error(`Failed to send scheduled broadcast ${broadcast.id}:`, err);
      // Reset to scheduled so it can be retried next cron
      try {
        await db.prepare(`UPDATE broadcasts SET status = 'scheduled' WHERE id = ? AND status = 'sending'`)
          .bind(broadcast.id).run();
      } catch (resetErr) {
        console.error(`Failed to reset broadcast ${broadcast.id} status:`, resetErr);
      }
    }
  }
}

/**
 * Cronから呼ばれるキュー処理。status='queued' のブロードキャストを
 * batch_offset から500人ずつ処理する。1回のCron実行で全バッチを処理可能。
 */
export async function processQueuedBroadcasts(
  db: D1Database,
  lineClient: LineClient,
  workerUrl?: string,
  quotaEnv?: QuotaEnv,
): Promise<void> {
  // NOTE: no blanket quota gate here — the queue must be walked even while
  // over the limit so rows that only need finalization can complete (see the
  // pre-claim gate in processQueuedBroadcastBatches). Sends themselves are
  // stopped per batch inside the executor.
  const queued = await getQueuedBroadcasts(db);
  for (const broadcast of queued) {
    // アカウント別のlineClientを解決
    const accountId = (broadcast as unknown as Record<string, unknown>).line_account_id as string | null;
    let client = lineClient;
    if (accountId) {
      const { getLineAccountById } = await import('@line-crm/db');
      const account = await getLineAccountById(db, accountId);
      if (account) client = new (await import('@line-crm/line-sdk')).LineClient(account.channel_access_token);
    }

    try {
      await processQueuedBroadcastBatches(db, client, broadcast, workerUrl, quotaEnv);
    } catch (err) {
      console.error(`Failed to process queued broadcast ${broadcast.id}:`, err);
    }
  }
}

async function processQueuedBroadcastBatches(
  db: D1Database,
  lineClient: LineClient,
  broadcast: import('@line-crm/db').Broadcast,
  workerUrl?: string,
  quotaEnv?: QuotaEnv,
): Promise<void> {
  const raw = broadcast as unknown as Record<string, unknown>;
  const segmentConditionsStr = raw.segment_conditions as string | null;
  const batchOffset = (raw.batch_offset as number) || 0;
  // dedup は分割送信で毎 tick batch_offset=0 から再入する。継続 tick かどうかは
  // dedup_progress の有無で判定する (auto-track の一回性判定とクォータの
  // fresh 判定の両方で使う)。
  const isDedupContinuation =
    broadcast.target_type === 'multi-account-dedup' && !!broadcast.dedup_progress;

  // While over quota, only a FRESH row (nothing sent yet, batch_offset 0 and
  // not a dedup continuation) is skipped — before the claim, so its one-time
  // side effects (auto-track link creation) are not repeated across ticks
  // and it simply stays queued. Rows already mid-run proceed: the
  // between-batch gate below stops further sends, while a row whose
  // recipients are all sent can still finalize to 'sent' instead of sitting
  // in 'sending' until the month rolls over.
  if (
    quotaEnv
    && batchOffset === 0
    && !isDedupContinuation
    && (await isQuotaExceeded(db, quotaEnv))
  ) {
    return;
  }

  // 排他ロック: batch_offset を -1 に設定して他のCronが拾わないようにする
  // WHERE batch_offset = ? で楽観ロック（既に他が処理中なら更新0行→スキップ）
  // batch_lock_at は recoverStalledBroadcasts が「ロック取得後 N 分経過」を判定する
  // ためのタイムスタンプ。created_at だと draft 作成時刻基準で本物の lock age と
  // ずれて Worker 並走 race を引き起こすため別カラムで管理する。
  // 重要: 値は SQL の strftime で生成する。jstNow() の '+09:00' suffix は SQLite で
  // UTC 正規化されて見かけ 9 時間古くなり、recover 側 (julianday('now','+9 hours'))
  // と比較すると即座に「stale」扱いされて lock 取得直後に解除される。created_at
  // 列の DEFAULT と同じ式を使って naive JST に揃える。
  const lockResult = await db.prepare(
    `UPDATE broadcasts SET batch_offset = -1, batch_lock_at = strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours') WHERE id = ? AND batch_offset = ?`,
  ).bind(broadcast.id, batchOffset).run();
  if (!lockResult.meta.changes || lockResult.meta.changes === 0) {
    // 他のCron実行が既に処理中 → スキップ
    return;
  }

  // auto-track（初回のみ）。auto-track は冪等でない (呼ぶたび新 tracked link を作る) ため
  // 「1 broadcast につき 1 回」に厳密化する。non-dedup は batch_offset が 0→N と進むので
  // `batchOffset === 0` が初回判定になる。dedup は分割送信で毎 tick batch_offset=0 から
  // 再入するため、それだけだと毎 tick auto-track が走って tracked link が二重生成される。
  // dedup の初回は dedup_progress=NULL なので、その条件 (isDedupContinuation) を足して
  // 継続 tick では再実行しない (初回に変換結果を message_content へ persist 済みなので、
  // 継続 tick はそれを使う)。
  let finalType: string = broadcast.message_type;
  let finalContent = broadcast.message_content;
  if (workerUrl && batchOffset === 0 && !isDedupContinuation && broadcast.track_links !== 0) {
    const { autoTrackContent } = await import('./auto-track.js');
    // dedup broadcast は複数アカウントから送るためリンクの所有アカウントを一意に
    // 決められない → line_account_id は null のまま (env.LIFF_URL フォールバック)。
    const tracked = await autoTrackContent(db, broadcast.message_type, broadcast.message_content, workerUrl, {
      lineAccountId: (raw.line_account_id as string | null) ?? null,
    });
    finalType = tracked.messageType;
    finalContent = tracked.content;
    // 変換後のコンテンツを保存（次バッチ以降で使えるように）
    if (finalType !== broadcast.message_type || finalContent !== broadcast.message_content) {
      await db.prepare('UPDATE broadcasts SET message_type = ?, message_content = ? WHERE id = ?')
        .bind(finalType, finalContent, broadcast.id).run();
    }
  }

  // {{liff_id}} 置換 (single account 経路のみ; multi は dedup 側で per-account 置換)。
  const queuedAccountId = raw.line_account_id as string | null;
  if (queuedAccountId && broadcast.target_type !== 'multi-account-dedup') {
    const { getLineAccountById: getLA } = await import('@line-crm/db');
    const acct = await getLA(db, queuedAccountId);
    const liffId = (acct as unknown as { liff_id?: string | null } | null)?.liff_id ?? null;
    finalContent = renderBroadcastMessageContent(finalType, finalContent, { liffId });
  }
  const altText = raw.alt_text as string | undefined;
  const message = buildMessage(finalType, finalContent, altText || undefined);

  // multi-account-dedup: delegate to processMultiAccountDedupBroadcast.
  // dedup ループは内部で per-account に {{liff_id}} 置換 + buildMessage する。
  // auto-track で計算された finalType / finalContent を反映した broadcast を
  // 渡す (broadcast 引数の message_content をそのまま使うと auto-track 結果が
  // 落ちる)。
  if (broadcast.target_type === 'multi-account-dedup') {
    const { processMultiAccountDedupBroadcast } = await import('./dedup-broadcast.js');
    const broadcastForDedup = { ...broadcast, message_type: finalType, message_content: finalContent };
    // quotaEnv を渡す: dedup 内部のバッチ境界でも使用量上限を再チェックさせる
    // (下の while ループの再チェックは dedup 委譲経路では通らないため)。
    const result = await processMultiAccountDedupBroadcast(db, broadcastForDedup, undefined, { quotaEnv });
    if (!result.complete) {
      // 時間バジェットに達して途中で yield した。status='sending' のまま batch_offset を
      // -1(ロック) → 0 に戻し、次の cron tick が getQueuedBroadcasts で拾って続きを送る。
      // 進捗 (dedup_progress / success_count) は batch ごとに永続化済みなので、
      // success_count は加算しない (第4引数 0)。これで 5000 人配信でも 1 実行が短く終わり、
      // Worker 時間制限に当たって stall することが無くなる (= 分割送信)。
      await updateBroadcastBatchProgress(db, broadcast.id, 0, 0);
      return;
    }
    await createBroadcastInsight(db, broadcast.id);
    await updateBroadcastStatus(db, broadcast.id, 'sent', {
      totalCount: result.totalCount,
      successCount: result.successCount,
    });
    // 'sent' 遷移は last_error を clear するので、クォータ不足による一部アカウント
    // スキップの理由はその後に書き戻す (部分完了の caveat として UI に残す)。
    if (result.quotaSkippedSummary) {
      await setBroadcastLastError(db, broadcast.id, result.quotaSkippedSummary);
    }
    return;
  }

  // 対象ユーザーリストを取得（アカウントで絞り込む）
  const accountId = raw.line_account_id as string | null;
  let friends: Array<{ id: string; line_user_id: string; display_name: string | null }>;
  if (segmentConditionsStr) {
    const { buildSegmentQuery } = await import('./segment-query.js');
    const condition = JSON.parse(segmentConditionsStr);
    const { sql, bindings } = buildSegmentQuery(condition);
    // アカウントフィルタを追加（line_account_idで絞り込み）
    let accountSql = sql;
    const accountBindings = [...bindings];
    if (accountId) {
      accountSql = sql.replace('WHERE', 'WHERE f.line_account_id = ? AND');
      accountBindings.unshift(accountId);
    }
    const result = await db.prepare(accountSql).bind(...accountBindings).all<{
      id: string;
      line_user_id: string;
      display_name: string | null;
    }>();
    friends = result.results ?? [];
  } else if (broadcast.target_tag_id) {
    const { getFriendsByTag } = await import('@line-crm/db');
    const tagFriends = await getFriendsByTag(db, broadcast.target_tag_id);
    friends = tagFriends.filter(f => f.is_following).map(f => ({
      id: f.id,
      line_user_id: f.line_user_id,
      display_name: f.display_name,
    }));
  } else {
    // target_type='all' でキューに入ることはないが、念のため
    // Same follower-count recording as the inline broadcast-API path (the
    // API reports no recipient count; see services/quota.ts monthly tally).
    // NULL line_account_id rows are included for the same reason as there,
    // and the COUNT likewise runs BEFORE the broadcast call: it is a snapshot
    // taken just ahead of the send, so no avoidable D1 read can fail after
    // LINE has already accepted the broadcast.
    const followerRow = accountId
      ? await db
          .prepare('SELECT COUNT(*) as count FROM friends WHERE is_following = 1 AND (line_account_id = ? OR line_account_id IS NULL)')
          .bind(accountId)
          .first<{ count: number }>()
      : await db
          .prepare('SELECT COUNT(*) as count FROM friends WHERE is_following = 1')
          .first<{ count: number }>();
    const followerCount = followerRow?.count ?? 0;
    // 送信前クォータガード (queue 経路は draft 戻しで中止)。
    if (await revertQueuedBroadcastOnQuotaShortfall(
      db, lineClient, broadcast, allTargetGuardAudience(db, accountId),
    )) {
      return;
    }
    const retryKey = await createBroadcastRetryKey(
      broadcast.id,
      'queued-broadcast',
      finalType,
      finalContent,
    );
    const { requestId } = await lineClient.broadcast([message], retryKey);
    await updateBroadcastLineRequestId(db, broadcast.id, requestId, null);
    await createBroadcastInsight(db, broadcast.id);
    await updateBroadcastStatus(db, broadcast.id, 'sent', { totalCount: followerCount, successCount: followerCount });
    return;
  }

  // 初回: total_count を設定
  if (batchOffset === 0) {
    await db.prepare('UPDATE broadcasts SET total_count = ? WHERE id = ?')
      .bind(friends.length, broadcast.id).run();

    // 送信前クォータガード (fresh 開始時のみ — まだ1通も送っていないので draft へ
    // 戻して安全に中止できる。resume 中の row は既存のバッチ単位失敗処理に任せる)。
    if (await revertQueuedBroadcastOnQuotaShortfall(db, lineClient, broadcast, friends.length)) {
      return;
    }
  }

  const now = jstNow();
  const unit = `bcast_${broadcast.id.slice(0, 8).replace(/[^a-zA-Z0-9_]/g, '_')}`;
  let currentOffset = batchOffset;
  const personalized = hasRecipientVariables(finalContent);
  const unsupportedVariables = getUnsupportedBroadcastVariables(finalContent);
  if (unsupportedVariables.length > 0) {
    await updateBroadcastBatchProgress(db, broadcast.id, batchOffset, 0);
    throw new Error(
      `Unsupported broadcast variables: ${unsupportedVariables.map((v) => `{{${v}}}`).join(', ')}`,
    );
  }
  if (!personalized) {
    try {
      assertNoUnresolvedBroadcastVariables(finalContent);
    } catch (err) {
      await updateBroadcastBatchProgress(db, broadcast.id, batchOffset, 0);
      throw err;
    }
  }
  const deliveryBatchSize = personalized ? PERSONALIZED_PUSH_BATCH_SIZE : MULTICAST_BATCH_SIZE;
  const totalBatches = Math.ceil(friends.length / deliveryBatchSize);

  // 1回のCron実行で全バッチを処理（タイムアウトしない範囲で）
  while (currentOffset < friends.length) {
    // Re-check the usage limits between batches: a run that started under the
    // limit stops as soon as it crosses it, so one run overshoots by at most
    // one batch. Progress is persisted with the offset unlocked and the next
    // tick resumes from here once back under the limit.
    if (quotaEnv && (await isQuotaExceeded(db, quotaEnv))) {
      await updateBroadcastBatchProgress(db, broadcast.id, currentOffset, 0);
      return;
    }
    const batch = friends.slice(currentOffset, currentOffset + deliveryBatchSize);
    const lineUserIds = batch.map(f => f.line_user_id);
    const batchIndex = Math.floor(currentOffset / deliveryBatchSize);

    if (personalized) {
      for (const friend of batch) {
        const alreadyLogged = await db.prepare(
          `SELECT 1 FROM messages_log
            WHERE broadcast_id = ? AND friend_id = ? AND direction = 'outgoing'
              AND COALESCE(delivery_type, '') != 'test'
            LIMIT 1`,
        ).bind(broadcast.id, friend.id).first();
        if (alreadyLogged) {
          currentOffset++;
          continue;
        }

        try {
          const renderedContent = renderBroadcastMessageContent(finalType, finalContent, {
            displayName: friend.display_name,
          });
          assertNoUnresolvedBroadcastVariables(renderedContent);
          const personalizedMessage = buildMessage(finalType, renderedContent, altText || undefined);
          const retryKey = await createBroadcastRetryKey(
            broadcast.id,
            'personalized-push',
            friend.id,
            finalType,
            renderedContent,
          );
          await lineClient.pushMessage(friend.line_user_id, [personalizedMessage], retryKey, [unit]);

          await db.prepare(
            `INSERT INTO messages_log
              (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
             VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, 'broadcast', ?, ?)`,
          ).bind(
            crypto.randomUUID(),
            friend.id,
            finalType,
            renderedContent,
            broadcast.id,
            accountId,
            now,
          ).run();
          currentOffset++;
        } catch (err) {
          console.error(`Personalized broadcast recipient ${friend.id} failed:`, err);
          await db.prepare(
            `UPDATE broadcasts
                SET batch_offset = ?, batch_lock_at = NULL,
                    success_count = (
                      SELECT COUNT(*) FROM messages_log
                       WHERE broadcast_id = ? AND direction = 'outgoing'
                         AND COALESCE(delivery_type, '') != 'test'
                    )
              WHERE id = ?`,
          ).bind(currentOffset, broadcast.id, broadcast.id).run();
          return;
        }
      }

      await db.prepare(
        `UPDATE broadcasts
            SET batch_offset = ?, batch_lock_at = NULL,
                success_count = (
                  SELECT COUNT(*) FROM messages_log
                   WHERE broadcast_id = ? AND direction = 'outgoing'
                     AND COALESCE(delivery_type, '') != 'test'
                )
          WHERE id = ?`,
      ).bind(currentOffset, broadcast.id, broadcast.id).run();
      if (currentOffset < friends.length) return;
      break;
    }

    // ステルス遅延（最初のバッチ以外）
    if (batchIndex > 0) {
      const delay = calculateStaggerDelay(friends.length, batchIndex);
      await sleep(delay);
    }

    // テキストメッセージのバリエーション
    let batchMessage = message;
    if (message.type === 'text' && totalBatches > 1) {
      batchMessage = { ...message, text: addMessageVariation((message as { text: string }).text, batchIndex) };
    }

    try {
      const retryKey = await createBroadcastRetryKey(
        broadcast.id,
        'queued-multicast',
        ...batch.map((f) => f.id),
        JSON.stringify(batchMessage),
      );
      await lineClient.multicast(lineUserIds, [batchMessage], [unit], retryKey);
    } catch (err) {
      console.error(`Queued broadcast batch ${batchIndex} send failed:`, err);
      // 送信失敗: ロック解除 + offsetを保存して次のCronで再開
      await updateBroadcastBatchProgress(db, broadcast.id, currentOffset, 0);
      return; // batch_offset が currentOffset に戻り、次の cron で再開可能
    }

    // 送信成功後のログ・進捗更新（失敗しても再送しない）
    // line_account_id は queue path lock 時の broadcast.line_account_id を使う
    // (friends.line_account_id ではなく送信元アカウントを固定で記録)。
    const queuedBroadcastAccount = (broadcast as unknown as Record<string, unknown>).line_account_id as string | null;
    try {
      const stmts = batch.map(friend =>
        db.prepare(
          `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
           VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, 'broadcast', ?, ?)`,
        ).bind(crypto.randomUUID(), friend.id, finalType, finalContent, broadcast.id, queuedBroadcastAccount, now),
      );
      await db.batch(stmts);
    } catch (logErr) {
      console.error(`Queued broadcast batch ${batchIndex} log failed (messages already sent):`, logErr);
    }

    currentOffset += batch.length;
    // Update success_count but keep batch_offset=-1 (locked) during processing
    await db.prepare(
      `UPDATE broadcasts SET success_count = success_count + ? WHERE id = ?`,
    ).bind(batch.length, broadcast.id).run();
  }

  // 全バッチ完了 — ロック解除 + 完了マーク
  await updateBroadcastLineRequestId(db, broadcast.id, null, unit);
  await createBroadcastInsight(db, broadcast.id);
  await updateBroadcastStatus(db, broadcast.id, 'sent');
}

export function buildMessage(messageType: string, messageContent: string, altText?: string): Message {
  if (messageType === 'text') {
    return { type: 'text', text: messageContent };
  }

  if (messageType === 'image') {
    try {
      const parsed = JSON.parse(messageContent) as {
        originalContentUrl: string;
        previewImageUrl: string;
      };
      return {
        type: 'image',
        originalContentUrl: parsed.originalContentUrl,
        previewImageUrl: parsed.previewImageUrl,
      };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }

  if (messageType === 'flex') {
    try {
      const contents = JSON.parse(messageContent);
      return { type: 'flex', altText: altText || extractFlexAltText(contents), contents };
    } catch {
      return { type: 'text', text: messageContent };
    }
  }

  return { type: 'text', text: messageContent };
}
