import { Hono } from 'hono';
import { jstNow } from '@line-crm/db';
import type { Env } from '../index.js';

const autoReplies = new Hono<Env>();

// GET /api/auto-replies - list all
autoReplies.get('/api/auto-replies', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    let sql = 'SELECT * FROM auto_replies';
    const bindings: string[] = [];
    if (lineAccountId) {
      sql += ' WHERE line_account_id = ? OR line_account_id IS NULL';
      bindings.push(lineAccountId);
    }
    sql += ' ORDER BY created_at ASC';
    const stmt = bindings.length > 0 ? c.env.DB.prepare(sql).bind(...bindings) : c.env.DB.prepare(sql);
    const result = await stmt.all();
    return c.json({
      success: true,
      data: result.results.map((r: Record<string, unknown>) => ({
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

// POST /api/auto-replies - create
autoReplies.post('/api/auto-replies', async (c) => {
  try {
    const body = await c.req.json<{
      keyword: string;
      matchType: 'exact' | 'contains';
      responseType?: string;
      responseContent: string;
      lineAccountId?: string | null;
    }>();
    if (!body.keyword || !body.responseContent) {
      return c.json({ success: false, error: 'keyword and responseContent are required' }, 400);
    }
    const id = crypto.randomUUID();
    const now = jstNow();
    await c.env.DB.prepare(
      `INSERT INTO auto_replies (id, keyword, match_type, response_type, response_content, is_active, line_account_id, created_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
      .bind(id, body.keyword, body.matchType || 'contains', body.responseType || 'text', body.responseContent, body.lineAccountId ?? null, now)
      .run();
    return c.json({
      success: true,
      data: {
        id,
        keyword: body.keyword,
        matchType: body.matchType || 'contains',
        responseType: body.responseType || 'text',
        responseContent: body.responseContent,
        isActive: true,
        createdAt: now,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/auto-replies error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/auto-replies/:id - update
autoReplies.put('/api/auto-replies/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      keyword?: string;
      matchType?: string;
      responseType?: string;
      responseContent?: string;
      isActive?: boolean;
    }>();
    const sets: string[] = [];
    const bindings: unknown[] = [];
    if (body.keyword !== undefined) { sets.push('keyword = ?'); bindings.push(body.keyword); }
    if (body.matchType !== undefined) { sets.push('match_type = ?'); bindings.push(body.matchType); }
    if (body.responseType !== undefined) { sets.push('response_type = ?'); bindings.push(body.responseType); }
    if (body.responseContent !== undefined) { sets.push('response_content = ?'); bindings.push(body.responseContent); }
    if (body.isActive !== undefined) { sets.push('is_active = ?'); bindings.push(body.isActive ? 1 : 0); }
    if (sets.length === 0) {
      return c.json({ success: false, error: 'No fields to update' }, 400);
    }
    bindings.push(id);
    await c.env.DB.prepare(`UPDATE auto_replies SET ${sets.join(', ')} WHERE id = ?`).bind(...bindings).run();
    const updated = await c.env.DB.prepare('SELECT * FROM auto_replies WHERE id = ?').bind(id).first();
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({
      success: true,
      data: {
        id: updated.id,
        keyword: updated.keyword,
        matchType: updated.match_type,
        responseType: updated.response_type,
        responseContent: updated.response_content,
        isActive: Boolean(updated.is_active),
        createdAt: updated.created_at,
      },
    });
  } catch (err) {
    console.error('PUT /api/auto-replies/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/auto-replies/:id - delete
autoReplies.delete('/api/auto-replies/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await c.env.DB.prepare('DELETE FROM auto_replies WHERE id = ?').bind(id).run();
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/auto-replies/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { autoReplies };
