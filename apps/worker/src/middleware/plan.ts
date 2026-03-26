/**
 * Teachable バイパス決済 — プラン判定ユーティリティ
 *
 * Stripe 本番化(T48)まではタグベースでプランを判定する。
 * Teachable 購入後に管理画面から plan_pro / plan_business タグを手動付与する。
 * Stripe 本番化後はサブスクリプションテーブルに移行。
 */
import type { D1Database } from '@cloudflare/workers-types';

export type Plan = 'free' | 'pro' | 'business';

const PLAN_TAGS: Record<string, Plan> = {
  plan_business: 'business',
  plan_pro: 'pro',
};

/**
 * LINE friend ID からプランを取得する。
 * タグ plan_business > plan_pro > subscriptions テーブル > free の優先順で判定。
 */
export async function getPlan(db: D1Database, friendId: string): Promise<Plan> {
  // 1. タグベース判定（Teachable バイパス）
  const tagRow = await db
    .prepare(
      `SELECT t.name FROM friend_tags ft
       JOIN tags t ON ft.tag_id = t.id
       WHERE ft.friend_id = ? AND t.name IN ('plan_business', 'plan_pro')
       ORDER BY CASE t.name WHEN 'plan_business' THEN 1 WHEN 'plan_pro' THEN 2 END ASC
       LIMIT 1`,
    )
    .bind(friendId)
    .first<{ name: string }>();

  if (tagRow && tagRow.name in PLAN_TAGS) {
    return PLAN_TAGS[tagRow.name];
  }

  // 2. Stripe サブスクリプションテーブル（本番化後 T48 まで存在しない可能性がある）
  // テーブルが未作成の場合 D1 は null ではなく例外を投げるため try/catch で保護する。
  // NOTE: subscriptions.user_id は LINE 友だち ID (friendId) と同一の識別子。
  // T48 マイグレーション実装時に列名を統一すること。
  try {
    const sub = await db
      .prepare(
        `SELECT plan FROM subscriptions WHERE user_id = ? AND status = 'active' LIMIT 1`,
      )
      .bind(friendId)
      .first<{ plan: string }>();

    if (sub && (sub.plan === 'pro' || sub.plan === 'business')) {
      return sub.plan as Plan;
    }
  } catch (err) {
    // Expected error: subscriptions table does not exist yet (pre-T48).
    // Log unexpected errors (schema mismatch etc.) so billing issues are observable.
    if (!(err instanceof Error && err.message.includes('no such table'))) {
      console.error('getPlan: subscription lookup failed:', err instanceof Error ? err.message : err);
    }
  }

  return 'free';
}

/**
 * プランが要求レベル以上かチェックする。
 * isPlanAtLeast('pro', 'pro') → true
 * isPlanAtLeast('free', 'pro') → false
 */
export function isPlanAtLeast(userPlan: Plan, required: Plan): boolean {
  const order: Plan[] = ['free', 'pro', 'business'];
  return order.indexOf(userPlan) >= order.indexOf(required);
}
