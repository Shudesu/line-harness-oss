/**
 * Pure domain logic — no I/O so it stays unit-testable.
 * All customer-facing times are JST (the plugin targets restaurants in Japan).
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000

export interface JstParts {
  date: string // 'YYYY-MM-DD'
  time: string // 'HH:mm'
  hour: number
  monthDay: string // 'MM-DD'
  year: number
}

export function jstParts(now: Date): JstParts {
  const j = new Date(now.getTime() + JST_OFFSET_MS)
  const date = j.toISOString().slice(0, 10)
  const time = j.toISOString().slice(11, 16)
  return {
    date,
    time,
    hour: j.getUTCHours(),
    monthDay: date.slice(5),
    year: j.getUTCFullYear(),
  }
}

/** 'YYYY-MM-DD' + 'HH:mm' interpreted as JST → UTC ISO string */
export function jstToUtcIso(date: string, time: string): string {
  const utc = new Date(`${date}T${time}:00+09:00`)
  return utc.toISOString()
}

/**
 * D1 stores datetimes as 'YYYY-MM-DD HH:MM:SS' (UTC, from datetime('now')).
 * Keep every stored timestamp in that format so SQL string comparisons stay
 * correct, and convert at the edges with these two helpers.
 */
export function isoToSqlite(iso: string): string {
  return iso.replace('T', ' ').slice(0, 19)
}

export function sqliteToIso(s: string): string {
  return s.includes('T') ? s : `${s.replace(' ', 'T')}Z`
}

const WEEKDAYS_JA = ['日', '月', '火', '水', '木', '金', '土']

/** UTC ISO → '7月8日(水) 19:00' */
export function formatJst(iso: string): string {
  const j = new Date(new Date(iso).getTime() + JST_OFFSET_MS)
  const m = j.getUTCMonth() + 1
  const d = j.getUTCDate()
  const w = WEEKDAYS_JA[j.getUTCDay()]
  const hh = String(j.getUTCHours()).padStart(2, '0')
  const mm = String(j.getUTCMinutes()).padStart(2, '0')
  return `${m}月${d}日(${w}) ${hh}:${mm}`
}

/** UTC ISO → JST 'YYYY-MM-DD' */
export function jstDateOf(iso: string): string {
  return new Date(new Date(iso).getTime() + JST_OFFSET_MS).toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Stamp card

export interface StampResult {
  newCount: number
  rewardEarned: boolean
}

/** Adding one stamp: reaching the goal earns a reward and resets the card. */
export function addStampToCard(currentCount: number, goal: number): StampResult {
  const next = currentCount + 1
  if (next >= goal) return { newCount: 0, rewardEarned: true }
  return { newCount: next, rewardEarned: false }
}

// ---------------------------------------------------------------------------
// Birthday

/**
 * birthday: 'MM-DD' or 'YYYY-MM-DD'. Matches on the JST month-day.
 * Feb 29 birthdays match Feb 28 on non-leap years (jstMonthDay never emits 02-29 then).
 */
export function isBirthday(birthday: string | null | undefined, jstMonthDay: string): boolean {
  if (!birthday) return false
  const md = birthday.length === 10 ? birthday.slice(5) : birthday
  if (!/^\d{2}-\d{2}$/.test(md)) return false
  if (md === '02-29' && jstMonthDay === '02-28') return true
  return md === jstMonthDay
}

// ---------------------------------------------------------------------------
// Reservation reminders

export type ReminderKind = 'day_before' | 'same_day'

/**
 * Which reminder (if any) is due for a reservation at `reservedAtIso` when the
 * cron fires at `now`.
 *  - day_before: from 18:00 JST on the previous day
 *  - same_day:   from 2 hours before the reservation
 * Sent-flags are handled by the caller; here we only judge the time windows.
 * Nothing is due once the reservation time has passed.
 */
export function dueReminders(reservedAtIso: string, now: Date): ReminderKind[] {
  const reservedAt = new Date(reservedAtIso)
  if (now.getTime() >= reservedAt.getTime()) return []

  const due: ReminderKind[] = []

  const resDateJst = jstDateOf(reservedAtIso)
  const dayBefore = new Date(new Date(`${resDateJst}T18:00:00+09:00`).getTime() - 24 * 60 * 60 * 1000)
  if (now.getTime() >= dayBefore.getTime()) due.push('day_before')

  const sameDay = new Date(reservedAt.getTime() - 2 * 60 * 60 * 1000)
  if (now.getTime() >= sameDay.getTime()) due.push('same_day')

  return due
}

// ---------------------------------------------------------------------------
// Winback

/** True when the member's last visit is `winbackDays` or more days ago. */
export function isWinbackTarget(lastVisitAtIso: string | null | undefined, winbackDays: number, now: Date): boolean {
  if (!lastVisitAtIso) return false
  const elapsed = now.getTime() - new Date(lastVisitAtIso).getTime()
  return elapsed >= winbackDays * 24 * 60 * 60 * 1000
}

// ---------------------------------------------------------------------------
// Takeout

export interface MenuItemLike {
  id: string
  name: string
  price: number
  is_available: number
}

export interface OrderLine {
  id: string
  name: string
  price: number
  qty: number
}

export type BuildOrderResult = { ok: true; lines: OrderLine[]; total: number } | { ok: false; error: string }

/** 注文リクエストをメニュー実データと突合して明細と合計を作る（価格はクライアント申告を信用しない） */
export function buildOrderLines(
  menu: MenuItemLike[],
  requested: { id?: string; qty?: number }[],
): BuildOrderResult {
  if (!Array.isArray(requested) || requested.length === 0) return { ok: false, error: '商品を選択してください' }
  const byId = new Map(menu.map((m) => [m.id, m]))
  const lines: OrderLine[] = []
  for (const req of requested) {
    const qty = Math.trunc(Number(req.qty ?? 0))
    if (qty === 0) continue
    if (!Number.isFinite(qty) || qty < 1 || qty > 20) return { ok: false, error: '数量は1〜20で指定してください' }
    const item = req.id ? byId.get(req.id) : undefined
    if (!item || !item.is_available) return { ok: false, error: '取り扱いのない商品が含まれています' }
    lines.push({ id: item.id, name: item.name, price: item.price, qty })
  }
  if (lines.length === 0) return { ok: false, error: '商品を選択してください' }
  const total = lines.reduce((sum, l) => sum + l.price * l.qty, 0)
  return { ok: true, lines, total }
}

/**
 * 受取時刻の検証: 本日（JST）の 'HH:mm'。現在時刻+15分以降のみ受付。
 * OKなら UTC ISO を返す。
 */
export function validatePickupTime(time: string, now: Date): { ok: true; iso: string } | { ok: false; error: string } {
  if (!/^\d{2}:\d{2}$/.test(time)) return { ok: false, error: '受取時間の形式が正しくありません' }
  const today = jstParts(now).date
  const iso = jstToUtcIso(today, time)
  if (Number.isNaN(new Date(iso).getTime())) return { ok: false, error: '受取時間が不正です' }
  if (new Date(iso).getTime() < now.getTime() + 15 * 60 * 1000) {
    return { ok: false, error: '受取時間は15分後以降で指定してください' }
  }
  return { ok: true, iso }
}

// ---------------------------------------------------------------------------
// Codes

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L

export function randomCode(length: number, randomValues: Uint8Array): string {
  let out = ''
  for (let i = 0; i < length; i++) {
    out += CODE_ALPHABET[(randomValues[i] as number) % CODE_ALPHABET.length]
  }
  return out
}

export function formatMemberNo(seq: number): string {
  return `R-${String(seq).padStart(6, '0')}`
}
