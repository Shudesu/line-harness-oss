import { createAuthorizedRouter } from '../middleware/authorized-router.js';
import { Hono } from 'hono';
import {
  getTemplatesWithUsageCount,
  getTemplateById,
  getTemplateUsage,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '@line-crm/db';
import type { Env } from '../index.js';

const templates = createAuthorizedRouter<Env>();

templates.get('/api/templates', async (c) => {
  try {
    const category = c.req.query('category') ?? undefined;
    const items = await getTemplatesWithUsageCount(c.env.DB, category);
    return c.json({
      success: true,
      data: items.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        messageType: t.message_type,
        messageContent: t.message_content,
        usageCount: t.usage_count,
        createdAt: t.created_at,
        updatedAt: t.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/templates error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templates.get('/api/templates/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const item = await getTemplateById(c.env.DB, id);
    if (!item) return c.json({ success: false, error: 'Template not found' }, 404);
    const usedBy = await getTemplateUsage(c.env.DB, id);
    return c.json({
      success: true,
      data: {
        id: item.id,
        name: item.name,
        category: item.category,
        messageType: item.message_type,
        messageContent: item.message_content,
        usedBy,
        createdAt: item.created_at,
        updatedAt: item.updated_at,
      },
    });
  } catch (err) {
    console.error('GET /api/templates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/templates/:id/usages — auto_replies + scenario_steps での使用箇所
templates.get('/api/templates/:id/usages', async (c) => {
  try {
    const templateId = c.req.param('id');

    const tpl = await c.env.DB
      .prepare(`SELECT id FROM templates WHERE id = ?`)
      .bind(templateId)
      .first<{ id: string }>();
    if (!tpl) {
      return c.json({ success: false, error: 'Template not found' }, 404);
    }

    const autoRepliesResult = await c.env.DB
      .prepare(
        `SELECT id, keyword, line_account_id FROM auto_replies WHERE template_id = ?`,
      )
      .bind(templateId)
      .all<{ id: string; keyword: string; line_account_id: string | null }>();

    const scenarioStepsResult = await c.env.DB
      .prepare(
        `SELECT ss.id AS step_id, ss.step_order, ss.scenario_id,
                s.name AS scenario_name
         FROM scenario_steps ss
         JOIN scenarios s ON ss.scenario_id = s.id
         WHERE ss.template_id = ?
         ORDER BY s.name, ss.step_order`,
      )
      .bind(templateId)
      .all<{
        step_id: string;
        step_order: number;
        scenario_id: string;
        scenario_name: string;
      }>();

    return c.json({
      success: true,
      data: {
        autoReplies: autoRepliesResult.results.map((r) => ({
          id: r.id,
          keyword: r.keyword,
          lineAccountId: r.line_account_id ?? null,
        })),
        scenarioSteps: scenarioStepsResult.results.map((r) => ({
          scenarioId: r.scenario_id,
          scenarioName: r.scenario_name,
          stepId: r.step_id,
          stepOrder: r.step_order,
        })),
      },
    });
  } catch (err) {
    console.error('GET /api/templates/:id/usages error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templates.post('/api/templates', async (c) => {
  try {
    const body = await c.req.json<{ name: string; category?: string; messageType: string; messageContent: string }>();
    if (!body.name || !body.messageType || !body.messageContent) {
      return c.json({ success: false, error: 'name, messageType, messageContent are required' }, 400);
    }
    const item = await createTemplate(c.env.DB, body);
    return c.json({ success: true, data: { id: item.id, name: item.name, category: item.category, messageType: item.message_type, createdAt: item.created_at } }, 201);
  } catch (err) {
    console.error('POST /api/templates error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templates.put('/api/templates/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    await updateTemplate(c.env.DB, id, body);
    const updated = await getTemplateById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: { id: updated.id, name: updated.name, category: updated.category, messageType: updated.message_type, messageContent: updated.message_content },
    });
  } catch (err) {
    console.error('PUT /api/templates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

templates.delete('/api/templates/:id', async (c) => {
  try {
    const id = c.req.param('id');
    // automations.actions JSON には FK が無いので、削除すると orphan な template_id が
    // 残って実行時に空メッセージ送信→partial fail を引き起こす。auto_replies は
    // ON DELETE SET NULL + inline fallback (responseContent snapshot) で大丈夫だが、
    // automations は安全な fallback パスがないので、参照があれば削除を拒否する。
    const usage = await getTemplateUsage(c.env.DB, id);
    if (usage.automations.length > 0) {
      return c.json({
        success: false,
        error: `automation rule (${usage.automations.length} 件) でこのテンプレートを参照しています。先にそちらの参照を解除してください。`,
        usedBy: usage,
      }, 409);
    }
    await deleteTemplate(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/templates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { templates };
