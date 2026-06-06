/**
 * Lark 通知ディスパッチャ。
 *
 * webhook handler や form submit handler から呼ばれて、
 * lark_notifications テーブルの設定どおりに Lark に投稿する。
 *
 * 設計のポイント:
 *  - 呼び出し側は `c.executionCtx.waitUntil(notifyLarkFriendAdded(...))` のように
 *    fire-and-forget で呼ぶ。LINE webhook の 3秒応答制限を守るため。
 *  - 1 イベントに対し複数の lark_notifications がぶら下がる可能性があるので
 *    Promise.allSettled で並列実行 → 個別に log。
 *  - 設定 0 件なら no-op (テスト投稿暴発防止)。
 *  - LARK_APP_ID / LARK_APP_SECRET が未設定の Worker でも他処理に影響しないよう、
 *    取得失敗時は黙って skip log を残す。
 */

import {
  getEnabledLarkNotifications,
  logLarkNotificationResult,
  pruneLarkNotificationLogs,
  type LarkNotification,
  type LarkEventType,
} from '@line-crm/db';
import { sendLarkTextMessage, type LarkReceiveIdType } from '../lib/lark-client.js';

interface LarkEnv {
  DB: D1Database;
  LARK_APP_ID?: string;
  LARK_APP_SECRET?: string;
}

interface NotifyContext {
  env: LarkEnv;
  lineAccountId: string;
  eventType: LarkEventType;
  /** プレースホルダ置換用の値 */
  vars: Record<string, string>;
  /** filter_form_id が一致する設定だけ送る (form_submitted 用) */
  matchFormId?: string;
}

function applyTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_m, key) => vars[key] ?? '');
}

function defaultTemplate(eventType: LarkEventType): string {
  switch (eventType) {
    case 'friend_added':
      return '🎉 新しい友だち追加\n名前: {{friend_name}}\nアカウント: {{account_name}}\n友だち詳細: {{friend_url}}';
    case 'friend_blocked':
      return '🚫 友だちブロック\n名前: {{friend_name}}\nアカウント: {{account_name}}';
    case 'form_submitted':
      return '📝 フォーム回答が届きました\nフォーム: {{form_name}}\n友だち: {{friend_name}}\n友だち詳細: {{friend_url}}';
    case 'unread_timeout':
      return '⏰ 未返信が {{minutes}} 分経過\n友だち: {{friend_name}}\nチャット: {{chat_url}}';
    case 'daily_summary':
      return '📊 本日の hyhome Harness サマリ\n新規: {{new_count}} / ブロック: {{block_count}} / フォーム: {{form_count}}';
    default:
      return '通知';
  }
}

async function sendOneNotification(
  env: LarkEnv,
  notif: LarkNotification,
  vars: Record<string, string>,
  triggerSummary: string,
): Promise<void> {
  const appId = env.LARK_APP_ID;
  const appSecret = env.LARK_APP_SECRET;
  if (!appId || !appSecret) {
    await logLarkNotificationResult(env.DB, notif.id, {
      status: 'skipped',
      errorMessage: 'LARK_APP_ID/LARK_APP_SECRET 未設定',
      triggerSummary,
    });
    return;
  }

  const template = notif.template_text && notif.template_text.trim().length > 0
    ? notif.template_text
    : defaultTemplate(notif.event_type as LarkEventType);
  const text = applyTemplate(template, vars);

  const receiveIdType: LarkReceiveIdType =
    notif.target_type === 'chat' ? 'chat_id'
    : notif.target_type === 'user' ? 'open_id'
    : 'email';

  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const result = await sendLarkTextMessage({
      appId,
      appSecret,
      receiveIdType,
      receiveId: notif.target_id,
      text,
      signal: controller.signal,
    });
    const durationMs = Date.now() - startedAt;
    if (result.ok) {
      await logLarkNotificationResult(env.DB, notif.id, {
        status: 'sent',
        httpStatus: result.httpStatus,
        durationMs,
        triggerSummary,
      });
    } else {
      await logLarkNotificationResult(env.DB, notif.id, {
        status: 'failed',
        httpStatus: result.httpStatus,
        durationMs,
        errorMessage: `code=${result.code ?? ''} msg=${result.errorMessage ?? ''}`.slice(0, 500),
        triggerSummary,
      });
    }
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const isAbort = (err as Error).name === 'AbortError';
    await logLarkNotificationResult(env.DB, notif.id, {
      status: isAbort ? 'timeout' : 'failed',
      durationMs,
      errorMessage: ((err as Error).message ?? '').slice(0, 500),
      triggerSummary,
    });
  } finally {
    clearTimeout(timeout);
  }

  // ログテーブルが肥大化しないよう、たまに prune (200件を超えたら古いの削除)
  try {
    await pruneLarkNotificationLogs(env.DB, notif.id, 200);
  } catch {
    // ベストエフォート
  }
}

