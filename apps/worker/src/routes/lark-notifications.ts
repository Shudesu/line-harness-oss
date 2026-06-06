/**
 * Phase 3-F1 (Lark連携): Lark 通知設定 管理 API
 *
 * - GET    /api/lark-notifications              (一覧、?lineAccountId= で絞込)
 * - POST   /api/lark-notifications              (新規作成)
 * - PATCH  /api/lark-notifications/:id          (更新・有効無効切替)
 * - DELETE /api/lark-notifications/:id
 * - GET    /api/lark-notifications/:id/logs     (送信ログ)
 * - POST   /api/lark-notifications/:id/test     (テスト送信 - 管理画面の確認ボタン)
 * - GET    /api/lark-notifications/health       (LARK_APP_ID/SECRET の疎通確認)
 */

import { Hono } from 'hono';
import {
  listLarkNotifications,
  getLarkNotification,
  createLarkNotification,
  updateLarkNotification,
  deleteLarkNotification,
  listLarkNotificationLogs,
  logLarkNotificationResult,
  type LarkEventType,
  type LarkTargetType,
} from '@line-crm/db';
import {
  sendLarkTextMessage,
  verifyLarkCredentials,
} from '../lib/lark-client.js';
import type { Env } from '../index.js';

export const larkNotifications = new Hono<Env>();

const VALID_EVENT_TYPES: LarkEventType[] = [
  'friend_added',
  'friend_blocked',
  'form_submitted',
  'unread_timeout',
  'daily_summary',
];

const VALID_TARGET_TYPES: LarkTargetType[] = ['chat', 'user', 'email'];

larkNotifications.get('/api/lark-notifications', async (c) => {
  const lineAccountId = c.req.query('lineAccountId') ?? undefined;
  const items = await listLarkNotifications(c.env.DB, lineAccountId);
  return c.json({ success: true, data: items });
});

larkNotifications.get('/api/lark-notifications/health', async (c) => {
  const appId = (c.env as unknown as { LARK_APP_ID?: string }).LARK_APP_ID;
  const appSecret = (c.env as unknown as { LARK_APP_SECRET?: string }).LARK_APP_SECRET;
  if (!appId || !appSecret) {
    return c.json(
      {
        success: false,
        configured: false,
        error: 'LARK_APP_ID または LARK_APP_SECRET が Worker secrets に未設定です',
      },
      503,
    );
  }
  const verify = await verifyLarkCredentials(appId, appSecret);
  if (!verify.ok) {
    return c.json(
      {
        success: false,
        configured: true,
        error: verify.errorMessage ?? 'tenant_access_token 取得に失敗',
      },
      503,
    );
  }
  return c.json({ success: true, configured: true });
});

larkNotifications.post('/api/lark-notifications', async (c) => {
  let body: {
    lineAccountId?: string;
    name?: string;
    eventType?: string;
    targetType?: string;
    targetId?: string;
    templateText?: string | null;
    filterFormId?: string | null;
    unreadThresholdMinutes?: number;
    memo?: string | null;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'invalid json' }, 400);
  }
  if (!body.lineAccountId || !body.name || !body.eventType || !body.targetType || !body.targetId) {
    return c.json(
      {
        success: false,
        error: 'lineAccountId, name, eventType, targetType, targetId は必須',
      },
      400,
    );
  }
  if (!VALID_EVENT_TYPES.includes(body.eventType as LarkEventType)) {
    return c.json({ success: false, error: `eventType は ${VALID_EVENT_TYPES.join('/')} のいずれか` }, 400);
  }
  if (!VALID_TARGET_TYPES.includes(body.targetType as LarkTargetType)) {
    return c.json({ success: false, error: `targetType は ${VALID_TARGET_TYPES.join('/')} のいずれか` }, 400);
  }
  if (body.unreadThresholdMinutes !== undefined) {
    if (!Number.isFinite(body.unreadThresholdMinutes) || body.unreadThresholdMinutes < 1 || body.unreadThresholdMinutes > 24 * 60) {
      return c.json({ success: false, error: 'unreadThresholdMinutes は 1〜1440 の範囲' }, 400);
    }
  }
  try {
    const item = await createLarkNotification(c.env.DB, {
      lineAccountId: body.lineAccountId,
      name: body.name,
      eventType: body.eventType as LarkEventType,
      targetType: body.targetType as LarkTargetType,
      targetId: body.targetId,
      templateText: body.templateText ?? null,
      filterFormId: body.filterFormId ?? null,
      unreadThresholdMinutes: body.unreadThresholdMinutes,
      memo: body.memo ?? null,
    });
    return c.json({ success: true, data: item }, 201);
  } catch (err) {
    console.error('[lark-notifications] create error:', err);
    return c.json({ success: false, error: 'internal error' }, 500);
  }
});

