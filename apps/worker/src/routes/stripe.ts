import { Hono } from 'hono';
import {
  getStripeEvents,
  getStripeEventByStripeId,
  createStripeEvent,
  upsertSubscription,
  cancelSubscription,
  jstNow,
} from '@line-crm/db';
import type { Env } from '../index.js';

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
      items?: { data: Array<{ price: { id: string; product: string } }> };
      current_period_start?: number;
      current_period_end?: number;
      cancel_at_period_end?: boolean;
    };
  };
}

function resolvePlan(
  priceId: string,
  proPriceId: string | undefined,
  businessPriceId: string | undefined,
): 'pro' | 'business' | null {
  if (proPriceId && priceId === proPriceId) return 'pro';
  if (businessPriceId && priceId === businessPriceId) return 'business';
  return null;
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

// ========== サブスクリプション照会 ==========

stripe.get('/api/subscriptions/:userId', async (c) => {
  try {
    const userId = c.req.param('userId');
    const sub = await (async () => {
      const { getSubscriptionByUserId } = await import('@line-crm/db');
      return getSubscriptionByUserId(c.env.DB, userId);
    })();
    if (!sub) {
      return c.json({
        success: true,
        data: { plan: 'free', status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: null },
      });
    }
    return c.json({
      success: true,
      data: {
        id: sub.id,
        plan: sub.plan,
        status: sub.status,
        cancelAtPeriodEnd: sub.cancel_at_period_end === 1,
        currentPeriodStart: sub.current_period_start,
        currentPeriodEnd: sub.current_period_end,
        stripeCustomerId: sub.stripe_customer_id,
        stripeSubscriptionId: sub.stripe_subscription_id,
      },
    });
  } catch (err) {
    console.error('GET /api/subscriptions/:userId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== サブスクリプション手動登録（管理用） ==========

stripe.post('/api/subscriptions', async (c) => {
  try {
    const body = await c.req.json<{
      userId: string;
      plan: 'free' | 'pro' | 'business';
      status?: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid';
      stripeCustomerId?: string;
      stripeSubscriptionId?: string;
    }>();
    if (!body.userId || !body.plan) {
      return c.json({ success: false, error: 'userId and plan are required' }, 400);
    }
    const sub = await upsertSubscription(c.env.DB, {
      userId: body.userId,
      plan: body.plan,
      status: body.status ?? 'active',
      stripeCustomerId: body.stripeCustomerId,
      stripeSubscriptionId: body.stripeSubscriptionId,
    });
    return c.json({ success: true, data: sub }, 201);
  } catch (err) {
    console.error('POST /api/subscriptions error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== Stripe署名検証 ==========

async function verifyStripeSignature(secret: string, rawBody: string, sigHeader: string): Promise<boolean> {
  const parts = Object.fromEntries(
    sigHeader.split(',').map((p) => {
      const [k, ...v] = p.split('=');
      return [k, v.join('=')];
    }),
  );
  const timestamp = parts.t;
  const expectedSig = parts.v1;
  if (!timestamp || !expectedSig) return false;

  const encoder = new TextEncoder();
  const signedPayload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(signedPayload));
  const computedSig = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return computedSig === expectedSig;
}

// ========== Stripe Webhook ==========

stripe.post('/api/integrations/stripe/webhook', async (c) => {
  try {
    const env = c.env as unknown as Record<string, string | undefined>;
    const stripeSecret = env.STRIPE_WEBHOOK_SECRET;
    let body: StripeWebhookBody;

    if (stripeSecret) {
      const sigHeader = c.req.header('Stripe-Signature') ?? '';
      const rawBody = await c.req.text();
      const valid = await verifyStripeSignature(stripeSecret, rawBody, sigHeader);
      if (!valid) {
        return c.json({ success: false, error: 'Stripe signature verification failed' }, 401);
      }
      body = JSON.parse(rawBody) as StripeWebhookBody;
    } else {
      return c.json(
        { success: false, error: 'STRIPE_WEBHOOK_SECRET is not configured. Webhook rejected.' },
        500,
      );
    }

    const existing = await getStripeEventByStripeId(c.env.DB, body.id);
    if (existing) {
      return c.json({ success: true, data: { message: 'Already processed' } });
    }

    const obj = body.data.object;
    const db = c.env.DB;
    const friendId = obj.metadata?.line_friend_id ?? null;
    const proPriceId = env.STRIPE_PRO_PRICE_ID;
    const businessPriceId = env.STRIPE_BUSINESS_PRICE_ID;

    const event = await createStripeEvent(db, {
      stripeEventId: body.id,
      eventType: body.type,
      friendId: friendId ?? undefined,
      amount: obj.amount,
      currency: obj.currency,
      metadata: JSON.stringify(obj.metadata ?? {}),
    });

    // payment_intent.succeeded
    if (body.type === 'payment_intent.succeeded' && friendId) {
      const { applyScoring } = await import('@line-crm/db');
      await applyScoring(db, friendId, 'purchase');

      const productId = obj.metadata?.product_id;
      if (productId) {
        const tag = await db
          .prepare(`SELECT id FROM tags WHERE name = ?`)
          .bind(`purchased_${productId}`)
          .first<{ id: string }>();
        if (tag) {
          await db
            .prepare(`INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at) VALUES (?, ?, ?)`)
            .bind(friendId, tag.id, jstNow())
            .run();
        }
      }

      const { fireEvent } = await import('../services/event-bus.js');
      await fireEvent(db, 'cv_fire', {
        friendId,
        eventData: { type: 'purchase', amount: obj.amount, stripeEventId: body.id },
      });
    }

    // subscription created / updated
    if (
      (body.type === 'customer.subscription.created' || body.type === 'customer.subscription.updated') &&
      obj.customer
    ) {
      const userId = obj.metadata?.miyabi_user_id;
      if (userId) {
        const priceId = obj.items?.data?.[0]?.price?.id ?? '';
        const plan = resolvePlan(priceId, proPriceId, businessPriceId) ?? 'free';
        const status = (obj.status ?? 'active') as 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid';
        await upsertSubscription(db, {
          userId,
          stripeCustomerId: obj.customer,
          stripeSubscriptionId: obj.id,
          plan,
          status,
          currentPeriodStart: obj.current_period_start
            ? new Date(obj.current_period_start * 1000).toISOString()
            : undefined,
          currentPeriodEnd: obj.current_period_end
            ? new Date(obj.current_period_end * 1000).toISOString()
            : undefined,
          cancelAtPeriodEnd: obj.cancel_at_period_end ?? false,
        });
      }
    }

    // subscription deleted
    if (body.type === 'customer.subscription.deleted') {
      await cancelSubscription(db, obj.id);

      if (friendId) {
        const cancelledTag = await db
          .prepare(`SELECT id FROM tags WHERE name = 'subscription_cancelled'`)
          .first<{ id: string }>();
        if (cancelledTag) {
          await db
            .prepare(`INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at) VALUES (?, ?, ?)`)
            .bind(friendId, cancelledTag.id, jstNow())
            .run();
        }
      }

      if (!friendId && obj.customer) {
        await db
          .prepare(
            `UPDATE subscriptions SET status = 'canceled', cancel_at_period_end = 1, updated_at = ?
             WHERE stripe_customer_id = ?`,
          )
          .bind(jstNow(), obj.customer)
          .run();
      }
    }

    return c.json({
      success: true,
      data: {
        id: event.id,
        stripeEventId: event.stripe_event_id,
        eventType: event.event_type,
        processedAt: event.processed_at,
      },
    });
  } catch (err) {
    console.error('POST /api/integrations/stripe/webhook error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { stripe };
