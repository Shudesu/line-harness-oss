import type { LineHarness } from '@line-harness/sdk'
import type { StoreConfig } from '../env.js'
import {
  buildOrderLines,
  formatJst,
  isoToSqlite,
  jstParts,
  sqliteToIso,
  validatePickupTime,
  type OrderLine,
} from '../lib/logic.js'
import { trySendText } from '../lib/harness.js'
import { markVisited, queueReviewAsk } from './review.js'
import type { MemberRow } from './members.js'

export interface MenuItemRow {
  id: string
  name: string
  price: number
  description: string | null
  is_available: number
  sort_order: number
  created_at: string
  updated_at: string
}

export interface TakeoutOrderRow {
  id: string
  member_id: string
  order_no: string
  items: string // JSON OrderLine[]
  total: number
  pickup_at: string
  note: string | null
  status: 'pending' | 'accepted' | 'ready' | 'completed' | 'cancelled'
  created_at: string
  updated_at: string
}

// ---------------------------------------------------------------- メニュー

export async function listMenu(db: D1Database, includeUnavailable = false): Promise<MenuItemRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM takeout_menu_items ${includeUnavailable ? '' : 'WHERE is_available = 1'}
       ORDER BY sort_order ASC, created_at ASC`,
    )
    .all<MenuItemRow>()
  return results
}

export interface UpsertMenuItemInput {
  id?: string
  name: string
  price: number
  description?: string
  isAvailable?: boolean
  sortOrder?: number
}

export async function upsertMenuItem(db: D1Database, input: UpsertMenuItemInput): Promise<MenuItemRow> {
  const name = input.name?.trim()
  const price = Math.trunc(Number(input.price))
  if (!name) throw new Error('商品名は必須です')
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000) throw new Error('価格が不正です')

  const id = input.id ?? crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO takeout_menu_items (id, name, price, description, is_available, sort_order)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         name = excluded.name, price = excluded.price, description = excluded.description,
         is_available = excluded.is_available, sort_order = excluded.sort_order,
         updated_at = datetime('now')`,
    )
    .bind(id, name, price, input.description?.trim() || null, input.isAvailable === false ? 0 : 1, input.sortOrder ?? 0)
    .run()
  const row = await db.prepare('SELECT * FROM takeout_menu_items WHERE id = ?').bind(id).first<MenuItemRow>()
  if (!row) throw new Error('menu upsert failed')
  return row
}

// ---------------------------------------------------------------- 注文

export interface CreateOrderInput {
  items: { id?: string; qty?: number }[]
  pickupTime: string // 'HH:mm' JST（本日）
  note?: string
}

export type CreateOrderResult = { ok: true; order: TakeoutOrderRow } | { ok: false; error: string }

export async function createTakeoutOrder(
  db: D1Database,
  client: LineHarness,
  config: StoreConfig,
  member: MemberRow,
  input: CreateOrderInput,
): Promise<CreateOrderResult> {
  const menu = await listMenu(db)
  const built = buildOrderLines(menu, input.items ?? [])
  if (!built.ok) return { ok: false, error: built.error }

  const now = new Date()
  const pickup = validatePickupTime(input.pickupTime ?? '', now)
  if (!pickup.ok) return { ok: false, error: pickup.error }

  const orderNo = await nextOrderNo(db, now)
  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO takeout_orders (id, member_id, order_no, items, total, pickup_at, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, member.id, orderNo, JSON.stringify(built.lines), built.total, isoToSqlite(pickup.iso), input.note?.trim() || null)
    .run()
  const order = await db.prepare('SELECT * FROM takeout_orders WHERE id = ?').bind(id).first<TakeoutOrderRow>()
  if (!order) return { ok: false, error: '注文の保存に失敗しました' }

  await trySendText(
    client,
    member.friend_id,
    `🥡 テイクアウトのご注文を承りました。\n\n【${config.storeName}】注文番号: ${orderNo}\n受取時間: ${formatJst(pickup.iso)}\n\n${formatLines(built.lines)}\n合計: ¥${built.total.toLocaleString()}\n\n準備ができましたら改めてお知らせします。お支払いは店頭でお願いいたします。`,
  )

  // 店側通知はすべてベストエフォート（各関数内で握りつぶす）なので並列に投げる
  await Promise.all([
    notifyNtfy(
      config,
      `新規テイクアウト注文 ${orderNo}`,
      `${formatJst(pickup.iso)} 受取 / ¥${built.total.toLocaleString()}\n${built.lines.map((l) => `${l.name}×${l.qty}`).join('、')}${input.note?.trim() ? `\n備考: ${input.note.trim()}` : ''}`,
    ),
    notifyCallmebot(config, orderNo, built.lines, pickup.iso),
    notifyCallmebotPhone(config, orderNo, built.lines, pickup.iso),
    notifyClickSend(config, orderNo, built.lines, pickup.iso),
    notifyPhoneCall(config, orderNo, built.lines, pickup.iso),
  ])

  return { ok: true, order }
}

