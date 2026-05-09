'use client'

import { useCallback, useEffect, useState } from 'react'
import type {
  ApiResponse,
  ExternalReservationSourceResponse,
  ReservationMenu,
  ReservationResource,
  ReservationResponse,
  ReservationSchedule,
  ReservationSlot,
  ReservationSlotStatus,
  ReservationSlotWithAvailability,
} from '@line-crm/shared'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'

type Mode = 'overview' | 'settings'
type ViewMode = 'week' | 'month'
type AdminExternalSource = ExternalReservationSourceResponse & {
  rawText?: string | null
  parsedPayload?: string | null
}

const dayLabels = ['日', '月', '火', '水', '木', '金', '土']

function toYmd(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function parseYmd(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

function addDays(value: string, days: number): string {
  const date = parseYmd(value)
  date.setDate(date.getDate() + days)
  return toYmd(date)
}

function startOfWeek(value: string): string {
  const date = parseYmd(value)
  date.setDate(date.getDate() - date.getDay())
  return toYmd(date)
}

function monthDates(value: string): string[] {
  const date = parseYmd(value)
  const first = new Date(date.getFullYear(), date.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const d = new Date(start)
    d.setDate(start.getDate() + index)
    return toYmd(d)
  })
}

function formatTime(value: string): string {
  const match = value.match(/T(\d{2}:\d{2})/)
  return match?.[1] ?? value.slice(11, 16) ?? value
}

function slotLabel(slot: ReservationSlotWithAvailability): { mark: string; className: string; text: string } {
  if (!slot.availability.available) return { mark: '×', className: 'text-red-600 bg-red-50', text: '満席' }
  const line = slot.availability.lineRemainingCapacity ?? slot.availability.remainingCapacity
  if (line >= 3) return { mark: '◎', className: 'text-green-700 bg-green-50', text: `残${line}` }
  if (line >= 1) return { mark: '△', className: 'text-amber-700 bg-amber-50', text: `残${line}` }
  return { mark: '×', className: 'text-red-600 bg-red-50', text: '満席' }
}

async function apiData<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetchApi<ApiResponse<T>>(path, options)
  if (!res.success) throw new Error(res.error || 'API request failed')
  return res.data
}

