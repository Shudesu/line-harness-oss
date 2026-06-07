import { Hono } from 'hono';
import {
  getStripeEvents,
  getStripeEventByStripeId,
  createStripeEvent,
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

/** Stripe署名検証 */
async function verifyStripeSignature(secret: string, rawBody: string, sigHeader: string): Promise<boolean> {
  // Stripe署名形式: t=timestamp,v1=signature
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

stripe.post('/api/integrations/stripe/webhook', async (c) => {
  try {
    const stripeSecret = (c.env as unknown as Record<string, string | undefined>).STRIPE_WEBHOOK_SECRET;
    let body: StripeWebhookBody;

    if (stripeSecret) {
      // 署名検証モード（本番環境）
      const sigHeader = c.req.header('Stripe-Signature') ?? '';
      const rawBody = await c.req.text();

      const valid = await verifyStripeSignature(stripeSecret, rawBody, sigHeader);
      if (!valid) {
        return c.json({ success: false, error: 'Stripe signature verification failed' }, 401);
      }
      body = JSON.parse(rawBody) as StripeWebhookBody;
    } else {
      // シークレット未設定（開発環境向け）
      body = await c.req.json<StripeWebhookBody>();
    }

    // Codex P1#1 修正: 早期スキップを廃止。重複 event は INSERT 段階で
    // stripe_event_id UNIQUE 制約に頼り、side effects は別途冪等化する。
    const existing = await getStripeEventByStripeId(c.env.DB, body.id);

    const obj = body.data.object;
    const db = c.env.DB;

    // メタデータからfriendIdを取得（Stripeのメタデータにline_friend_idを設定している想定）
    const friendId = obj.metadata?.line_friend_id ?? null;

    // イベントを記録 (重複時は INSERT 失敗を捕捉)
    let event = existing;
    if (!existing) {
      try {
        event = await createStripeEvent(db, {
          stripeEventId: body.id,
          eventType: body.type,
          friendId: friendId ?? undefined,
          amount: obj.amount,
          currency: obj.currency,
          metadata: JSON.stringify(obj.metadata ?? {}),
        });
      } catch (e) {
        // UNIQUE 違反 = 並行受信、既に他のリクエストが処理中
        const refetched = await getStripeEventByStripeId(db, body.id);
        if (refetched) event = refetched;
        else throw e;
      }
    }

    // Codex P1#1 副作用冪等化: 購入アクションは stripe_purchases.stripe_event_id の
    // 存在で既処理判定 (UNIQUE INDEX を migration 065 で追加済)。
    // 既処理ならスキップ、未処理なら実行。これで再送時の永久ロストを防ぐ。
    const alreadyHandled = await db
      .prepare(`SELECT 1 FROM stripe_purchases WHERE stripe_event_id = ? LIMIT 1`)
      .bind(body.id)
      .first<{ '1': number }>();
    if (alreadyHandled) {
      return c.json({
        success: true,
        data: { id: event?.id, message: 'Already handled (side effects done)' },
      });
    }

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
          await db
            .prepare(`INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at) VALUES (?, ?, ?)`)
            .bind(friendId, tag.id, jstNow())
            .run();
        }
      }

      // Codex P1 修正 v2: stripe_purchases INSERT 成功を「処理権の獲得」にする。
      // 並行受信時、UNIQUE(stripe_event_id) 制約により INSERT に成功するリクエストは
      // ちょうど1個。それだけが副作用を実行し、他はスキップ → race condition 解消。
      // 30秒タイムアウト回避のため、副作用群は waitUntil で非同期化。
      const priceId = (obj.metadata?.price_id as string | undefined) ?? null;
      const sessionId = (obj.metadata?.session_id as string | undefined) ?? null;
      const amount = obj.amount ?? 0;
      const eventCurrency = obj.currency ?? 'jpy';
      const eventId = body.id;
      const env = c.env;
      c.executionCtx.waitUntil(
        (async () => {
          try {
            if (!priceId) return;
            const { getStripeProductByPriceId, createStripePurchase, enrollFriendInScenario, addTagToFriend } = await import('@line-crm/db');
            const product = await getStripeProductByPriceId(db, priceId);
            if (!product) return;
            // INSERT 成功 = この request が処理権を獲得
            let claimed = false;
            try {
              await createStripePurchase(db, {
                friendId,
                stripeProductId: product.id,
                stripeEventId: eventId,
                stripeSessionId: sessionId,
                amount,
                currency: eventCurrency,
              });
              claimed = true;
            } catch (e) {
              // UNIQUE 違反 = 他のリクエストが先に処理権を獲得済み、副作用スキップ
              console.log('[stripe] purchase claim lost (race), skipping side effects', e);
              return;
            }
            if (!claimed) return;
            if (product.on_purchase_tag_id) {
              try { await addTagToFriend(db, friendId, product.on_purchase_tag_id); }
              catch (e) { console.error('[stripe] purchase tag attach failed', e); }
            }
            if (product.on_purchase_scenario_id) {
              try { await enrollFriendInScenario(db, friendId, product.on_purchase_scenario_id); }
              catch (e) { console.error('[stripe] purchase scenario enroll failed', e); }
            }
            if (product.on_purchase_message_template_id) {
              try {
                const { getMessageTemplateById, getFriendById, getLineAccountById } = await import('@line-crm/db');
                const tmpl = await getMessageTemplateById(db, product.on_purchase_message_template_id);
                const friend = await getFriendById(db, friendId);
                if (tmpl && friend?.line_user_id && (friend as unknown as { line_account_id?: string }).line_account_id) {
                  const acc = await getLineAccountById(db, (friend as unknown as { line_account_id: string }).line_account_id);
                  if (acc) {
                    const { resolveAccessToken } = await import('../lib/account-token.js');
                    const token = await resolveAccessToken(env, acc.channel_access_token);
                    const { LineClient } = await import('@line-crm/line-sdk');
                    const { buildMessage } = await import('../services/step-delivery.js');
                    const message = buildMessage(tmpl.message_type, tmpl.message_content);
                    await new LineClient(token).pushMessage(friend.line_user_id, [message]);
                  }
                }
              } catch (e) {
                console.error('[stripe] purchase message push failed', e);
              }
            }
          } catch (e) {
            console.error('[stripe] async purchase actions failed', e);
          }
        })(),
      );

      // イベントバスに発火（自動化ルール用）
      const { fireEvent } = await import('../services/event-bus.js');
      await fireEvent(db, 'cv_fire', { friendId, eventData: { type: 'purchase', amount: obj.amount, stripeEventId: body.id } });
    }

    // Phase 2-D: subscription 系イベントを stripe_subscriptions に同期
    if (
      friendId && (
        body.type === 'customer.subscription.created' ||
        body.type === 'customer.subscription.updated' ||
        body.type === 'customer.subscription.deleted'
      )
    ) {
      try {
        const subObj = obj as unknown as {
          id?: string;
          customer?: string;
          status?: string;
          current_period_start?: number;
          current_period_end?: number;
          cancel_at?: number | null;
          canceled_at?: number | null;
          items?: { data?: Array<{ price?: { id?: string } }> };
        };
        const subId = subObj.id;
        if (subId) {
          const priceId = subObj.items?.data?.[0]?.price?.id ?? null;
          const { getStripeProductByPriceId, upsertStripeSubscription } = await import('@line-crm/db');
          const product = priceId ? await getStripeProductByPriceId(db, priceId) : null;
          const toIso = (sec: number | null | undefined) =>
            sec ? new Date(sec * 1000).toISOString() : null;
          const status = (subObj.status ?? 'incomplete') as Parameters<typeof upsertStripeSubscription>[1]['status'];
          await upsertStripeSubscription(db, {
            friendId,
            stripeSubscriptionId: subId,
            stripeCustomerId: subObj.customer ?? null,
            stripeProductId: product?.id ?? null,
            status,
            currentPeriodStart: toIso(subObj.current_period_start),
            currentPeriodEnd: toIso(subObj.current_period_end),
            cancelAt: toIso(subObj.cancel_at),
            canceledAt: toIso(subObj.canceled_at),
          });
        }
      } catch (e) {
        console.error('[stripe] subscription sync failed', e);
      }
    }

    // サブスクリプションイベント処理
    if (body.type === 'customer.subscription.deleted' && friendId) {
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

    return c.json({
      success: true,
      data: event
        ? { id: event.id, stripeEventId: event.stripe_event_id, eventType: event.event_type, processedAt: event.processed_at }
        : { stripeEventId: body.id, eventType: body.type, processedAt: jstNow() },
    });
  } catch (err) {
    console.error('POST /api/integrations/stripe/webhook error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { stripe };