async function dispatch(ctx: NotifyContext): Promise<void> {
  let notifs = await getEnabledLarkNotifications(
    ctx.env.DB,
    ctx.lineAccountId,
    ctx.eventType,
  );
  if (ctx.matchFormId !== undefined) {
    notifs = notifs.filter(
      (n) => !n.filter_form_id || n.filter_form_id === ctx.matchFormId,
    );
  }
  if (notifs.length === 0) return;
  const triggerSummary = `${ctx.eventType} (account=${ctx.lineAccountId.slice(0, 8)})`;
  await Promise.allSettled(
    notifs.map((n) => sendOneNotification(ctx.env, n, ctx.vars, triggerSummary)),
  );
}

// ─── 各イベント用の薄いラッパ ──────────────────────────────────────

export async function notifyLarkFriendAdded(
  env: LarkEnv,
  args: {
    lineAccountId: string;
    accountName: string;
    friendName: string;
    friendId: string;
    publicBaseUrl?: string;
  },
): Promise<void> {
  const friendUrl = args.publicBaseUrl
    ? `${args.publicBaseUrl.replace(/\/$/, '')}/friends/${args.friendId}`
    : `/friends/${args.friendId}`;
  await dispatch({
    env,
    lineAccountId: args.lineAccountId,
    eventType: 'friend_added',
    vars: {
      account_name: args.accountName,
      friend_name: args.friendName,
      friend_id: args.friendId,
      friend_url: friendUrl,
    },
  });
}

export async function notifyLarkFriendBlocked(
  env: LarkEnv,
  args: {
    lineAccountId: string;
    accountName: string;
    friendName: string;
    friendId: string;
  },
): Promise<void> {
  await dispatch({
    env,
    lineAccountId: args.lineAccountId,
    eventType: 'friend_blocked',
    vars: {
      account_name: args.accountName,
      friend_name: args.friendName,
      friend_id: args.friendId,
    },
  });
}

export async function notifyLarkFormSubmitted(
  env: LarkEnv,
  args: {
    lineAccountId: string;
    formId: string;
    formName: string;
    friendName: string;
    friendId: string;
    publicBaseUrl?: string;
  },
): Promise<void> {
  const friendUrl = args.publicBaseUrl
    ? `${args.publicBaseUrl.replace(/\/$/, '')}/friends/${args.friendId}`
    : `/friends/${args.friendId}`;
  await dispatch({
    env,
    lineAccountId: args.lineAccountId,
    eventType: 'form_submitted',
    matchFormId: args.formId,
    vars: {
      form_id: args.formId,
      form_name: args.formName,
      friend_name: args.friendName,
      friend_id: args.friendId,
      friend_url: friendUrl,
    },
  });
}

export async function notifyLarkUnreadTimeout(
  env: LarkEnv,
  args: {
    lineAccountId: string;
    friendName: string;
    friendId: string;
    minutes: number;
    publicBaseUrl?: string;
  },
): Promise<void> {
  const chatUrl = args.publicBaseUrl
    ? `${args.publicBaseUrl.replace(/\/$/, '')}/chats/${args.friendId}`
    : `/chats/${args.friendId}`;
  await dispatch({
    env,
    lineAccountId: args.lineAccountId,
    eventType: 'unread_timeout',
    vars: {
      friend_name: args.friendName,
      friend_id: args.friendId,
      minutes: String(args.minutes),
      chat_url: chatUrl,
    },
  });
}

export async function notifyLarkDailySummary(
  env: LarkEnv,
  args: {
    lineAccountId: string;
    newCount: number;
    blockCount: number;
    formCount: number;
  },
): Promise<void> {
  await dispatch({
    env,
    lineAccountId: args.lineAccountId,
    eventType: 'daily_summary',
    vars: {
      new_count: String(args.newCount),
      block_count: String(args.blockCount),
      form_count: String(args.formCount),
    },
  });
}
