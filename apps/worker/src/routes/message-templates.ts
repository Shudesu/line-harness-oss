import { Hono } from 'hono';
import {
  listMessageTemplates,
  getMessageTemplateById,
  createMessageTemplate,
  updateMessageTemplate,
  deleteMessageTemplate,
} from '@line-crm/db';
import type { MessageTemplate } from '@line-crm/db';
import type { Env } from '../index.js';

const messageTemplates = new Hono<Env>();

function serialize(t: MessageTemplate) {
  return {
    id: t.id,
    name: t.name,
    messageType: t.message_type,
    messageContent: t.message_content,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

// GET /api/message-templates — list all
messageTemplates.get('/api/message-templates', async (c) => {
  try {
    const templates = await listMessageTemplates(c.env.DB);
    return c.json({ success: true, data: templates.map(serialize) });
  } catch (err) {
    console.error('GET /api/message-templates error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/message-templates/:id — get by id
messageTemplates.get('/api/message-templates/:id', async (c) => {
  try {
    const t = await getMessageTemplateById(c.env.DB, c.req.param('id'));
    if (!t) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serialize(t) });
  } catch (err) {
    console.error('GET /api/message-templates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/message-templates — create
messageTemplates.post('/api/message-templates', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      messageType: 'text' | 'flex';
      messageContent: string;
    }>();

    if (!body.name || !body.messageType || !body.messageContent) {
      return c.json({ success: false, error: 'name, messageType, messageContent are required' }, 400);
    }

    if (!['text', 'flex'].includes(body.messageType)) {
      return c.json({ success: false, error: 'messageType must be text or flex' }, 400);
    }

    // Validate flex JSON
    if (body.messageType === 'flex') {
      try {
        JSON.parse(body.messageContent);
      } catch {
        return c.json({ success: false, error: 'messageContent must be valid JSON for flex type' }, 400);
      }
    }

    const t = await createMessageTemplate(c.env.DB, {
      name: body.name,
      messageType: body.messageType,
      messageContent: body.messageContent,
    });
    return c.json({ success: true, data: serialize(t) }, 201);
  } catch (err) {
    console.error('POST /api/message-templates error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/message-templates/:id — update
messageTemplates.put('/api/message-templates/:id', async (c) => {
  try {
    const body = await c.req.json<{
      name?: string;
      messageType?: 'text' | 'flex';
      messageContent?: string;
    }>();

    if (body.messageType && !['text', 'flex'].includes(body.messageType)) {
      return c.json({ success: false, error: 'messageType must be text or flex' }, 400);
    }

    // Resolve effective type and content for validation
    const existing = await getMessageTemplateById(c.env.DB, c.req.param('id'));
    if (!existing) return c.json({ success: false, error: 'Not found' }, 404);
    const effectiveType = body.messageType ?? existing.message_type;
    const effectiveContent = body.messageContent ?? existing.message_content;

    if (effectiveType === 'flex') {
      try {
        JSON.parse(effectiveContent);
      } catch {
        return c.json({ success: false, error: 'messageContent must be valid JSON for flex type' }, 400);
      }
    }

    const t = await updateMessageTemplate(c.env.DB, c.req.param('id'), {
      name: body.name,
      messageType: body.messageType,
      messageContent: body.messageContent,
    });
    if (!t) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serialize(t) });
  } catch (err) {
    console.error('PUT /api/message-templates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/message-templates/:id — delete
messageTemplates.delete('/api/message-templates/:id', async (c) => {
  try {
    const deleted = await deleteMessageTemplate(c.env.DB, c.req.param('id'));
    if (!deleted) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/message-templates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { messageTemplates };
