import {
  getBroadcastById,
  getBroadcasts,
  updateBroadcastStatus,
  getFriendsByTag,
  getLineAccountById,
  jstNow,
} from '@line-crm/db';
import type { Broadcast } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { buildMessages } from '../utils/build-messages.js';
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
  const messages = buildMessages(finalType, finalContent, altText || undefined);
  const lineAccountId = (broadcast as unknown as Record<string, unknown>).line_account_id as string | null;
  let totalCount = 0;
  let successCount = 0;

  try {
    if (broadcast.target_type === 'all') {
      // Get all following friends for this account
      const allFriendsResult = await db
        .prepare(
          lineAccountId
            ? `SELECT * FROM friends WHERE is_following = 1 AND line_account_id = ?`
            : `SELECT * FROM friends WHERE is_following = 1`,
        )
        .bind(...(lineAccountId ? [lineAccountId] : []))
        .all<{ id: string; line_user_id: string }>();
      const allFriends = allFriendsResult.results;
      totalCount = allFriends.length;

      if (allFriends.length <= MULTICAST_BATCH_SIZE) {
        // Use multicast for small audiences (gives us exact count)
        const lineUserIds = allFriends.map((f) => f.line_user_id);
        if (lineUserIds.length > 0) {
          await lineClient.multicast(lineUserIds, messages);
          successCount = lineUserIds.length;
        }
      } else {
        // Use LINE broadcast API for large audiences
        await lineClient.broadcast(messages);
        successCount = totalCount;
      }
    } else if (broadcast.target_type === 'tag') {
      if (!broadcast.target_tag_id) {
        throw new Error('target_tag_id is required for tag-targeted broadcasts');
      }

      const friends = await getFriendsByTag(db, broadcast.target_tag_id, lineAccountId || undefined);
      const followingFriends = friends.filter((f) => f.is_following);
      totalCount = followingFriends.length;

      // Send in batches with stealth delays to mimic human patterns
      const now = jstNow();
      const totalBatches = Math.ceil(followingFriends.length / MULTICAST_BATCH_SIZE);
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
        let batchMessages = messages;
        if (totalBatches > 1) {
          batchMessages = messages.map((m) =>
            m.type === 'text' ? { ...m, text: addMessageVariation(m.text, batchIndex) } : m,
          );
        }

        try {
          await lineClient.multicast(lineUserIds, batchMessages);
          successCount += batch.length;

          // Log only successfully sent messages
          for (const friend of batch) {
            const logId = crypto.randomUUID();
            await db
              .prepare(
                `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, created_at)
                 VALUES (?, ?, 'outgoing', ?, ?, ?, NULL, ?)`,
              )
              .bind(logId, friend.id, broadcast.message_type, broadcast.message_content, broadcastId, now)
              .run();
          }
        } catch (err) {
          console.error(`Multicast batch ${i / MULTICAST_BATCH_SIZE} failed:`, err);
          // Continue with next batch; failed batch is not logged
        }
      }
    }

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
  fallbackLineClient: LineClient,
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
      // Use the correct LINE account token for each broadcast
      const lineAccountId = (broadcast as unknown as Record<string, unknown>).line_account_id as string | null;
      let client = fallbackLineClient;
      if (lineAccountId) {
        const account = await getLineAccountById(db, lineAccountId);
        if (account) {
          client = new LineClient(account.channel_access_token);
        }
      }
      await processBroadcastSend(db, client, broadcast.id, workerUrl);
    } catch (err) {
      console.error(`Failed to send scheduled broadcast ${broadcast.id}:`, err);
      // Continue with next broadcast
    }
  }
}

