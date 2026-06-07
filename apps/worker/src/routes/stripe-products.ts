/**
 * Phase 2-D: Stripe 商品マスタ管理 API
 *
 * - GET    /api/stripe-products            一覧 (?lineAccountId=)
 * - POST   /api/stripe-products            新規作成 (要 owner)
 * - PATCH  /api/stripe-products/:id        更新 (要 owner)
 * - DELETE /api/stripe-products/:id        削除 (要 owner)
 * - GET    /api/stripe-products/:id/checkout-url?friendId=  - Checkout URL 生成 (Stripe 側で先に設定した URL を返す)
 */

import { Hono } from 'hono';
import {
  listStripeProducts,
  getStripeProduct,
  createStripeProduct,
  updateStripeProduct,
  deleteStripeProduct,
  type BillingType,
  type RecurringInterval,
} from '@line-crm/db';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';

export const stripeProducts = new Hono<Env>();

const BILLING_TYPES: BillingType[] = ['one_time', 'subscription'];
const INTERVALS: RecurringInterval[] = ['day', 'week', 'month', 'year'];

stripeProducts.get('/api/stripe-products', async (c) => {
  const lineAccountId = c.req.query('lineAccountId') ?? undefined;
  const items = await listStripeProducts(c.env.DB, lineAccountId);
  return c.json({ success: true, data: items });
});

stripeProducts.get('/api/stripe-products/:id', async (c) => {
  const item = await getStripeProduct(c.env.DB, c.req.param('id'));
  if (!item) return c.json({ success: false, error: 'not found' }, 404);
  return c.json({ success: true, data: item });
});

stripeProducts.post('/api/stripe-products', requireRole('owner', 'admin'), async (c) => {
  let body: {
    lineAccountId?: string | null;
    name?: string;
    description?: string | null;
    stripeProductId?: string | null;
    stripePriceId?: string;
    amount?: number;
    currency?: string;
    billingType?: string;
    recurringInterval?: string | null;
    onPurchaseTagId?: string | null;
    onPurchaseScenarioId?: string | null;
    onPurchaseMessageTemplateId?: string | null;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'invalid json' }, 400);
  }
  if (!body.name || !body.stripePriceId || body.amount === undefined || !body.billingType) {
    return c.json(
      { success: false, error: 'name / stripePriceId / amount / billingType は必須' },
      400,
    );
  }
  if (!BILLING_TYPES.includes(body.billingType as BillingType)) {
    return c.json({ success: false, error: 'billingType は one_time / subscription' }, 400);
  }
  if (body.billingType === 'subscription' && !body.recurringInterval) {
    return c.json({ success: false, error: 'subscription には recurringInterval が必要' }, 400);
  }
  if (body.recurringInterval && !INTERVALS.includes(body.recurringInterval as RecurringInterval)) {
    return c.json({ success: false, error: 'recurringInterval は day/week/month/year' }, 400);
  }
  if (!Number.isFinite(body.amount) || body.amount < 0 || body.amount > 100_000_000) {
    return c.json({ success: false, error: 'amount は 0〜1億の整数' }, 400);
  }
  if (!body.stripePriceId.startsWith('price_')) {
    return c.json({ success: false, error: 'stripePriceId は price_ から始まる必要があります' }, 400);
  }
  // Codex 指摘 (P2): currency 制限
  const cur = (body.currency ?? 'jpy').toLowerCase();
  if (!['jpy', 'usd'].includes(cur)) {
    return c.json({ success: false, error: 'currency は jpy または usd' }, 400);
  }

  // Codex 指摘 (P2): 紐付けリソースの存在 & アカウント境界 厳格検証
  const postAccountId = body.lineAccountId ?? null;
  const validateBound = async (
    table: string,
    id: string | null | undefined,
  ): Promise<string | null> => {
    if (!id) return null;
    const row = await c.env.DB
      .prepare(`SELECT line_account_id FROM ${table} WHERE id = ?`)
      .bind(id)
      .first<{ line_account_id: string | null }>();
    if (!row) return `${table}.${id} が見つかりません`;
    // 商品が NULL (グローバル) → 紐付け先も NULL のみ許可 (Codex P2 厳格)
    // 商品が account 固定 → 同じ account or NULL のみ許可
    if (postAccountId === null) {
      if (row.line_account_id !== null) {
        return `グローバル商品には account 固定のリソース (${table}.${id}) を紐付けできません`;
      }
    } else if (row.line_account_id && row.line_account_id !== postAccountId) {
      return `${table}.${id} は別の LINE アカウントに属しています`;
    }
    return null;
  };
  for (const [t, v] of [
    ['tags', body.onPurchaseTagId],
    ['scenarios', body.onPurchaseScenarioId],
    ['message_templates', body.onPurchaseMessageTemplateId],
  ] as const) {
    const err = await validateBound(t, v ?? null);
    if (err) return c.json({ success: false, error: err }, 400);
  }

  try {
    const item = await createStripeProduct(c.env.DB, {
      lineAccountId: body.lineAccountId,
      name: body.name,
      description: body.description ?? null,
      stripeProductId: body.stripeProductId ?? null,
      stripePriceId: body.stripePriceId,
      amount: Math.floor(body.amount),
      currency: (body.currency ?? 'jpy').toLowerCase(),
      billingType: body.billingType as BillingType,
      recurringInterval: (body.recurringInterval ?? null) as RecurringInterval | null,
      onPurchaseTagId: body.onPurchaseTagId ?? null,
      onPurchaseScenarioId: body.onPurchaseScenarioId ?? null,
      onPurchaseMessageTemplateId: body.onPurchaseMessageTemplateId ?? null,
    });
    return c.json({ success: true, data: item }, 201);
  } catch (err) {
    console.error('[stripe-products] create error:', err);
    return c.json({ success: false, error: 'internal error' }, 500);
  }
});