function numberOrUndefined(value: FormDataEntryValue | null): number | undefined {
  if (value === null || String(value).trim() === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

function nullableNumber(value: FormDataEntryValue | null): number | null {
  return numberOrUndefined(value) ?? null
}

export default function ReservationsPage() {
  const [mode, setMode] = useState<Mode>('overview')
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [date, setDate] = useState(toYmd(new Date()))
  const [weekStart, setWeekStart] = useState(startOfWeek(toYmd(new Date())))
  const [resources, setResources] = useState<ReservationResource[]>([])
  const [resourceId, setResourceId] = useState('')
  const [menus, setMenus] = useState<ReservationMenu[]>([])
  const [schedules, setSchedules] = useState<ReservationSchedule[]>([])
  const [slots, setSlots] = useState<ReservationSlotWithAvailability[]>([])
  const [slotsByDate, setSlotsByDate] = useState<Record<string, ReservationSlotWithAvailability[]>>({})
  const [reservations, setReservations] = useState<ReservationResponse[]>([])
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)
  const [selectedReservation, setSelectedReservation] = useState<ReservationResponse | null>(null)
  const [externalSources, setExternalSources] = useState<AdminExternalSource[]>([])
  const [showExternalDetails, setShowExternalDetails] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const visibleDates = viewMode === 'week'
    ? Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
    : monthDates(date)

  const selectedSlot = selectedSlotId ? slots.find((slot) => slot.id === selectedSlotId) ?? null : null
  const selectedSlotReservations = selectedSlotId
    ? reservations.filter((reservation) => reservation.slotId === selectedSlotId)
    : reservations
  const selectedDateExternalSources = externalSources.filter((source) => {
    const text = [source.receivedAt, source.rawText, source.parsedPayload, source.lastError].filter(Boolean).join(' ')
    return text.includes(date) || text.includes(date.replaceAll('-', '/'))
  })

  const load = useCallback(async (nextResourceId = resourceId, nextDate = date) => {
    setLoading(true)
    setError('')
    try {
      const allResources = await apiData<ReservationResource[]>('/api/reservation-resources')
      const resolvedResourceId = nextResourceId || allResources[0]?.id || ''
      setResources(allResources)
      setResourceId(resolvedResourceId)

      const dates = viewMode === 'week'
        ? Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(nextDate), index))
        : monthDates(nextDate)

      const [
        nextReservations,
        nextExternalSources,
        nextMenus,
        nextSchedules,
        slotEntries,
      ] = await Promise.all([
        apiData<ReservationResponse[]>(`/api/reservations?date=${encodeURIComponent(nextDate)}`),
        apiData<AdminExternalSource[]>('/api/external-reservation-sources?parseStatus=needs_review&limit=50'),
        resolvedResourceId ? apiData<ReservationMenu[]>(`/api/reservation-resources/${encodeURIComponent(resolvedResourceId)}/menus`) : Promise.resolve([]),
        resolvedResourceId ? apiData<ReservationSchedule[]>(`/api/reservation-resources/${encodeURIComponent(resolvedResourceId)}/schedules`) : Promise.resolve([]),
        resolvedResourceId
          ? Promise.all(dates.map(async (d) => [
              d,
              await apiData<ReservationSlotWithAvailability[]>(
                `/api/reservation-slots?resourceId=${encodeURIComponent(resolvedResourceId)}&date=${encodeURIComponent(d)}&people=1`,
              ).catch(() => []),
            ] as const))
          : Promise.resolve([]),
      ])

      const nextSlotsByDate = Object.fromEntries(slotEntries)
      setReservations(nextReservations)
      setExternalSources(nextExternalSources)
      setMenus(nextMenus)
      setSchedules(nextSchedules)
      setSlotsByDate(nextSlotsByDate)
      setSlots(nextSlotsByDate[nextDate] ?? [])
      setSelectedSlotId((current) => current && (nextSlotsByDate[nextDate] ?? []).some((slot) => slot.id === current) ? current : null)
      setSelectedReservation(null)
    } catch {
      setError('予約データの読み込みに失敗しました。APIキー、CORS、D1 schemaを確認してください。')
    } finally {
      setLoading(false)
    }
  }, [date, resourceId, viewMode])

  useEffect(() => {
    load()
  }, [load])

  const runSaving = async (fn: () => Promise<void>, success: string) => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      await fn()
      setMessage(success)
      await load(resourceId, date)
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const changeDate = (nextDate: string, slotId?: string) => {
    setDate(nextDate)
    setWeekStart(startOfWeek(nextDate))
    setSelectedSlotId(slotId ?? null)
    setSelectedReservation(null)
  }

  const moveRange = (direction: -1 | 1) => {
    if (viewMode === 'week') {
      const next = addDays(weekStart, direction * 7)
      setWeekStart(next)
      setDate(next)
      return
    }
    const d = parseYmd(date)
    d.setMonth(d.getMonth() + direction, 1)
    const next = toYmd(d)
    setDate(next)
    setWeekStart(startOfWeek(next))
  }

  const generateSlots = async (formData: FormData) => {
    const dateFrom = String(formData.get('dateFrom') || date)
    const dateTo = String(formData.get('dateTo') || date)
    if (!resourceId) throw new Error('予約対象を選択してください')
    await apiData<ReservationSlot[]>('/api/reservation-slots/generate', {
      method: 'POST',
      body: JSON.stringify({ resourceId, dateFrom, dateTo }),
    })
  }

  const updateSlot = async (slot: ReservationSlotWithAvailability, formData: FormData) => {
    await apiData<ReservationSlot>(`/api/reservation-slots/${encodeURIComponent(slot.id)}`, {
      method: 'PUT',
      body: JSON.stringify({
        status: formData.get('status'),
        totalCapacity: numberOrUndefined(formData.get('totalCapacity')),
        lineCapacity: nullableNumber(formData.get('lineCapacity')),
        externalCapacity: nullableNumber(formData.get('externalCapacity')),
        bufferCapacity: numberOrUndefined(formData.get('bufferCapacity')),
        note: String(formData.get('note') || '') || null,
      }),
    })
  }

  const cancelReservation = async (reservation: ReservationResponse) => {
    if (!confirm(`${reservation.customerName || reservation.title} をキャンセルしますか？在庫戻しは状態遷移ルールに従います。`)) return
    await runSaving(async () => {
      await apiData(`/api/reservations/${encodeURIComponent(reservation.id)}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'cancelled', reason: 'admin_cancelled' }),
      })
    }, '予約をキャンセルしました')
  }

  const markExternalIgnored = async (source: AdminExternalSource) => {
    await runSaving(async () => {
      await apiData(`/api/external-reservation-sources/${encodeURIComponent(source.id)}/parse-status`, {
        method: 'PUT',
        body: JSON.stringify({ parseStatus: 'ignored', lastError: null }),
      })
    }, '外部取り込みを確認済みにしました')
  }

  const startGoogleOAuth = async (formData: FormData) => {
    const calendarId = String(formData.get('calendarId') || 'primary')
    const returnTo = window.location.href
    const result = await apiData<{ url: string }>(
      `/api/reservations/google-calendar/oauth-url?${new URLSearchParams({ calendarId, returnTo })}`,
    )
    window.open(result.url, '_blank', 'noopener,noreferrer')
  }

  return (
    <div>
      <Header
        title="予約管理"
        description="予約カレンダー、予約枠、予約対象・メニュー・営業時間を管理します。"
        action={
          <div className="flex rounded-lg bg-gray-100 p-1">
            <button
              onClick={() => setMode('overview')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md ${mode === 'overview' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
            >
              予約確認
            </button>
            <button
              onClick={() => setMode('settings')}
              className={`px-3 py-1.5 text-sm font-medium rounded-md ${mode === 'settings' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}
            >
              予約設計
            </button>
          </div>
        }
      />

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
      {message && <div className="mb-4 rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-700">{message}</div>}

      <div className="mb-4 flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm md:flex-row md:items-end">
        <label className="flex-1 text-sm font-medium text-gray-700">
          予約対象
          <select
            value={resourceId}
            onChange={(event) => {
              setResourceId(event.target.value)
              setSelectedSlotId(null)
            }}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none"
          >
            {resources.length === 0 && <option value="">未登録</option>}
            {resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-gray-700">
          日付
          <input
            type="date"
            value={date}
            onChange={(event) => changeDate(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-green-500 focus:outline-none md:w-44"
          />
        </label>
        <button
          onClick={() => load(resourceId, date)}
          disabled={loading}
          className="rounded-lg px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          style={{ backgroundColor: '#06C755' }}
        >
          更新
        </button>
      </div>

      {mode === 'overview' ? (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
          <div className="space-y-4">
            <CalendarCard
              date={date}
              viewMode={viewMode}
              visibleDates={visibleDates}
              slotsByDate={slotsByDate}
              onSelectDate={changeDate}
              onMoveRange={moveRange}
              onSetViewMode={setViewMode}
            />
            <ExternalSourcesCard
              sources={selectedDateExternalSources}
              showDetails={showExternalDetails}
              onToggle={() => setShowExternalDetails((value) => !value)}
              onIgnore={markExternalIgnored}
              saving={saving}
            />
            <SlotsCard
              slots={slots}
              reservations={reservations}
              selectedSlotId={selectedSlotId}
              onSelect={(slotId) => {
                setSelectedSlotId(selectedSlotId === slotId ? null : slotId)
                setSelectedReservation(null)
              }}
              onSaveSlot={(slot, formData) => runSaving(() => updateSlot(slot, formData), '予約枠を更新しました')}
              saving={saving}
            />
          </div>
          <ReservationDetailCard
            title={selectedSlot ? `${formatTime(selectedSlot.startAt)} の予約` : `${date} の予約`}
            reservations={selectedSlotReservations}
            selectedReservation={selectedReservation}
            onSelect={setSelectedReservation}
            onCancel={cancelReservation}
            saving={saving}
          />
        </section>
      ) : (
        <SettingsPanel
          resources={resources}
          resourceId={resourceId}
          menus={menus}
          schedules={schedules}
          loading={loading || saving}
          onCreateResource={(formData) => runSaving(async () => {
            const resource = await apiData<ReservationResource>('/api/reservation-resources', {
              method: 'POST',
              body: JSON.stringify(resourcePayload(formData)),
            })
            setResourceId(resource.id)
          }, '予約対象を作成しました')}
          onUpdateResource={(resource, formData) => runSaving(async () => {
            await apiData<ReservationResource>(`/api/reservation-resources/${encodeURIComponent(resource.id)}`, {
              method: 'PUT',
              body: JSON.stringify(resourcePayload(formData, true)),
            })
          }, '予約対象を保存しました')}
          onCreateMenu={(formData) => runSaving(async () => {
            if (!resourceId) throw new Error('予約対象を選択してください')
            await apiData<ReservationMenu>(`/api/reservation-resources/${encodeURIComponent(resourceId)}/menus`, {
              method: 'POST',
              body: JSON.stringify(menuPayload(formData)),
            })
          }, 'メニューを作成しました')}
          onUpdateMenu={(menu, formData) => runSaving(async () => {
            await apiData<ReservationMenu>(`/api/reservation-resources/${encodeURIComponent(menu.resourceId)}/menus/${encodeURIComponent(menu.id)}`, {
              method: 'PUT',
              body: JSON.stringify(menuPayload(formData, true)),
            })
          }, 'メニューを保存しました')}
          onCreateSchedule={(formData) => runSaving(async () => {
            if (!resourceId) throw new Error('予約対象を選択してください')
            await apiData<ReservationSchedule>(`/api/reservation-resources/${encodeURIComponent(resourceId)}/schedules`, {
              method: 'POST',
              body: JSON.stringify(schedulePayload(formData)),
            })
          }, '営業時間を作成しました')}
          onUpdateSchedule={(schedule, formData) => runSaving(async () => {
            await apiData<ReservationSchedule>(`/api/reservation-resources/${encodeURIComponent(schedule.resourceId)}/schedules/${encodeURIComponent(schedule.id)}`, {
              method: 'PUT',
              body: JSON.stringify(schedulePayload(formData, true)),
            })
          }, '営業時間を保存しました')}
          onGenerateSlots={(formData) => runSaving(() => generateSlots(formData), '予約枠を生成しました')}
          onGoogleOAuth={(formData) => runSaving(() => startGoogleOAuth(formData), 'Google Calendar接続を開始しました')}
        />
      )}

      {loading && <div className="mt-4 text-sm text-gray-400">読み込み中...</div>}
    </div>
  )
}

function CalendarCard({
  date,
  viewMode,
  visibleDates,
  slotsByDate,
  onSelectDate,
  onMoveRange,
  onSetViewMode,
}: {
  date: string
  viewMode: ViewMode
  visibleDates: string[]
  slotsByDate: Record<string, ReservationSlotWithAvailability[]>
  onSelectDate: (date: string, slotId?: string) => void
  onMoveRange: (direction: -1 | 1) => void
  onSetViewMode: (mode: ViewMode) => void
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-bold text-gray-900">空き状況カレンダー</h2>
          <p className="text-xs text-gray-500">日付を選ぶと下に枠情報、枠を選ぶと右側に予約詳細を表示します。</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => onMoveRange(-1)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">←</button>
          <button onClick={() => onSetViewMode('week')} className={`rounded-lg px-3 py-2 text-sm ${viewMode === 'week' ? 'bg-green-50 text-green-700' : 'border border-gray-200 text-gray-600'}`}>1週間</button>
          <button onClick={() => onSetViewMode('month')} className={`rounded-lg px-3 py-2 text-sm ${viewMode === 'month' ? 'bg-green-50 text-green-700' : 'border border-gray-200 text-gray-600'}`}>1か月</button>
          <button onClick={() => onMoveRange(1)} className="rounded-lg border border-gray-200 px-3 py-2 text-sm hover:bg-gray-50">→</button>
        </div>
      </div>
      <div className={`grid gap-px bg-gray-100 p-px ${viewMode === 'week' ? 'grid-cols-7' : 'grid-cols-7'}`}>
        {visibleDates.map((d) => {
          const slots = slotsByDate[d] ?? []
          const bestSlot = slots.find((slot) => slot.availability.available) ?? slots[0]
          const label = bestSlot ? slotLabel(bestSlot) : { mark: '-', className: 'text-gray-400 bg-gray-50', text: '未生成' }
          return (
            <button
              key={d}
              onClick={() => onSelectDate(d, bestSlot?.id)}
              className={`min-h-24 bg-white p-2 text-left transition hover:bg-green-50 ${d === date ? 'ring-2 ring-inset ring-green-500' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-gray-700">{Number(d.slice(-2))}</span>
                <span className="text-[11px] text-gray-400">{dayLabels[parseYmd(d).getDay()]}</span>
              </div>
              <div className={`mt-3 inline-flex rounded-full px-2 py-1 text-xs font-bold ${label.className}`}>
                {label.mark} {label.text}
              </div>
              <p className="mt-2 text-[11px] text-gray-400">{slots.length}枠</p>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ExternalSourcesCard({
  sources,
  showDetails,
  onToggle,
  onIgnore,
  saving,
}: {
  sources: AdminExternalSource[]
  showDetails: boolean
  onToggle: () => void
  onIgnore: (source: AdminExternalSource) => void
  saving: boolean
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-bold text-gray-900">外部取り込み確認</h2>
          <p className="text-xs text-gray-500">選択日の要確認: {sources.length}件</p>
        </div>
        <button onClick={onToggle} className="rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50">
          {showDetails ? '閉じる' : '詳細'}
        </button>
      </div>
      {showDetails && (
        <div className="mt-3 space-y-2">
          {sources.length === 0 ? <p className="text-sm text-gray-400">要確認の外部取り込みはありません。</p> : sources.map((source) => (
            <div key={source.id} className="rounded-lg border border-amber-100 bg-amber-50 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm font-medium text-amber-900">{source.source} / {source.eventType}</p>
                <button disabled={saving} onClick={() => onIgnore(source)} className="rounded-md bg-white px-2 py-1 text-xs text-amber-700 disabled:opacity-50">確認済み</button>
              </div>
              <p className="mt-1 text-xs text-amber-700">{source.lastError || source.externalId || source.dedupeKey || source.receivedAt}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function SlotsCard({
  slots,
  reservations,
  selectedSlotId,
  onSelect,
  onSaveSlot,
  saving,
}: {
  slots: ReservationSlotWithAvailability[]
  reservations: ReservationResponse[]
  selectedSlotId: string | null
  onSelect: (slotId: string) => void
  onSaveSlot: (slot: ReservationSlotWithAvailability, formData: FormData) => void
  saving: boolean
}) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 p-4">
        <h2 className="text-base font-bold text-gray-900">選択日の予約枠</h2>
      </div>
      <div className="divide-y divide-gray-100">
        {slots.length === 0 ? <p className="p-6 text-sm text-gray-400">予約枠がありません。予約設計から生成してください。</p> : slots.map((slot) => {
          const label = slotLabel(slot)
          const count = reservations.filter((reservation) => reservation.slotId === slot.id).length
          const open = selectedSlotId === slot.id
          return (
            <details key={slot.id} open={open} className="group">
              <summary onClick={(event) => { event.preventDefault(); onSelect(slot.id) }} className="flex cursor-pointer items-center justify-between gap-3 p-4 hover:bg-gray-50">
                <div>
                  <p className="font-semibold text-gray-900">{formatTime(slot.startAt)} - {formatTime(slot.endAt)}</p>
                  <p className="text-xs text-gray-500">予約 {count}件 / 総枠 {slot.totalCapacity} / LINE {slot.lineReservedCount}/{slot.lineCapacity ?? slot.totalCapacity} / 外部 {slot.externalReservedCount}/{slot.externalCapacity ?? slot.totalCapacity}</p>
                </div>
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${label.className}`}>{label.mark} {label.text}</span>
              </summary>
              <form action={(formData) => onSaveSlot(slot, formData)} className="grid gap-3 bg-gray-50 p-4 sm:grid-cols-6">
                <Field label="状態">
                  <select name="status" defaultValue={slot.status} className="input">
                    {(['open', 'closed', 'sold_out', 'hidden'] satisfies ReservationSlotStatus[]).map((status) => <option key={status} value={status}>{status}</option>)}
                  </select>
                </Field>
                <Field label="総枠"><input name="totalCapacity" type="number" defaultValue={slot.totalCapacity} className="input" /></Field>
                <Field label="LINE枠"><input name="lineCapacity" type="number" defaultValue={slot.lineCapacity ?? ''} className="input" /></Field>
                <Field label="外部枠"><input name="externalCapacity" type="number" defaultValue={slot.externalCapacity ?? ''} className="input" /></Field>
                <Field label="バッファ"><input name="bufferCapacity" type="number" defaultValue={slot.bufferCapacity} className="input" /></Field>
                <Field label="メモ"><input name="note" defaultValue={slot.note ?? ''} className="input" /></Field>
                <div className="sm:col-span-6">
                  <button disabled={saving} className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-50">slot保存</button>
                </div>
              </form>
            </details>
          )
        })}
      </div>
    </div>
  )
}

function ReservationDetailCard({
  title,
  reservations,
  selectedReservation,
  onSelect,
  onCancel,
  saving,
}: {
  title: string
  reservations: ReservationResponse[]
  selectedReservation: ReservationResponse | null
  onSelect: (reservation: ReservationResponse) => void
  onCancel: (reservation: ReservationResponse) => void
  saving: boolean
}) {
  return (
    <aside className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 p-4">
        <h2 className="text-base font-bold text-gray-900">{title}</h2>
        <p className="text-xs text-gray-500">{reservations.length}件</p>
      </div>
      <div className="max-h-[720px] overflow-y-auto p-4">
        {reservations.length === 0 ? <p className="text-sm text-gray-400">予約はありません。</p> : (
          <div className="space-y-2">
            {reservations.map((reservation) => (
              <button key={reservation.id} onClick={() => onSelect(reservation)} className="w-full rounded-lg border border-gray-200 p-3 text-left hover:bg-gray-50">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-semibold text-gray-900">{reservation.customerName || reservation.title}</p>
                  <StatusBadge status={reservation.status} />
                </div>
                <p className="mt-1 text-xs text-gray-500">{formatTime(reservation.startAt)} / {reservation.totalPeople}名 / {reservation.source}:{reservation.capacityChannel}</p>
              </button>
            ))}
          </div>
        )}
        {selectedReservation && (
          <div className="mt-4 rounded-lg bg-gray-50 p-4">
            <h3 className="font-bold text-gray-900">{selectedReservation.customerName || selectedReservation.title}</h3>
            <dl className="mt-3 space-y-2 text-sm">
              <Info label="電話" value={selectedReservation.customerPhone || '-'} />
              <Info label="メール" value={selectedReservation.customerEmail || '-'} />
              <Info label="人数" value={`${selectedReservation.totalPeople}名 大人${selectedReservation.adultCount} / 子ども${selectedReservation.childCount} / 幼児${selectedReservation.infantCount}`} />
              <Info label="枠消費" value={`${selectedReservation.capacityPeople}枠`} />
              <Info label="状態" value={selectedReservation.status} />
              <Info label="外部ID" value={selectedReservation.externalReservationId || '-'} />
            </dl>
            {(selectedReservation.status === 'pending' || selectedReservation.status === 'confirmed') && (
              <button disabled={saving} onClick={() => onCancel(selectedReservation)} className="mt-4 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
                キャンセル
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}

function SettingsPanel(props: {
  resources: ReservationResource[]
  resourceId: string
  menus: ReservationMenu[]
  schedules: ReservationSchedule[]
  loading: boolean
  onCreateResource: (formData: FormData) => void
  onUpdateResource: (resource: ReservationResource, formData: FormData) => void
  onCreateMenu: (formData: FormData) => void
  onUpdateMenu: (menu: ReservationMenu, formData: FormData) => void
  onCreateSchedule: (formData: FormData) => void
  onUpdateSchedule: (schedule: ReservationSchedule, formData: FormData) => void
  onGenerateSlots: (formData: FormData) => void
  onGoogleOAuth: (formData: FormData) => void
}) {
  const currentResource = props.resources.find((resource) => resource.id === props.resourceId)
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <SettingsCard title="予約対象 Resource">
        <form action={props.onCreateResource} className="space-y-3">
          <Field label="名前"><input name="name" className="input" placeholder="ブルーベリー摘み取り" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="標準時間"><input name="defaultDurationMinutes" type="number" defaultValue={60} className="input" /></Field>
            <Field label="総枠"><input name="defaultCapacity" type="number" defaultValue={20} className="input" /></Field>
          </div>
          <button disabled={props.loading} className="btn-primary">resource作成</button>
        </form>
        {currentResource && <ResourceEditor resource={currentResource} loading={props.loading} onSubmit={props.onUpdateResource} />}
        <form action={props.onGoogleOAuth} className="mt-4 border-t border-gray-100 pt-4">
          <Field label="Google Calendar ID"><input name="calendarId" defaultValue="primary" className="input" /></Field>
          <button disabled={props.loading} className="btn-secondary mt-3">Google Calendar接続</button>
        </form>
      </SettingsCard>

      <SettingsCard title="メニュー Menu">
        <form action={props.onCreateMenu} className="space-y-3">
          <Field label="名前"><input name="name" className="input" placeholder="食べ放題60分" /></Field>
          <Field label="説明"><input name="description" className="input" /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="時間"><input name="durationMinutes" type="number" defaultValue={60} className="input" /></Field>
            <Field label="最小人数"><input name="minPeople" type="number" defaultValue={1} className="input" /></Field>
            <Field label="大人料金"><input name="priceAdult" type="number" className="input" /></Field>
            <Field label="子ども料金"><input name="priceChild" type="number" className="input" /></Field>
            <Field label="幼児料金"><input name="priceInfant" type="number" className="input" /></Field>
          </div>
          <div className="grid gap-2 text-xs text-gray-600">
            <label><input name="capacityCountAdult" type="checkbox" defaultChecked className="mr-2" />大人は枠を消費</label>
            <label><input name="capacityCountChild" type="checkbox" defaultChecked className="mr-2" />子どもは枠を消費</label>
            <label><input name="capacityCountInfant" type="checkbox" defaultChecked className="mr-2" />幼児は枠を消費</label>
          </div>
          <button disabled={props.loading || !props.resourceId} className="btn-primary">menu作成</button>
        </form>
        <div className="mt-4 space-y-3">
          {props.menus.map((menu) => <MenuEditor key={menu.id} menu={menu} loading={props.loading} onSubmit={props.onUpdateMenu} />)}
        </div>
      </SettingsCard>

      <SettingsCard title="営業時間 Schedule / Slot">
        <form action={props.onCreateSchedule} className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Field label="曜日">
              <select name="dayOfWeek" className="input">
                {dayLabels.map((label, index) => <option key={label} value={index}>{label}</option>)}
              </select>
            </Field>
            <Field label="開始"><input name="startTime" type="time" defaultValue="09:00" className="input" /></Field>
            <Field label="終了"><input name="endTime" type="time" defaultValue="15:00" className="input" /></Field>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="間隔"><input name="slotIntervalMinutes" type="number" defaultValue={60} className="input" /></Field>
            <Field label="総枠"><input name="defaultCapacity" type="number" defaultValue={20} className="input" /></Field>
          </div>
          <button disabled={props.loading || !props.resourceId} className="btn-primary">schedule作成</button>
        </form>
        <form action={props.onGenerateSlots} className="mt-4 rounded-lg bg-green-50 p-3">
          <p className="mb-2 text-sm font-bold text-green-900">予約枠一括生成</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="開始日"><input name="dateFrom" type="date" defaultValue={toYmd(new Date())} className="input" /></Field>
            <Field label="終了日"><input name="dateTo" type="date" defaultValue={toYmd(new Date())} className="input" /></Field>
          </div>
          <button disabled={props.loading || !props.resourceId} className="btn-secondary mt-3">slot生成</button>
        </form>
        <div className="mt-4 space-y-3">
          {props.schedules.map((schedule) => <ScheduleEditor key={schedule.id} schedule={schedule} loading={props.loading} onSubmit={props.onUpdateSchedule} />)}
        </div>
      </SettingsCard>
    </div>
  )
}

function ResourceEditor({ resource, loading, onSubmit }: { resource: ReservationResource; loading: boolean; onSubmit: (resource: ReservationResource, formData: FormData) => void }) {
  return (
    <form action={(formData) => onSubmit(resource, formData)} className="mt-4 space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
      <Field label="名前"><input name="name" defaultValue={resource.name} className="input" /></Field>
      <Field label="説明"><input name="description" defaultValue={resource.description ?? ''} className="input" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="標準時間"><input name="defaultDurationMinutes" type="number" defaultValue={resource.defaultDurationMinutes} className="input" /></Field>
        <Field label="総枠"><input name="defaultCapacity" type="number" defaultValue={resource.defaultCapacity} className="input" /></Field>
        <Field label="LINE枠"><input name="defaultLineCapacity" type="number" defaultValue={resource.defaultLineCapacity ?? ''} className="input" /></Field>
        <Field label="外部枠"><input name="defaultExternalCapacity" type="number" defaultValue={resource.defaultExternalCapacity ?? ''} className="input" /></Field>
      </div>
      <Field label="Google connection ID"><input name="googleCalendarConnectionId" defaultValue={resource.googleCalendarConnectionId ?? ''} className="input" /></Field>
      <button disabled={loading} className="btn-secondary">resource保存</button>
    </form>
  )
}

function MenuEditor({ menu, loading, onSubmit }: { menu: ReservationMenu; loading: boolean; onSubmit: (menu: ReservationMenu, formData: FormData) => void }) {
  return (
    <details className="rounded-lg border border-gray-100 bg-gray-50 p-3">
      <summary className="cursor-pointer text-sm font-bold text-gray-800">{menu.name}</summary>
      <form action={(formData) => onSubmit(menu, formData)} className="mt-3 space-y-3">
        <Field label="名前"><input name="name" defaultValue={menu.name} className="input" /></Field>
        <Field label="説明"><input name="description" defaultValue={menu.description ?? ''} className="input" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="時間"><input name="durationMinutes" type="number" defaultValue={menu.durationMinutes} className="input" /></Field>
          <Field label="最大人数"><input name="maxPeople" type="number" defaultValue={menu.maxPeople ?? ''} className="input" /></Field>
          <Field label="大人料金"><input name="priceAdult" type="number" defaultValue={menu.priceAdult ?? ''} className="input" /></Field>
          <Field label="子ども料金"><input name="priceChild" type="number" defaultValue={menu.priceChild ?? ''} className="input" /></Field>
          <Field label="幼児料金"><input name="priceInfant" type="number" defaultValue={menu.priceInfant ?? ''} className="input" /></Field>
        </div>
        <div className="grid gap-2 text-xs text-gray-600">
          <label><input name="capacityCountAdult" type="checkbox" defaultChecked={menu.capacityCountAdult} className="mr-2" />大人は枠を消費</label>
          <label><input name="capacityCountChild" type="checkbox" defaultChecked={menu.capacityCountChild} className="mr-2" />子どもは枠を消費</label>
          <label><input name="capacityCountInfant" type="checkbox" defaultChecked={menu.capacityCountInfant} className="mr-2" />幼児は枠を消費</label>
        </div>
        <button disabled={loading} className="btn-secondary">menu保存</button>
      </form>
    </details>
  )
}

function ScheduleEditor({ schedule, loading, onSubmit }: { schedule: ReservationSchedule; loading: boolean; onSubmit: (schedule: ReservationSchedule, formData: FormData) => void }) {
  return (
    <details className="rounded-lg border border-gray-100 bg-gray-50 p-3">
      <summary className="cursor-pointer text-sm font-bold text-gray-800">{dayLabels[schedule.dayOfWeek]} {schedule.startTime}-{schedule.endTime}</summary>
      <form action={(formData) => onSubmit(schedule, formData)} className="mt-3 space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <Field label="曜日"><select name="dayOfWeek" defaultValue={schedule.dayOfWeek} className="input">{dayLabels.map((label, index) => <option key={label} value={index}>{label}</option>)}</select></Field>
          <Field label="開始"><input name="startTime" type="time" defaultValue={schedule.startTime} className="input" /></Field>
          <Field label="終了"><input name="endTime" type="time" defaultValue={schedule.endTime} className="input" /></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="総枠"><input name="defaultCapacity" type="number" defaultValue={schedule.defaultCapacity} className="input" /></Field>
          <Field label="間隔"><input name="slotIntervalMinutes" type="number" defaultValue={schedule.slotIntervalMinutes} className="input" /></Field>
          <Field label="LINE枠"><input name="defaultLineCapacity" type="number" defaultValue={schedule.defaultLineCapacity ?? ''} className="input" /></Field>
          <Field label="外部枠"><input name="defaultExternalCapacity" type="number" defaultValue={schedule.defaultExternalCapacity ?? ''} className="input" /></Field>
        </div>
        <button disabled={loading} className="btn-secondary">schedule保存</button>
      </form>
    </details>
  )
}

function SettingsCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="mb-4 text-base font-bold text-gray-900">{title}</h2>
      {children}
    </section>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-xs font-medium text-gray-600">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-gray-500">{label}</dt>
      <dd className="text-right font-medium text-gray-800">{value}</dd>
    </div>
  )
}

function StatusBadge({ status }: { status: ReservationResponse['status'] }) {
  const className = status === 'confirmed' || status === 'pending'
    ? 'bg-green-50 text-green-700'
    : status === 'cancelled'
      ? 'bg-red-50 text-red-700'
      : 'bg-gray-100 text-gray-600'
  return <span className={`rounded-full px-2 py-1 text-xs font-bold ${className}`}>{status}</span>
}

function resourcePayload(formData: FormData, update = false) {
  return {
    name: String(formData.get('name') || ''),
    description: String(formData.get('description') || '') || null,
    defaultDurationMinutes: numberOrUndefined(formData.get('defaultDurationMinutes')),
    defaultCapacity: numberOrUndefined(formData.get('defaultCapacity')),
    defaultLineCapacity: nullableNumber(formData.get('defaultLineCapacity')),
    defaultExternalCapacity: nullableNumber(formData.get('defaultExternalCapacity')),
    googleCalendarConnectionId: String(formData.get('googleCalendarConnectionId') || '') || null,
    ...(update ? { isActive: true } : {}),
  }
}

function menuPayload(formData: FormData, update = false) {
  return {
    name: String(formData.get('name') || ''),
    description: String(formData.get('description') || '') || null,
    durationMinutes: numberOrUndefined(formData.get('durationMinutes')),
    minPeople: numberOrUndefined(formData.get('minPeople')),
    maxPeople: nullableNumber(formData.get('maxPeople')),
    priceAdult: nullableNumber(formData.get('priceAdult')),
    priceChild: nullableNumber(formData.get('priceChild')),
    priceInfant: nullableNumber(formData.get('priceInfant')),
    capacityCountAdult: formData.get('capacityCountAdult') === 'on',
    capacityCountChild: formData.get('capacityCountChild') === 'on',
    capacityCountInfant: formData.get('capacityCountInfant') === 'on',
    ...(update ? { isActive: true } : {}),
  }
}

function schedulePayload(formData: FormData, update = false) {
  return {
    dayOfWeek: numberOrUndefined(formData.get('dayOfWeek')),
    startTime: String(formData.get('startTime') || '09:00'),
    endTime: String(formData.get('endTime') || '15:00'),
    slotIntervalMinutes: numberOrUndefined(formData.get('slotIntervalMinutes')),
    defaultCapacity: numberOrUndefined(formData.get('defaultCapacity')),
    defaultLineCapacity: nullableNumber(formData.get('defaultLineCapacity')),
    defaultExternalCapacity: nullableNumber(formData.get('defaultExternalCapacity')),
    ...(update ? { isActive: true } : {}),
  }
}
