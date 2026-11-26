import { Hono } from 'hono';
import {
  getStripeEvents,
  getStripeEventByStripeId,
  createStripeEvent,
  addTagToFriend,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { awardActivityMileage } from '../services/activity-mileage.js';
import { verifyWebhookSignature } from '../services/webhook-signature.js';

const stripe = new Hono<Env>();

interface StripeWebhookBody {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      amount?: number;
      currency?: string;
      metadata?: Record<string, string>;
      customer?: string;
      status?: string;
    };
  };
}

// ========== Stripeイベント一覧 ==========

stripe.get('/api/integrations/stripe/events', async (c) => {
  try {
    const friendId = c.req.query('friendId') ?? undefined;
    const eventType = c.req.query('eventType') ?? undefined;
    const limit = Number(c.req.query('limit') ?? '100');
    const items = await getStripeEvents(c.env.DB, { friendId, eventType, limit });
    return c.json({
      success: true,
      data: items.map((e) => ({
        id: e.id,
        stripeEventId: e.stripe_event_id,
        eventType: e.event_type,
        friendId: e.friend_id,
        amount: e.amount,
        currency: e.currency,
        metadata: e.metadata ? JSON.parse(e.metadata) : null,
        processedAt: e.processed_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/integrations/stripe/events error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== Stripe Webhookレシーバー ==========

stripe.post('/api/integrations/stripe/webhook', async (c) => {
  try {
    const stripeSecret = c.env.STRIPE_WEBHOOK_SECRET;
    if (!stripeSecret?.trim()) {
      return c.json({ success: false, error: 'Stripe webhook is not configured' }, 503);
    }
    const rawBody = await c.req.text();
    const valid = await verifyWebhookSignature(stripeSecret, rawBody, c.req.header('Stripe-Signature') ?? '');
    if (!valid) {
      return c.json({ success: false, error: 'Stripe signature verification failed' }, 401);
    }
    let body: StripeWebhookBody;
    try {
      body = JSON.parse(rawBody) as StripeWebhookBody;
    } catch {
      return c.json({ success: false, error: 'Invalid JSON' }, 400);
    }
    if (!body || typeof body.id !== 'string' || !body.id ||
        typeof body.type !== 'string' || !body.data?.object?.id) {
      return c.json({ success: false, error: 'Invalid Stripe event' }, 400);
    }

    // 冪等性チェック
    const existing = await getStripeEventByStripeId(c.env.DB, body.id);
    if (existing) {
      return c.json({ success: true, data: { message: 'Already processed' } });
    }

    const obj = body.data.object;
    const db = c.env.DB;

    // メタデータからfriendIdを取得（Stripeのメタデータにline_friend_idを設定している想定）
    const friendId = obj.metadata?.line_friend_id ?? null;

    // イベントを記録
    const event = await createStripeEvent(db, {
      stripeEventId: body.id,
      eventType: body.type,
      friendId: friendId ?? undefined,
      amount: obj.amount,
      currency: obj.currency,
      metadata: JSON.stringify(obj.metadata ?? {}),
    });

    // 決済成功時の自動処理
    if (body.type === 'payment_intent.succeeded' && friendId) {
      const { applyScoring } = await import('@line-crm/db');
      await applyScoring(db, friendId, 'purchase');

      // 自動タグ付け（product_idベース）
      const productId = obj.metadata?.product_id;
      if (productId) {
        const tag = await db
          .prepare(`SELECT id FROM tags WHERE name = ?`)
          .bind(`purchased_${productId}`)
          .first<{ id: string }>();
        if (tag) {
          await addTagToFriend(db, friendId, tag.id);
        }
      }

      await awardActivityMileage(db, {
        eventType: 'purchase_completed',
        source: 'stripe',
        sourceEventId: body.id,
        friendId,
        subjectKey: productId || 'first_purchase',
        metadata: {
          stripeEventId: body.id,
          paymentIntentId: obj.id,
          productId: productId ?? null,
          amount: obj.amount ?? null,
          currency: obj.currency ?? null,
        },
        occurredAt: event.processed_at,
      });

      // イベントバスに発火（自動化ルール用）
      const { fireEvent } = await import('../services/event-bus.js');
      await fireEvent(db, 'cv_fire', { friendId, eventData: { type: 'purchase', amount: obj.amount, stripeEventId: body.id } });
    }

    // サブスクリプションイベント処理
    if (body.type === 'customer.subscription.deleted' && friendId) {
      const cancelledTag = await db
        .prepare(`SELECT id FROM tags WHERE name = 'subscription_cancelled'`)
        .first<{ id: string }>();
      if (cancelledTag) {
        await addTagToFriend(db, friendId, cancelledTag.id);
      }
    }

    return c.json({
      success: true,
      data: { id: event.id, stripeEventId: event.stripe_event_id, eventType: event.event_type, processedAt: event.processed_at },
    });
  } catch (err) {
    console.error('POST /api/integrations/stripe/webhook error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { stripe };
