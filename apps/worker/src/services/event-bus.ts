/**
 * イベントバス — システム内イベントの発火と処理
 *
 * イベント発生時に以下を実行:
 * 1. アクティブな送信Webhookへ通知
 * 2. スコアリングルール適用
 * 3. 自動化ルール(IF-THEN)実行
 * 4. 通知ルール処理
 */

import {
  getActiveOutgoingWebhooksByEvent,
  applyScoring,
  getActiveAutomationsByEvent,
  createAutomationLog,
  getActiveNotificationRulesByEvent,
  createNotification,
  addTagToFriend,
  removeTagFromFriend,
  enrollFriendInScenario,
  jstNow,
} from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';

interface EventPayload {
  friendId?: string;
  eventData?: Record<string, unknown>;
}

/**
 * Fire an event and run all registered handlers.
 *
 * Execution is split into two sequential phases so that score_threshold
 * conditions in automation rules see the score already updated by this event:
 *
 *   Phase 1 (concurrent): outgoing webhooks + scoring
 *   Phase 2 (concurrent): automations + notifications, with currentScore injected
 */
export async function fireEvent(
  db: D1Database,
  eventType: string,
  payload: EventPayload,
  lineAccessToken?: string,
  lineAccountId?: string | null,
): Promise<void> {
  // Phase 1: fire webhooks and apply scoring rules concurrently.
  await Promise.allSettled([
    fireOutgoingWebhooks(db, eventType, payload),
    processScoring(db, eventType, payload),
  ]);

  // Inject the freshly-updated score so that score_threshold conditions in
  // Phase 2 automations evaluate against the score written by Phase 1, not a
  // stale or undefined value.
  if (payload.friendId) {
    const row = await db
      .prepare('SELECT score FROM friends WHERE id = ?')
      .bind(payload.friendId)
      .first<{ score: number }>();
    if (row) {
      payload.eventData = { ...(payload.eventData ?? {}), currentScore: row.score };
    }
  }

  // Phase 2: evaluate automations and create notifications concurrently.
  await Promise.allSettled([
    processAutomations(db, eventType, payload, lineAccessToken, lineAccountId),
    processNotifications(db, eventType, payload, lineAccountId),
  ]);
}

/** 送信Webhookへの通知 */
async function fireOutgoingWebhooks(
  db: D1Database,
  eventType: string,
  payload: EventPayload,
): Promise<void> {
  try {
    const webhooks = await getActiveOutgoingWebhooksByEvent(db, eventType);
    for (const wh of webhooks) {
      try {
        const body = JSON.stringify({
          event: eventType,
          timestamp: jstNow(),
          data: payload,
        });

        const headers: Record<string, string> = { 'Content-Type': 'application/json' };

        // HMAC署名（シークレットがある場合）
        if (wh.secret) {
          const encoder = new TextEncoder();
          const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(wh.secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign'],
          );
          const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
          const hexSignature = Array.from(new Uint8Array(signature))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
          headers['X-Webhook-Signature'] = hexSignature;
        }

        await fetch(wh.url, { method: 'POST', headers, body });
      } catch (err) {
        console.error(`送信Webhook ${wh.id} への通知失敗:`, err);
      }
    }
  } catch (err) {
    console.error('fireOutgoingWebhooks error:', err);
  }
}

/** スコアリングルール適用 */
async function processScoring(
  db: D1Database,
  eventType: string,
  payload: EventPayload,
): Promise<void> {
  if (!payload.friendId) return;
  try {
    await applyScoring(db, payload.friendId, eventType);
  } catch (err) {
    console.error('processScoring error:', err);
  }
}

/** 自動化ルール(IF-THEN)実行 */
async function processAutomations(
  db: D1Database,
  eventType: string,
  payload: EventPayload,
  lineAccessToken?: string,
  lineAccountId?: string | null,
): Promise<void> {
  try {
    const allAutomations = await getActiveAutomationsByEvent(db, eventType);
    // Filter by account: match this account's automations + unassigned (backward compat)
    const automations = allAutomations.filter(
      (a) => !a.line_account_id || !lineAccountId || a.line_account_id === lineAccountId,
    );

    for (const automation of automations) {
      const conditions = JSON.parse(automation.conditions) as Record<string, unknown>;
      const actions = JSON.parse(automation.actions) as Array<{ type: string; params: Record<string, string> }>;

      // 条件チェック（簡易版: 条件が空なら常にマッチ）
      if (!matchConditions(conditions, payload)) continue;

      const results: Array<{ action: string; success: boolean; error?: string }> = [];

      for (const action of actions) {
        try {
          await executeAction(db, action, payload, lineAccessToken);
          results.push({ action: action.type, success: true });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          results.push({ action: action.type, success: false, error: errorMsg });
        }
      }

      const allSuccess = results.every((r) => r.success);
      const anySuccess = results.some((r) => r.success);

      await createAutomationLog(db, {
        automationId: automation.id,
        friendId: payload.friendId,
        eventData: JSON.stringify(payload.eventData ?? {}),
        actionsResult: JSON.stringify(results),
        status: allSuccess ? 'success' : anySuccess ? 'partial' : 'failed',
      });
    }
  } catch (err) {
    console.error('processAutomations error:', err);
  }
}