larkNotifications.patch('/api/lark-notifications/:id', async (c) => {
  const id = c.req.param('id');
  let body: {
    name?: string;
    targetType?: string;
    targetId?: string;
    templateText?: string | null;
    filterFormId?: string | null;
    unreadThresholdMinutes?: number;
    isEnabled?: boolean;
    memo?: string | null;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'invalid json' }, 400);
  }
  if (body.targetType !== undefined && !VALID_TARGET_TYPES.includes(body.targetType as LarkTargetType)) {
    return c.json({ success: false, error: `targetType は ${VALID_TARGET_TYPES.join('/')} のいずれか` }, 400);
  }
  if (body.unreadThresholdMinutes !== undefined) {
    if (!Number.isFinite(body.unreadThresholdMinutes) || body.unreadThresholdMinutes < 1 || body.unreadThresholdMinutes > 24 * 60) {
      return c.json({ success: false, error: 'unreadThresholdMinutes は 1〜1440 の範囲' }, 400);
    }
  }
  const item = await updateLarkNotification(c.env.DB, id, {
    name: body.name,
    targetType: body.targetType as LarkTargetType | undefined,
    targetId: body.targetId,
    templateText: body.templateText,
    filterFormId: body.filterFormId,
    unreadThresholdMinutes: body.unreadThresholdMinutes,
    isEnabled: body.isEnabled,
    memo: body.memo,
  });
  if (!item) return c.json({ success: false, error: 'not found' }, 404);
  return c.json({ success: true, data: item });
});

larkNotifications.delete('/api/lark-notifications/:id', async (c) => {
  await deleteLarkNotification(c.env.DB, c.req.param('id'));
  return c.json({ success: true, data: null });
});

larkNotifications.get('/api/lark-notifications/:id/logs', async (c) => {
  const limit = Math.min(200, Number(c.req.query('limit') ?? 50));
  const items = await listLarkNotificationLogs(c.env.DB, c.req.param('id'), limit);
  return c.json({ success: true, data: items });
});

larkNotifications.post('/api/lark-notifications/:id/test', async (c) => {
  const id = c.req.param('id');
  const notif = await getLarkNotification(c.env.DB, id);
  if (!notif) return c.json({ success: false, error: 'not found' }, 404);

  const appId = (c.env as unknown as { LARK_APP_ID?: string }).LARK_APP_ID;
  const appSecret = (c.env as unknown as { LARK_APP_SECRET?: string }).LARK_APP_SECRET;
  if (!appId || !appSecret) {
    return c.json(
      { success: false, error: 'LARK_APP_ID/LARK_APP_SECRET 未設定' },
      503,
    );
  }

  const receiveIdType =
    notif.target_type === 'chat' ? 'chat_id'
    : notif.target_type === 'user' ? 'open_id'
    : 'email';

  const text = `[hyhome Harness テスト送信]\n通知設定「${notif.name}」(${notif.event_type}) は正常に動いています。\n本番イベントが発生したらここに通知が来ます。`;

  const startedAt = Date.now();
  const result = await sendLarkTextMessage({
    appId,
    appSecret,
    receiveIdType,
    receiveId: notif.target_id,
    text,
  });
  const durationMs = Date.now() - startedAt;

  await logLarkNotificationResult(c.env.DB, id, {
    status: result.ok ? 'sent' : 'failed',
    httpStatus: result.httpStatus,
    durationMs,
    errorMessage: result.ok ? undefined : (result.errorMessage ?? 'unknown'),
    triggerSummary: 'manual test',
  });

  if (!result.ok) {
    return c.json(
      {
        success: false,
        error: result.errorMessage ?? `HTTP ${result.httpStatus}`,
        code: result.code,
      },
      502,
    );
  }
  return c.json({ success: true, messageId: result.messageId });
});
