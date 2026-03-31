import { Hono } from 'hono';
import {
  getCoupons,
  getCouponById,
  getCouponByCode,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  claimCoupon,
  redeemCoupon,
  getCouponClaims,
} from '@line-crm/db';
import type { Env } from '../index.js';

const coupons = new Hono<Env>();

// GET /api/coupons
coupons.get('/api/coupons', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    const data = await getCoupons(c.env.DB, lineAccountId);
    return c.json({ success: true, data });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// GET /api/coupons/:id
coupons.get('/api/coupons/:id', async (c) => {
  try {
    const data = await getCouponById(c.env.DB, c.req.param('id'));
    if (!data) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// POST /api/coupons
coupons.post('/api/coupons', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      description?: string;
      code: string;
      discountType?: 'fixed' | 'percentage';
      discountValue?: number;
      maxClaims?: number;
      expiresAt?: string;
      lineAccountId?: string;
    }>();
    if (!body.name || !body.code) {
      return c.json({ success: false, error: 'name and code are required' }, 400);
    }
    const data = await createCoupon(c.env.DB, body);
    return c.json({ success: true, data }, 201);
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// PUT /api/coupons/:id
coupons.put('/api/coupons/:id', async (c) => {
  try {
    const body = await c.req.json();
    const data = await updateCoupon(c.env.DB, c.req.param('id'), body);
    if (!data) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// DELETE /api/coupons/:id
coupons.delete('/api/coupons/:id', async (c) => {
  try {
    await deleteCoupon(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// POST /api/coupons/claim — claim by code
coupons.post('/api/coupons/claim', async (c) => {
  try {
    const body = await c.req.json<{ code: string; friendId: string }>();
    if (!body.code || !body.friendId) {
      return c.json({ success: false, error: 'code and friendId are required' }, 400);
    }
    const coupon = await getCouponByCode(c.env.DB, body.code);
    if (!coupon) return c.json({ success: false, error: 'Invalid or inactive coupon code' }, 404);

    const claim = await claimCoupon(c.env.DB, coupon.id, body.friendId);
    if (!claim) {
      return c.json({ success: false, error: 'Already claimed, expired, or limit reached' }, 409);
    }
    return c.json({ success: true, data: { claim, coupon } });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// POST /api/coupons/:id/redeem
coupons.post('/api/coupons/:id/redeem', async (c) => {
  try {
    const body = await c.req.json<{ friendId: string }>();
    if (!body.friendId) return c.json({ success: false, error: 'friendId is required' }, 400);
    const ok = await redeemCoupon(c.env.DB, c.req.param('id'), body.friendId);
    if (!ok) return c.json({ success: false, error: 'Not claimed or already redeemed' }, 409);
    return c.json({ success: true, data: null });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// GET /api/coupons/:id/claims
coupons.get('/api/coupons/:id/claims', async (c) => {
  try {
    const data = await getCouponClaims(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

export { coupons };
