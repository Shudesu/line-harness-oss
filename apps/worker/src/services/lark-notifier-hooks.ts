/**
 * Phase 3-F1: Lark 通知の各ホットパスへの薄い差し込み層。
 *
 * 「webhook の follow event を受けたら lark-notifier に投げる」みたいな
 * "イベント → notifier" の glue を1ヶ所に集約する。webhook.ts や
 * forms.ts を肥大化させずに済む。
 *
 * 全関数 fire-and-forget で安全に動く前提 (内部で try/catch + skip log)。
 *
 * P1 (2026-06-07): APNs (iOS) 通知も同じイベントで並列に発射する。
 *   - Lark 通知の動作は無変更
 *   - APNS_* env 未設定なら ios-notifier 側で no-op
 *   - 失敗しても Lark 通知に影響させないため Promise.allSettled で並列実行
 */

import type { WebhookEvent } from '@line-crm/line-sdk';
import {
  notifyLarkFriendAdded,
  notifyLarkFriendBlocked,
  notifyLarkFormSubmitted,
} from './lark-notifier.js';
import {
  triggerApnsForFollowEvent,
  triggerApnsForFormSubmit,
  triggerApnsForUnreadTimeout,
} from './ios-notifier.js';

interface MinimalEnv {
  DB: D1Database;
  LARK_APP_ID?: string;
  LARK_APP_SECRET?: string;
  ADMIN_PUBLIC_URL?: string;
  WORKER_PUBLIC_URL?: string;
  // P1: APNs secrets (未設定なら APNs はスキップ、Lark のみ動く)
  APNS_TEAM_ID?: string;
  APNS_KEY_ID?: string;
  APNS_AUTH_KEY?: string;
  APNS_BUNDLE_ID?: string;
}

async function lookupFriendAndAccount(
  db: D1Database,
  lineAccountId: string,
  lineUserId: string,
): Promise<{
  friendId: string;
  friendName: string;
  accountName: string;
} | null> {
  const friend = await db
    .prepare(
      'SELECT id, display_name FROM friends WHERE line_user_id = ? AND (line_account_id = ? OR line_account_id IS NULL) LIMIT 1',
    )
    .bind(lineUserId, lineAccountId)
    .first<{ id: string; display_name: string | null }>();
  if (!friend) return null;
  // Codex 指摘: line_accounts のカラム名は name (display_name ではない)
  const account = await db
    .prepare('SELECT name FROM line_accounts WHERE id = ?')
    .bind(lineAccountId)
    .first<{ name: string | null }>();
  return {
    friendId: friend.id,
    friendName: friend.display_name ?? '(名前未取得)',
    accountName: account?.name ?? '(アカウント名なし)',
  };
}

export async function triggerLarkForFollowEvent(
  env: MinimalEnv,
  db: D1Database,
  lineAccountId: string,
  event: WebhookEvent,
): Promise<void> {
  if (event.type !== 'follow' && event.type !== 'unfollow') return;
  const userId = event.source?.type === 'user' ? event.source.userId : undefined;
  if (!userId) return;

  const found = await lookupFriendAndAccount(db, lineAccountId, userId);
  if (!found) return;

  const publicBaseUrl = env.ADMIN_PUBLIC_URL;

  // P1 (2026-06-07): Lark と APNs を並列発射。片方の失敗が他方に伝播しないように
  // Promise.allSettled。APNs は env 未設定なら no-op (ios-notifier 側でガード)。
  const larkPromise = event.type === 'follow'
    ? notifyLarkFriendAdded(env, {
        lineAccountId,
        accountName: found.accountName,
        friendName: found.friendName,
        friendId: found.friendId,
        publicBaseUrl,
      })
    : notifyLarkFriendBlocked(env, {
        lineAccountId,
        accountName: found.accountName,
        friendName: found.friendName,
        friendId: found.friendId,
      });

  const apnsPromise = triggerApnsForFollowEvent(env, db, {
    lineAccountId,
    accountName: found.accountName,
    friendName: found.friendName,
    friendId: found.friendId,
    eventType: event.type,
  });

  await Promise.allSettled([larkPromise, apnsPromise]);
}

export async function triggerLarkForFormSubmit(
  env: MinimalEnv,
  db: D1Database,
  args: {
    lineAccountId: string;
    formId: string;
    formName: string;
    friendId: string;
    friendName: string;
  },
): Promise<void> {
  // P1 (2026-06-07): Lark と APNs を並列発射。
  const larkPromise = notifyLarkFormSubmitted(env, {
    lineAccountId: args.lineAccountId,
    formId: args.formId,
    formName: args.formName,
    friendName: args.friendName,
    friendId: args.friendId,
    publicBaseUrl: env.ADMIN_PUBLIC_URL,
  });
  const apnsPromise = triggerApnsForFormSubmit(env, db, {
    lineAccountId: args.lineAccountId,
    formId: args.formId,
    formName: args.formName,
    friendId: args.friendId,
    friendName: args.friendName,
  });
  await Promise.allSettled([larkPromise, apnsPromise]);
}

/**
 * P1 (2026-06-07): 未対応タイムアウト時の APNs 通知。
 * 既存の Lark 用 trigger は無いので、呼び出し側 (services/unanswered-inbox.ts 等)
 * からの追加呼び出し用に新規 export。
 */
export async function triggerApnsForUnreadTimeoutEvent(
  env: MinimalEnv,
  db: D1Database,
  args: {
    lineAccountId: string;
    friendId: string;
    friendName: string;
    minutes: number;
  },
): Promise<void> {
  await triggerApnsForUnreadTimeout(env, db, args);
}