/**
 * お客様自身による受け取り完了（LIFFのスライド操作）。
 * スタッフの面前でスライドしてもらう運用。調理中(accepted)以降で有効。
 * 完了＝来店確定として review パイプラインにつなぐ。
 */
export async function receiveOrderBySlide(
  db: D1Database,
  config: StoreConfig,
  member: MemberRow,
  orderId: string,
): Promise<{ ok: true; orderNo: string } | { ok: false; error: string }> {
  const order = await db.prepare('SELECT * FROM takeout_orders WHERE id = ?').bind(orderId).first<TakeoutOrderRow>()
  if (!order || order.member_id !== member.id) return { ok: false, error: '注文が見つかりません' }
  if (order.status !== 'accepted' && order.status !== 'ready') {
    return { ok: false, error: order.status === 'completed' ? 'この注文は受け取り済みです' : 'まだ受け取りできる状態ではありません' }
  }

  await db
    .prepare("UPDATE takeout_orders SET status = 'completed', updated_at = datetime('now') WHERE id = ?")
    .bind(orderId)
    .run()
  await markVisited(db, member.id)
  await queueReviewAsk(db, config, member, new Date())
  return { ok: true, orderNo: order.order_no }
}

export async function listMemberOrders(db: D1Database, memberId: string): Promise<TakeoutOrderRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM takeout_orders WHERE member_id = ?
       AND status IN ('pending', 'accepted', 'ready') ORDER BY pickup_at ASC`,
    )
    .bind(memberId)
    .all<TakeoutOrderRow>()
  return results
}

export async function cancelMemberOrder(db: D1Database, member: MemberRow, orderId: string): Promise<'ok' | 'not_found' | 'not_cancellable'> {
  const order = await db.prepare('SELECT * FROM takeout_orders WHERE id = ?').bind(orderId).first<TakeoutOrderRow>()
  if (!order || order.member_id !== member.id) return 'not_found'
  if (order.status !== 'pending') return 'not_cancellable' // 調理開始(accepted)後はお店に電話
  await db
    .prepare("UPDATE takeout_orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?")
    .bind(orderId)
    .run()
  return 'ok'
}

export async function listOrdersByDate(db: D1Database, jstDate: string): Promise<(TakeoutOrderRow & { member_no: string })[]> {
  const { results } = await db
    .prepare(
      `SELECT o.*, m.member_no FROM takeout_orders o JOIN members m ON m.id = o.member_id
       WHERE date(o.pickup_at, '+9 hours') = ? ORDER BY o.pickup_at ASC`,
    )
    .bind(jstDate)
    .all<TakeoutOrderRow & { member_no: string }>()
  return results
}

const ORDER_STATUSES: TakeoutOrderRow['status'][] = ['pending', 'accepted', 'ready', 'completed', 'cancelled']

/** スタッフによるステータス変更。ready / cancelled はお客様にLINE通知する */
export async function setOrderStatus(
  db: D1Database,
  client: LineHarness,
  config: StoreConfig,
  orderId: string,
  status: string,
): Promise<TakeoutOrderRow | null> {
  if (!ORDER_STATUSES.includes(status as TakeoutOrderRow['status'])) return null
  const order = await db.prepare('SELECT * FROM takeout_orders WHERE id = ?').bind(orderId).first<TakeoutOrderRow>()
  if (!order) return null

  await db
    .prepare("UPDATE takeout_orders SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(status, orderId)
    .run()

  const friend = await db
    .prepare('SELECT friend_id FROM members WHERE id = ?')
    .bind(order.member_id)
    .first<{ friend_id: string | null }>()

  if (status === 'ready') {
    await trySendText(
      client,
      friend?.friend_id ?? null,
      `🍱 ご注文（${order.order_no}）のご準備ができました！\n【${config.storeName}】にてお待ちしております。\nお会計は店頭でお願いいたします。`,
    )
  } else if (status === 'completed') {
    // 受渡完了＝来店確定。レビュー依頼の起点にする
    await markVisited(db, order.member_id)
    await queueReviewAsk(db, config, { id: order.member_id, friend_id: friend?.friend_id ?? null }, new Date())
  } else if (status === 'cancelled') {
    await trySendText(
      client,
      friend?.friend_id ?? null,
      `ご注文（${order.order_no}）はキャンセルとなりました。\nご不明点は【${config.storeName}】までお問い合わせください。`,
    )
  }

  return await db.prepare('SELECT * FROM takeout_orders WHERE id = ?').bind(orderId).first<TakeoutOrderRow>()
}

// ---------------------------------------------------------------- helpers

/** 当日連番の注文番号 T-001（JST日付でリセット） */
async function nextOrderNo(db: D1Database, now: Date): Promise<string> {
  const key = `takeout_seq:${jstParts(now).date}`
  const row = await db
    .prepare(
      `INSERT INTO settings (key, value) VALUES (?, '1')
       ON CONFLICT (key) DO UPDATE SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT), updated_at = datetime('now')
       RETURNING value`,
    )
    .bind(key)
    .first<{ value: string }>()
  return `T-${String(Number.parseInt(row?.value ?? '1', 10)).padStart(3, '0')}`
}

function formatLines(lines: OrderLine[]): string {
  return lines.map((l) => `・${l.name} ×${l.qty}　¥${(l.price * l.qty).toLocaleString()}`).join('\n')
}

/**
 * 無料の自動音声通話（CallMeBot）。店長のTelegramに音声通話が着信し、
 * 注文内容を日本語TTSで読み上げる。CALLMEBOT_TELEGRAM_USER 設定時のみ。
 * 事前に Telegram で @CallMeBot_txtbot に /start を送って認可しておくこと。
 * 個人利用向けの無料サービスのためベストエフォート（失敗しても注文は成立）。
 */
async function notifyCallmebot(config: StoreConfig, orderNo: string, lines: OrderLine[], pickupIso: string): Promise<void> {
  if (!config.callmebotUser) return
  try {
    const text = (
      `テイクアウトの新しい注文です。番号${orderNo.replace('T-', '')}番。` +
      `受け取りは${formatJst(pickupIso).split(' ')[1]}。` +
      `${lines.map((l) => `${l.name}${l.qty}点`).join('、')}。`
    ).slice(0, 256)
    const url =
      `https://api.callmebot.com/start.php?user=${encodeURIComponent(config.callmebotUser)}` +
      `&text=${encodeURIComponent(text)}&lang=ja-JP-Standard-B&rpt=2`
    const res = await fetch(url)
    if (!res.ok) console.error('[restaurant] callmebot failed:', res.status)
  } catch (error) {
    console.error('[restaurant] callmebot error:', error)
  }
}

