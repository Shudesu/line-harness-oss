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
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(toYmd(new Date()).slice(0, 7))
  const [slotDays, setSlotDays] = useState<Set<string>>(new Set())
  const [selectedReservation, setSelectedReservation] = useState<ReservationItem | null>(null)
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

  useEffect(() => {
    if (calendarOpen) void loadCalendarMonth()
  }, [calendarOpen, calendarMonth, resourceId])

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

  async function loadCalendarMonth() {
    if (!resourceId) {
      setSlotDays(new Set())
      return
    }
    const days = monthDates(calendarMonth)
    try {
      const results = await Promise.all(days.map(async (day) => {
        const res = await fetchApi<ApiResponse<ReservationSlot[]>>(`/api/reservation-slots?resourceId=${encodeURIComponent(resourceId)}&date=${encodeURIComponent(day)}&people=1`)
        return res.success && res.data.length > 0 ? day : null
      }))
      setSlotDays(new Set(results.filter(Boolean) as string[]))
    } catch {
      setSlotDays(new Set())
    }
  }

  const moveCalendarMonth = (direction: -1 | 1) => {
    const next = new Date(`${calendarMonth}-01T00:00:00`)
    next.setMonth(next.getMonth() + direction)
    setCalendarMonth(toYmd(next).slice(0, 7))
  }

  const activeReservations = reservations.filter(isActiveReservation)

  return (
    <section className="space-y-4">
      <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Reservation Calendar</p>
            <h2 className="mt-1 text-xl font-black text-gray-950">予約カレンダー</h2>
            <p className="mt-1 text-sm text-gray-500">カレンダーから日付を選び、その日の枠と予約客を確認します。</p>
          </div>
          <button onClick={() => setCalendarOpen(true)} className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-bold text-white">
            カレンダー
          </button>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-[1.5fr_1fr_auto]">
          <select value={resourceId} onChange={(event) => setResourceId(event.target.value)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm">
            <option value="">予約対象を選択</option>
            {resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
          </select>
          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-bold text-gray-800">{date}</div>
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
                      <button key={reservation.id} onClick={() => setSelectedReservation(reservation)} className="w-full rounded-xl bg-white p-3 text-left shadow-sm hover:bg-blue-50">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-bold text-gray-950">{reservation.customerName || reservation.title}</p>
                            <p className="mt-1 text-xs text-gray-500">{reservation.totalPeople}名 / {sourceLabel(reservation.source)} / {reservation.customerPhone || '電話なし'}</p>
                          </div>
                          <span className="rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600">{reservation.status}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                </details>
              )
            })}
          </div>
        )}
      </div>

      {calendarOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-0 sm:items-center sm:p-4">
          <section className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:mx-auto sm:max-w-xl sm:rounded-3xl">
            <div className="flex items-center justify-between gap-2">
              <button onClick={() => moveCalendarMonth(-1)} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700">前月</button>
              <input type="month" value={calendarMonth} onChange={(event) => setCalendarMonth(event.target.value || calendarMonth)} className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold text-gray-900" />
              <button onClick={() => moveCalendarMonth(1)} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700">次月</button>
              <button onClick={() => setCalendarOpen(false)} className="rounded-xl bg-gray-100 px-3 py-2 text-xs font-bold text-gray-700">閉じる</button>
            </div>
            <div className="mt-4 grid grid-cols-7 gap-1 text-center text-xs font-bold text-gray-400">
              {['日', '月', '火', '水', '木', '金', '土'].map((w) => <div key={w} className="py-1">{w}</div>)}
            </div>
            <div className="mt-1 grid grid-cols-7 gap-1">
              {calendarCells(calendarMonth).map((day, index) => {
                const inMonth = day.startsWith(calendarMonth)
                const hasSlot = slotDays.has(day)
                const selected = day === date
                return (
                  <button
                    key={`${day}-${index}`}
                    onClick={() => {
                      setDate(day)
                      setCalendarOpen(false)
                    }}
                    className={`min-h-14 rounded-xl border p-1 text-left ${selected ? 'border-blue-500 bg-blue-50' : hasSlot ? 'border-emerald-200 bg-emerald-50' : 'border-gray-100 bg-white'} ${inMonth ? 'text-gray-900' : 'text-gray-300'}`}
                  >
                    <span className="text-xs font-black">{Number(day.slice(8, 10))}</span>
                    {hasSlot && <span className="mt-1 block text-center text-lg leading-none text-emerald-500">○</span>}
                  </button>
                )
              })}
            </div>
            <p className="mt-3 text-xs text-gray-500">○ は予約枠がある日です。</p>
          </section>
        </div>
      )}

      {selectedReservation && (
        <ReservationDetailModal reservation={selectedReservation} onClose={() => setSelectedReservation(null)} />
      )}
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

function monthDates(month: string) {
  const start = new Date(`${month}-01T00:00:00`)
  const dates: string[] = []
  const cursor = new Date(start)
  while (cursor.getMonth() === start.getMonth()) {
    dates.push(toYmd(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return dates
}

function calendarCells(month: string) {
  const start = new Date(`${month}-01T00:00:00`)
  const cursor = new Date(start)
  cursor.setDate(1 - start.getDay())
  const days: string[] = []
  for (let i = 0; i < 42; i += 1) {
    days.push(toYmd(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }
  return days
}

function ReservationDetailModal({ reservation, onClose }: { reservation: ReservationItem; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-0 sm:items-center sm:p-4">
      <section className="w-full rounded-t-3xl bg-white p-5 shadow-2xl sm:mx-auto sm:max-w-lg sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-black text-gray-950">{reservation.customerName || reservation.title}</p>
            <p className="mt-1 text-sm text-gray-500">{timeLabel(reservation.startAt)} - {timeLabel(reservation.endAt)}</p>
          </div>
          <button onClick={onClose} className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-bold text-gray-700">閉じる</button>
        </div>
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          <Info label="人数" value={`${reservation.totalPeople}名`} />
          <Info label="経路" value={sourceLabel(reservation.source)} />
          <Info label="電話" value={reservation.customerPhone || '-'} />
          <Info label="状態" value={reservation.status} />
        </dl>
      </section>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-gray-50 p-3">
      <dt className="text-xs font-bold text-gray-400">{label}</dt>
      <dd className="mt-1 text-sm font-bold text-gray-900">{value}</dd>
    </div>
  )
}
