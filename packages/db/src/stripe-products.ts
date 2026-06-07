/**
 * Phase 2-D/E: Stripe 商品マスタ・継続課金状態・購入履歴の DB ヘルパー
 */

import { jstNow } from './utils.js';

export type BillingType = 'one_time' | 'subscription';
export type RecurringInterval = 'day' | 'week' | 'month' | 'year';
export type SubscriptionStatus =
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'trialing'
  | 'paused';

export interface StripeProduct {
  id: string;
  line_account_id: string | null;
  name: string;
  description: string | null;
  stripe_product_id: string | null;
  stripe_price_id: string;
  amount: number;
  currency: string;
  billing_type: BillingType;
  recurring_interval: RecurringInterval | null;
  on_purchase_tag_id: string | null;
  on_purchase_scenario_id: string | null;
  on_purchase_message_template_id: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export async function listStripeProducts(
  db: D1Database,
  lineAccountId?: string,
): Promise<StripeProduct[]> {
  if (lineAccountId) {
    const r = await db
      .prepare(
        'SELECT * FROM stripe_products WHERE line_account_id = ? ORDER BY created_at DESC',
      )
      .bind(lineAccountId)
      .all<StripeProduct>();
    return r.results ?? [];
  }
  const r = await db
    .prepare('SELECT * FROM stripe_products ORDER BY created_at DESC')
    .all<StripeProduct>();
  return r.results ?? [];
}

export async function getStripeProduct(
  db: D1Database,
  id: string,
): Promise<StripeProduct | null> {
  const row = await db
    .prepare('SELECT * FROM stripe_products WHERE id = ?')
    .bind(id)
    .first<StripeProduct>();
  return row ?? null;
}

export async function getStripeProductByPriceId(
  db: D1Database,
  stripePriceId: string,
): Promise<StripeProduct | null> {
  const row = await db
    .prepare('SELECT * FROM stripe_products WHERE stripe_price_id = ? LIMIT 1')
    .bind(stripePriceId)
    .first<StripeProduct>();
  return row ?? null;
}

export interface CreateStripeProductInput {
  lineAccountId?: string | null;
  name: string;
  description?: string | null;
  stripeProductId?: string | null;
  stripePriceId: string;
  amount: number;
  currency: string;
  billingType: BillingType;
  recurringInterval?: RecurringInterval | null;
  onPurchaseTagId?: string | null;
  onPurchaseScenarioId?: string | null;
  onPurchaseMessageTemplateId?: string | null;
}

export async function createStripeProduct(
  db: D1Database,
  input: CreateStripeProductInput,
): Promise<StripeProduct> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO stripe_products
        (id, line_account_id, name, description, stripe_product_id, stripe_price_id,
         amount, currency, billing_type, recurring_interval,
         on_purchase_tag_id, on_purchase_scenario_id, on_purchase_message_template_id,
         is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(
      id,
      input.lineAccountId ?? null,
      input.name,
      input.description ?? null,
      input.stripeProductId ?? null,
      input.stripePriceId,
      input.amount,
      input.currency,
      input.billingType,
      input.recurringInterval ?? null,
      input.onPurchaseTagId ?? null,
      input.onPurchaseScenarioId ?? null,
      input.onPurchaseMessageTemplateId ?? null,
      now,
      now,
    )
    .run();
  const row = await getStripeProduct(db, id);
  if (!row) throw new Error('failed to read back stripe_product');
  return row;
}

export async function updateStripeProduct(
  db: D1Database,
  id: string,
  input: Partial<CreateStripeProductInput> & { isActive?: boolean },
): Promise<StripeProduct | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];
  const map: Record<string, [string, unknown]> = {
    name: ['name', input.name],
    description: ['description', input.description],
    stripeProductId: ['stripe_product_id', input.stripeProductId],
    stripePriceId: ['stripe_price_id', input.stripePriceId],
    amount: ['amount', input.amount],
    currency: ['currency', input.currency],
    billingType: ['billing_type', input.billingType],
    recurringInterval: ['recurring_interval', input.recurringInterval],
    onPurchaseTagId: ['on_purchase_tag_id', input.onPurchaseTagId],
    onPurchaseScenarioId: ['on_purchase_scenario_id', input.onPurchaseScenarioId],
    onPurchaseMessageTemplateId: ['on_purchase_message_template_id', input.onPurchaseMessageTemplateId],
  };
  for (const k of Object.keys(input) as (keyof typeof input)[]) {
    if (k in map && input[k] !== undefined) {
      sets.push(`${map[k as string][0]} = ?`);
      binds.push(input[k]);
    }
  }
  if (input.isActive !== undefined) {
    sets.push('is_active = ?');
    binds.push(input.isActive ? 1 : 0);
  }
  if (sets.length === 0) return getStripeProduct(db, id);
  sets.push('updated_at = ?');
  binds.push(jstNow());
  binds.push(id);
  await db
    .prepare(`UPDATE stripe_products SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  return getStripeProduct(db, id);
}

export async function deleteStripeProduct(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM stripe_products WHERE id = ?').bind(id).run();
}

// ─── Subscriptions ──────────────────────────────────────

export interface StripeSubscription {
  id: string;
  friend_id: string;
  stripe_product_id: string | null;
  stripe_subscription_id: string | null;
  stripe_customer_id: string | null;
  status: SubscriptionStatus;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at: string | null;
  canceled_at: string | null;
  /** P1 (2026-06-07): Stripe event.created の monotonic timestamp。 */
  last_event_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function listStripeSubscriptionsByFriend(
  db: D1Database,
  friendId: string,
): Promise<StripeSubscription[]> {
  const r = await db
    .prepare('SELECT * FROM stripe_subscriptions WHERE friend_id = ? ORDER BY created_at DESC')
    .bind(friendId)
    .all<StripeSubscription>();
  return r.results ?? [];
}

export async function upsertStripeSubscription(
  db: D1Database,
  input: {
    friendId: string;
    stripeSubscriptionId: string;
    stripeCustomerId?: string | null;
    stripeProductId?: string | null;
    status: SubscriptionStatus;
    currentPeriodStart?: string | null;
    currentPeriodEnd?: string | null;
    cancelAt?: string | null;
    canceledAt?: string | null;
    /**
     * P1 (2026-06-07): Stripe event.created を ISO 文字列で渡す。
     * UPDATE 経路は last_event_at が NULL または bind 値より古い場合のみ書き込む
     * (= subscription.updated → subscription.created の re-order を弾く)。
     * 省略時は monotonic guard を skip (=旧挙動と互換)。
     */
    eventCreatedAt?: string | null;
  },
): Promise<StripeSubscription> {
  // Stripe subscription_id をユニークキーとして upsert
  const now = jstNow();
  const existing = await db
    .prepare('SELECT id FROM stripe_subscriptions WHERE stripe_subscription_id = ?')
    .bind(input.stripeSubscriptionId)
    .first<{ id: string }>();

  if (existing) {
    // P1: monotonic guard。eventCreatedAt が指定されていれば、現在の last_event_at
    // より新しい場合のみ UPDATE 全体を実行する。古い event は no-op。
    // ISO 8601 文字列の lexicographic 比較は時系列順と一致する。
    if (input.eventCreatedAt) {
      await db
        .prepare(
          `UPDATE stripe_subscriptions
              SET friend_id = ?, stripe_product_id = ?, stripe_customer_id = ?,
                  status = ?, current_period_start = ?, current_period_end = ?,
                  cancel_at = ?, canceled_at = ?, last_event_at = ?, updated_at = ?
            WHERE id = ?
              AND (last_event_at IS NULL OR last_event_at < ?)`,
        )
        .bind(
          input.friendId,
          input.stripeProductId ?? null,
          input.stripeCustomerId ?? null,
          input.status,
          input.currentPeriodStart ?? null,
          input.currentPeriodEnd ?? null,
          input.cancelAt ?? null,
          input.canceledAt ?? null,
          input.eventCreatedAt,
          now,
          existing.id,
          input.eventCreatedAt,
        )
        .run();
    } else {
      await db
        .prepare(
          `UPDATE stripe_subscriptions
              SET friend_id = ?, stripe_product_id = ?, stripe_customer_id = ?,
                  status = ?, current_period_start = ?, current_period_end = ?,
                  cancel_at = ?, canceled_at = ?, updated_at = ?
            WHERE id = ?`,
        )
        .bind(
          input.friendId,
          input.stripeProductId ?? null,
          input.stripeCustomerId ?? null,
          input.status,
          input.currentPeriodStart ?? null,
          input.currentPeriodEnd ?? null,
          input.cancelAt ?? null,
          input.canceledAt ?? null,
          now,
          existing.id,
        )
        .run();
    }
    const row = await db
      .prepare('SELECT * FROM stripe_subscriptions WHERE id = ?')
      .bind(existing.id)
      .first<StripeSubscription>();
    if (!row) throw new Error('failed read back subscription');
    return row;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO stripe_subscriptions
        (id, friend_id, stripe_product_id, stripe_subscription_id, stripe_customer_id,
         status, current_period_start, current_period_end, cancel_at, canceled_at,
         last_event_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.friendId,
      input.stripeProductId ?? null,
      input.stripeSubscriptionId,
      input.stripeCustomerId ?? null,
      input.status,
      input.currentPeriodStart ?? null,
      input.currentPeriodEnd ?? null,
      input.cancelAt ?? null,
      input.canceledAt ?? null,
      input.eventCreatedAt ?? null,
      now,
      now,
    )
    .run();
  const row = await db
    .prepare('SELECT * FROM stripe_subscriptions WHERE id = ?')
    .bind(id)
    .first<StripeSubscription>();
  if (!row) throw new Error('failed read back subscription');
  return row;
}

// ─── Purchases ──────────────────────────────────────────

export interface StripePurchase {
  id: string;
  friend_id: string;
  stripe_product_id: string | null;
  stripe_event_id: string | null;
  stripe_session_id: string | null;
  amount: number;
  currency: string;
  purchased_at: string;
}

export async function listStripePurchasesByFriend(
  db: D1Database,
  friendId: string,
  limit: number = 100,
): Promise<StripePurchase[]> {
  const r = await db
    .prepare(
      'SELECT * FROM stripe_purchases WHERE friend_id = ? ORDER BY purchased_at DESC LIMIT ?',
    )
    .bind(friendId, limit)
    .all<StripePurchase>();
  return r.results ?? [];
}

export async function createStripePurchase(
  db: D1Database,
  input: {
    friendId: string;
    stripeProductId?: string | null;
    stripeEventId?: string | null;
    stripeSessionId?: string | null;
    amount: number;
    currency: string;
  },
): Promise<StripePurchase> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO stripe_purchases
        (id, friend_id, stripe_product_id, stripe_event_id, stripe_session_id,
         amount, currency, purchased_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.friendId,
      input.stripeProductId ?? null,
      input.stripeEventId ?? null,
      input.stripeSessionId ?? null,
      input.amount,
      input.currency,
      now,
    )
    .run();
  const row = await db
    .prepare('SELECT * FROM stripe_purchases WHERE id = ?')
    .bind(id)
    .first<StripePurchase>();
  if (!row) throw new Error('failed read back purchase');
  return row;
}
