import { Hono } from 'hono';
import {
  getIncomingWebhooks,
  getIncomingWebhookById,
  createIncomingWebhook,
  updateIncomingWebhook,
  deleteIncomingWebhook,
  getOutgoingWebhooks,
  getOutgoingWebhookById,
  createOutgoingWebhook,
  updateOutgoingWebhook,
  deleteOutgoingWebhook,
} from '@line-crm/db';
import { timingSafeEqual } from '../middleware/auth.js';
import type { Env } from '../index.js';

/** 受信WebhookのHMAC-SHA256署名を検証する */
async function verifyIncomingSignature(secret: string, rawBody: string, sigHeader: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(rawBody));
  const computedSig = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return timingSafeEqual(computedSig, sigHeader);
}

const webhooks = new Hono<Env>();

// ========== 受信Webhook ==========

webhooks.get('/api/webhooks/incoming', async (c) => {
  try {
    const items = await getIncomingWebhooks(c.env.DB);
    return c.json({
      success: true,
      data: items.map((w) => ({
        id: w.id,
        name: w.name,
        sourceType: w.source_type,
        hasSecret: Boolean(w.secret),
        isActive: Boolean(w.is_active),
        createdAt: w.created_at,
        updatedAt: w.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/webhooks/incoming error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.post('/api/webhooks/incoming', async (c) => {
  try {
    const body = await c.req.json<{ name: string; sourceType?: string; secret?: string }>();
    if (!body.name) return c.json({ success: false, error: 'name is required' }, 400);
    const item = await createIncomingWebhook(c.env.DB, body);
    return c.json({ success: true, data: { id: item.id, name: item.name, sourceType: item.source_type, isActive: Boolean(item.is_active), createdAt: item.created_at } }, 201);
  } catch (err) {
    console.error('POST /api/webhooks/incoming error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.put('/api/webhooks/incoming/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    await updateIncomingWebhook(c.env.DB, id, body);
    const updated = await getIncomingWebhookById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: { id: updated.id, name: updated.name, sourceType: updated.source_type, isActive: Boolean(updated.is_active) } });
  } catch (err) {
    console.error('PUT /api/webhooks/incoming/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.delete('/api/webhooks/incoming/:id', async (c) => {
  try {
    await deleteIncomingWebhook(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/webhooks/incoming/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 送信Webhook ==========

webhooks.get('/api/webhooks/outgoing', async (c) => {
  try {
    const items = await getOutgoingWebhooks(c.env.DB);
    return c.json({
      success: true,
      data: items.map((w) => ({
        id: w.id,
        name: w.name,
        url: w.url,
        eventTypes: JSON.parse(w.event_types),
        hasSecret: Boolean(w.secret),
        isActive: Boolean(w.is_active),
        createdAt: w.created_at,
        updatedAt: w.updated_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/webhooks/outgoing error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.post('/api/webhooks/outgoing', async (c) => {
  try {
    const body = await c.req.json<{ name: string; url: string; eventTypes: string[]; secret?: string }>();
    if (!body.name || !body.url) return c.json({ success: false, error: 'name and url are required' }, 400);
    const item = await createOutgoingWebhook(c.env.DB, { ...body, eventTypes: body.eventTypes ?? [] });
    return c.json({
      success: true,
      data: { id: item.id, name: item.name, url: item.url, eventTypes: JSON.parse(item.event_types), isActive: Boolean(item.is_active), createdAt: item.created_at },
    }, 201);
  } catch (err) {
    console.error('POST /api/webhooks/outgoing error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.put('/api/webhooks/outgoing/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json();
    await updateOutgoingWebhook(c.env.DB, id, body);
    const updated = await getOutgoingWebhookById(c.env.DB, id);
    if (!updated) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: { id: updated.id, name: updated.name, url: updated.url, eventTypes: JSON.parse(updated.event_types), isActive: Boolean(updated.is_active) } });
  } catch (err) {
    console.error('PUT /api/webhooks/outgoing/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webhooks.delete('/api/webhooks/outgoing/:id', async (c) => {
  try {
    await deleteOutgoingWebhook(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/webhooks/outgoing/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 受信Webhookエンドポイント (外部システムからの受信) ==========

webhooks.post('/api/webhooks/incoming/:id/receive', async (c) => {
  try {
    const id = c.req.param('id');
    const wh = await getIncomingWebhookById(c.env.DB, id);
    if (!wh || !wh.is_active) return c.json({ success: false, error: 'Webhook not found or inactive' }, 404);

    const rawBody = await c.req.text();

    // secretが設定されている場合はHMAC署名を検証する
    if (wh.secret) {
      const sigHeader = c.req.header('X-Webhook-Signature') ?? '';
      const valid = await verifyIncomingSignature(wh.secret, rawBody, sigHeader);
      if (!valid) return c.json({ success: false, error: 'Invalid signature' }, 401);
    }

    let body: unknown;
    try { body = JSON.parse(rawBody); } catch { return c.json({ success: false, error: 'Invalid JSON' }, 400); }

    // イベントバスに発火: source_type をイベントタイプとして使用
    const { fireEvent } = await import('../services/event-bus.js');
    const eventType = `incoming_webhook.${wh.source_type}`;
    await fireEvent(c.env.DB, eventType, {
      eventData: { webhookId: wh.id, source: wh.source_type, payload: body },
    });

    return c.json({ success: true, data: { received: true, source: wh.source_type } });
  } catch (err) {
    console.error('POST /api/webhooks/incoming/:id/receive error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { webhooks };
