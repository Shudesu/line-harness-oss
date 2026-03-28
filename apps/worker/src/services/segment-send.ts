import { extractFlexAltText } from '../utils/flex-alt-text.js';
import {
  getBroadcastById,
  updateBroadcastStatus,
  jstNow,
} from '@line-crm/db';
import type { Broadcast } from '@line-crm/db';
import type { LineClient, Message } from '@line-crm/line-sdk';
import { calculateStaggerDelay, sleep, addMessageVariation } from './stealth.js';
import { buildSegmentQuery } from './segment-query.js';
import type { SegmentCondition } from './segment-query.js';

const MULTICAST_BATCH_SIZE = 500;

interface FriendRow {
  id: string;
  line_user_id: string;
}

export async function processSegmentSend(
  db: D1Database,
  lineClient: LineClient,
  broadcastId: string,
  condition: SegmentCondition,
): Promise<Broadcast> {
  // Mark as sending
  await updateBroadcastStatus(db, broadcastId, 'sending');

  const broadcast = await getBroadcastById(db, broadcastId);
  if (!broadcast) {
    throw new Error(`Broadcast ${broadcastId} not found`);
  }

  const message = buildMessage(broadcast.message_type, broadcast.message_content);

  let totalCount = 0;
  let successCount = 0;

  try {
    // Build and execute segment query to get matching friends
    const { sql, bindings } = buildSegmentQuery(condition);
    const queryResult = await db
      .prepare(sql)
      .bind(...bindings)
      .all<FriendRow>();

    const friends = queryResult.results ?? [];
    totalCount = friends.length;

    const now = jstNow();
    const totalBatches = Math.ceil(friends.length / MULTICAST_BATCH_SIZE);

    for (let i = 0; i < friends.length; i += MULTICAST_BATCH_SIZE) {
      const batchIndex = Math.floor(i / MULTICAST_BATCH_SIZE);
      const batch = friends.slice(i, i + MULTICAST_BATCH_SIZE);
      const lineUserIds = batch.map((f) => f.line_user_id);

      // Stealth: stagger delays between batches
      if (batchIndex > 0) {
        const delay = calculateStaggerDelay(friends.length, batchIndex);
        await sleep(delay);
      }

      // Stealth: add slight variation to text messages
      let batchMessage = message;
      if (message.type === 'text' && totalBatches > 1) {
        batchMessage = { ...message, text: addMessageVariation(message.text, batchIndex) };
      }

      try {
        await lineClient.multicast(lineUserIds, [batchMessage]);
        successCount += batch.length;

        // Log successfully sent messages
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
        console.error(`Segment multicast batch ${batchIndex} failed:`, err);
        // Continue with next batch; failed batch is not logged
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

function buildMessage(messageType: string, messageContent: string, altText?: string): Message {
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
