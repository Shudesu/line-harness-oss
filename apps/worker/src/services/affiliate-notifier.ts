import { LineClient } from '@line-crm/line-sdk';
import {
  getAffiliateById,
  getFriendById,
  getLineAccountById,
} from '@line-crm/db';

/**
 * Affiliate push notifications (ASP).
 *
 * Two operator-facing events push a LINE message to the affiliate (the person
 * who owns the referral link), not to the friend who converted:
 *   A) friend-add via an affiliate link  → notifyAffiliateFriendAdd
 *   B) conversion approved               → notifyAffiliateApproval
 *
 * Both flow through notifyAffiliate, which resolves:
 *   affiliates.friend_id → friends(line_user_id, line_account_id)
 *   → line_accounts.channel_access_token (fallback: env.LINE_CHANNEL_ACCESS_TOKEN)
 *   → LINE push.
 *
 * Best-effort by contract: any failure is swallowed (try/catch + console.error)
 * so it can never break the caller's primary flow (friend attribution / CV
 * approval). Callers should still `await` it — Workers keeps the isolate alive
 * for an awaited promise — but must not let a rejection escape (this never
 * rejects).
 */

/** Minimal env surface needed to resolve the fallback push token. */
export interface AffiliateNotifierEnv {
  LINE_CHANNEL_ACCESS_TOKEN: string;
}

/**
 * Push a plain-text LINE message to the affiliate identified by `affiliateId`.
 *
 * Silently no-ops (returns without throwing) when:
 *   - the affiliate does not exist,
 *   - the affiliate has no bound friend (admin-created affiliate with no LIFF
 *     self-register — friend_id NULL),
 *   - the bound friend row is missing or has no line_user_id,
 *   - no push token can be resolved.
 *
 * Never throws. All errors are logged and swallowed.
 */
export async function notifyAffiliate(
  db: D1Database,
  env: AffiliateNotifierEnv,
  affiliateId: string,
  text: string,
): Promise<void> {
  try {
    const affiliate = await getAffiliateById(db, affiliateId);
    if (!affiliate?.friend_id) return; // unbound affiliate — nothing to push to

    const friend = await getFriendById(db, affiliate.friend_id);
    if (!friend?.line_user_id) return;

    // Resolve the push token from the friend's LINE account, falling back to
    // the env default when the account row / token is absent.
    let accessToken = env.LINE_CHANNEL_ACCESS_TOKEN;
    if (friend.line_account_id) {
      const account = await getLineAccountById(db, friend.line_account_id);
      if (account?.channel_access_token) accessToken = account.channel_access_token;
    }
    if (!accessToken) return;

    const client = new LineClient(accessToken);
    await client.pushMessage(friend.line_user_id, [{ type: 'text', text }]);
  } catch (err) {
    console.error('notifyAffiliate failed (non-blocking):', err);
  }
}

/** Format the reward line with a thousands separator, e.g. 12345 → "12,345". */
function formatYen(amount: number): string {
  return new Intl.NumberFormat('en-US').format(amount);
}

/**
 * A) 友だち追加通知 — a new friend was added through this affiliate's link.
 *
 * `offerName` is the offer (案件) name, or null for a 汎用リンク (generic link).
 */
export async function notifyAffiliateFriendAdd(
  db: D1Database,
  env: AffiliateNotifierEnv,
  affiliateId: string,
  offerName: string | null,
): Promise<void> {
  const offerLine = offerName && offerName.trim() ? offerName : '汎用リンク';
  const text =
    `🎉 あなたの紹介リンクから友だち追加がありました！\n` +
    `案件: ${offerLine}\n` +
    `『アフィリ』と送るとマイページで実績を確認できます`;
  await notifyAffiliate(db, env, affiliateId, text);
}

/**
 * B) 成果承認通知 — a conversion attributed to this affiliate was approved.
 *
 * When `offerName` is set the message includes the fixed reward line. For an
 * offer-less attribution (offerName null) the reward line is omitted and only
 * a generic approval message is sent.
 */
export async function notifyAffiliateApproval(
  db: D1Database,
  env: AffiliateNotifierEnv,
  affiliateId: string,
  offerName: string | null,
  rewardAmount: number,
): Promise<void> {
  let text: string;
  if (offerName && offerName.trim()) {
    text =
      `✅ 成果が承認されました！\n` +
      `案件: ${offerName}\n` +
      `確定報酬: ¥${formatYen(rewardAmount)}\n` +
      `『アフィリ』と送るとマイページで確認できます`;
  } else {
    text =
      `✅ 成果が承認されました！\n` +
      `『アフィリ』と送るとマイページで確認できます`;
  }
  await notifyAffiliate(db, env, affiliateId, text);
}
