import { Hono } from 'hono'
import { storeConfig } from '../env.js'
import type { AppContext } from '../middleware/auth.js'
import { adminAuth } from '../middleware/auth.js'
import { harnessClient, trySendText } from '../lib/harness.js'
import { formatJst, jstParts, sqliteToIso } from '../lib/logic.js'
import type { MemberRow } from '../services/members.js'
import { findMemberByNo } from '../services/members.js'
import { issueReward } from '../services/stamps.js'
import { listReservationsByDate } from '../services/reservations.js'
import { createCampaignCoupon, listCampaignCoupons } from '../services/campaigns.js'
import { listMenu, upsertMenuItem } from '../services/takeout.js'

/** Admin API — consumed by the bundled MCP server (Bearer PLUGIN_API_KEY). */
export const adminApi = new Hono<AppContext>()

adminApi.use('*', adminAuth)

adminApi.get('/reservations', async (c) => {
  const date = c.req.query('date') ?? jstParts(new Date()).date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ success: false, error: 'dateはYYYY-MM-DD' }, 400)
  const items = await listReservationsByDate(c.env.DB, date)
  return c.json({
    success: true,
    data: items.map((r) => ({
      id: r.id,
      reservedAt: formatJst(sqliteToIso(r.reserved_at)),
      name: r.name,
      phone: r.phone,
      partySize: r.party_size,
      note: r.note,
      status: r.status,
      memberNo: r.member_no,
    })),
  })
})

adminApi.get('/members/:memberNo', async (c) => {
  const member = await findMemberByNo(c.env.DB, c.req.param('memberNo'))
  if (!member) return c.json({ success: false, error: '会員が見つかりません' }, 404)
  return c.json({ success: true, data: publicMember(member) })
})

adminApi.get('/stats', async (c) => {
  const db = c.env.DB
  const [members, visits30, rewardsIssued, rewardsRedeemed, upcoming] = await Promise.all([
    db.prepare('SELECT COUNT(*) AS n FROM members').first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM visits WHERE visited_at > datetime('now', '-30 days')").first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) AS n FROM rewards').first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM rewards WHERE status = 'redeemed'").first<{ n: number }>(),
    db.prepare("SELECT COUNT(*) AS n FROM reservations WHERE status = 'confirmed' AND reserved_at > datetime('now')").first<{ n: number }>(),
  ])
  return c.json({
    success: true,
    data: {
      members: members?.n ?? 0,
      visitsLast30Days: visits30?.n ?? 0,
      rewardsIssued: rewardsIssued?.n ?? 0,
      rewardsRedeemed: rewardsRedeemed?.n ?? 0,
      upcomingReservations: upcoming?.n ?? 0,
    },
  })
})

/** 手動特典発行（LINE通知付き） */
adminApi.post('/rewards', async (c) => {
  const body = await c.req.json<{ memberNo?: string; name?: string }>().catch(() => ({}) as Record<string, never>)
  const member = await findMemberByNo(c.env.DB, body.memberNo ?? '')
  if (!member) return c.json({ success: false, error: '会員が見つかりません' }, 404)
  const rewardName = (body.name ?? '').trim() || storeConfig(c.env).rewardName

  const code = await issueReward(c.env.DB, member.id, rewardName, 'manual')
  await trySendText(
    harnessClient(c.env),
    member.friend_id,
    `【${storeConfig(c.env).storeName}】特典をお贈りします🎁\n\n${rewardName}\n特典コード: ${code}\n（有効期限: 発行から90日）\n\nご来店の際にスタッフへこの画面をお見せください。`,
  )
  return c.json({ success: true, data: { memberNo: member.member_no, code, name: rewardName } })
})

/** テイクアウトメニュー一覧（非公開含む） */
adminApi.get('/takeout/menu', async (c) => {
  const menu = await listMenu(c.env.DB, true)
  return c.json({
    success: true,
    data: menu.map((m) => ({
      id: m.id,
      name: m.name,
      price: m.price,
      description: m.description,
      isAvailable: Boolean(m.is_available),
      sortOrder: m.sort_order,
    })),
  })
})

/** テイクアウトメニュー登録・更新（idを渡すと更新） */
adminApi.post('/takeout/menu', async (c) => {
  const body = await c.req
    .json<{ id?: string; name?: string; price?: number; description?: string; isAvailable?: boolean; sortOrder?: number }>()
    .catch(() => ({}) as Record<string, never>)
  try {
    const item = await upsertMenuItem(c.env.DB, {
      id: body.id,
      name: body.name ?? '',
      price: Number(body.price),
      description: body.description,
      isAvailable: body.isAvailable,
      sortOrder: body.sortOrder,
    })
    return c.json({ success: true, data: { id: item.id, name: item.name, price: item.price } })
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'エラー' }, 400)
  }
})

/** キャンペーンクーポン作成（全員共通コード） */
adminApi.post('/campaigns', async (c) => {
  const body = await c.req
    .json<{ name?: string; discountText?: string; expiresAt?: string }>()
    .catch(() => ({}) as Record<string, never>)
  try {
    const coupon = await createCampaignCoupon(c.env.DB, {
      name: body.name ?? '',
      discountText: body.discountText,
      expiresAt: body.expiresAt,
    })
    return c.json({ success: true, data: publicCampaign(coupon) })
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'エラー' }, 400)
  }
})

adminApi.get('/campaigns', async (c) => {
  const items = await listCampaignCoupons(c.env.DB)
  return c.json({ success: true, data: items.map(publicCampaign) })
})

function publicCampaign(coupon: import('../services/campaigns.js').CampaignCouponRow) {
  return {
    name: coupon.name,
    code: coupon.code,
    discountText: coupon.discount_text,
    status: coupon.status,
    usedCount: coupon.used_count,
    expiresAt: coupon.expires_at ? formatJst(sqliteToIso(coupon.expires_at)) : null,
  }
}

function publicMember(member: MemberRow) {
  return {
    memberNo: member.member_no,
    displayName: member.display_name,
    birthday: member.birthday,
    stampCount: member.stamp_count,
    totalVisits: member.total_visits,
    lastVisitAt: member.last_visit_at ? formatJst(sqliteToIso(member.last_visit_at)) : null,
    createdAt: formatJst(sqliteToIso(member.created_at)),
  }
}
