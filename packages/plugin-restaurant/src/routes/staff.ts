import { Hono } from 'hono'
import { storeConfig } from '../env.js'
import type { AppContext } from '../middleware/auth.js'
import { staffAuth } from '../middleware/auth.js'
import { harnessClient } from '../lib/harness.js'
import { formatJst, jstParts, sqliteToIso } from '../lib/logic.js'
import { findMemberByNo } from '../services/members.js'
import { getTodayVisitCode, grantStamp, redeemReward } from '../services/stamps.js'
import { redeemCampaignCoupon } from '../services/campaigns.js'
import { markVisited, queueReviewAsk } from '../services/review.js'
import { listMenu, listOrdersByDate, publicOrder, setOrderStatus, upsertMenuItem } from '../services/takeout.js'
import { listReservationsByDate, setReservationStatus } from '../services/reservations.js'

export const staffApi = new Hono<AppContext>()

staffApi.use('*', staffAuth)

/** 本日の来店コード（店内掲示用） */
staffApi.get('/visit-code', async (c) => {
  const code = await getTodayVisitCode(c.env.DB, new Date())
  return c.json({ success: true, data: { date: jstParts(new Date()).date, code } })
})

/** 会員番号でスタンプ付与 */
staffApi.post('/stamp', async (c) => {
  const body = await c.req.json<{ memberNo?: string }>().catch(() => ({}) as { memberNo?: string })
  const memberNo = (body.memberNo ?? '').trim()
  if (!memberNo) return c.json({ success: false, error: '会員番号を入力してください' }, 400)

  const member = await findMemberByNo(c.env.DB, memberNo)
  if (!member) return c.json({ success: false, error: '会員が見つかりません' }, 404)

  const outcome = await grantStamp(c.env.DB, harnessClient(c.env), storeConfig(c.env), member, 'staff')
  return c.json({
    success: true,
    data: { memberNo: member.member_no, displayName: member.display_name, ...outcome },
  })
})

/**
 * 特典コード消込（RW-個人特典 / CP-キャンペーン共通クーポン）。
 * 消込＝来店とみなし、last_visit_at 更新とGoogleレビュー依頼のキュー投入も行う。
 * CP- は会員に紐づかないコードのため、memberNo を添えると来店判定できる。
 */
staffApi.post('/redeem', async (c) => {
  const body = await c.req
    .json<{ code?: string; memberNo?: string }>()
    .catch(() => ({}) as { code?: string; memberNo?: string })
  const code = (body.code ?? '').trim()
  if (!code) return c.json({ success: false, error: '特典コードを入力してください' }, 400)

  if (code.toUpperCase().startsWith('CP-')) {
    const member = body.memberNo?.trim() ? await findMemberByNo(c.env.DB, body.memberNo) : null
    const campaign = await redeemCampaignCoupon(c.env.DB, code, member?.id)
    if (!campaign.ok) {
      const messages = {
        not_found: 'クーポンが見つかりません',
        ended: 'このキャンペーンは終了しています',
        expired: 'このクーポンは期限切れです',
      } as const
      return c.json({ success: false, error: messages[campaign.reason] }, 400)
    }
    if (member) {
      await markVisited(c.env.DB, member.id)
      await queueReviewAsk(c.env.DB, storeConfig(c.env), member, new Date())
    }
    return c.json({
      success: true,
      data: {
        name: campaign.coupon.name,
        code: campaign.coupon.code,
        kind: 'campaign',
        usedCount: campaign.coupon.used_count,
        memberNo: member?.member_no ?? null,
      },
    })
  }

  const result = await redeemReward(c.env.DB, code)
  if (!result.ok) {
    const messages = {
      not_found: '特典が見つかりません',
      already_redeemed: 'この特典は使用済みです',
      expired: 'この特典は期限切れです',
    } as const
    return c.json({ success: false, error: messages[result.reason] }, 400)
  }

  // 個人特典は所有者が確定しているので、そのまま来店判定
  const owner = await c.env.DB
    .prepare('SELECT id, friend_id, member_no FROM members WHERE id = ?')
    .bind(result.reward.member_id)
    .first<{ id: string; friend_id: string | null; member_no: string }>()
  if (owner) {
    await markVisited(c.env.DB, owner.id)
    await queueReviewAsk(c.env.DB, storeConfig(c.env), owner, new Date())
  }
  return c.json({
    success: true,
    data: { name: result.reward.name, code: result.reward.code, kind: 'reward', memberNo: owner?.member_no ?? null },
  })
})

