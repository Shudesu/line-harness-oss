import { Hono } from 'hono'
import { storeConfig } from '../env.js'
import type { AppContext } from '../middleware/auth.js'
import { liffAuth } from '../middleware/auth.js'
import { harnessClient } from '../lib/harness.js'
import { sqliteToIso, formatJst } from '../lib/logic.js'
import { getOrCreateMember, setBirthday } from '../services/members.js'
import { checkVisitCode, grantStamp, listRewards } from '../services/stamps.js'
import {
  cancelReservation,
  createReservation,
  listMemberReservations,
} from '../services/reservations.js'
import {
  cancelMemberOrder,
  createTakeoutOrder,
  listMemberOrders,
  listMenu,
  publicOrder,
  receiveOrderBySlide,
} from '../services/takeout.js'

export const liffApi = new Hono<AppContext>()

liffApi.use('*', liffAuth)

/** 会員証: 登録済みなら取得、未登録なら会員番号を発行して登録 */
liffApi.post('/me', async (c) => {
  const user = c.get('lineUser')
  const client = harnessClient(c.env)
  const config = storeConfig(c.env)
  const member = await getOrCreateMember(c.env.DB, client, user.userId, user.displayName)
  const rewards = await listRewards(c.env.DB, member.id)
  return c.json({
    success: true,
    data: {
      memberNo: member.member_no,
      displayName: member.display_name,
      birthday: member.birthday,
      stampCount: member.stamp_count,
      stampGoal: config.stampGoal,
      totalVisits: member.total_visits,
      storeName: config.storeName,
      rewardName: config.rewardName,
      rewards: rewards.map((r) => ({
        name: r.name,
        code: r.code,
        expiresAt: r.expires_at ? formatJst(sqliteToIso(r.expires_at)).split(' ')[0] : null,
      })),
    },
  })
})

/** 誕生日登録（MM-DD） */
liffApi.post('/profile', async (c) => {
  const user = c.get('lineUser')
  const client = harnessClient(c.env)
  const member = await getOrCreateMember(c.env.DB, client, user.userId, user.displayName)
  const body = await c.req.json<{ birthday?: string }>().catch(() => ({}) as { birthday?: string })
  const birthday = (body.birthday ?? '').trim()
  if (!/^\d{2}-\d{2}$/.test(birthday)) {
    return c.json({ success: false, error: '誕生日は MM-DD 形式で指定してください' }, 400)
  }
  const [mm, dd] = birthday.split('-').map((v) => Number.parseInt(v, 10))
  if (!mm || mm < 1 || mm > 12 || !dd || dd < 1 || dd > 31) {
    return c.json({ success: false, error: '誕生日の値が不正です' }, 400)
  }
  await setBirthday(c.env.DB, member.id, birthday)
  return c.json({ success: true, data: { birthday } })
})

/** 来店コードでスタンプ取得 */
liffApi.post('/stamp', async (c) => {
  const user = c.get('lineUser')
  const client = harnessClient(c.env)
  const config = storeConfig(c.env)
  const member = await getOrCreateMember(c.env.DB, client, user.userId, user.displayName)
  const body = await c.req.json<{ code?: string }>().catch(() => ({}) as { code?: string })
  const code = (body.code ?? '').trim()
  if (!code) return c.json({ success: false, error: 'コードを入力してください' }, 400)

  const check = await checkVisitCode(c.env.DB, member, code, new Date())
  if (check !== 'ok') {
    const messages: Record<Exclude<typeof check, 'ok'>, string> = {
      wrong: 'コードが違います。店内掲示の本日のコードをご確認ください。',
      not_ready: '本日のコードがまだ発行されていません。スタッフにお声がけください。',
      rate_limited: '試行回数の上限に達しました。スタッフにお声がけください。',
      already_today: '本日のスタンプは取得済みです。またのご来店をお待ちしております！',
    }
    return c.json({ success: false, error: messages[check], reason: check }, 400)
  }

  const outcome = await grantStamp(c.env.DB, client, config, member, 'store_code')
  return c.json({ success: true, data: outcome })
})