/**
 * CallMeBot有料プラン（InOut.bot）での実電話（GSM/固定）架電。
 * 月$1〜3で5〜30回の上限があるため低頻度店向け。日本語TTSは上位プランのみ。
 */
async function notifyCallmebotPhone(config: StoreConfig, orderNo: string, lines: OrderLine[], pickupIso: string): Promise<void> {
  if (!config.callmebotPhone) return
  try {
    const text = (
      `テイクアウトの新しい注文です。番号${orderNo.replace('T-', '')}番。` +
      `受け取りは${formatJst(pickupIso).split(' ')[1]}。` +
      `${lines.map((l) => `${l.name}${l.qty}点`).join('、')}。`
    ).slice(0, 256)
    const url =
      `https://api.callmebot.com/call.php?phone=${encodeURIComponent(config.callmebotPhone.number)}` +
      `&text=${encodeURIComponent(text)}&lang=ja-JP-Standard-B&rpt=2&apikey=${encodeURIComponent(config.callmebotPhone.apiKey)}`
    const res = await fetch(url)
    if (!res.ok) console.error('[restaurant] callmebot phone failed:', res.status)
  } catch (error) {
    console.error('[restaurant] callmebot phone error:', error)
  }
}

/**
 * ClickSendでの実電話（固定/携帯）架電。審査なし・従量課金・回数無制限。
 * CallMeBotの月次上限を超える店の移行先。CLICKSEND_USERNAME/API_KEY + STORE_PHONE_NUMBER 設定時のみ。
 */
