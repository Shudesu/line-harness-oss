import { useEffect, useMemo, useState } from 'react'
import { fetchApi } from '@/lib/api'
import { formatDateTime } from '../utils'

type ApiResponse<T> = { success: true; data: T } | { success: false; error?: string }

type ReservationResource = {
  id: string
  name: string
  isActive: boolean
}

type ReservationSlot = {
  slotId: string
  id?: string
  resourceId: string
  date: string
  startAt: string
  endAt: string
  remainingCapacity?: number
  lineRemainingCapacity?: number
  available?: boolean
}

type ReservationItem = {
  id: string
  slotId: string
  source: 'line' | 'web' | 'jalan' | 'phone' | 'gmail' | 'admin' | 'mcp'
  status: 'pending' | 'confirmed' | 'cancelled' | 'completed' | 'no_show'
  title: string
  customerName?: string | null
  customerPhone?: string | null
  totalPeople: number
  startAt: string
  endAt: string
}

export function ReservationCalendarTab() {
  const [date, setDate] = useState(toYmd(new Date()))
  const [resources, setResources] = useState<ReservationResource[]>([])
  const [resourceId, setResourceId] = useState('')
  const [slots, setSlots] = useState<ReservationSlot[]>([])
  const [reservations, setReservations] = useState<ReservationItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    void loadResources()
  }, [])

  useEffect(() => {
    void loadDay()
  }, [date, resourceId])

  const reservationsBySlot = useMemo(() => {
    const map = new Map<string, ReservationItem[]>()
    for (const reservation of reservations.filter(isActiveReservation)) {
      const list = map.get(reservation.slotId) || []
      list.push(reservation)
      map.set(reservation.slotId, list)
    }
    return map
  }, [reservations])

  async function loadResources() {
    const res = await fetchApi<ApiResponse<ReservationResource[]>>('/api/reservation-resources')
    if (!res.success) {
      setError(res.error || '予約対象を読み込めませんでした')
      return
    }
    const active = res.data.filter((item) => item.isActive !== false)
    setResources(active)
    setResourceId((current) => current || active[0]?.id || '')
  }

  async function loadDay() {
    setLoading(true)
    setError('')
    try {
      const [reservationRes, slotRes] = await Promise.all([
        fetchApi<ApiResponse<ReservationItem[]>>(`/api/reservations?date=${encodeURIComponent(date)}`),
        resourceId
          ? fetchApi<ApiResponse<ReservationSlot[]>>(`/api/reservation-slots?resourceId=${encodeURIComponent(resourceId)}&date=${encodeURIComponent(date)}&people=1`)
          : Promise.resolve({ success: true, data: [] } as ApiResponse<ReservationSlot[]>),
      ])
      if (!reservationRes.success) throw new Error(reservationRes.error || '予約を読み込めませんでした')
      if (!slotRes.success) throw new Error(slotRes.error || '予約枠を読み込めませんでした')
      setReservations(reservationRes.data)
      setSlots(slotRes.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '予約カレンダーの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const activeReservations = reservations.filter(isActiveReservation)

  return (
    <section className="space-y-4">
      <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Reservation Calendar</p>
        <h2 className="mt-1 text-xl font-black text-gray-950">予約カレンダー</h2>
        <p className="mt-1 text-sm text-gray-500">日付と予約対象を選ぶと、その日の枠と予約客を確認できます。</p>
        <div className="mt-4 grid gap-2 sm:grid-cols-[1fr_1.5fr_auto]">
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          <select value={resourceId} onChange={(event) => setResourceId(event.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm">
            <option value="">予約対象を選択</option>
            {resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
          </select>
          <button onClick={() => void loadDay()} className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white">更新</button>
        </div>
      </div>

      {error && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-3">
        <Summary label="有効予約" value={`${activeReservations.length}件`} />
        <Summary label="予約枠" value={`${slots.length}枠`} />
        <Summary label="総人数" value={`${activeReservations.reduce((sum, item) => sum + item.totalPeople, 0)}名`} />
      </div>

      <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
        {loading ? (
          <p className="py-8 text-center text-sm text-gray-400">読み込み中...</p>
        ) : slots.length === 0 ? (
          <p className="py-8 text-center text-sm text-gray-400">この日の予約枠はありません。</p>
        ) : (
          <div className="space-y-3">
            {slots.map((slot) => {
              const slotId = slot.slotId || slot.id || ''
              const list = reservationsBySlot.get(slotId) || []
              return (
                <details key={slotId} className="rounded-2xl border border-gray-100 bg-gray-50 p-3" open={list.length > 0}>
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-gray-950">{timeLabel(slot.startAt)} - {timeLabel(slot.endAt)}</p>
                        <p className="mt-1 text-xs text-gray-500">予約 {list.length}件 / 残り {slot.lineRemainingCapacity ?? slot.remainingCapacity ?? '-'}枠</p>
                      </div>
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${slot.available === false ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {slot.available === false ? '満席/停止' : '受付可'}
                      </span>
                    </div>
                  </summary>
                  <div className="mt-3 space-y-2">
                    {list.length === 0 ? (
                      <p className="text-sm text-gray-400">予約客はいません。</p>
                    ) : list.map((reservation) => (
                      <div key={reservation.id} className="rounded-xl bg-white p-3 shadow-sm">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-gray-950">{reservation.customerName || reservation.title}</p>
                            <p className="mt-1 text-xs text-gray-500">{reservation.totalPeople}名 / {sourceLabel(reservation.source)} / {reservation.customerPhone || '電話なし'}</p>
                          </div>
                          <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600">{reservation.status}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </details>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-bold text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-black text-gray-950">{value}</p>
    </div>
  )
}

function isActiveReservation(reservation: ReservationItem) {
  return reservation.status === 'pending' || reservation.status === 'confirmed'
}

function timeLabel(value: string) {
  return formatDateTime(value).split(' ').pop() || value.slice(11, 16)
}

function sourceLabel(source: ReservationItem['source']) {
  const labels: Record<ReservationItem['source'], string> = {
    line: 'LINE',
    web: 'Web',
    jalan: 'じゃらん',
    phone: '電話',
    gmail: 'Gmail',
    admin: '管理',
    mcp: 'MCP',
  }
  return labels[source]
}

function toYmd(date: Date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
