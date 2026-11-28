import { claimPendingRefClicks, getEntryRouteByRefCode } from '@line-crm/db';
import { attachTagAndFireSideEffects } from './friend-tag-attach.js';

/**
 * LIFF で友だち追加前に開かれたリファラルの保留クリックを友だちに結び直し、
 * 流入元（friends.ref_code）とルートのタグを付ける。follow webhook と
 * /api/liff/link（保留保存の直後に友だちが既にいた場合）の両方から呼ぶ。
 * claim は friend_id IS NULL の行だけを更新するので、二重に呼んでも安全。
 */
export async function applyPendingReferral(
  db: D1Database,
  input: {
    lineUserId: string;
    lineAccountId: string | null;
    friendId: string;
    defaultAccessToken: string;
    workerUrl?: string;
  },
): Promise<string | null> {
  const ref = await claimPendingRefClicks(db, input.lineUserId, input.lineAccountId, input.friendId);
  if (!ref) return null;
  const route = await getEntryRouteByRefCode(db, ref);
  if (route?.tag_id) {
    await attachTagAndFireSideEffects(
      db,
      input.friendId,
      route.tag_id,
      { defaultAccessToken: input.defaultAccessToken, workerUrl: input.workerUrl },
      { lineAccountId: input.lineAccountId },
    );
  }
  return ref;
}
