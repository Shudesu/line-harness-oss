import { Hono } from 'hono';
import {
  getNotificationRules,
  getNotificationRuleById,
  createNotificationRule,
  updateNotificationRule,
  deleteNotificationRule,
  getNotifications,
} from '@line-crm/db';
import type { Env } from '../index.js';

const notifications = new Hono<Env>();

// ========== 通知ルールCRUD ==========

notifications.get('/api/notifications/rules', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    let items;
    if (lineAccountId) {
      const result = await c.env.DB
        .prepare(`SELECT * FROM notification_rules WHERE line_account_id = ? ORDER BY created_at DESC`)
        .bind(lineAccountId)
        .all();
      items = result.results as unknown as Awaited<ReturnType<typeof getNotificationRules>>;
    } else {
      items = await getNotificationRules(c.env.DB);
    }
    return c.json({
      success: true,
      data: items.map((r) => ({
        id: r.id,
        name: r.name,
        eventType: r.event_type,
        conditions: JSON.parse(r.conditions),
        channels: JSON.parse(r.channels),
        isActive: Boolean(r.is_active),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/notifications/rules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

notifications.get('/api/notifications/rules/:id', async (c) => {
  try {
    const item = await getNotificationRuleById(c.env.DB, c.req.param('id'));
    if (!item) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: {
        id: item.id,
        name: item.name,
        eventType: item.event_type,
        conditions: JSON.parse(item.conditions),
        channels: JSON.parse(item.channels),
        isActive: Boolean(item.is_active),
        createdAt: item.created_at,
      },
    });
  } catch (err) {
    console.error('GET /api/notifications/rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

notifications.post('/api/notifications/rules', async (c) => {
  try {
    const body = await c.req.json<{ name: string; eventType: string; conditions?: Record<string, unknown>; channels?: string[] }>();
    if (!body.name || !body.eventType) return c.json({ success: false, error: 'name and eventType are required' }, 400);
    const item = await createNotificationRule(c.env.DB, body);
    return c.json({
      success: true,
      data: { id: item.id, name: item.name, eventType: item.event_type, channels: JSON.parse(item.channels), createdAt: item.created_at },
    }, 201);
  } catch (err) {
    console.error('POST /api/notifications/rules error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

notifications.put('/api/notifications/rules/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    await updateNotificationRule(c.env.DB, id, body);
    const updated = await getNotificationRuleById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: { id: updated.id, name: updated.name, eventType: updated.event_type, channels: JSON.parse(updated.channels), isActive: Boolean(updated.is_active) },
    });
  } catch (err) {
    console.error('PUT /api/notifications/rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

notifications.delete('/api/notifications/rules/:id', async (c) => {
  try {
    await deleteNotificationRule(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/notifications/rules/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 通知一覧 ==========

notifications.get('/api/notifications', async (c) => {
  try {
    const status = c.req.query('status') ?? undefined;
    const limit = Number(c.req.query('limit') ?? '100');
    const lineAccountId = c.req.query('lineAccountId') ?? undefined;
    let items;
    if (lineAccountId) {
      const conditions: string[] = ['line_account_id = ?'];
      const bindings: unknown[] = [lineAccountId];
      if (status) {
        conditions.push('status = ?');
        bindings.push(status);
      }
      bindings.push(limit);
      const result = await c.env.DB
        .prepare(`SELECT * FROM notifications WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC LIMIT ?`)
        .bind(...bindings)
        .all();
      items = result.results as unknown as Awaited<ReturnType<typeof getNotifications>>;
    } else {
      items = await getNotifications(c.env.DB, { status, limit });
    }
    return c.json({
      success: true,
      data: items.map((n) => ({
        id: n.id,
        ruleId: n.rule_id,
        eventType: n.event_type,
        title: n.title,
        body: n.body,
        channel: n.channel,
        status: n.status,
        metadata: n.metadata ? JSON.parse(n.metadata) : null,
        createdAt: n.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/notifications error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { notifications };
