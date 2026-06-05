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
  getTrackedLinkById,
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

async function countSent(db: D1Database, friendId: string): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS cnt FROM ad_conversion_logs
        WHERE friend_id = ? AND event_name = 'AddFriend' AND status = 'sent'`,
    )
    .bind(friendId)
    .first<{ cnt: number }>();
  return row?.cnt ?? 0;
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

      // L-TRACK 互換: af_amount を eventValue として渡す
      let eventValue: number | undefined;
      if (entry.tracked_link_id) {
        const link = await getTrackedLinkById(db, entry.tracked_link_id);
        if (link?.af_amount != null) eventValue = link.af_amount;
      }

      // Codex指摘 High: 送信は enqueue 時の ref_tracking_id 直引きで。
      // friend の「最新」を見ると遅延中に踏まれた別広告に切り替わってしまう。
      //
      // Codex指摘 Medium: 送信対象クリックIDが無い (ref_tracking 削除等) ときに
      // sent 扱いするのは誤計上。実際に送信が行われたかをログ件数で確認する。
      const beforeCount = await countSent(db, entry.friend_id);
      if (entry.ref_tracking_id) {
        await sendAdConversionsByRefTrackingId(db, entry.ref_tracking_id, 'AddFriend', eventValue);
      } else {
        // 後方互換: ref_tracking_id が無い古い行は friend の最新を使う
        await sendAdConversions(db, entry.friend_id, 'AddFriend', eventValue);
      }
      const afterCount = await countSent(db, entry.friend_id);
      if (afterCount > beforeCount) {
        await markAfConfirmProcessed(db, entry.id, 'sent');
        result.sent++;
      } else {
        // 何も送られなかった = ref_tracking 不在 or click ID 無し or 全 platform 非アクティブ
        await markAfConfirmProcessed(db, entry.id, 'cancelled', 'no_capi_target');
        result.cancelled++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await markAfConfirmProcessed(db, entry.id, 'failed', msg);
      result.failed++;
    }
  }

  return result;
}
