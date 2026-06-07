/**
 * 監査 H1 対応: CRM forward 管理 API
 *
 * - GET    /api/crm-forwards            (一覧)
 * - POST   /api/crm-forwards            (新規作成)
 * - PATCH  /api/crm-forwards/:id        (更新・有効無効切替)
 * - DELETE /api/crm-forwards/:id
 * - GET    /api/crm-forwards/:id/logs   (転送ログ)
 *
 * UI 想定: 「外部 CRM 転送設定」画面で、エルメ等の webhook URL を登録できる。
 */

import { Hono } from 'hono';
import {
  listCrmForwards,
  createCrmForward,
  updateCrmForward,
  deleteCrmForward,
  getCrmForwardLogs,
} from '@line-crm/db';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';

export const crmForwards = new Hono<Env>();

// Codex P2 修正: CRM 転送設定は外部 webhook 送信 = 高権限。owner/admin 限定。
crmForwards.get('/api/crm-forwards', requireRole('owner', 'admin'), async (c) => {
  const lineAccountId = c.req.query('lineAccountId') ?? null;
  const items = await listCrmForwards(c.env.DB, { lineAccountId });
  return c.json({ success: true, data: items });
});

crmForwards.post('/api/crm-forwards', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{
      lineAccountId: string;
      name: string;
      webhookUrl: string;
      attachLineSignature?: boolean;
      maxRetries?: number;
      memo?: string | null;
    }>();
    if (!body.lineAccountId || !body.name || !body.webhookUrl) {
      return c.json(
        { success: false, error: 'lineAccountId, name, webhookUrl are required' },
        400,
      );
    }
    let parsed: URL;
    try {
      parsed = new URL(body.webhookUrl);
    } catch {
      return c.json({ success: false, error: 'invalid webhookUrl' }, 400);
    }
    if (parsed.protocol !== 'https:') {
      return c.json(
        { success: false, error: 'webhookUrl must be https' },
        400,
      );
    }
    const item = await createCrmForward(c.env.DB, body);
    return c.json({ success: true, data: item }, 201);
  } catch (err) {
    console.error('[crm-forwards] create error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

crmForwards.patch('/api/crm-forwards/:id', requireRole('owner', 'admin'), async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    webhookUrl?: string;
    isEnabled?: boolean;
    attachLineSignature?: boolean;
    maxRetries?: number;
    memo?: string | null;
  }>();
  if (body.webhookUrl !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(body.webhookUrl);
    } catch {
      return c.json({ success: false, error: 'invalid webhookUrl' }, 400);
    }
    if (parsed.protocol !== 'https:') {
      return c.json(
        { success: false, error: 'webhookUrl must be https' },
        400,
      );
    }
  }
  const item = await updateCrmForward(c.env.DB, id, body);
  if (!item) {
    return c.json({ success: false, error: 'not found' }, 404);
  }
  return c.json({ success: true, data: item });
});

crmForwards.delete('/api/crm-forwards/:id', requireRole('owner'), async (c) => {
  await deleteCrmForward(c.env.DB, c.req.param('id'));
  return c.json({ success: true, data: null });
});

crmForwards.get('/api/crm-forwards/:id/logs', requireRole('owner', 'admin'), async (c) => {
  const limit = Math.min(200, Number(c.req.query('limit') ?? 50));
  const items = await getCrmForwardLogs(c.env.DB, c.req.param('id'), limit);
  return c.json({ success: true, data: items });
});