/** 予約作成 */
liffApi.post('/reservations', async (c) => {
  const user = c.get('lineUser')
  const client = harnessClient(c.env)
  const config = storeConfig(c.env)
  const member = await getOrCreateMember(c.env.DB, client, user.userId, user.displayName)
  const body = await c.req
    .json<{ date?: string; time?: string; partySize?: number; name?: string; phone?: string; note?: string }>()
    .catch(() => ({}) as Record<string, never>)

  const result = await createReservation(c.env.DB, client, config, member, {
    date: body.date ?? '',
    time: body.time ?? '',
    partySize: Number(body.partySize ?? 0),
    name: body.name ?? member.display_name ?? '',
    phone: body.phone,
    note: body.note,
  })
  if (!result.ok) return c.json({ success: false, error: result.error }, 400)
  return c.json({
    success: true,
    data: {
      id: result.reservation.id,
      reservedAt: formatJst(sqliteToIso(result.reservation.reserved_at)),
      partySize: result.reservation.party_size,
    },
  })
})

/** 自分の予約一覧（今後の確定分） */
liffApi.get('/reservations', async (c) => {
  const user = c.get('lineUser')
  const client = harnessClient(c.env)
  const member = await getOrCreateMember(c.env.DB, client, user.userId, user.displayName)
  const items = await listMemberReservations(c.env.DB, member.id)
  return c.json({
    success: true,
    data: items.map((r) => ({
      id: r.id,
      reservedAt: formatJst(sqliteToIso(r.reserved_at)),
      partySize: r.party_size,
      name: r.name,
      note: r.note,
    })),
  })
})

/** テイクアウトメニュー */
liffApi.get('/takeout/menu', async (c) => {
  const menu = await listMenu(c.env.DB)
  return c.json({
    success: true,
    data: menu.map((m) => ({ id: m.id, name: m.name, price: m.price, description: m.description })),
  })
})

/** テイクアウト注文 */
liffApi.post('/takeout/orders', async (c) => {
  const user = c.get('lineUser')
  const client = harnessClient(c.env)
  const config = storeConfig(c.env)
  const member = await getOrCreateMember(c.env.DB, client, user.userId, user.displayName)
  const body = await c.req
    .json<{ items?: { id?: string; qty?: number }[]; pickupTime?: string; note?: string }>()
    .catch(() => ({}) as Record<string, never>)

  const result = await createTakeoutOrder(c.env.DB, client, config, member, {
    items: body.items ?? [],
    pickupTime: body.pickupTime ?? '',
    note: body.note,
  })
  if (!result.ok) return c.json({ success: false, error: result.error }, 400)
  return c.json({ success: true, data: publicOrder(result.order) })
})

/** 自分のテイクアウト注文一覧（進行中のみ） */
liffApi.get('/takeout/orders', async (c) => {
  const user = c.get('lineUser')
  const client = harnessClient(c.env)
  const member = await getOrCreateMember(c.env.DB, client, user.userId, user.displayName)
  const orders = await listMemberOrders(c.env.DB, member.id)
  return c.json({ success: true, data: orders.map(publicOrder) })
})

/** テイクアウト受け取り完了（スタッフの面前でスライド操作） */
liffApi.post('/takeout/orders/:id/receive', async (c) => {
  const user = c.get('lineUser')
  const client = harnessClient(c.env)
  const member = await getOrCreateMember(c.env.DB, client, user.userId, user.displayName)
  const result = await receiveOrderBySlide(c.env.DB, storeConfig(c.env), member, c.req.param('id'))
  if (!result.ok) return c.json({ success: false, error: result.error }, 400)
  return c.json({ success: true, data: { orderNo: result.orderNo } })
})

/** テイクアウト注文キャンセル（調理開始前のみ） */
liffApi.delete('/takeout/orders/:id', async (c) => {
  const user = c.get('lineUser')
  const client = harnessClient(c.env)
  const member = await getOrCreateMember(c.env.DB, client, user.userId, user.displayName)
  const result = await cancelMemberOrder(c.env.DB, member, c.req.param('id'))
  if (result !== 'ok') {
    return c.json(
      {
        success: false,
        error: result === 'not_found' ? '注文が見つかりません' : '調理開始後のキャンセルはお店に直接ご連絡ください',
      },
      400,
    )
  }
  return c.json({ success: true })
})

/** 予約キャンセル */
liffApi.delete('/reservations/:id', async (c) => {
  const user = c.get('lineUser')
  const client = harnessClient(c.env)
  const config = storeConfig(c.env)
  const member = await getOrCreateMember(c.env.DB, client, user.userId, user.displayName)
  const result = await cancelReservation(c.env.DB, client, config, member, c.req.param('id'))
  if (result !== 'ok') {
    return c.json({ success: false, error: result === 'not_found' ? '予約が見つかりません' : 'この予約はキャンセルできません' }, 400)
  }
  return c.json({ success: true })
})
