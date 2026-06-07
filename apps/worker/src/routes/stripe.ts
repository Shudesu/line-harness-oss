import { Hono } from 'hono';
import {
  getStripeEvents,
  getStripeEventByStripeId,
  createStripeEvent,
  jstNow,
  applyScoring,
} from '@line-crm/db';
import { fireEvent } from '../services/event-bus.js';
import type { Env } from '../index.js';

const stripe = new Hono<Env>();

interface StripeWebhookBody {
  id: string;
  type: string;
  /**
   * P1 (2026-06-07): Stripe event の作成 unix 秒。
   * subscription.updated と subscription.created の re-order を弾く monotonic guard 用。
   */
  created?: number;
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

/**
 * Stripe 署名検証 (Codex P1 修正: timestamp tolerance + 定時間比較)
 *
 * Stripe webhook の正規ロジック:
 *  - Stripe-Signature: t=<timestamp>,v1=<hex>
 *  - 期待される HMAC: HMAC_SHA256(secret, "{timestamp}.{rawBody}")
 *  - timestamp は Unix 秒。Stripe SDK は ±5 分以内を許容。
 *
 * 修正点:
 *  - tolerance を 5 分に設定 (replay 攻撃を抑止)
 *  - 文字列比較を timingSafeEqual 相当 (Web Crypto では bytes 比較で定時間化)
 */
const STRIPE_TOLERANCE_SECONDS = 300; // 5 分

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    const v = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(v)) return null;
    bytes[i] = v;
  }
  return bytes;
}

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

  // タイムスタンプ tolerance チェック (replay 防止)
  const tsNum = Number(timestamp);
  if (!Number.isFinite(tsNum)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > STRIPE_TOLERANCE_SECONDS) {
    console.warn(`[stripe] signature timestamp outside tolerance: ts=${tsNum}, now=${nowSec}`);
    return false;
  }

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

  const computedBytes = new Uint8Array(sig);
  const expectedBytes = hexToBytes(expectedSig);
  if (!expectedBytes) return false;
  return constantTimeEqual(computedBytes, expectedBytes);
}

