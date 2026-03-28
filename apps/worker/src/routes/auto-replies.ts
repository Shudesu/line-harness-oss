import { Hono } from 'hono';
import type { Env } from '../index.js';

const autoReplies = new Hono<Env>();

// ========== Auto Replies CRUD ==========

// GET /api/auto-replies — list all auto-reply rules
autoReplies.get('/api/auto-replies', async (c) => {
  try {
    const result = await c.env.DB
      .prepare('SELECT * FROM auto_replies ORDER BY created_at ASC')
      .all<{
        id: string;
        keyword: string;
        match_type: string;
        response_type: string;
        response_content: string;
        is_active: number;
        line_account_id?: string | null;
        created_at: string;
      }>();

    return c.json({
      success: true,
      data: result.results.map((r) => ({
        id: r.id,
        keyword: r.keyword,
        matchType: r.match_type,
        responseType: r.response_type,
        responseContent: r.response_content,
        isActive: Boolean(r.is_active),
        lineAccountId: r.line_account_id ?? null,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/auto-replies error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/auto-replies — create a new auto-reply rule
autoReplies.post('/api/auto-replies', async (c) => {
  try {
    const body = await c.req.json<{
      keyword: string;
      matchType?: 'exact' | 'contains';
      responseType?: string;
      responseContent: string;
      isActive?: boolean;
      lineAccountId?: string | null;
    }>();

    if (!body.keyword || !body.responseContent) {
      return c.json({ success: false, error: 'keyword and responseContent are required' }, 400);
    }

    const id = crypto.randomUUID();
    const matchType = body.matchType ?? 'exact';
    const responseType = body.responseType ?? 'text';
    const isActive = body.isActive !== false ? 1 : 0;
    const lineAccountId = body.lineAccountId ?? null;

    try {
      await c.env.DB
        .prepare(
          `INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content, is_active, line_account_id)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, body.keyword, matchType, responseType, body.responseContent, isActive, lineAccountId)
        .run();
    } catch {
      // Fallback: line_account_id column may not exist yet
      await c.env.DB
        .prepare(
          `INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content, is_active)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(id, body.keyword, matchType, responseType, body.responseContent, isActive)
        .run();
    }

    return c.json({
      success: true,
      data: {
        id,
        keyword: body.keyword,
        matchType,
        responseType,
        responseContent: body.responseContent,
        isActive: Boolean(isActive),
        lineAccountId,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/auto-replies error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/auto-replies/:id — get a single auto-reply rule
autoReplies.get('/api/auto-replies/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const row = await c.env.DB
      .prepare('SELECT * FROM auto_replies WHERE id = ?')
      .bind(id)
      .first<{
        id: string;
        keyword: string;
        match_type: string;
        response_type: string;
        response_content: string;
        is_active: number;
        line_account_id: string | null;
        created_at: string;
      }>();

    if (!row) return c.json({ success: false, error: 'Auto-reply not found' }, 404);

    return c.json({
      success: true,
      data: {
        id: row.id,
        keyword: row.keyword,
        matchType: row.match_type,
        responseType: row.response_type,
        responseContent: row.response_content,
        isActive: Boolean(row.is_active),
        lineAccountId: row.line_account_id,
        createdAt: row.created_at,
      },
    });
  } catch (err) {
    console.error('GET /api/auto-replies/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/auto-replies/:id — update an auto-reply rule
autoReplies.put('/api/auto-replies/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      keyword?: string;
      matchType?: 'exact' | 'contains';
      responseType?: string;
      responseContent?: string;
      isActive?: boolean;
      lineAccountId?: string | null;
    }>();

    const existing = await c.env.DB
      .prepare('SELECT * FROM auto_replies WHERE id = ?')
      .bind(id)
      .first();
    if (!existing) return c.json({ success: false, error: 'Auto-reply not found' }, 404);

    const sets: string[] = [];
    const bindings: (string | number | null)[] = [];

    if (body.keyword !== undefined) { sets.push('keyword = ?'); bindings.push(body.keyword); }
    if (body.matchType !== undefined) { sets.push('match_type = ?'); bindings.push(body.matchType); }
    if (body.responseType !== undefined) { sets.push('response_type = ?'); bindings.push(body.responseType); }
    if (body.responseContent !== undefined) { sets.push('response_content = ?'); bindings.push(body.responseContent); }
    if (body.isActive !== undefined) { sets.push('is_active = ?'); bindings.push(body.isActive ? 1 : 0); }
    if (body.lineAccountId !== undefined) { sets.push('line_account_id = ?'); bindings.push(body.lineAccountId); }

    if (sets.length === 0) {
      return c.json({ success: false, error: 'No fields to update' }, 400);
    }

    bindings.push(id);
    await c.env.DB
      .prepare(`UPDATE auto_replies SET ${sets.join(', ')} WHERE id = ?`)
      .bind(...bindings)
      .run();

    const updated = await c.env.DB
      .prepare('SELECT * FROM auto_replies WHERE id = ?')
      .bind(id)
      .first<{
        id: string;
        keyword: string;
        match_type: string;
        response_type: string;
        response_content: string;
        is_active: number;
        line_account_id: string | null;
        created_at: string;
      }>();

    return c.json({
      success: true,
      data: updated
        ? {
            id: updated.id,
            keyword: updated.keyword,
            matchType: updated.match_type,
            responseType: updated.response_type,
            responseContent: updated.response_content,
            isActive: Boolean(updated.is_active),
            lineAccountId: updated.line_account_id,
            createdAt: updated.created_at,
          }
        : null,
    });
  } catch (err) {
    console.error('PUT /api/auto-replies/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/auto-replies/:id — delete an auto-reply rule
autoReplies.delete('/api/auto-replies/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await c.env.DB
      .prepare('SELECT id FROM auto_replies WHERE id = ?')
      .bind(id)
      .first();
    if (!existing) return c.json({ success: false, error: 'Auto-reply not found' }, 404);

    await c.env.DB.prepare('DELETE FROM auto_replies WHERE id = ?').bind(id).run();
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/auto-replies/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { autoReplies };