stripeProducts.patch('/api/stripe-products/:id', requireRole('owner', 'admin'), async (c) => {
  const id = c.req.param('id');
  let body: {
    name?: string;
    description?: string | null;
    stripeProductId?: string | null;
    stripePriceId?: string;
    amount?: number;
    currency?: string;
    billingType?: string;
    recurringInterval?: string | null;
    onPurchaseTagId?: string | null;
    onPurchaseScenarioId?: string | null;
    onPurchaseMessageTemplateId?: string | null;
    isActive?: boolean;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'invalid json' }, 400);
  }
  if (body.billingType && !BILLING_TYPES.includes(body.billingType as BillingType)) {
    return c.json({ success: false, error: 'billingType は one_time / subscription' }, 400);
  }
  if (body.recurringInterval !== undefined && body.recurringInterval !== null && !INTERVALS.includes(body.recurringInterval as RecurringInterval)) {
    return c.json({ success: false, error: 'recurringInterval は day/week/month/year' }, 400);
  }
  if (body.amount !== undefined && (!Number.isFinite(body.amount) || body.amount < 0 || body.amount > 100_000_000)) {
    return c.json({ success: false, error: 'amount は 0〜1億の整数' }, 400);
  }
  if (body.stripePriceId !== undefined && !body.stripePriceId.startsWith('price_')) {
    return c.json({ success: false, error: 'stripePriceId は price_ から始まる必要があります' }, 400);
  }
  if (body.currency !== undefined && !['jpy', 'usd'].includes(body.currency.toLowerCase())) {
    return c.json({ success: false, error: 'currency は jpy または usd' }, 400);
  }
  // Codex P1 修正: PATCH でも cross-account 検証
  const existing = await getStripeProduct(c.env.DB, id);
  if (!existing) return c.json({ success: false, error: 'not found' }, 404);
  const accountId = existing.line_account_id;
  const validateBound = async (
    table: string,
    boundId: string | null | undefined,
  ): Promise<string | null> => {
    if (boundId === undefined) return null;
    if (boundId === null) return null;
    const row = await c.env.DB
      .prepare(`SELECT line_account_id FROM ${table} WHERE id = ?`)
      .bind(boundId)
      .first<{ line_account_id: string | null }>();
    if (!row) return `${table}.${boundId} が見つかりません`;
    // 商品が account 固定なら、紐付け先も同じ account か NULL のみ許可
    // 商品が NULL (グローバル) なら、紐付け先も NULL のみ許可 (Codex P2 修正)
    if (accountId === null) {
      if (row.line_account_id !== null) {
        return `グローバル商品には account 固定のリソース (${table}.${boundId}) を紐付けできません`;
      }
    } else if (row.line_account_id && row.line_account_id !== accountId) {
      return `${table}.${boundId} は別の LINE アカウントに属しています`;
    }
    return null;
  };
  for (const [t, v] of [
    ['tags', body.onPurchaseTagId],
    ['scenarios', body.onPurchaseScenarioId],
    ['message_templates', body.onPurchaseMessageTemplateId],
  ] as const) {
    const err = await validateBound(t, v);
    if (err) return c.json({ success: false, error: err }, 400);
  }

  const updated = await updateStripeProduct(c.env.DB, id, {
    name: body.name,
    description: body.description ?? undefined,
    stripeProductId: body.stripeProductId ?? undefined,
    stripePriceId: body.stripePriceId,
    amount: body.amount,
    currency: body.currency,
    billingType: body.billingType as BillingType | undefined,
    recurringInterval: (body.recurringInterval ?? null) as RecurringInterval | null | undefined,
    onPurchaseTagId: body.onPurchaseTagId ?? undefined,
    onPurchaseScenarioId: body.onPurchaseScenarioId ?? undefined,
    onPurchaseMessageTemplateId: body.onPurchaseMessageTemplateId ?? undefined,
    isActive: body.isActive,
  });
  if (!updated) return c.json({ success: false, error: 'not found' }, 404);
  return c.json({ success: true, data: updated });
});

stripeProducts.delete('/api/stripe-products/:id', requireRole('owner'), async (c) => {
  await deleteStripeProduct(c.env.DB, c.req.param('id'));
  return c.json({ success: true, data: null });
});
