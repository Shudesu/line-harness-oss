import { isoToSqlite, randomCode } from '../lib/logic.js'

export interface CampaignCouponRow {
  id: string
  name: string
  code: string
  discount_text: string | null
  status: 'active' | 'ended'
  used_count: number
  expires_at: string | null
  created_at: string
}

export interface CreateCampaignInput {
  name: string
  discountText?: string
  /** ISO 8601 or 'YYYY-MM-DD'（JSTの終日=翌日00:00 JSTまで） */
  expiresAt?: string
}

export async function createCampaignCoupon(db: D1Database, input: CreateCampaignInput): Promise<CampaignCouponRow> {
  const name = input.name.trim()
  if (!name) throw new Error('キャンペーン名は必須です')

  let expiresAt: string | null = null
  if (input.expiresAt) {
    const raw = /^\d{4}-\d{2}-\d{2}$/.test(input.expiresAt)
      ? `${input.expiresAt}T23:59:59+09:00` // 日付だけならJST終日
      : input.expiresAt
    const d = new Date(raw)
    if (Number.isNaN(d.getTime())) throw new Error('expiresAt が不正です')
    expiresAt = isoToSqlite(d.toISOString())
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const bytes = new Uint8Array(6)
    crypto.getRandomValues(bytes)
    const code = `CP-${randomCode(6, bytes)}`
    try {
      await db
        .prepare(
          'INSERT INTO campaign_coupons (id, name, code, discount_text, expires_at) VALUES (?, ?, ?, ?, ?)',
        )
        .bind(crypto.randomUUID(), name, code, input.discountText?.trim() || null, expiresAt)
        .run()
      const row = await db.prepare('SELECT * FROM campaign_coupons WHERE code = ?').bind(code).first<CampaignCouponRow>()
      if (!row) throw new Error('campaign insert failed')
      return row
    } catch (e) {
      if (attempt === 4) throw e
      // UNIQUE collision — retry with a fresh code
    }
  }
  throw new Error('campaign code generation failed')
}

export async function listCampaignCoupons(db: D1Database): Promise<CampaignCouponRow[]> {
  const { results } = await db
    .prepare('SELECT * FROM campaign_coupons ORDER BY created_at DESC LIMIT 100')
    .all<CampaignCouponRow>()
  return results
}

export type CampaignRedeemResult =
  | { ok: true; coupon: CampaignCouponRow }
  | { ok: false; reason: 'not_found' | 'ended' | 'expired' }

/**
 * 共通クーポンの消込（多回数使用可・使用回数をカウント）。
 * memberId を渡すと「誰が使ったか」を campaign_redemptions に記録する（来店判定用）。
 */
export async function redeemCampaignCoupon(
  db: D1Database,
  code: string,
  memberId?: string | null,
): Promise<CampaignRedeemResult> {
  const coupon = await db
    .prepare('SELECT * FROM campaign_coupons WHERE code = ?')
    .bind(code.trim().toUpperCase())
    .first<CampaignCouponRow>()
  if (!coupon) return { ok: false, reason: 'not_found' }
  if (coupon.status !== 'active') return { ok: false, reason: 'ended' }
  if (coupon.expires_at && coupon.expires_at <= isoToSqlite(new Date().toISOString())) {
    return { ok: false, reason: 'expired' }
  }
  await db.batch([
    db.prepare('UPDATE campaign_coupons SET used_count = used_count + 1 WHERE id = ?').bind(coupon.id),
    db
      .prepare('INSERT INTO campaign_redemptions (id, coupon_id, member_id) VALUES (?, ?, ?)')
      .bind(crypto.randomUUID(), coupon.id, memberId ?? null),
  ])
  coupon.used_count += 1
  return { ok: true, coupon }
}
