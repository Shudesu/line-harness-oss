import { Hono } from 'hono';
import {
  getAutoReplies,
  getAutoReplyById,
  createAutoReply,
  updateAutoReply,
  deleteAutoReply,
} from '@line-crm/db';
import type { AutoReply as DbAutoReply } from '@line-crm/db';
import type { Env } from '../index.js';

const autoReplies = new Hono<Env>();

function serializeAutoReply(row: DbAutoReply) {
  return {
    id: row.id,
    keyword: row.keyword,
    matchType: row.match_type,
    responseType: row.response_type,
    responseContent: row.response_content,
    lineAccountId: row.line_account_id,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}

// GET /api/auto-replies — list all auto-replies (optional ?accountId filter)
autoReplies.get('/api/auto-replies', async (c) => {
  try {
    const accountId = c.req.query('accountId');
    const items = await getAutoReplies(c.env.DB, accountId || undefined);
    return c.json({ success: true, data: items.map(serializeAutoReply) });
  } catch (err) {
    console.error('GET /api/auto-replies error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/auto-replies/:id — get by ID
autoReplies.get('/api/auto-replies/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const item = await getAutoReplyById(c.env.DB, id);
    if (!item) {
      return c.json({ success: false, error: 'Auto-reply not found' }, 404);
    }
    return c.json({ success: true, data: serializeAutoReply(item) });
  } catch (err) {
    console.error('GET /api/auto-replies/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/auto-replies — create
autoReplies.post('/api/auto-replies', async (c) => {
  try {
    const body = await c.req.json<{
      keyword: string;
      matchType?: 'exact' | 'contains';
      responseType?: string;
      responseContent: string;
      lineAccountId?: string | null;
    }>();

    if (!body.keyword) {
      return c.json({ success: false, error: 'keyword is required' }, 400);
    }
    if (!body.responseContent) {
      return c.json({ success: false, error: 'responseContent is required' }, 400);
    }

    const item = await createAutoReply(c.env.DB, {
      keyword: body.keyword,
      matchType: body.matchType,
      responseType: body.responseType,
      responseContent: body.responseContent,
      lineAccountId: body.lineAccountId ?? null,
    });

    return c.json({ success: true, data: serializeAutoReply(item) }, 201);
  } catch (err) {
    console.error('POST /api/auto-replies error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/auto-replies/:id — update
autoReplies.put('/api/auto-replies/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      keyword?: string;
      matchType?: 'exact' | 'contains';
      responseType?: string;
      responseContent?: string;
      lineAccountId?: string | null;
      isActive?: boolean;
    }>();

    const input: Record<string, unknown> = {};
    if (body.keyword !== undefined) input.keyword = body.keyword;
    if (body.matchType !== undefined) input.matchType = body.matchType;
    if (body.responseType !== undefined) input.responseType = body.responseType;
    if (body.responseContent !== undefined) input.responseContent = body.responseContent;
    if ('lineAccountId' in body) input.lineAccountId = body.lineAccountId;
    if (body.isActive !== undefined) input.isActive = body.isActive;

    const updated = await updateAutoReply(c.env.DB, id, input as Parameters<typeof updateAutoReply>[2]);

    if (!updated) {
      return c.json({ success: false, error: 'Auto-reply not found' }, 404);
    }

    return c.json({ success: true, data: serializeAutoReply(updated) });
  } catch (err) {
    console.error('PUT /api/auto-replies/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/auto-replies/:id
autoReplies.delete('/api/auto-replies/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const item = await getAutoReplyById(c.env.DB, id);
    if (!item) {
      return c.json({ success: false, error: 'Auto-reply not found' }, 404);
    }
    await deleteAutoReply(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/auto-replies/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { autoReplies };
