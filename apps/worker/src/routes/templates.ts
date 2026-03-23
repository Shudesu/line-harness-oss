import { Hono } from 'hono';
import {
  getTemplates,
  getTemplateById,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '@line-crm/db';
import type { Env } from '../index.js';

const templates = new Hono<Env>();

templates.get('/api/templates', async (c) => {
  try {
    const category = c.req.query('category') ?? undefined;
    const items = await getTemplates(c.env.DB, category);
    return c.json({
      success: true,
      data: items.map((t) => ({
        id: t.id,
        name: t.name,
        category: t.category,
        messageType: t.message_type,
        messageContent: t.message_content,
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
    const item = await getTemplateById(c.env.DB, c.req.param('id'));
    if (!item) return c.json({ success: false, error: 'Template not found' }, 404);
    return c.json({
      success: true,
      data: { id: item.id, name: item.name, category: item.category, messageType: item.message_type, messageContent: item.message_content, createdAt: item.created_at, updatedAt: item.updated_at },
    });
  } catch (err) {
    console.error('GET /api/templates/:id error:', err);
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
    await deleteTemplate(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/templates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { templates };