stripe.post('/api/integrations/stripe/webhook', async (c) => {
  try {
    // P1 緊急修正: body size guard (DoS 防止)
    // Stripe webhook の最大 event サイズは ~256KB だが、攻撃者が巨大 JSON で memory 食いを狙える
    const contentLength = c.req.header('content-length');
    if (contentLength) {
      const len = Number(contentLength);
      if (Number.isFinite(len) && len > 1_048_576) { // 1MiB 上限
        return c.json({ success: false, error: 'Payload too large' }, 413);
      }
    }

    const stripeSecret = (c.env as unknown as Record<string, string | undefined>).STRIPE_WEBHOOK_SECRET;

    // P1 緊急修正 (2026-06-07): fail-closed。
    // 旧実装は secret 未設定だと検証なしで body を受け入れていた。
    // 本番で STRIPE_WEBHOOK_SECRET が未設定の状態で公開されており、
    // 攻撃者が偽 webhook を投げて CV 発火・タグ付与・スコア加算を任意発動できた。
    // 503 で即拒否し、dev でも本番と同じ動作で確認させる
    // (dev で動作確認したい場合は STRIPE_WEBHOOK_SECRET を手動設定して
    //  Stripe CLI の `stripe listen --print-secret` の値を流すこと)。
    if (!stripeSecret) {
      return c.json({ success: false, error: 'STRIPE_WEBHOOK_SECRET not configured' }, 503);
    }

    const sigHeader = c.req.header('Stripe-Signature') ?? '';
    const rawBody = await c.req.text();
    // 二重チェック: content-length が空でも raw byte で 1MiB 超なら拒否
    if (rawBody.length > 1_048_576) {
      return c.json({ success: false, error: 'Payload too large' }, 413);
    }

    const valid = await verifyStripeSignature(stripeSecret, rawBody, sigHeader);
    if (!valid) {
      return c.json({ success: false, error: 'Stripe signature verification failed' }, 401);
    }
    const body = JSON.parse(rawBody) as StripeWebhookBody;

    const obj = body.data.object;
    const db = c.env.DB;

    // メタデータからfriendIdを取得（Stripeのメタデータにline_friend_idを設定している想定）
    const friendId = obj.metadata?.line_friend_id ?? null;

    // Codex P1 修正 v3: stripe_events INSERT 成功が「処理権の獲得」(Stripe推奨の event-id idempotency)。
    // - 成功 = この request が最初の処理担当 → 全 side effects を実行
    // - UNIQUE 違反 = 既に別の request が処理した/中 → 全 side effects スキップ
    // これで applyScoring / 自動タグ / cv_fire の重複実行を完全に防げる。
    let claimed = false;
    let event;
    try {
      event = await createStripeEvent(db, {
        stripeEventId: body.id,
        eventType: body.type,
        friendId: friendId ?? undefined,
        amount: obj.amount,
        currency: obj.currency,
        metadata: JSON.stringify(obj.metadata ?? {}),
      });
      claimed = true;
    } catch {
      // UNIQUE 違反 (= 重複 webhook)
      const refetched = await getStripeEventByStripeId(db, body.id);
      event = refetched ?? undefined;
    }
    if (!claimed) {
      return c.json({
        success: true,
        data: { id: event?.id, message: 'Already handled (stripe_events UNIQUE)' },
      });
    }

    // 決済成功時の自動処理 (claim 後だから安全に実行可)
    if (body.type === 'payment_intent.succeeded' && friendId) {
      // 重い処理は waitUntil で非同期化 (LINE/Stripe の 30 秒タイムアウト回避)。
      // claim 済みなので二重実行は起きない。
      const priceId = (obj.metadata?.price_id as string | undefined) ?? null;
      const sessionId = (obj.metadata?.session_id as string | undefined) ?? null;
      const amount = obj.amount ?? 0;
      const eventCurrency = obj.currency ?? 'jpy';
      const eventId = body.id;
      const env = c.env;
      const legacyProductId = obj.metadata?.product_id;

      c.executionCtx.waitUntil(
        (async () => {
          try {
            // (1) スコアリング (applyScoring は static import に昇格 - hot path)
            try { await applyScoring(db, friendId, 'purchase'); }
            catch (e) { console.error('[stripe] applyScoring failed', e); }

            // (2) 旧 product_id ベース自動タグ (purchased_xxx)
            if (legacyProductId) {
              try {
                const tag = await db
                  .prepare(`SELECT id FROM tags WHERE name = ?`)
                  .bind(`purchased_${legacyProductId}`)
                  .first<{ id: string }>();
                if (tag) {
                  await db
                    .prepare(`INSERT OR IGNORE INTO friend_tags (friend_id, tag_id, assigned_at) VALUES (?, ?, ?)`)
                    .bind(friendId, tag.id, jstNow())
                    .run();
                }
              } catch (e) { console.error('[stripe] legacy auto-tag failed', e); }
            }

            // (3) 新 stripe_products / purchases / Phase 2-E 購入者限定アクション
            if (priceId) {
              const { getStripeProductByPriceId, createStripePurchase, enrollFriendInScenario, addTagToFriend } = await import('@line-crm/db');
              const product = await getStripeProductByPriceId(db, priceId);
              if (product) {
                try {
                  await createStripePurchase(db, {
                    friendId,
                    stripeProductId: product.id,
                    stripeEventId: eventId,
                    stripeSessionId: sessionId,
                    amount,
                    currency: eventCurrency,
                  });
                } catch (e) {
                  // ここは stripe_events claim 済なので来ないはずだが、保険
                  console.log('[stripe] purchase row already exists', e);
                }
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
              }
            }

            // (4) イベントバス発火 (自動化ルール用) - fireEvent は static import に昇格
            try {
              await fireEvent(db, 'cv_fire', { friendId, eventData: { type: 'purchase', amount, stripeEventId: eventId } });
            } catch (e) { console.error('[stripe] fireEvent failed', e); }
          } catch (e) {
            console.error('[stripe] async purchase actions failed', e);
          }
        })(),
      );
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
            // P1 (2026-06-07): event.created を monotonic guard に渡す。
            // 古い (再送された .created) で新しい (.updated) を上書きしない。
            eventCreatedAt: toIso(body.created),
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