/** 条件マッチング */
function matchConditions(
  conditions: Record<string, unknown>,
  payload: EventPayload,
): boolean {
  // 条件が空 → 常にマッチ
  if (Object.keys(conditions).length === 0) return true;

  // score_threshold チェック
  if (conditions.score_threshold !== undefined && payload.eventData) {
    const currentScore = payload.eventData.currentScore as number | undefined;
    if (currentScore !== undefined && currentScore < (conditions.score_threshold as number)) {
      return false;
    }
  }

  // tag_id チェック
  if (conditions.tag_id !== undefined && payload.eventData) {
    if (payload.eventData.tagId !== conditions.tag_id) return false;
  }

  // keyword チェック（message_received イベント用）
  if (conditions.keyword !== undefined && payload.eventData) {
    const text = payload.eventData.text as string | undefined;
    if (!text || !text.includes(conditions.keyword as string)) return false;
  }

  return true;
}

/** アクション実行 */
async function executeAction(
  db: D1Database,
  action: { type: string; params: Record<string, string> },
  payload: EventPayload,
  lineAccessToken?: string,
): Promise<void> {
  const friendId = payload.friendId;
  if (!friendId && action.type !== 'send_webhook') {
    throw new Error('friendId is required for this action');
  }

  switch (action.type) {
    case 'add_tag':
      await addTagToFriend(db, friendId!, action.params.tagId);
      break;

    case 'remove_tag':
      await removeTagFromFriend(db, friendId!, action.params.tagId);
      break;

    case 'start_scenario':
      await enrollFriendInScenario(db, friendId!, action.params.scenarioId);
      break;

    case 'send_message': {
      if (!lineAccessToken || !friendId) break;
      const friend = await db
        .prepare('SELECT line_user_id FROM friends WHERE id = ?')
        .bind(friendId)
        .first<{ line_user_id: string }>();
      if (!friend) break;
      const lineClient = new LineClient(lineAccessToken);
      const msgType = action.params.messageType || 'text';
      if (msgType === 'flex') {
        const contents = JSON.parse(action.params.content);
        await lineClient.pushMessage(friend.line_user_id, [
          { type: 'flex', altText: action.params.altText || 'Message', contents },
        ]);
      } else {
        // Default: text message
        await lineClient.pushMessage(friend.line_user_id, [
          { type: 'text', text: action.params.content },
        ]);
      }
      break;
    }

    case 'send_webhook': {
      const url = action.params.url;
      if (url) {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ friendId, ...payload.eventData }),
        });
      }
      break;
    }

    case 'switch_rich_menu': {
      if (!lineAccessToken || !friendId) break;
      const friend = await db
        .prepare('SELECT line_user_id FROM friends WHERE id = ?')
        .bind(friendId)
        .first<{ line_user_id: string }>();
      if (!friend) break;
      const lineClient = new LineClient(lineAccessToken);
      await lineClient.linkRichMenuToUser(friend.line_user_id, action.params.richMenuId);
      break;
    }

    case 'remove_rich_menu': {
      if (!lineAccessToken || !friendId) break;
      const friend = await db
        .prepare('SELECT line_user_id FROM friends WHERE id = ?')
        .bind(friendId)
        .first<{ line_user_id: string }>();
      if (!friend) break;
      const lineClient = new LineClient(lineAccessToken);
      await lineClient.unlinkRichMenuFromUser(friend.line_user_id);
      break;
    }

    case 'set_metadata': {
      if (!friendId) break;
      const existing = await db
        .prepare('SELECT metadata FROM friends WHERE id = ?')
        .bind(friendId)
        .first<{ metadata: string }>();
      const current = JSON.parse(existing?.metadata || '{}') as Record<string, unknown>;
      const patch = JSON.parse(action.params.data || '{}') as Record<string, unknown>;
      const merged = { ...current, ...patch };
      await db
        .prepare('UPDATE friends SET metadata = ?, updated_at = ? WHERE id = ?')
        .bind(JSON.stringify(merged), jstNow(), friendId)
        .run();
      break;
    }

    default:
      console.warn(`未知のアクションタイプ: ${action.type}`);
  }
}

/** 通知ルール処理 */
async function processNotifications(
  db: D1Database,
  eventType: string,
  payload: EventPayload,
  lineAccountId?: string | null,
): Promise<void> {
  try {
    const allRules = await getActiveNotificationRulesByEvent(db, eventType);
    const rules = allRules.filter(
      (r) => !r.line_account_id || !lineAccountId || r.line_account_id === lineAccountId,
    );

    for (const rule of rules) {
      let channels: string[] = JSON.parse(rule.channels);
      // Guard against double-encoded JSON strings (e.g. "\"[\\\"webhook\\\"]\"")
      if (typeof channels === 'string') channels = JSON.parse(channels);

      for (const channel of channels) {
        await createNotification(db, {
          ruleId: rule.id,
          eventType,
          title: `${rule.name}: ${eventType}`,
          body: JSON.stringify(payload),
          channel,
          metadata: JSON.stringify(payload.eventData ?? {}),
        });

        // Webhook通知チャネルの場合は即時配信
        if (channel === 'webhook') {
          // 送信Webhookと統合（既にfireOutgoingWebhooksで処理済み）
        }
        // email チャネルの場合はSendGrid等で送信（将来実装）
        // dashboard チャネルの場合はDB記録のみ（上記createNotificationで完了）
      }
    }
  } catch (err) {
    console.error('processNotifications error:', err);
  }
}
