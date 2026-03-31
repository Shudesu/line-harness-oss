import { Hono } from 'hono';
import { getAiReplyConfig, upsertAiReplyConfig, getAiReplyQueue } from '@line-crm/db';
import type { Env } from '../index.js';

const aiReply = new Hono<Env>();

// GET /api/ai-reply/config - get AI reply config
aiReply.get('/api/ai-reply/config', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId') || null;
    const config = await getAiReplyConfig(c.env.DB, lineAccountId);
    if (!config) {
      return c.json({
        success: true,
        data: null,
      });
    }
    return c.json({
      success: true,
      data: {
        id: config.id,
        lineAccountId: config.line_account_id,
        isEnabled: Boolean(config.is_enabled),
        aiModel: config.ai_model,
        systemPrompt: config.system_prompt,
        delayMinMinutes: config.delay_min_minutes,
        delayMaxMinutes: config.delay_max_minutes,
        maxContextMessages: config.max_context_messages,
        maxTokens: config.max_tokens,
        createdAt: config.created_at,
        updatedAt: config.updated_at,
      },
    });
  } catch (err) {
    console.error('GET /api/ai-reply/config error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/ai-reply/config - upsert AI reply config
aiReply.put('/api/ai-reply/config', async (c) => {
  try {
    const body = await c.req.json<{
      lineAccountId?: string | null;
      isEnabled?: boolean;
      aiModel?: string;
      systemPrompt?: string;
      delayMinMinutes?: number;
      delayMaxMinutes?: number;
      maxContextMessages?: number;
      maxTokens?: number;
    }>();

    const config = await upsertAiReplyConfig(c.env.DB, body);
    return c.json({
      success: true,
      data: {
        id: config.id,
        lineAccountId: config.line_account_id,
        isEnabled: Boolean(config.is_enabled),
        aiModel: config.ai_model,
        systemPrompt: config.system_prompt,
        delayMinMinutes: config.delay_min_minutes,
        delayMaxMinutes: config.delay_max_minutes,
        maxContextMessages: config.max_context_messages,
        maxTokens: config.max_tokens,
        createdAt: config.created_at,
        updatedAt: config.updated_at,
      },
    });
  } catch (err) {
    console.error('PUT /api/ai-reply/config error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/ai-reply/queue - list queue entries
aiReply.get('/api/ai-reply/queue', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId') || undefined;
    const status = c.req.query('status') || undefined;
    const limit = c.req.query('limit') ? parseInt(c.req.query('limit')!, 10) : undefined;

    const entries = await getAiReplyQueue(c.env.DB, { lineAccountId, status, limit });
    return c.json({
      success: true,
      data: entries.map((e) => ({
        id: e.id,
        friendId: e.friend_id,
        lineAccountId: e.line_account_id,
        incomingMessage: e.incoming_message,
        aiResponse: e.ai_response,
        status: e.status,
        scheduledSendAt: e.scheduled_send_at,
        sentAt: e.sent_at,
        errorMessage: e.error_message,
        createdAt: e.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/ai-reply/queue error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/ai-reply/queue/:id - cancel a pending queue entry
aiReply.delete('/api/ai-reply/queue/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const result = await c.env.DB
      .prepare(`UPDATE ai_reply_queue SET status = 'cancelled' WHERE id = ? AND status = 'pending'`)
      .bind(id)
      .run();

    if ((result.meta.changes ?? 0) === 0) {
      return c.json({ success: false, error: 'Not found or already processed' }, 404);
    }
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/ai-reply/queue/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/ai-reply/test - test AI generation without sending
aiReply.post('/api/ai-reply/test', async (c) => {
  try {
    const body = await c.req.json<{
      message: string;
      friendId?: string;
      lineAccountId?: string | null;
    }>();

    if (!body.message) {
      return c.json({ success: false, error: 'message is required' }, 400);
    }

    const anthropicApiKey = c.env.ANTHROPIC_API_KEY;
    if (!anthropicApiKey) {
      return c.json({ success: false, error: 'ANTHROPIC_API_KEY is not configured' }, 500);
    }

    const lineAccountId = body.lineAccountId ?? null;
    const config = await getAiReplyConfig(c.env.DB, lineAccountId);
    if (!config) {
      return c.json({ success: false, error: 'AI reply config not found. Create one first via PUT /api/ai-reply/config' }, 404);
    }

    // Build context: if friendId is given, use real conversation history
    let messages: { role: 'user' | 'assistant'; content: string }[] = [];
    if (body.friendId) {
      const rows = await c.env.DB
        .prepare(
          `SELECT direction, message_type, content FROM messages_log WHERE friend_id = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .bind(body.friendId, config.max_context_messages)
        .all<{ direction: string; message_type: string; content: string }>();

      const logs = rows.results.reverse();
      for (const log of logs) {
        const role: 'user' | 'assistant' = log.direction === 'incoming' ? 'user' : 'assistant';
        let text = log.content;
        if (log.message_type !== 'text') text = `[${log.message_type}]`;
        const last = messages[messages.length - 1];
        if (last && last.role === role) {
          last.content += '\n' + text;
        } else {
          messages.push({ role, content: text });
        }
      }
      while (messages.length > 0 && messages[0].role !== 'user') {
        messages.shift();
      }
    }

    // Add the test message
    const last = messages[messages.length - 1];
    if (last && last.role === 'user') {
      last.content += '\n' + body.message;
    } else {
      messages.push({ role: 'user', content: body.message });
    }

    // Map model names
    const modelMap: Record<string, string> = {
      'claude-haiku': 'claude-haiku-4-5-20251001',
      'claude-sonnet': 'claude-sonnet-4-5-20241022',
      'claude-opus': 'claude-opus-4-20250514',
    };
    const modelId = modelMap[config.ai_model] || config.ai_model;

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: modelId,
        max_tokens: config.max_tokens,
        system: config.system_prompt,
        messages,
      }),
    });

    if (!res.ok) {
      const errBody = await res.text();
      return c.json({ success: false, error: `Claude API error: ${errBody}` }, 502);
    }

    const data = (await res.json()) as { content: { type: string; text: string }[] };
    const textBlock = data.content.find((b) => b.type === 'text');

    return c.json({
      success: true,
      data: {
        response: textBlock?.text ?? '',
        model: modelId,
        contextMessages: messages.length,
      },
    });
  } catch (err) {
    console.error('POST /api/ai-reply/test error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { aiReply };
