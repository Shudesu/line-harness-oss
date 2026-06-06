/**
 * Phase 3-F1: Lark 通知の各ホットパスへの薄い差し込み層。
 *
 * 「webhook の follow event を受けたら lark-notifier に投げる」みたいな
 * "イベント → notifier" の glue を1ヶ所に集約する。webhook.ts や
 * forms.ts を肥大化させずに済む。
 *
 * 全関数 fire-and-forget で安全に動く前提 (内部で try/catch + skip log)。
 */

import type { WebhookEvent } from '@line-crm/line-sdk';
import {
  notifyLarkFriendAdded,
  notifyLarkFriendBlocked,
  notifyLarkFormSubmitted,
} from './lark-notifier.js';

interface MinimalEnv {
  DB: D1Database;
  LARK_APP_ID?: string;
  LARK_APP_SECRET?: string;
  ADMIN_PUBLIC_URL?: string;
  WORKER_PUBLIC_URL?: string;
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
  const account = await db
    .prepare('SELECT display_name FROM line_accounts WHERE id = ?')
    .bind(lineAccountId)
    .first<{ display_name: string | null }>();
  return {
    friendId: friend.id,
    friendName: friend.display_name ?? '(名前未取得)',
    accountName: account?.display_name ?? '(アカウント名なし)',
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

  if (event.type === 'follow') {
    await notifyLarkFriendAdded(env, {
      lineAccountId,
      accountName: found.accountName,
      friendName: found.friendName,
      friendId: found.friendId,
      publicBaseUrl,
    });
  } else {
    await notifyLarkFriendBlocked(env, {
      lineAccountId,
      accountName: found.accountName,
      friendName: found.friendName,
      friendId: found.friendId,
    });
  }
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
  await notifyLarkFormSubmitted(env, {
    lineAccountId: args.lineAccountId,
    formId: args.formId,
    formName: args.formName,
    friendName: args.friendName,
    friendId: args.friendId,
    publicBaseUrl: env.ADMIN_PUBLIC_URL,
  });
}
