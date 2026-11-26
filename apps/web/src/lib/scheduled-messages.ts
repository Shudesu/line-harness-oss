/**
 * 友だち1人宛ての予約送信 (1:1) — 画面用の純粋関数。
 * 管理画面を開いているブラウザのタイムゾーンに関係なく、入力も表示も JST で扱う。
 */

export interface ScheduledFriendMessage {
  id: string
  friendId: string
  friendDisplayName?: string | null
  messageType: string
  content: string
  sendAt: string
  sendAtJst: string
  status: 'pending' | 'sending' | 'sent' | 'cancelled' | 'failed'
  createdBy: string | null
  createdAt: string
  sentAt: string | null
  cancelledAt: string | null
  error: string | null
  messageId: string | null
}

/** <input type="datetime-local"> の値 (YYYY-MM-DDTHH:mm, JST とみなす) → API 用 ISO (+09:00)。 */
export function jstLocalInputToIso(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const iso = `${value}:00+09:00`
  return Number.isFinite(Date.parse(iso)) ? iso : null
}

/** 時刻 → datetime-local 用の JST 文字列 (YYYY-MM-DDTHH:mm)。 */
export function toJstLocalInput(date: Date): string {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000)
  return jst.toISOString().slice(0, 16)
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土']

/** ISO → 「11/20(金) 19:00」(JST)。 */
export function formatJst(iso: string): string {
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return iso
  const jst = new Date(t + 9 * 60 * 60 * 1000)
  const m = jst.getUTCMonth() + 1
  const d = jst.getUTCDate()
  const w = WEEKDAYS[jst.getUTCDay()]
  const hh = String(jst.getUTCHours()).padStart(2, '0')
  const mm = String(jst.getUTCMinutes()).padStart(2, '0')
  return `${m}/${d}(${w}) ${hh}:${mm}`
}

export const SCHEDULED_STATUS_LABELS: Record<ScheduledFriendMessage['status'], { label: string; className: string }> = {
  pending: { label: '予約中', className: 'bg-blue-100 text-blue-700' },
  sending: { label: '送信中', className: 'bg-yellow-100 text-yellow-700' },
  sent: { label: '送信済', className: 'bg-green-100 text-green-700' },
  cancelled: { label: '取消', className: 'bg-gray-100 text-gray-500' },
  failed: { label: '失敗', className: 'bg-red-100 text-red-700' },
}
