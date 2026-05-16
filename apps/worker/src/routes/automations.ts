import { Hono } from 'hono';
import {
  getAutomations,
  getAutomationById,
  createAutomation,
  updateAutomation,
  deleteAutomation,
  getAutomationLogs,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { hasColumn, hasTable } from '../utils/db-compat.js';

const automations = new Hono<Env>();

type AutomationItem = Awaited<ReturnType<typeof getAutomations>>[number];
type AutomationLogItem = Awaited<ReturnType<typeof getAutomationLogs>>[number];

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value?.trim()) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function parseJsonArray(value: string | null | undefined): unknown[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function serializeAutomation(a: AutomationItem) {
  return {
    id: a.id,
    name: a.name,
    description: a.description,
    eventType: a.event_type,
    conditions: parseJsonObject(a.conditions),
    actions: parseJsonArray(a.actions),
    isActive: Boolean(a.is_active),
    priority: a.priority,
    createdAt: a.created_at,
    updatedAt: a.updated_at,
  };
}

function serializeAutomationLog(l: AutomationLogItem) {
  return {
    id: l.id,
    automationId: l.automation_id,
    friendId: l.friend_id,
    eventData: parseJsonObject(l.event_data),
    actionsResult: parseJsonObject(l.actions_result),
    status: l.status,
    createdAt: l.created_at,
  };
}

function isMissingColumnError(err: unknown, columnName: string): boolean {
  const message = err instanceof Error ? err.message : String(err);
  return message.includes('no such column') && message.includes(columnName);
}

async function listAutomationsCompat(db: D1Database, lineAccountId?: string): Promise<AutomationItem[]> {
  if (!lineAccountId) return getAutomations(db);

  try {
    const hasLineAccountId = await hasColumn(db, 'automations', 'line_account_id');
    if (!hasLineAccountId) return getAutomations(db);

    const result = await db
      .prepare(`SELECT * FROM automations WHERE line_account_id = ? ORDER BY priority DESC, created_at DESC`)
      .bind(lineAccountId)
      .all();
    return result.results as unknown as AutomationItem[];
  } catch (err) {
    if (isMissingColumnError(err, 'line_account_id')) {
      return getAutomations(db);
    }
    throw err;
  }
}

async function updateAutomationLineAccountCompat(db: D1Database, automationId: string, lineAccountId?: string | null): Promise<void> {
  if (!lineAccountId) return;
  try {
    const hasLineAccountId = await hasColumn(db, 'automations', 'line_account_id');
    if (!hasLineAccountId) return;
    await db.prepare(`UPDATE automations SET line_account_id = ? WHERE id = ?`)
      .bind(lineAccountId, automationId).run();
  } catch (err) {
    if (isMissingColumnError(err, 'line_account_id')) return;
    throw err;
  }
}

// ========== 自動化ルールCRUD ==========

automations.get('/api/automations', async (c) => {
  try {
    if (!await hasTable(c.env.DB, 'automations')) {
      return c.json({ success: true, data: [] });
    }
    const lineAccountId = c.req.query('lineAccountId');
    const items = await listAutomationsCompat(c.env.DB, lineAccountId);
    return c.json({
      success: true,
      data: items.map(serializeAutomation),
    });
  } catch (err) {
    console.error('GET /api/automations error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

automations.get('/api/automations/:id', async (c) => {
  try {
    const item = await getAutomationById(c.env.DB, c.req.param('id'));
    if (!item) return c.json({ success: false, error: 'Automation not found' }, 404);

    // ログも取得
    const logs = await getAutomationLogs(c.env.DB, item.id, 50);

    return c.json({
      success: true,
      data: {
        ...serializeAutomation(item),
        logs: logs.map(serializeAutomationLog),
      },
    });
  } catch (err) {
    console.error('GET /api/automations/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

automations.post('/api/automations', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      description?: string;
      eventType: string;
      conditions?: Record<string, unknown>;
      actions: unknown[];
      priority?: number;
      lineAccountId?: string | null;
    }>();
    if (!body.name || !body.eventType || !body.actions) {
      return c.json({ success: false, error: 'name, eventType, actions are required' }, 400);
    }
    const item = await createAutomation(c.env.DB, body);
    await updateAutomationLineAccountCompat(c.env.DB, item.id, body.lineAccountId);
    return c.json({
      success: true,
      data: {
        ...serializeAutomation(item),
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/automations error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

automations.put('/api/automations/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    await updateAutomation(c.env.DB, id, body);
    const updated = await getAutomationById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: serializeAutomation(updated),
    });
  } catch (err) {
    console.error('PUT /api/automations/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

automations.delete('/api/automations/:id', async (c) => {
  try {
    await deleteAutomation(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/automations/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 自動化ログ ==========

automations.get('/api/automations/:id/logs', async (c) => {
  try {
    const automationId = c.req.param('id');
    const limit = Number(c.req.query('limit') ?? '100');
    const logs = await getAutomationLogs(c.env.DB, automationId, limit);
    return c.json({
      success: true,
      data: logs.map(serializeAutomationLog),
    });
  } catch (err) {
    console.error('GET /api/automations/:id/logs error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { automations };
