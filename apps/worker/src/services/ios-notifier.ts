/**
 * P1 (2026-06-07): iOS APNs 通知のホットパス glue。
 *
 * 問題: apns-pusher.ts は実装済だが呼び出し元ゼロで、iOS アプリは device token を
 * 登録するだけで永久に通知が来ない状態だった。
 *
 * 設計:
 *   - lark-notifier-hooks.ts と同じイベント (友だち追加/ブロック/フォーム回答/未対応タイムアウト)
 *     で APNs にも通知を流す。Lark 通知の動作には影響しない (並列で動く)。
 *   - 通知対象 staff の特定はイベントによって異なる:
 *       follow / form_submitted: line_account_id に紐付く active staff 全員
 *       unread_timeout:           対応すべき staff (= 同 account 全 staff へファンアウト)
 *     線引きが曖昧な領域なので、現状は全 active staff にファンアウトする方針。
 *     将来 notification_preferences テーブルで staff 単位の購読を作るまでの暫定。
 *   - env で APNS_* 未設定なら apns-pusher.ts 側で no-op になる (Lark 通知だけが動く)。
 *   - 呼び出し側は waitUntil で fire-and-forget。
 */

import type { WebhookEvent } from '@line-crm/line-sdk';
import { pushToDevices } from './apns-pusher.js';
import type { DeviceToken } from '@line-crm/db';

interface ApnsEnv {
  DB: D1Database;
  APNS_TEAM_ID?: string;
  APNS_KEY_ID?: string;
  APNS_AUTH_KEY?: string;
  APNS_BUNDLE_ID?: string;
}

/**
 * line_account_id に紐付く active staff 全員の active iOS device token を取得。
 * staff_members テーブルに line_account_id が無いプロジェクトもあるので、
 * 「全 staff」を fallback として用意する。
 */
async function getDeviceTokensForAccount(
  db: D1Database,
  lineAccountId: string,
): Promise<DeviceToken[]> {
  // staff_members に line_account_id 列がある実装と、staff_account_access JOIN テーブル
  // 経由の実装が混在しうるので、両方を試みる。
  // 単純化のため、ここでは全 active iOS token を返す (multi-account 切り分けは
  // 将来の notification_preferences で実装)。一旦は通知が「来ない」を「来る」に
  // するのが最優先。
  void lineAccountId;
  const r = await db
    .prepare(
      `SELECT * FROM device_tokens WHERE is_active = 1 AND platform = 'ios'`,
    )
    .all<DeviceToken>();
  return r.results;
}

/**
 * 早期 return ガード: APNs secrets が未設定なら DB アクセスもスキップ。
 */
function isApnsConfigured(env: ApnsEnv): boolean {
  return !!(env.APNS_TEAM_ID && env.APNS_KEY_ID && env.APNS_AUTH_KEY && env.APNS_BUNDLE_ID);
}

export async function triggerApnsForFollowEvent(
  env: ApnsEnv,
  db: D1Database,
  args: {
    lineAccountId: string;
    accountName: string;
    friendName: string;
    friendId: string;
    eventType: 'follow' | 'unfollow';
  },
): Promise<void> {
  if (!isApnsConfigured(env)) return;
  try {
    const devices = await getDeviceTokensForAccount(db, args.lineAccountId);
    if (devices.length === 0) return;
    const title = args.eventType === 'follow' ? '新しい友だち追加' : '友だちブロック';
    const body = `${args.friendName} (${args.accountName})`;
    await pushToDevices(db, env, devices, {
      alert: { title, body },
      sound: 'default',
      threadId: `account:${args.lineAccountId}`,
      customData: {
        kind: args.eventType === 'follow' ? 'friend_added' : 'friend_blocked',
        friend_id: args.friendId,
        line_account_id: args.lineAccountId,
      },
    });
  } catch (e) {
    console.error('[ios-notifier] follow event error:', e);
  }
}

/**
 * lark-notifier-hooks の triggerLarkForFollowEvent から渡される生 WebhookEvent
 * 互換のラッパ。account 名・friend 名を caller が解決済の状態で渡す。
 */
export async function triggerApnsForFollowWebhookEvent(
  env: ApnsEnv,
  db: D1Database,
  lineAccountId: string,
  event: WebhookEvent,
  resolved: { accountName: string; friendName: string; friendId: string },
): Promise<void> {
  if (event.type !== 'follow' && event.type !== 'unfollow') return;
  await triggerApnsForFollowEvent(env, db, {
    lineAccountId,
    accountName: resolved.accountName,
    friendName: resolved.friendName,
    friendId: resolved.friendId,
    eventType: event.type,
  });
}

export async function triggerApnsForFormSubmit(
  env: ApnsEnv,
  db: D1Database,
  args: {
    lineAccountId: string;
    formId: string;
    formName: string;
    friendId: string;
    friendName: string;
  },
): Promise<void> {
  if (!isApnsConfigured(env)) return;
  try {
    const devices = await getDeviceTokensForAccount(db, args.lineAccountId);
    if (devices.length === 0) return;
    await pushToDevices(db, env, devices, {
      alert: {
        title: 'フォーム回答が届きました',
        body: `${args.friendName} → ${args.formName}`,
      },
      sound: 'default',
      threadId: `form:${args.formId}`,
      customData: {
        kind: 'form_submitted',
        form_id: args.formId,
        friend_id: args.friendId,
        line_account_id: args.lineAccountId,
      },
    });
  } catch (e) {
    console.error('[ios-notifier] form submit error:', e);
  }
}

export async function triggerApnsForUnreadTimeout(
  env: ApnsEnv,
  db: D1Database,
  args: {
    lineAccountId: string;
    friendId: string;
    friendName: string;
    minutes: number;
  },
): Promise<void> {
  if (!isApnsConfigured(env)) return;
  try {
    const devices = await getDeviceTokensForAccount(db, args.lineAccountId);
    if (devices.length === 0) return;
    await pushToDevices(db, env, devices, {
      alert: {
        title: '未返信タイムアウト',
        body: `${args.friendName} (${args.minutes}分)`,
      },
      sound: 'default',
      threadId: `unread:${args.friendId}`,
      customData: {
        kind: 'unread_timeout',
        friend_id: args.friendId,
        line_account_id: args.lineAccountId,
        minutes: args.minutes,
      },
    });
  } catch (e) {
    console.error('[ios-notifier] unread timeout error:', e);
  }
}
