import type { LineClient, Message } from '@line-crm/line-sdk';
import { getLineAccountById, getTemplateById } from '@line-crm/db';
import type { AutoReply, Friend } from '@line-crm/db';
import { logOutgoingMessage } from './event-bus.js';
import { renderBroadcastMessageContent } from './render-message.js';
import {
  buildMessage,
  expandVariables,
  messageToLogPayload,
  resolveMetadata,
} from './step-delivery.js';

/**
 * exact/contains のキーワードマッチ述語。webhook のテキスト/postback 経路と
 * unanswered-inbox の「構造化メッセ除外」判定が同じルール解釈を共有する。
 * 未知の match_type はマッチなし扱い (誤マッチで inbox から隠すより安全側)。
 */
export function keywordMatches(
  rule: { keyword: string; match_type: string },
  text: string,
): boolean {
  if (rule.match_type === 'exact') return text === rule.keyword;
  if (rule.match_type === 'contains') return text.includes(rule.keyword);
  return false;
}

/**
 * auto_reply 行の content/type を resolve する。template_id が set なら templates
 * から取得、参照切れや NULL のときは inline response_content/response_type を使う。
 */
async function resolveAutoReplyContent(
  db: D1Database,
  rule: Pick<AutoReply, 'template_id' | 'response_type' | 'response_content'>,
): Promise<{ messageType: string; content: string }> {
  if (rule.template_id) {
    const tpl = await getTemplateById(db, rule.template_id);
    if (tpl) {
      return { messageType: tpl.message_type, content: tpl.message_content };
    }
  }
  return { messageType: rule.response_type, content: rule.response_content };
}

export interface MatchAndReplyResult {
  matched: boolean;
  replyTokenConsumed: boolean;
}

export type AutoReplySender = (replyToken: string, messages: Message[]) => Promise<void>;

function liffIdFromUrl(liffUrl?: string): string | null {
  if (!liffUrl) return null;
  try {
    const url = new URL(liffUrl);
    if (url.hostname !== 'liff.line.me') return null;
    return url.pathname.split('/').filter(Boolean)[0] ?? null;
  } catch {
    return null;
  }
}

async function resolveAutoReplyLiffId(
  db: D1Database,
  lineAccountId: string | null,
  fallbackLiffUrl?: string,
): Promise<string | null> {
  if (lineAccountId) {
    const account = await getLineAccountById(db, lineAccountId);
    return account?.is_active && account.liff_id ? account.liff_id : null;
  }
  return liffIdFromUrl(fallbackLiffUrl);
}

/**
 * incomingText を auto_replies (このアカウントのルール + グローバルルール) に
 * マッチさせ、最初にマッチしたルールで replyMessage を送って messages_log に
 * outgoing を記録する。webhook のテキストメッセージ経路と postback 経路の共通部。
 *
 * - silent タイプ: 返信せず matched=true だけ返す。テキスト経路では unread /
 *   push の抑止、postback 経路では「返信なしでタグだけ付ける」構成に使う。
 * - reply 失敗時も matched=true のまま (replyTokenConsumed=false)。呼び出し側は
 *   replyTokenConsumed=false のとき replyToken をイベントバスへ引き継げる。
 *
 * NOTE: auto-reply は replyMessage (無料・push 枠を消費しない) を使う。
 * replyToken の有効期限はイベントから約1分。
 */
export async function matchAndReply(
  db: D1Database,
  lineClient: LineClient,
  friend: Friend,
  incomingText: string,
  replyToken: string,
  opts: {
    lineAccountId?: string | null;
    workerUrl?: string;
    liffUrl?: string;
    logContext?: string;
    replyMessage?: AutoReplySender;
  } = {},
): Promise<MatchAndReplyResult> {
  const { lineAccountId = null, workerUrl, liffUrl, logContext, replyMessage } = opts;

  // グローバルルール (line_account_id IS NULL) + このアカウントのルール。
  // lineAccountId が null のときは `= NULL` が偽になるのでグローバルのみ残る。
  const autoReplies = await db
    .prepare(
      `SELECT * FROM auto_replies
        WHERE is_active = 1 AND (line_account_id IS NULL OR line_account_id = ?)
        ORDER BY CASE WHEN id = 'builtin-mileage-wallet-keyword' THEN 0 ELSE 1 END,
                 created_at ASC`,
    )
    .bind(lineAccountId)
    .all<AutoReply>();

  const rule = autoReplies.results.find((r) => keywordMatches(r, incomingText));
  if (!rule) return { matched: false, replyTokenConsumed: false };
  if (rule.response_type === 'silent') return { matched: true, replyTokenConsumed: false };

  let replyTokenConsumed = false;
  try {
    const resolvedMeta = await resolveMetadata(db, friend);
    const resolved = await resolveAutoReplyContent(db, rule);
    let expandedContent = expandVariables(
      resolved.content,
      { ...friend, metadata: resolvedMeta },
      workerUrl,
      resolved.messageType,
    );
    if (/\{\{\s*liff_id\s*\}\}/.test(expandedContent)) {
      const liffId = await resolveAutoReplyLiffId(db, lineAccountId, liffUrl);
      if (!liffId) {
        throw new Error('LIFF ID is not configured for the matched LINE account');
      }
      expandedContent = renderBroadcastMessageContent(
        resolved.messageType,
        expandedContent,
        { liffId },
      );
    }
    const replyMsg = buildMessage(resolved.messageType, expandedContent);
    if (replyMessage) {
      await replyMessage(replyToken, [replyMsg]);
    } else {
      await lineClient.replyMessage(replyToken, [replyMsg]);
    }
    replyTokenConsumed = true;

    // 送信ログ（replyMessage = 無料）— derive content from the built reply
    // message so any cleanEmptyNodes / parse-failure fallback is reflected
    // in the dashboard.
    const replyPayload = messageToLogPayload(replyMsg);
    await logOutgoingMessage(db, {
      friendId: friend.id,
      messageType: replyPayload.messageType,
      content: replyPayload.content,
      deliveryType: 'reply',
      source: 'auto_reply',
      lineAccountId,
    });
  } catch (err) {
    console.error(`Failed to send auto-reply${logContext ? ` (${logContext})` : ''}`, err);
  }

  return { matched: true, replyTokenConsumed };
}
