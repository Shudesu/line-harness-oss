/**
 * リマインダ配信処理 — cronトリガーで定期実行
 *
 * target_date + offset_minutes の時刻が現在時刻以前で
 * まだ配信されていないステップを配信する
 */

import {
  getDueReminderDeliveries,
  markReminderStepDelivered,
  completeReminderIfDone,
  getFriendById,
  jstNow,
} from '@line-crm/db';
import type { LineClient } from '@line-crm/line-sdk';
import { buildMessages } from '../utils/build-messages.js';
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
        // フォロー解除済み — スキップ
        continue;
      }

      for (const step of fr.steps) {
        const messages = buildMessages(step.message_type, step.message_content);
        await lineClient.pushMessage(friend.line_user_id, messages);

        // メッセージログに記録
        const logId = crypto.randomUUID();
        await db
          .prepare(
            `INSERT INTO messages_log (id, friend_id, direction, message_type, content, created_at)
             VALUES (?, ?, 'outgoing', ?, ?, ?)`,
          )
          .bind(logId, friend.id, step.message_type, step.message_content, jstNow())
          .run();

        // 配信済みを記録
        await markReminderStepDelivered(db, fr.id, step.id);
      }

      // 全ステップ配信済みかチェック
      await completeReminderIfDone(db, fr.id, fr.reminder_id);
    } catch (err) {
      console.error(`リマインダ配信エラー (friend_reminder ${fr.id}):`, err);
    }
  }
}

