import { jstNow } from './utils.js';

export interface SubscriptionRow {
  id: string;
  user_id: string;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  plan: 'free' | 'pro' | 'business';
  status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid';
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: number;
  created_at: string;
  updated_at: string;
}

export async function getSubscriptionByUserId(
  db: D1Database,
  userId: string,
): Promise<SubscriptionRow | null> {
  return db
    .prepare(`SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(userId)
    .first<SubscriptionRow>();
}

export async function getSubscriptionByStripeSubId(
  db: D1Database,
  stripeSubscriptionId: string,
): Promise<SubscriptionRow | null> {
  return db
    .prepare(`SELECT * FROM subscriptions WHERE stripe_subscription_id = ?`)
    .bind(stripeSubscriptionId)
    .first<SubscriptionRow>();
}

export async function getSubscriptionByStripeCustomerId(
  db: D1Database,
  stripeCustomerId: string,
): Promise<SubscriptionRow | null> {
  return db
    .prepare(`SELECT * FROM subscriptions WHERE stripe_customer_id = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(stripeCustomerId)
    .first<SubscriptionRow>();
}

export async function upsertSubscription(
  db: D1Database,
  input: {
    userId: string;
    stripeCustomerId?: string;
    stripeSubscriptionId?: string;
    plan: 'free' | 'pro' | 'business';
    status: 'active' | 'trialing' | 'past_due' | 'canceled' | 'unpaid';
    currentPeriodStart?: string;
    currentPeriodEnd?: string;
    cancelAtPeriodEnd?: boolean;
  },
): Promise<SubscriptionRow> {
  const now = jstNow();
  const existing = await getSubscriptionByUserId(db, input.userId);

  if (existing) {
    await db
      .prepare(
        `UPDATE subscriptions SET
          stripe_customer_id = ?,
          stripe_subscription_id = ?,
          plan = ?,
          status = ?,
          current_period_start = ?,
          current_period_end = ?,
          cancel_at_period_end = ?,
          updated_at = ?
        WHERE id = ?`,
      )
      .bind(
        input.stripeCustomerId ?? existing.stripe_customer_id,
        input.stripeSubscriptionId ?? existing.stripe_subscription_id,
        input.plan,
        input.status,
        input.currentPeriodStart ?? existing.current_period_start,
        input.currentPeriodEnd ?? existing.current_period_end,
        input.cancelAtPeriodEnd ? 1 : 0,
        now,
        existing.id,
      )
      .run();
    return (await db
      .prepare(`SELECT * FROM subscriptions WHERE id = ?`)
      .bind(existing.id)
      .first<SubscriptionRow>())!;
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO subscriptions
        (id, user_id, stripe_customer_id, stripe_subscription_id, plan, status,
         current_period_start, current_period_end, cancel_at_period_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.userId,
      input.stripeCustomerId ?? null,
      input.stripeSubscriptionId ?? null,
      input.plan,
      input.status,
      input.currentPeriodStart ?? null,
      input.currentPeriodEnd ?? null,
      input.cancelAtPeriodEnd ? 1 : 0,
      now,
      now,
    )
    .run();
  return (await db
    .prepare(`SELECT * FROM subscriptions WHERE id = ?`)
    .bind(id)
    .first<SubscriptionRow>())!;
}

export async function cancelSubscription(
  db: D1Database,
  stripeSubscriptionId: string,
): Promise<void> {
  const now = jstNow();
  await db
    .prepare(
      `UPDATE subscriptions SET status = 'canceled', cancel_at_period_end = 1, updated_at = ?
       WHERE stripe_subscription_id = ?`,
    )
    .bind(now, stripeSubscriptionId)
    .run();
}