/** 指定日（JST, 省略時は本日）の予約一覧 */
staffApi.get('/reservations', async (c) => {
  const date = c.req.query('date') ?? jstParts(new Date()).date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ success: false, error: 'dateはYYYY-MM-DD' }, 400)
  const items = await listReservationsByDate(c.env.DB, date)
  return c.json({
    success: true,
    data: items.map((r) => ({
      id: r.id,
      time: formatJst(sqliteToIso(r.reserved_at)).split(' ')[1],
      name: r.name,
      phone: r.phone,
      partySize: r.party_size,
      note: r.note,
      status: r.status,
      memberNo: r.member_no,
    })),
  })
})

/** 予約ステータス変更（seated / no_show / cancelled / confirmed）。seated は来店判定になる */
staffApi.patch('/reservations/:id', async (c) => {
  const body = await c.req.json<{ status?: string }>().catch(() => ({}) as { status?: string })
  const updated = await setReservationStatus(c.env.DB, c.req.param('id'), body.status ?? '')
  if (!updated) return c.json({ success: false, error: '予約が見つからないか、ステータスが不正です' }, 400)

  if (updated.status === 'seated') {
    const member = await c.env.DB
      .prepare('SELECT id, friend_id FROM members WHERE id = ?')
      .bind(updated.member_id)
      .first<{ id: string; friend_id: string | null }>()
    if (member) {
      await markVisited(c.env.DB, member.id)
      await queueReviewAsk(c.env.DB, storeConfig(c.env), member, new Date())
    }
  }
  return c.json({ success: true, data: { id: updated.id, status: updated.status } })
})

/** 指定日（JST, 省略時は本日）のテイクアウト注文一覧 */
staffApi.get('/takeout', async (c) => {
  const date = c.req.query('date') ?? jstParts(new Date()).date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ success: false, error: 'dateはYYYY-MM-DD' }, 400)
  const items = await listOrdersByDate(c.env.DB, date)
  return c.json({ success: true, data: items.map(publicOrder) })
})

/** テイクアウト注文のステータス変更（accepted / ready / completed / cancelled） */
staffApi.patch('/takeout/:id', async (c) => {
  const body = await c.req.json<{ status?: string }>().catch(() => ({}) as { status?: string })
  const updated = await setOrderStatus(
    c.env.DB,
    harnessClient(c.env),
    storeConfig(c.env),
    c.req.param('id'),
    body.status ?? '',
  )
  if (!updated) return c.json({ success: false, error: '注文が見つからないか、ステータスが不正です' }, 400)
  return c.json({ success: true, data: { id: updated.id, orderNo: updated.order_no, status: updated.status } })
})

/** テイクアウトメニュー一覧（非公開含む・スタッフ管理用） */
staffApi.get('/takeout-menu', async (c) => {
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
staffApi.post('/takeout-menu', async (c) => {
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
    return c.json({
      success: true,
      data: { id: item.id, name: item.name, price: item.price, isAvailable: Boolean(item.is_available) },
    })
  } catch (e) {
    return c.json({ success: false, error: e instanceof Error ? e.message : 'エラー' }, 400)
  }
})

/** サマリー（本日の来店数・予約数・会員数） */
staffApi.get('/summary', async (c) => {
  const today = jstParts(new Date()).date
  const [members, visits, reservations] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM members').first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM visits WHERE date(visited_at, '+9 hours') = ?").bind(today).first<{ n: number }>(),
    c.env.DB.prepare("SELECT COUNT(*) AS n FROM reservations WHERE date(reserved_at, '+9 hours') = ? AND status = 'confirmed'")
      .bind(today)
      .first<{ n: number }>(),
  ])
  return c.json({
    success: true,
    data: { members: members?.n ?? 0, visitsToday: visits?.n ?? 0, reservationsToday: reservations?.n ?? 0 },
  })
})
