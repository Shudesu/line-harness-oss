import { extractFlexAltText } from '../utils/flex-alt-text.js';
import {
  getBroadcastById,
  getBroadcasts,
  getQueuedBroadcasts,
  updateBroadcastStatus,
  updateBroadcastBatchProgress,
  getFriendsByTag,
  getFriendsExcludingTag,
  jstNow,
  updateBroadcastLineRequestId,
  createBroadcastInsight,
} from '@line-crm/db';
import type { Broadcast } from '@line-crm/db';
import type { LineClient } from '@line-crm/line-sdk';
import type { Message } from '@line-crm/line-sdk';
import { calculateStaggerDelay, sleep, addMessageVariation } from './stealth.js';

const MULTICAST_BATCH_SIZE = 500;

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

  // Auto-wrap URLs with tracking links (text with URLs → Flex with button)
  let finalType: string = broadcast.message_type;
  let finalContent = broadcast.message_content;
  if (workerUrl) {
    const { autoTrackContent } = await import('./auto-track.js');
    const tracked = await autoTrackContent(db, broadcast.message_type, broadcast.message_content, workerUrl);
    finalType = tracked.messageType;
    finalContent = tracked.content;
  }
  const altText = (broadcast as unknown as Record<string, unknown>).alt_text as string | undefined;
  const message = buildMessage(finalType, finalContent, altText || undefined);
  let totalCount = 0;
  let successCount = 0;

  try {
    if (broadcast.target_type === 'all') {
      // Use LINE broadcast API (sends to all followers)
      const { requestId } = await lineClient.broadcast([message]);
      await updateBroadcastLineRequestId(db, broadcast.id, requestId, null);
      // We don't have exact count for broadcast API, set as 0 (unknown)
      totalCount = 0;
      successCount = 0;
    } else if (broadcast.target_type === 'tag' || broadcast.target_type === 'tag_exclude') {
      if (!broadcast.target_tag_id) {
        throw new Error('target_tag_id is required for tag-targeted broadcasts');
      }

      const friends = broadcast.target_type === 'tag_exclude'
        ? await getFriendsExcludingTag(db, broadcast.target_tag_id)
        : await getFriendsByTag(db, broadcast.target_tag_id);
      const followingFriends = friends.filter((f) => f.is_following);
      totalCount = followingFriends.length;

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
          await lineClient.multicast(lineUserIds, [batchMessage], [unit]);
          successCount += batch.length;

          // Log only successfully sent messages (batch insert for performance)
          const logStmts = batch.map(friend =>
            db.prepare(
              `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, created_at)
               VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, 'broadcast', ?)`,
            ).bind(crypto.randomUUID(), friend.id, broadcast.message_type, broadcast.message_content, broadcastId, now),
          );
          await db.batch(logStmts);
        } catch (err) {
          console.error(`Multicast batch ${i / MULTICAST_BATCH_SIZE} failed:`, err);
          // Continue with next batch; failed batch is not logged
        }
      }
      await updateBroadcastLineRequestId(db, broadcast.id, null, unit);
    }

    await createBroadcastInsight(db, broadcast.id);
    await updateBroadcastStatus(db, broadcastId, 'sent', { totalCount, successCount });
  } catch (err) {
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
): Promise<void> {
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
      await processQueuedBroadcastBatches(db, client, broadcast, workerUrl);
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
): Promise<void> {
  const raw = broadcast as unknown as Record<string, unknown>;
  const segmentConditionsStr = raw.segment_conditions as string | null;
  const batchOffset = (raw.batch_offset as number) || 0;

  // 排他ロック: batch_offset を -1 に設定して他のCronが拾わないようにする
  // WHERE batch_offset = ? で楽観ロック（既に他が処理中なら更新0行→スキップ）
  const lockResult = await db.prepare(
    `UPDATE broadcasts SET batch_offset = -1 WHERE id = ? AND batch_offset = ?`,
  ).bind(broadcast.id, batchOffset).run();
  if (!lockResult.meta.changes || lockResult.meta.changes === 0) {
    // 他のCron実行が既に処理中 → スキップ
    return;
  }

  // auto-track（初回バッチのみ、offsetが0のとき）
  let finalType: string = broadcast.message_type;
  let finalContent = broadcast.message_content;
  if (workerUrl && batchOffset === 0) {
    const { autoTrackContent } = await import('./auto-track.js');
    const tracked = await autoTrackContent(db, broadcast.message_type, broadcast.message_content, workerUrl);
    finalType = tracked.messageType;
    finalContent = tracked.content;
    // 変換後のコンテンツを保存（次バッチ以降で使えるように）
    if (finalType !== broadcast.message_type || finalContent !== broadcast.message_content) {
      await db.prepare('UPDATE broadcasts SET message_type = ?, message_content = ? WHERE id = ?')
        .bind(finalType, finalContent, broadcast.id).run();
    }
  }

  const altText = raw.alt_text as string | undefined;
  const message = buildMessage(finalType, finalContent, altText || undefined);

  // 対象ユーザーリストを取得（アカウントで絞り込む）
  const accountId = raw.line_account_id as string | null;
  let friends: Array<{ id: string; line_user_id: string }>;
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
    const result = await db.prepare(accountSql).bind(...accountBindings).all<{ id: string; line_user_id: string }>();
    friends = result.results ?? [];
  } else if (broadcast.target_tag_id) {
    const { getFriendsByTag } = await import('@line-crm/db');
    const tagFriends = await getFriendsByTag(db, broadcast.target_tag_id);
    friends = tagFriends.filter(f => f.is_following).map(f => ({ id: f.id, line_user_id: f.line_user_id }));
  } else {
    // target_type='all' でキューに入ることはないが、念のため
    const { requestId } = await lineClient.broadcast([message]);
    await updateBroadcastLineRequestId(db, broadcast.id, requestId, null);
    await createBroadcastInsight(db, broadcast.id);
    await updateBroadcastStatus(db, broadcast.id, 'sent', { totalCount: 0, successCount: 0 });
    return;
  }

  // 初回: total_count を設定
  if (batchOffset === 0) {
    await db.prepare('UPDATE broadcasts SET total_count = ? WHERE id = ?')
      .bind(friends.length, broadcast.id).run();
  }

  const now = jstNow();
  const unit = `bcast_${broadcast.id.slice(0, 8)}`;
  let currentOffset = batchOffset;
  const totalBatches = Math.ceil(friends.length / MULTICAST_BATCH_SIZE);

  // 1回のCron実行で全バッチを処理（タイムアウトしない範囲で）
  while (currentOffset < friends.length) {
    const batch = friends.slice(currentOffset, currentOffset + MULTICAST_BATCH_SIZE);
    const lineUserIds = batch.map(f => f.line_user_id);
    const batchIndex = Math.floor(currentOffset / MULTICAST_BATCH_SIZE);

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
      await lineClient.multicast(lineUserIds, [batchMessage], [unit]);
    } catch (err) {
      console.error(`Queued broadcast batch ${batchIndex} send failed:`, err);
      // 送信失敗: ロック解除 + offsetを保存して次のCronで再開
      await updateBroadcastBatchProgress(db, broadcast.id, currentOffset, 0);
      return; // batch_offset が currentOffset に戻り、次の cron で再開可能
    }

    // 送信成功後のログ・進捗更新（失敗しても再送しない）
    try {
      const stmts = batch.map(friend =>
        db.prepare(
          `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, created_at)
           VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, 'broadcast', ?)`,
        ).bind(crypto.randomUUID(), friend.id, broadcast.message_type, broadcast.message_content, broadcast.id, now),
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
