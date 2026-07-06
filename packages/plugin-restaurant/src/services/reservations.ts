import type { LineHarness } from '@line-harness/sdk'
import type { StoreConfig } from '../env.js'
import { dueReminders, formatJst, isoToSqlite, jstToUtcIso, sqliteToIso } from '../lib/logic.js'
import { trySendText } from '../lib/harness.js'
import type { MemberRow } from './members.js'

export interface ReservationRow {
  id: string
  member_id: string
  name: string
  phone: string | null
  party_size: number
  reserved_at: string
  note: string | null
  status: 'confirmed' | 'cancelled' | 'seated' | 'no_show'
  remind_day_before_sent: number
  remind_same_day_sent: number
  created_at: string
  updated_at: string
}

export interface CreateReservationInput {
  date: string // 'YYYY-MM-DD' (JST)
  time: string // 'HH:mm' (JST)
  partySize: number
  name: string
  phone?: string
  note?: string
}

export type CreateResult = { ok: true; reservation: ReservationRow } | { ok: false; error: string }

export async function createReservation(
  db: D1Database,
  client: LineHarness,
  config: StoreConfig,
  member: MemberRow,
  input: CreateReservationInput,
): Promise<CreateResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || !/^\d{2}:\d{2}$/.test(input.time)) {
    return { ok: false, error: '日時の形式が正しくありません' }
  }
  const partySize = Math.trunc(input.partySize)
  if (!Number.isFinite(partySize) || partySize < 1 || partySize > 100) {
    return { ok: false, error: '人数は1〜100名で指定してください' }
  }
  const name = input.name.trim()
  if (!name) return { ok: false, error: 'お名前を入力してください' }

  const reservedAt = jstToUtcIso(input.date, input.time)
  if (Number.isNaN(new Date(reservedAt).getTime())) return { ok: false, error: '日時が不正です' }
  if (new Date(reservedAt).getTime() <= Date.now()) {
    return { ok: false, error: '過去の日時は予約できません' }
  }

  const id = crypto.randomUUID()
  await db
    .prepare(
      `INSERT INTO reservations (id, member_id, name, phone, party_size, reserved_at, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, member.id, name, input.phone?.trim() || null, partySize, isoToSqlite(reservedAt), input.note?.trim() || null)
    .run()

  const reservation = await getReservation(db, id)
  if (!reservation) return { ok: false, error: '予約の保存に失敗しました' }

  await trySendText(
    client,
    member.friend_id,
    `✅ ご予約を承りました。\n\n【${config.storeName}】\n日時: ${formatJst(reservedAt)}\n人数: ${partySize}名\nお名前: ${name}様\n${input.note?.trim() ? `備考: ${input.note.trim()}\n` : ''}\n変更・キャンセルは会員証メニューの「予約」からお手続きください。当日お会いできるのを楽しみにしております！`,
  )

  return { ok: true, reservation }
}

export async function getReservation(db: D1Database, id: string): Promise<ReservationRow | null> {
  return await db.prepare('SELECT * FROM reservations WHERE id = ?').bind(id).first<ReservationRow>()
}

export async function listMemberReservations(db: D1Database, memberId: string): Promise<ReservationRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM reservations WHERE member_id = ? AND status = 'confirmed' AND reserved_at > datetime('now')
       ORDER BY reserved_at ASC`,
    )
    .bind(memberId)
    .all<ReservationRow>()
  return results
}

export async function listReservationsByDate(db: D1Database, jstDate: string): Promise<(ReservationRow & { member_no: string })[]> {
  const { results } = await db
    .prepare(
      `SELECT r.*, m.member_no FROM reservations r JOIN members m ON m.id = r.member_id
       WHERE date(r.reserved_at, '+9 hours') = ? ORDER BY r.reserved_at ASC`,
    )
    .bind(jstDate)
    .all<ReservationRow & { member_no: string }>()
  return results
}

export type CancelResult = 'ok' | 'not_found' | 'not_cancellable'

export async function cancelReservation(
  db: D1Database,
  client: LineHarness,
  config: StoreConfig,
  member: MemberRow,
  reservationId: string,
): Promise<CancelResult> {
  const reservation = await getReservation(db, reservationId)
  if (!reservation || reservation.member_id !== member.id) return 'not_found'
  if (reservation.status !== 'confirmed') return 'not_cancellable'

  await db
    .prepare("UPDATE reservations SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?")
    .bind(reservationId)
    .run()

  await trySendText(
    client,
    member.friend_id,
    `ご予約（${formatJst(sqliteToIso(reservation.reserved_at))}・${reservation.party_size}名）をキャンセルしました。\nまたのご利用をお待ちしております。【${config.storeName}】`,
  )
  return 'ok'
}

const STAFF_STATUSES: ReservationRow['status'][] = ['confirmed', 'cancelled', 'seated', 'no_show']

export async function setReservationStatus(
  db: D1Database,
  reservationId: string,
  status: string,
): Promise<ReservationRow | null> {
  if (!STAFF_STATUSES.includes(status as ReservationRow['status'])) return null
  const reservation = await getReservation(db, reservationId)
  if (!reservation) return null
  await db
    .prepare("UPDATE reservations SET status = ?, updated_at = datetime('now') WHERE id = ?")
    .bind(status, reservationId)
    .run()
  return await getReservation(db, reservationId)
}

/**
 * Cron entry: send day-before (18:00 JST) and same-day (2h before) reminders
 * for confirmed reservations. Flags guarantee each reminder goes out once.
 */
export async function processReservationReminders(
  db: D1Database,
  client: LineHarness,
  config: StoreConfig,
  now: Date,
): Promise<number> {
  const { results } = await db
    .prepare(
      `SELECT r.*, m.friend_id FROM reservations r JOIN members m ON m.id = r.member_id
       WHERE r.status = 'confirmed' AND r.reserved_at > datetime('now')
       AND (r.remind_day_before_sent = 0 OR r.remind_same_day_sent = 0)`,
    )
    .all<ReservationRow & { friend_id: string | null }>()

  let sent = 0
  for (const r of results) {
    const due = dueReminders(sqliteToIso(r.reserved_at), now)

    if (due.includes('day_before') && !r.remind_day_before_sent) {
      const delivered = await trySendText(
        client,
        r.friend_id,
        `【${config.storeName}】明日のご予約のご確認です。\n\n日時: ${formatJst(sqliteToIso(r.reserved_at))}\n人数: ${r.party_size}名\n\nご変更・キャンセルは会員証メニューの「予約」からお願いいたします。お待ちしております！`,
      )
      await db
        .prepare("UPDATE reservations SET remind_day_before_sent = 1, updated_at = datetime('now') WHERE id = ?")
        .bind(r.id)
        .run()
      if (delivered) sent++
    }

    if (due.includes('same_day') && !r.remind_same_day_sent) {
      const delivered = await trySendText(
        client,
        r.friend_id,
        `【${config.storeName}】本日 ${formatJst(sqliteToIso(r.reserved_at)).split(' ')[1]} より ${r.party_size}名様でご予約を承っております。\nお気をつけてお越しください🍽`,
      )
      await db
        .prepare("UPDATE reservations SET remind_same_day_sent = 1, updated_at = datetime('now') WHERE id = ?")
        .bind(r.id)
        .run()
      if (delivered) sent++
    }
  }
  return sent
}
