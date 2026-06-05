/**
 * L-TRACK 互換: af_confirm_queue の処理ジョブ
 *
 * scheduled cron tick から呼ぶ。
 *  1) scheduled_at <= now の pending を取得
 *  2) friend.is_following = 0（ブロック）なら status='cancelled' で確定取消
 *  3) sendAdConversions('AddFriend') を呼ぶ。成功 = 'sent'、失敗 = 'failed' (リトライ)
 *
 * リトライ上限を超えた pending は別途 failoverStuckAfConfirms で 'failed' に確定。
 */

import {
  getDueAfConfirms,
  markAfConfirmProcessed,
  failoverStuckAfConfirms,
  claimAfConfirm,
  getFriendById,
} from '@line-crm/db';
import { sendAdConversions, sendAdConversionsByRefTrackingId } from './ad-conversion.js';

const MAX_BATCH = 100;
const MAX_ATTEMPTS = 5;

export interface AfConfirmProcessResult {
  considered: number;
  sent: number;
  cancelled: number;
  failed: number;
}

export async function processAfConfirmDelayed(
  db: D1Database,
): Promise<AfConfirmProcessResult> {
  const result: AfConfirmProcessResult = {
    considered: 0,
    sent: 0,
    cancelled: 0,
    failed: 0,
  };

  // 取りこぼし防止: 上限超え分を先に failed 確定
  await failoverStuckAfConfirms(db, MAX_ATTEMPTS);

  const due = await getDueAfConfirms(db, MAX_BATCH);
  result.considered = due.length;

  for (const entry of due) {
    // Codex指摘 High: 二重処理防止のための claim。pending→processing を競合勝者だけが取れる。
    const claimed = await claimAfConfirm(db, entry.id);
    if (!claimed) continue; // 他 tick が既に処理中
    try {
      const friend = await getFriendById(db, entry.friend_id);
      if (!friend) {
        // friend が消えていたら確定取消
        await markAfConfirmProcessed(db, entry.id, 'cancelled', 'friend_not_found');
        result.cancelled++;
        continue;
      }
      // is_following=0 はブロック中。CV送らない＝広告計測を汚さない。
      if ((friend as { is_following?: number }).is_following === 0) {
        await markAfConfirmProcessed(db, entry.id, 'cancelled', 'blocked');
        result.cancelled++;
        continue;
      }

      // Codex指摘 High: 送信は enqueue 時の ref_tracking_id 直引きで。
      // friend の「最新」を見ると遅延中に踏まれた別広告に切り替わってしまう。
      if (entry.ref_tracking_id) {
        await sendAdConversionsByRefTrackingId(db, entry.ref_tracking_id, 'AddFriend');
      } else {
        // 後方互換: ref_tracking_id が無い古い行は friend の最新を使う
        await sendAdConversions(db, entry.friend_id, 'AddFriend');
      }
      await markAfConfirmProcessed(db, entry.id, 'sent');
      result.sent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markAfConfirmProcessed(db, entry.id, 'failed', msg);
      result.failed++;
    }
  }

  return result;
}