async function notifyClickSend(config: StoreConfig, orderNo: string, lines: OrderLine[], pickupIso: string): Promise<void> {
  if (!config.clicksend) return
  try {
    const body = (
      `こちらは、${config.storeName}の、テイクアウト注文システムです。` +
      `新しい注文が入りました。番号${orderNo.replace('T-', '')}番。` +
      `受け取りは${formatJst(pickupIso).split(' ')[1]}。` +
      `${lines.map((l) => `${l.name}${l.qty}点`).join('、')}。`
    ).slice(0, 300)
    const res = await fetch('https://rest.clicksend.com/v3/voice/send', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(`${config.clicksend.username}:${config.clicksend.apiKey}`)}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          {
            source: 'line-harness-restaurant',
            to: config.clicksend.to,
            body,
            voice: 'female',
            lang: 'ja-jp',
            machine_detection: 0,
          },
        ],
      }),
    })
    if (!res.ok) console.error('[restaurant] clicksend failed:', res.status, await res.text())
  } catch (error) {
    console.error('[restaurant] clicksend error:', error)
  }
}

/**
 * 新規注文の店舗への自動架電（Twilio・環境変数がすべて設定されたときのみ）。
 * 失敗しても注文は成立させる。通話内容は日本語TTSで注文番号と受取時刻を2回読み上げる。
 */
async function notifyPhoneCall(config: StoreConfig, orderNo: string, lines: OrderLine[], pickupIso: string): Promise<void> {
  if (!config.twilio) return
  try {
    const speech =
      `こちらは、${config.storeName}の、テイクアウト注文システムです。` +
      `新しい注文が入りました。注文番号、${orderNo.replace('T-', 'ティー')}。` +
      `受け取り時刻は、${formatJst(pickupIso).split(' ')[1]}。` +
      `内容は、${lines.map((l) => `${l.name}が${l.qty}点`).join('、')}です。` +
      `詳細はスタッフページをご確認ください。`
    const twiml = `<Response><Say language="ja-JP" loop="2">${speech
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')}</Say></Response>`

    const params = new URLSearchParams({ To: config.twilio.to, From: config.twilio.from, Twiml: twiml })
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${config.twilio.accountSid}/Calls.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(`${config.twilio.accountSid}:${config.twilio.authToken}`)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
      },
    )
    if (!res.ok) console.error('[restaurant] twilio call failed:', res.status, await res.text())
  } catch (error) {
    console.error('[restaurant] twilio call error:', error)
  }
}

/** ntfy.sh へのスタッフ向けプッシュ（NTFY_TOPIC 設定時のみ・失敗しても注文は成立させる） */
async function notifyNtfy(config: StoreConfig, title: string, body: string): Promise<void> {
  if (!config.ntfyTopic) return
  try {
    // Priority: urgent = ntfyアプリ側の設定で「アラーム音を鳴らし続ける」対象にできる（着信の代替）
    await fetch(`https://ntfy.sh/${config.ntfyTopic}`, {
      method: 'POST',
      headers: { Title: encodeURIComponent(title), Priority: 'urgent', Tags: 'rotating_light,bento' },
      body,
    })
  } catch (error) {
    console.error('[restaurant] ntfy failed:', error)
  }
}

export function publicOrder(order: TakeoutOrderRow & { member_no?: string }) {
  return {
    id: order.id,
    orderNo: order.order_no,
    items: JSON.parse(order.items) as OrderLine[],
    total: order.total,
    pickupAt: formatJst(sqliteToIso(order.pickup_at)),
    note: order.note,
    status: order.status,
    ...(order.member_no ? { memberNo: order.member_no } : {}),
  }
}
