import { jstNow } from './utils';

export interface Coupon {
  id: string;
  name: string;
  description: string | null;
  code: string;
  discount_type: 'fixed' | 'percentage';
  discount_value: number;
  max_claims: number | null;
  expires_at: string | null;
  is_active: number;
  line_account_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface CouponClaim {
  id: string;
  coupon_id: string;
  friend_id: string;
  claimed_at: string;
  redeemed_at: string | null;
}

export interface CouponWithStats extends Coupon {
  claim_count: number;
  redeem_count: number;
}

export async function getCoupons(db: D1Database, lineAccountId?: string): Promise<CouponWithStats[]> {
  const sql = lineAccountId
    ? `SELECT c.*,
         (SELECT COUNT(*) FROM coupon_claims cc WHERE cc.coupon_id = c.id) as claim_count,
         (SELECT COUNT(*) FROM coupon_claims cc WHERE cc.coupon_id = c.id AND cc.redeemed_at IS NOT NULL) as redeem_count
       FROM coupons c WHERE c.line_account_id = ? OR c.line_account_id IS NULL ORDER BY c.created_at DESC`
    : `SELECT c.*,
         (SELECT COUNT(*) FROM coupon_claims cc WHERE cc.coupon_id = c.id) as claim_count,
         (SELECT COUNT(*) FROM coupon_claims cc WHERE cc.coupon_id = c.id AND cc.redeemed_at IS NOT NULL) as redeem_count
       FROM coupons c ORDER BY c.created_at DESC`;
  const result = await db.prepare(sql).bind(...(lineAccountId ? [lineAccountId] : [])).all<CouponWithStats>();
  return result.results;
}

export async function getCouponById(db: D1Database, id: string): Promise<Coupon | null> {
  return db.prepare('SELECT * FROM coupons WHERE id = ?').bind(id).first<Coupon>();
}

export async function getCouponByCode(db: D1Database, code: string): Promise<Coupon | null> {
  return db.prepare('SELECT * FROM coupons WHERE code = ? AND is_active = 1').bind(code).first<Coupon>();
}

export async function createCoupon(
  db: D1Database,
  data: {
    name: string;
    description?: string;
    code: string;
    discountType?: 'fixed' | 'percentage';
    discountValue?: number;
    maxClaims?: number;
    expiresAt?: string;
    lineAccountId?: string;
  },
): Promise<Coupon> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      'INSERT INTO coupons (id, name, description, code, discount_type, discount_value, max_claims, expires_at, line_account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(
      id,
      data.name,
      data.description || null,
      data.code,
      data.discountType || 'fixed',
      data.discountValue || 0,
      data.maxClaims || null,
      data.expiresAt || null,
      data.lineAccountId || null,
      now,
      now,
    )
    .run();
  return (await getCouponById(db, id))!;
}

export async function updateCoupon(
  db: D1Database,
  id: string,
  data: {
    name?: string;
    description?: string;
    code?: string;
    discountType?: 'fixed' | 'percentage';
    discountValue?: number;
    maxClaims?: number | null;
    expiresAt?: string | null;
    isActive?: boolean;
  },
): Promise<Coupon | null> {
  const existing = await getCouponById(db, id);
  if (!existing) return null;
  const now = jstNow();
  await db
    .prepare(
      'UPDATE coupons SET name = ?, description = ?, code = ?, discount_type = ?, discount_value = ?, max_claims = ?, expires_at = ?, is_active = ?, updated_at = ? WHERE id = ?',
    )
    .bind(
      data.name ?? existing.name,
      data.description ?? existing.description,
      data.code ?? existing.code,
      data.discountType ?? existing.discount_type,
      data.discountValue ?? existing.discount_value,
      data.maxClaims !== undefined ? data.maxClaims : existing.max_claims,
      data.expiresAt !== undefined ? data.expiresAt : existing.expires_at,
      data.isActive !== undefined ? (data.isActive ? 1 : 0) : existing.is_active,
      now,
      id,
    )
    .run();
  return getCouponById(db, id);
}

export async function deleteCoupon(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM coupon_claims WHERE coupon_id = ?').bind(id).run();
  await db.prepare('DELETE FROM coupons WHERE id = ?').bind(id).run();
}

/** Claim a coupon for a friend. Returns the claim or null if already claimed / limit reached / expired. */
export async function claimCoupon(
  db: D1Database,
  couponId: string,
  friendId: string,
): Promise<CouponClaim | null> {
  const coupon = await getCouponById(db, couponId);
  if (!coupon || !coupon.is_active) return null;

  // Check expiry
  if (coupon.expires_at && new Date(coupon.expires_at) < new Date()) return null;

  // Check max claims
  if (coupon.max_claims) {
    const count = await db
      .prepare('SELECT COUNT(*) as cnt FROM coupon_claims WHERE coupon_id = ?')
      .bind(couponId)
      .first<{ cnt: number }>();
    if (count && count.cnt >= coupon.max_claims) return null;
  }

  // Check duplicate
  const existing = await db
    .prepare('SELECT id FROM coupon_claims WHERE coupon_id = ? AND friend_id = ?')
    .bind(couponId, friendId)
    .first();
  if (existing) return null;

  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare('INSERT INTO coupon_claims (id, coupon_id, friend_id, claimed_at) VALUES (?, ?, ?, ?)')
    .bind(id, couponId, friendId, now)
    .run();
  return { id, coupon_id: couponId, friend_id: friendId, claimed_at: now, redeemed_at: null };
}

/** Redeem (use) a claimed coupon */
export async function redeemCoupon(db: D1Database, couponId: string, friendId: string): Promise<boolean> {
  const now = jstNow();
  const result = await db
    .prepare('UPDATE coupon_claims SET redeemed_at = ? WHERE coupon_id = ? AND friend_id = ? AND redeemed_at IS NULL')
    .bind(now, couponId, friendId)
    .run();
  return (result.meta?.changes || 0) > 0;
}

/** Get claims for a coupon */
export async function getCouponClaims(
  db: D1Database,
  couponId: string,
): Promise<(CouponClaim & { friend_name?: string })[]> {
  const result = await db
    .prepare(
      `SELECT cc.*, f.display_name as friend_name
       FROM coupon_claims cc LEFT JOIN friends f ON f.id = cc.friend_id
       WHERE cc.coupon_id = ? ORDER BY cc.claimed_at DESC`,
    )
    .bind(couponId)
    .all<CouponClaim & { friend_name?: string }>();
  return result.results;
}
