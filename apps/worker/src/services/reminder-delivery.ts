import { extractFlexAltText } from '../utils/flex-alt-text.js';

/**
 * リマインダ配信処理 — cronトリガーで定期実行
 *
 * target_date + offset_minutes の時刻が現在時刻以前で
 * まだ配信されていないステップを配信する
 */

import {
  getDueReminderDeliveries,
  completeReminderIfDone,
  getFriendById,
  jstNow,
} from '@line-crm/db';
import type { LineClient, Message } from '@line-crm/line-sdk';
import { addJitter, sleep } from './stealth.js';

export async function processReminderDeliveries(
  db: D1Database,
  lineClient: LineClient,
): Promise<void> {
  const now = jstNow();
  const dueReminders = await getDueReminderDeliveries(db, now);

  for (let i = 0; i < dueReminders.length; i++) {
    const fr = dueReminders[i];
    try {
      // ステルス: バースト回避のためランダム遅延
      if (i > 0) {
        await sleep(addJitter(50, 200));
      }

      const friend = await getFriendById(db, fr.friend_id);
      if (!friend || !friend.is_following) {
        continue;
      }

      // Resolve correct lineClient for this friend's account
      let deliveryClient = lineClient;
      const friendAccountId = (friend as unknown as Record<string, string | null>).line_account_id;
      if (friendAccountId) {
        const { getLineAccountById } = await import('@line-crm/db');
        const account = await getLineAccountById(db, friendAccountId);
        if (account) {
          const { LineClient: LC } = await import('@line-crm/line-sdk');
          deliveryClient = new LC(account.channel_access_token);
        }
      }

      for (const step of fr.steps) {
        const message = buildMessage(step.message_type, step.message_content);
        await deliveryClient.pushMessage(friend.line_user_id, [message]);

        // Mark as delivered AFTER successful send.
        // INSERT OR IGNORE prevents duplicate records if parallel workers both sent.
        // Prefer possible duplicate send over silent message loss on crash.
        const lockId = crypto.randomUUID();
        await db
          .prepare(`INSERT OR IGNORE INTO friend_reminder_deliveries (id, friend_reminder_id, reminder_step_id) VALUES (?, ?, ?)`)
          .bind(lockId, fr.id, step.id)
          .run();

        // メッセージログに記録
        const logId = crypto.randomUUID();
        await db
          .prepare(
            `INSERT INTO messages_log (id, friend_id, direction, message_type, content, source, created_at)
             VALUES (?, ?, 'outgoing', ?, ?, 'reminder', ?)`,
          )
          .bind(logId, friend.id, step.message_type, step.message_content, jstNow())
          .run();
      }

      // 全ステップ配信済みかチェック
      await completeReminderIfDone(db, fr.id, fr.reminder_id);
    } catch (err) {
      console.error(`リマインダ配信エラー (friend_reminder ${fr.id}):`, err);
    }
  }
}

function buildMessage(messageType: string, messageContent: string, altText?: string): Message {
  if (messageType === 'text') {
    return { type: 'text', text: messageContent };
  }
  if (messageType === 'image') {
    try {
      const parsed = JSON.parse(messageContent) as { originalContentUrl: string; previewImageUrl: string };
      return { type: 'image', originalContentUrl: parsed.originalContentUrl, previewImageUrl: parsed.previewImageUrl };
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
