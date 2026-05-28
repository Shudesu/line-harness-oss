'use client'

import { useCallback, useEffect, useState, type ReactNode } from 'react'
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
import { api, fetchApi, type ApiProviderConfig } from '@/lib/api'

type Mode = 'overview' | 'settings'
type ViewMode = 'week' | 'month'
type ReservationDisplayMode = 'all' | 'line' | 'jalan' | 'time'
type AdminExternalSource = ExternalReservationSourceResponse & {
  rawText?: string | null
  parsedPayload?: string | null
}

type OrphanedReservationItem = {
  reason: 'slot_missing' | 'resource_missing' | 'resource_inactive'
  resourceId?: string | null
  resourceName?: string | null
  reservation: ReservationResponse
}

type OrphanedReservationsResponse = {
  count: number
  reservations: OrphanedReservationItem[]
}

type OrphanedCancelResponse = {
  dryRun: boolean
  count?: number
  scanned?: number
  cancelled: number
  failed: number
  reservations?: OrphanedReservationItem[]
  items?: Array<{ id: string; changed: boolean }>
  errors?: Array<{ id: string; reason: string }>
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

function isActiveReservation(reservation: ReservationResponse): boolean {
  return reservation.status !== 'cancelled' && reservation.status !== 'no_show'
}

function sourceLabel(source: ReservationResponse['source']): string {
  if (source === 'line') return 'LINE'
  if (source === 'web') return 'Web'
  if (source === 'jalan') return 'じゃらん'
  return source
}

function channelLabel(channel: string): string {
  const labels: Record<string, string> = {
    line: 'LINE',
    web: 'Web',
    google_map: 'Google Map',
    instagram: 'Instagram',
    website: '公式サイト',
    qr: 'QR',
    flyer: 'チラシ',
  }
  return labels[channel] ?? channel
}

function reservationEntryInfo(reservation: ReservationResponse): { label: string; detail: string } {
  const metadata = parseReservationMetadata(reservation.metadata)
  const entry = metadata.entry && typeof metadata.entry === 'object' && !Array.isArray(metadata.entry)
    ? metadata.entry as Record<string, unknown>
    : {}
  const channel = typeof entry.channel === 'string' && entry.channel.trim() ? entry.channel.trim() : ''
  const ref = typeof entry.ref === 'string' && entry.ref.trim() ? entry.ref.trim() : ''
  const utmSource = typeof entry.utmSource === 'string' && entry.utmSource.trim() ? entry.utmSource.trim() : ''
  const utmMedium = typeof entry.utmMedium === 'string' && entry.utmMedium.trim() ? entry.utmMedium.trim() : ''
  const utmCampaign = typeof entry.utmCampaign === 'string' && entry.utmCampaign.trim() ? entry.utmCampaign.trim() : ''
  const label = channel ? channelLabel(channel) : sourceLabel(reservation.source)
  const detail = [
    ref ? `ref=${ref}` : null,
    utmSource ? `utm_source=${utmSource}` : null,
    utmMedium ? `utm_medium=${utmMedium}` : null,
    utmCampaign ? `utm_campaign=${utmCampaign}` : null,
  ].filter(Boolean).join(' / ')
  return { label, detail }
}

function orphanReasonLabel(reason: OrphanedReservationItem['reason']): string {
  if (reason === 'slot_missing') return '予約枠が存在しません'
  if (reason === 'resource_missing') return '予約対象が存在しません'
  if (reason === 'resource_inactive') return '予約対象が削除/停止済みです'
  return reason
}

function formatCurrency(value: number | null): string {
  if (value === null) return '金額未登録'
  return new Intl.NumberFormat('ja-JP', { style: 'currency', currency: 'JPY', maximumFractionDigits: 0 }).format(value)
}

type ReservationPriceDetails = {
  totalAmount: number | null
  pointAmount: number | null
  couponAmount: number | null
  customerChargeAmount: number | null
}

function parseReservationMetadata(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function readMoneyCandidate(metadata: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const value = metadata[key]
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const normalized = value.replace(/[^\d.-]/g, '')
      if (!normalized) continue
      const numberValue = Number(normalized)
      if (Number.isFinite(numberValue)) return numberValue
    }
  }
  return null
}

function reservationPriceDetails(reservation: ReservationResponse): ReservationPriceDetails | null {
  const metadata = parseReservationMetadata(reservation.metadata)
  const details: ReservationPriceDetails = {
    totalAmount: readMoneyCandidate(metadata, ['totalAmount', 'total_amount', 'totalAmountYen', 'totalPrice', 'total_price', 'amount']) ?? reservation.amount,
    pointAmount: readMoneyCandidate(metadata, ['pointAmount', 'point_amount', 'pointsAmount', 'points_amount']),
    couponAmount: readMoneyCandidate(metadata, ['couponAmount', 'coupon_amount']),
    customerChargeAmount: readMoneyCandidate(metadata, ['customerChargeAmount', 'customer_charge_amount', 'chargeAmount', 'charge_amount']),
  }
  return Object.values(details).some((value) => value !== null) ? details : null
}

function formatPriceSummary(reservation: ReservationResponse): string {
  const details = reservationPriceDetails(reservation)
  if (!details) return '金額未登録'
  if (details.customerChargeAmount !== null) return `請求 ${formatCurrency(details.customerChargeAmount)}`
  if (details.totalAmount !== null) return `合計 ${formatCurrency(details.totalAmount)}`
  return '金額未登録'
}

function formatPriceDetails(reservation: ReservationResponse): string {
  const details = reservationPriceDetails(reservation)
  if (!details) return '金額未登録'
  const items = [
    details.totalAmount !== null ? `合計 ${formatCurrency(details.totalAmount)}` : null,
    details.pointAmount !== null ? `ポイント ${formatCurrency(details.pointAmount)}` : null,
    details.couponAmount !== null ? `クーポン ${formatCurrency(details.couponAmount)}` : null,
    details.customerChargeAmount !== null ? `請求 ${formatCurrency(details.customerChargeAmount)}` : null,
  ].filter(Boolean)
  return items.join(' / ') || '金額未登録'
}

function formatRangeLabel(viewMode: ViewMode, date: string, visibleDates: string[]): string {
  if (viewMode === 'month') {
    const d = parseYmd(date)
    return `${d.getFullYear()}年${d.getMonth() + 1}月`
  }
  const first = visibleDates[0]
  const last = visibleDates[visibleDates.length - 1]
  return first && last ? `${Number(first.slice(5, 7))}/${Number(first.slice(8, 10))} - ${Number(last.slice(5, 7))}/${Number(last.slice(8, 10))}` : ''
}

function dateSummary(slots: ReservationSlotWithAvailability[]): { slots: number; remaining: number; reserved: number } {
  return slots.reduce((acc, slot) => {
    acc.slots += 1
    acc.remaining += Math.max(0, slot.availability.remainingCapacity)
    acc.reserved += slot.reservedCount
    return acc
  }, { slots: 0, remaining: 0, reserved: 0 })
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

function workerBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787').trim().replace(/\/+$/, '')
}

export default function ReservationsPage() {
  const [mode, setMode] = useState<Mode>('overview')
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [reservationDisplayMode, setReservationDisplayMode] = useState<ReservationDisplayMode>('all')
  const [date, setDate] = useState(toYmd(new Date()))
  const [weekStart, setWeekStart] = useState(startOfWeek(toYmd(new Date())))
  const [resources, setResources] = useState<ReservationResource[]>([])
  const [resourceId, setResourceId] = useState('')
  const [menuId, setMenuId] = useState('')
  const [menus, setMenus] = useState<ReservationMenu[]>([])
  const [schedules, setSchedules] = useState<ReservationSchedule[]>([])
  const [slots, setSlots] = useState<ReservationSlotWithAvailability[]>([])
  const [slotsByDate, setSlotsByDate] = useState<Record<string, ReservationSlotWithAvailability[]>>({})
  const [reservations, setReservations] = useState<ReservationResponse[]>([])
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)
  const [selectedReservation, setSelectedReservation] = useState<ReservationResponse | null>(null)
  const [externalSources, setExternalSources] = useState<AdminExternalSource[]>([])
  const [orphanedReservations, setOrphanedReservations] = useState<OrphanedReservationItem[]>([])
  const [orphanedMaintenanceResult, setOrphanedMaintenanceResult] = useState<OrphanedCancelResponse | null>(null)
  const [showExternalDetails, setShowExternalDetails] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [showResourceForm, setShowResourceForm] = useState(false)
  const [showMenuForm, setShowMenuForm] = useState(false)
  const [showScheduleForm, setShowScheduleForm] = useState(false)
  const [providerConfig, setProviderConfig] = useState<ApiProviderConfig | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const visibleDates = viewMode === 'week'
    ? Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
    : monthDates(date)

  const selectedDateExternalSources = externalSources.filter((source) => {
    const text = [source.receivedAt, source.rawText, source.parsedPayload, source.lastError].filter(Boolean).join(' ')
    return text.includes(date) || text.includes(date.replaceAll('-', '/'))
  })

  const load = useCallback(async (nextResourceId = resourceId, nextDate = date) => {
    setLoading(true)
    setError('')
    try {
      const allResources = await apiData<ReservationResource[]>('/api/reservation-resources')
      const fallbackResourceId = allResources.find((resource) => resource.isActive)?.id ?? allResources[0]?.id ?? ''
      const resolvedResourceId = nextResourceId || fallbackResourceId
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
      setMenuId((current) => {
        if (current && nextMenus.some((menu) => menu.id === current)) return current
        return nextMenus.find((menu) => menu.isActive)?.id ?? nextMenus[0]?.id ?? ''
      })
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

  const loadProviderConfig = useCallback(async () => {
    try {
      const res = await api.providerConfig.get()
      if (res.success) setProviderConfig(res.data)
    } catch {
      // Provider config is optional for this admin page. Keep existing labels if it fails.
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    loadProviderConfig()
  }, [loadProviderConfig])

  const runSaving = async (fn: () => Promise<{ resourceId?: string } | void>, success: string) => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const result = await fn()
      const reloadResourceId = result?.resourceId ?? resourceId
      if (success) setMessage(success)
      await load(reloadResourceId, date)
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

  const changeResource = (nextResourceId: string) => {
    setResourceId(nextResourceId)
    setMenuId('')
    setMenus([])
    setSchedules([])
    setSlots([])
    setSlotsByDate({})
    setSelectedSlotId(null)
    setSelectedReservation(null)
    void load(nextResourceId, date)
  }

  const generateSlots = async (formData: FormData) => {
    const dateFrom = String(formData.get('dateFrom') || date)
    const dateTo = String(formData.get('dateTo') || date)
    if (!resourceId) throw new Error('予約対象を選択してください')
    if (!menuId) throw new Error('メニューを選択してください')
    await apiData<ReservationSlot[]>('/api/reservation-slots/generate', {
      method: 'POST',
      body: JSON.stringify({ resourceId, dateFrom, dateTo }),
    })
  }

  const deleteSlots = async (formData: FormData) => {
    const dateFrom = String(formData.get('dateFrom') || date)
    const dateTo = String(formData.get('dateTo') || date)
    if (!resourceId) throw new Error('予約対象を選択してください')
    if (!confirm(`${dateFrom} から ${dateTo} の未予約Slotを削除します。予約があるSlotは残します。実行しますか？`)) {
      throw new Error('Slot削除をキャンセルしました')
    }
    const query = new URLSearchParams({ resourceId, dateFrom, dateTo })
    const result = await apiData<{ deletedCount: number; skippedCount: number }>(`/api/reservation-slots?${query}`, {
      method: 'DELETE',
    })
    setMessage(`Slotを${result.deletedCount}件削除しました。予約ありなどで残したSlot: ${result.skippedCount}件`)
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

  const loadOrphanedReservations = async (limit = 100) => {
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const result = await apiData<OrphanedReservationsResponse>(
        `/api/reservations/maintenance/orphaned?${new URLSearchParams({ limit: String(limit) })}`,
      )
      setOrphanedReservations(result.reservations)
      setOrphanedMaintenanceResult(null)
      setMessage(`孤立予約を${result.count}件確認しました`)
    } catch (err) {
      setError(err instanceof Error ? err.message : '孤立予約の確認に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const cancelOrphanedReservations = async (dryRun: boolean, limit = 100) => {
    if (!dryRun && !confirm('既存Resourceに紐づかない有効予約を一括キャンセルします。物理削除ではありません。実行しますか？')) return
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const result = await apiData<OrphanedCancelResponse>('/api/reservations/maintenance/orphaned/cancel', {
        method: 'POST',
        body: JSON.stringify({ dryRun, limit }),
      })
      setOrphanedMaintenanceResult(result)
      if (result.reservations) setOrphanedReservations(result.reservations)
      setMessage(
        dryRun
          ? `dry run: 対象${result.count ?? result.scanned ?? 0}件を確認しました`
          : `孤立予約を${result.cancelled}件キャンセルしました。失敗: ${result.failed}件`,
      )
      if (!dryRun) await load(resourceId, date)
    } catch (err) {
      setError(err instanceof Error ? err.message : '孤立予約の一括キャンセルに失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const startGoogleOAuth = async (formData: FormData) => {
    const calendarId = String(formData.get('calendarId') || 'primary')
    const returnTo = window.location.href
    const result = await apiData<{ url: string }>(
      `/api/reservations/google-calendar/oauth-url?${new URLSearchParams({ calendarId, returnTo })}`,
    )
    window.location.assign(result.url)
  }

  return (
    <div>
      <Header
        title="予約管理"
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

      {mode === 'overview' ? (
        <section className="space-y-4">
          <ReservationOverviewToolbar
            date={date}
            resourceId={resourceId}
            resources={resources}
            onDateChange={(nextDate) => changeDate(nextDate)}
            onResourceChange={changeResource}
            onReload={() => load(resourceId, date)}
            onOpenCalendar={() => setCalendarOpen(true)}
            loading={loading}
          />
          <ReservationDaySummary
            date={date}
            resource={resources.find((resource) => resource.id === resourceId)}
            slots={slots}
            reservations={reservations}
          />
          {calendarOpen && (
            <CalendarModal onClose={() => setCalendarOpen(false)}>
              <CalendarCard
                date={date}
                viewMode={viewMode}
                visibleDates={visibleDates}
                slotsByDate={slotsByDate}
                onSelectDate={(nextDate) => {
                  changeDate(nextDate)
                  setCalendarOpen(false)
                }}
                onMoveRange={moveRange}
                onSetViewMode={setViewMode}
              />
            </CalendarModal>
          )}
          <ReservationListPanel
            date={date}
            mode="all"
            reservations={reservations}
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
          menuId={menuId}
          providerConfig={providerConfig}
          menus={menus}
          schedules={schedules}
          date={date}
          viewMode={viewMode}
          visibleDates={visibleDates}
          slotsByDate={slotsByDate}
          loading={loading || saving}
          onSelectDate={(nextDate) => changeDate(nextDate)}
          onMoveRange={moveRange}
          onSetViewMode={setViewMode}
          onSelectResource={changeResource}
          onSelectMenu={setMenuId}
          onCreateResource={(formData) => runSaving(async () => {
            const resource = await apiData<ReservationResource>('/api/reservation-resources', {
              method: 'POST',
              body: JSON.stringify(resourcePayload(formData)),
            })
            setResourceId(resource.id)
            return { resourceId: resource.id }
          }, '予約対象を作成しました')}
          onUpdateResource={(resource, formData) => runSaving(async () => {
            await apiData<ReservationResource>(`/api/reservation-resources/${encodeURIComponent(resource.id)}`, {
              method: 'PUT',
              body: JSON.stringify(resourcePayload(formData, true)),
            })
          }, '予約対象を保存しました')}
          onDeleteResource={(resource) => runSaving(async () => {
            if (!confirm(`${resource.name} を削除しますか？過去予約は残し、今後の選択肢から外します。`)) return
            await apiData<ReservationResource>(`/api/reservation-resources/${encodeURIComponent(resource.id)}`, {
              method: 'DELETE',
            })
            const nextResourceId = resources.find((item) => item.id !== resource.id && item.isActive)?.id ?? ''
            setResourceId(nextResourceId)
            return { resourceId: nextResourceId }
          }, '予約対象を削除しました')}
          onCreateMenu={(formData) => runSaving(async () => {
            if (!resourceId) throw new Error('予約対象を選択してください')
            const menu = await apiData<ReservationMenu>(`/api/reservation-resources/${encodeURIComponent(resourceId)}/menus`, {
              method: 'POST',
              body: JSON.stringify(menuPayload(formData)),
            })
            setMenuId(menu.id)
          }, 'メニューを作成しました')}
          onUpdateMenu={(menu, formData) => runSaving(async () => {
            await apiData<ReservationMenu>(`/api/reservation-resources/${encodeURIComponent(menu.resourceId)}/menus/${encodeURIComponent(menu.id)}`, {
              method: 'PUT',
              body: JSON.stringify(menuPayload(formData, true)),
            })
          }, 'メニューを保存しました')}
          onDeleteMenu={(menu) => runSaving(async () => {
            if (!confirm(`${menu.name} を削除しますか？過去予約は残し、今後の選択肢から外します。`)) return
            await apiData<ReservationMenu>(`/api/reservation-resources/${encodeURIComponent(menu.resourceId)}/menus/${encodeURIComponent(menu.id)}`, {
              method: 'DELETE',
            })
            setMenuId((current) => current === menu.id ? '' : current)
          }, 'メニューを削除しました')}
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
          onDeleteSchedule={(schedule) => runSaving(async () => {
            if (!confirm(`${dayLabels[schedule.dayOfWeek]} ${schedule.startTime}-${schedule.endTime} のScheduleを削除しますか？既に作成済みのSlotや予約は削除されません。`)) return
            await apiData<ReservationSchedule>(`/api/reservation-resources/${encodeURIComponent(schedule.resourceId)}/schedules/${encodeURIComponent(schedule.id)}`, {
              method: 'DELETE',
            })
          }, '営業時間を削除しました')}
          onGenerateSlots={(formData) => runSaving(() => generateSlots(formData), '予約枠を生成しました')}
          onDeleteSlots={(formData) => runSaving(() => deleteSlots(formData), '')}
          onGoogleOAuth={(formData) => runSaving(() => startGoogleOAuth(formData), 'Google Calendar接続を開始しました')}
          orphanedReservations={orphanedReservations}
          orphanedMaintenanceResult={orphanedMaintenanceResult}
          onLoadOrphanedReservations={loadOrphanedReservations}
          onCancelOrphanedReservations={cancelOrphanedReservations}
          showResourceForm={showResourceForm}
          showMenuForm={showMenuForm}
          showScheduleForm={showScheduleForm}
          onToggleResourceForm={() => setShowResourceForm((value) => !value)}
          onToggleMenuForm={() => setShowMenuForm((value) => !value)}
          onToggleScheduleForm={() => setShowScheduleForm((value) => !value)}
        />
      )}

      {loading && <div className="mt-4 text-sm text-gray-400">読み込み中...</div>}
    </div>
  )
}

function ReservationOverviewToolbar({
  date,
  resourceId,
  resources,
  onDateChange,
  onResourceChange,
  onReload,
  onOpenCalendar,
  loading,
}: {
  date: string
  resourceId: string
  resources: ReservationResource[]
  onDateChange: (date: string) => void
  onResourceChange: (resourceId: string) => void
  onReload: () => void
  onOpenCalendar: () => void
  loading: boolean
}) {
  return (
    <div className="sticky top-0 z-30 -mx-4 border-y border-gray-100 bg-white/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:shadow-sm">
      <div className="flex gap-2 overflow-x-auto">
        <button onClick={onOpenCalendar} className="shrink-0 rounded-full bg-blue-600 px-4 py-2 text-sm font-bold text-white">
          カレンダー
        </button>
        <input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} className="shrink-0 rounded-full border border-gray-300 px-3 py-2 text-sm" />
        <select value={resourceId} onChange={(event) => onResourceChange(event.target.value)} className="min-w-48 shrink-0 rounded-full border border-gray-300 px-3 py-2 text-sm">
          {resources.length === 0 && <option value="">未登録</option>}
          {resources.filter((resource) => resource.isActive).map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
        </select>
        <button onClick={onReload} disabled={loading} className="shrink-0 rounded-full border border-gray-200 bg-white px-4 py-2 text-sm font-bold text-gray-700 disabled:opacity-50">
          更新
        </button>
      </div>
    </div>
  )
}

function ReservationDaySummary({
  date,
  resource,
  slots,
  reservations,
}: {
  date: string
  resource?: ReservationResource
  slots: ReservationSlotWithAvailability[]
  reservations: ReservationResponse[]
}) {
  const activeReservations = reservations.filter(isActiveReservation)
  const totalPeople = activeReservations.reduce((sum, reservation) => sum + reservation.totalPeople, 0)
  const remaining = slots.reduce((sum, slot) => sum + Math.max(0, slot.availability.remainingCapacity), 0)
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <p className="text-sm font-bold text-gray-900">{resource?.name ?? '予約対象未選択'} / {date}</p>
      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        <DailyMetric label="予約" value={`${activeReservations.length}件`} />
        <DailyMetric label="人数" value={`${totalPeople}名`} />
        <DailyMetric label="枠数" value={`${slots.length}枠`} />
        <DailyMetric label="残数合計" value={`${remaining}`} />
      </div>
    </div>
  )
}

function DailyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-blue-50 px-3 py-2">
      <p className="text-[11px] font-bold text-blue-700">{label}</p>
      <p className="mt-0.5 text-lg font-black text-blue-950">{value}</p>
    </div>
  )
}

function CalendarModal({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-3 shadow-xl sm:mx-auto sm:max-w-5xl sm:rounded-2xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-base font-bold text-gray-900">カレンダーから日付を選択</h3>
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold text-gray-700">閉じる</button>
        </div>
        {children}
      </div>
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
  headerControls,
}: {
  date: string
  viewMode: ViewMode
  visibleDates: string[]
  slotsByDate: Record<string, ReservationSlotWithAvailability[]>
  onSelectDate: (date: string, slotId?: string) => void
  onMoveRange: (direction: -1 | 1) => void
  onSetViewMode: (mode: ViewMode) => void
  headerControls?: React.ReactNode
}) {
  const rangeLabel = formatRangeLabel(viewMode, date, visibleDates)
  return (
    <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          {headerControls}
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => onMoveRange(-1)} className="rounded-full border border-gray-200 px-3 py-2 text-sm font-bold hover:bg-gray-50">←</button>
            <div className="min-w-32 rounded-full bg-blue-50 px-4 py-2 text-center text-sm font-bold text-blue-900">{rangeLabel}</div>
            <button onClick={() => onMoveRange(1)} className="rounded-full border border-gray-200 px-3 py-2 text-sm font-bold hover:bg-gray-50">→</button>
            <div className="ml-0 flex rounded-full bg-gray-100 p-1 sm:ml-2">
              <button onClick={() => onSetViewMode('week')} className={`rounded-full px-3 py-1.5 text-xs font-bold ${viewMode === 'week' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'}`}>1週間</button>
              <button onClick={() => onSetViewMode('month')} className={`rounded-full px-3 py-1.5 text-xs font-bold ${viewMode === 'month' ? 'bg-white text-green-700 shadow-sm' : 'text-gray-500'}`}>1か月</button>
            </div>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50 text-center text-[11px] font-bold text-gray-400">
        {dayLabels.map((label) => <div key={label} className="py-2">{label}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-px bg-gray-100 p-px">
        {visibleDates.map((d) => {
          const slots = slotsByDate[d] ?? []
          const bestSlot = slots.find((slot) => slot.availability.available) ?? slots[0]
          const label = bestSlot ? slotLabel(bestSlot) : { mark: '-', className: 'text-gray-400 bg-gray-50', text: '未生成' }
          const summary = dateSummary(slots)
          const isSelected = d === date
          const isOtherMonth = viewMode === 'month' && d.slice(0, 7) !== date.slice(0, 7)
          return (
            <button
              key={d}
              onClick={() => onSelectDate(d)}
              className={`min-h-24 bg-white p-2 text-left transition hover:bg-blue-50 sm:min-h-28 ${isSelected ? 'ring-2 ring-inset ring-blue-500' : ''} ${isOtherMonth ? 'opacity-45' : ''}`}
            >
              <div className="flex items-center justify-between">
                <span className={`grid h-7 w-7 place-items-center rounded-full text-sm font-bold ${isSelected ? 'bg-blue-600 text-white' : 'text-gray-800'}`}>
                  {Number(d.slice(-2))}
                </span>
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${label.className}`}>{label.mark}</span>
              </div>
              <p className="mt-3 text-xs font-bold text-gray-700">{label.text}</p>
              <p className="mt-1 text-[11px] text-gray-400">{summary.slots}枠 / 予約{summary.reserved} / 残{summary.remaining}</p>
              <div className="mt-2 hidden gap-1 sm:flex">
                {slots.slice(0, 4).map((slot) => (
                  <span key={slot.id} className={`h-1.5 flex-1 rounded-full ${slot.availability.available ? 'bg-blue-300' : 'bg-red-300'}`} />
                ))}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function ReservationDisplayTabs({
  mode,
  onChange,
}: {
  mode: ReservationDisplayMode
  onChange: (mode: ReservationDisplayMode) => void
}) {
  const items: Array<{ value: ReservationDisplayMode; label: string }> = [
    { value: 'all', label: 'All' },
    { value: 'line', label: 'LINEのみ' },
    { value: 'jalan', label: 'じゃらんのみ' },
    { value: 'time', label: '時間ごと' },
  ]
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-2 shadow-sm">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map((item) => {
          const active = mode === item.value
          return (
            <button
              key={item.value}
              type="button"
              onClick={() => onChange(item.value)}
              className={`rounded-lg px-3 py-2 text-sm font-bold transition ${
                active ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'
              }`}
            >
              {item.label}
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
        <h2 className="text-base font-bold text-gray-900">選択日の予約枠・予約客</h2>
        <p className="mt-1 text-xs text-gray-500">枠を開くと、その枠の予約客を下に展開します。枠調整は各枠の一番下です。</p>
      </div>
      <div className="divide-y divide-gray-100">
	        {slots.length === 0 ? <p className="p-6 text-sm text-gray-400">予約枠がありません。予約設計から生成してください。</p> : slots.map((slot) => {
	          const label = slotLabel(slot)
	          const slotReservations = reservations.filter((reservation) => reservation.slotId === slot.id)
	          const activeReservations = slotReservations.filter((reservation) => reservation.status !== 'cancelled' && reservation.status !== 'no_show')
	          const count = activeReservations.length
	          const totalPeople = activeReservations.reduce((sum, reservation) => sum + reservation.totalPeople, 0)
	          const capacityPeople = activeReservations.reduce((sum, reservation) => sum + reservation.capacityPeople, 0)
	          const adultCount = activeReservations.reduce((sum, reservation) => sum + reservation.adultCount, 0)
	          const childCount = activeReservations.reduce((sum, reservation) => sum + reservation.childCount, 0)
	          const infantCount = activeReservations.reduce((sum, reservation) => sum + reservation.infantCount, 0)
	          const underThreeCount = activeReservations.reduce((sum, reservation) => sum + reservation.underThreeCount, 0)
	          const open = selectedSlotId === slot.id
	          return (
	            <details key={slot.id} open={open} className="group">
              <summary onClick={(event) => { event.preventDefault(); onSelect(slot.id) }} className="cursor-pointer p-3 hover:bg-gray-50">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">{formatTime(slot.startAt)} - {formatTime(slot.endAt)}</p>
                    <p className="mt-1 text-xs text-gray-500">LINE {slot.lineReservedCount}/{slot.lineCapacity ?? slot.totalCapacity} / 外部 {slot.externalReservedCount}/{slot.externalCapacity ?? slot.totalCapacity}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${label.className}`}>{label.mark} {label.text}</span>
                </div>
                <div className="mt-3 min-w-0">
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <SlotMetric label="組数" value={`${count}組`} />
                    <SlotMetric label="人数" value={`${totalPeople}名`} />
                    <SlotMetric label="枠消費" value={`${capacityPeople}/${slot.totalCapacity}`} />
                  </div>
                  <p className="mt-2 text-xs text-gray-500">内訳: 大人{adultCount} / 小学生{childCount} / 幼児{infantCount} / 3歳以下{underThreeCount}</p>
                </div>
              </summary>
              <div className="bg-white px-4 pb-4">
                <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-bold text-gray-900">予約客</p>
                    <span className="text-xs text-gray-500">{count}件</span>
                  </div>
                  {slotReservations.length === 0 ? (
                    <p className="mt-2 text-sm text-gray-400">この枠の予約はありません。</p>
                  ) : (
                    <div className="mt-2 grid gap-2">
                      {slotReservations.map((reservation) => (
                        <div key={reservation.id} className="rounded-lg border border-gray-200 bg-white p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-gray-900">{reservation.customerName || reservation.title}</p>
                              <p className="mt-1 text-xs text-gray-500">{reservation.customerPhone || '電話未登録'}</p>
                            </div>
                            <StatusBadge status={reservation.status} />
                          </div>
                          <p className="mt-1 text-xs text-gray-500">
                            {reservation.totalPeople}名 / 大人{reservation.adultCount}・小学生{reservation.childCount}・幼児{reservation.infantCount}・3歳以下{reservation.underThreeCount}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <details className="mt-3 rounded-lg border border-gray-200 bg-white">
                  <summary className="cursor-pointer px-3 py-2 text-sm font-bold text-gray-700">枠調整</summary>
                  <form action={(formData) => onSaveSlot(slot, formData)} className="grid gap-3 border-t border-gray-100 bg-gray-50 p-3 sm:grid-cols-6">
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
              </div>
            </details>
          )
        })}
      </div>
    </div>
  )
}

function ReservationListPanel({
  date,
  mode,
  reservations,
  selectedReservation,
  onSelect,
  onCancel,
  saving,
}: {
  date: string
  mode: Exclude<ReservationDisplayMode, 'time'>
  reservations: ReservationResponse[]
  selectedReservation: ReservationResponse | null
  onSelect: (reservation: ReservationResponse | null) => void
  onCancel: (reservation: ReservationResponse) => void
  saving: boolean
}) {
  const filtered = reservations
    .filter(isActiveReservation)
    .filter((reservation) => {
      if (mode === 'all') return true
      return reservation.source === mode
    })
  const grouped = filtered.reduce<Record<string, ReservationResponse[]>>((acc, reservation) => {
    const key = formatTime(reservation.startAt)
    acc[key] = [...(acc[key] ?? []), reservation]
    return acc
  }, {})
  const times = Object.keys(grouped).sort()
  const title = mode === 'all' ? 'All' : mode === 'line' ? 'LINEのみ' : 'じゃらんのみ'

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 p-4">
        <h2 className="text-base font-bold text-gray-900">{title} の予約</h2>
        <p className="text-xs text-gray-500">{date} / {filtered.length}件</p>
      </div>
      <div className="p-4">
        <div className="space-y-3">
          {times.length === 0 ? <p className="text-sm text-gray-400">予約はありません。</p> : times.map((time) => {
            const group = grouped[time]
            const people = group.reduce((sum, reservation) => sum + reservation.totalPeople, 0)
            return (
              <section key={time} className="rounded-lg border border-gray-200">
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="font-bold text-gray-900">{time}</p>
                  <p className="text-xs text-gray-500">{group.length}組 / {people}名</p>
                </div>
                <div className="divide-y divide-gray-100">
                  {group.map((reservation) => (
                    <button key={reservation.id} onClick={() => onSelect(reservation)} className="w-full p-3 text-left hover:bg-gray-50">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-gray-900">{reservation.customerName || reservation.title}</p>
                          <p className="mt-1 text-xs text-gray-500">
                            {reservation.totalPeople}名 / 大人{reservation.adultCount}・小学生{reservation.childCount}・幼児{reservation.infantCount}・3歳以下{reservation.underThreeCount}
                          </p>
                          {reservationEntryInfo(reservation).detail && <p className="mt-1 text-xs text-blue-700">{reservationEntryInfo(reservation).detail}</p>}
                          {reservation.source === 'jalan' && <p className="mt-1 text-xs font-semibold text-gray-700">{formatPriceSummary(reservation)}</p>}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <span className="rounded-full bg-blue-50 px-2 py-1 text-[11px] font-bold text-blue-700">{reservationEntryInfo(reservation).label}</span>
                          <StatusBadge status={reservation.status} />
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )
          })}
        </div>
      </div>
      {selectedReservation && (
        <ReservationDetailModal
          reservation={selectedReservation}
          saving={saving}
          onClose={() => onSelect(null)}
          onCancel={onCancel}
        />
      )}
    </div>
  )
}

function ReservationDetailModal({
  reservation,
  saving,
  onClose,
  onCancel,
}: {
  reservation: ReservationResponse
  saving: boolean
  onClose: () => void
  onCancel: (reservation: ReservationResponse) => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:mx-auto sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{reservation.customerName || reservation.title}</h3>
            <p className="mt-1 text-xs text-gray-500">{reservationEntryInfo(reservation).label} / {reservation.status}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold text-gray-700">閉じる</button>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <Info label="媒体" value={reservationEntryInfo(reservation).label} />
          <Info label="流入元" value={reservationEntryInfo(reservation).detail || '-'} />
          <Info label="時間" value={`${formatTime(reservation.startAt)} - ${formatTime(reservation.endAt)}`} />
          <Info label="電話" value={reservation.customerPhone || '-'} />
          <Info label="メール" value={reservation.customerEmail || '-'} />
          <Info label="人数" value={`${reservation.totalPeople}名 大人${reservation.adultCount} / 小学生${reservation.childCount} / 幼児${reservation.infantCount} / 3歳以下${reservation.underThreeCount}`} />
          <Info label="枠消費" value={`${reservation.capacityPeople}枠`} />
          {reservation.source === 'jalan' && <Info label="料金" value={formatPriceDetails(reservation)} />}
          <Info label="状態" value={reservation.status} />
          <Info label="外部ID" value={reservation.externalReservationId || '-'} />
        </dl>
        {(reservation.status === 'pending' || reservation.status === 'confirmed') && (
          <button disabled={saving} onClick={() => onCancel(reservation)} className="mt-4 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            キャンセル
          </button>
        )}
      </div>
    </div>
  )
}

function SlotMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg bg-gray-50 px-2 py-2 text-center sm:px-3">
      <p className="text-[11px] font-medium text-gray-500">{label}</p>
      <p className="mt-0.5 truncate text-sm font-bold text-gray-900">{value}</p>
    </div>
  )
}

function SettingsPanel(props: {
  resources: ReservationResource[]
  resourceId: string
  menuId: string
  providerConfig: ApiProviderConfig | null
  menus: ReservationMenu[]
  schedules: ReservationSchedule[]
  date: string
  viewMode: ViewMode
  visibleDates: string[]
  slotsByDate: Record<string, ReservationSlotWithAvailability[]>
  loading: boolean
  onSelectDate: (date: string, slotId?: string) => void
  onMoveRange: (direction: -1 | 1) => void
  onSetViewMode: (mode: ViewMode) => void
  onSelectResource: (resourceId: string) => void
  onSelectMenu: (menuId: string) => void
  onCreateResource: (formData: FormData) => void
  onUpdateResource: (resource: ReservationResource, formData: FormData) => void
  onDeleteResource: (resource: ReservationResource) => void
  onCreateMenu: (formData: FormData) => void
  onUpdateMenu: (menu: ReservationMenu, formData: FormData) => void
  onDeleteMenu: (menu: ReservationMenu) => void
  onCreateSchedule: (formData: FormData) => void
  onUpdateSchedule: (schedule: ReservationSchedule, formData: FormData) => void
  onDeleteSchedule: (schedule: ReservationSchedule) => void
  onGenerateSlots: (formData: FormData) => void
  onDeleteSlots: (formData: FormData) => void
  onGoogleOAuth: (formData: FormData) => void
  orphanedReservations: OrphanedReservationItem[]
  orphanedMaintenanceResult: OrphanedCancelResponse | null
  onLoadOrphanedReservations: (limit?: number) => void | Promise<void>
  onCancelOrphanedReservations: (dryRun: boolean, limit?: number) => void | Promise<void>
  showResourceForm: boolean
  showMenuForm: boolean
  showScheduleForm: boolean
  onToggleResourceForm: () => void
  onToggleMenuForm: () => void
  onToggleScheduleForm: () => void
}) {
  const currentResource = props.resources.find((resource) => resource.id === props.resourceId)
  const currentMenu = props.menus.find((menu) => menu.id === props.menuId)
  const activeResources = props.resources.filter((resource) => resource.isActive)
  const activeMenus = props.menus.filter((menu) => menu.isActive)
  const today = toYmd(new Date())
  const nextWeek = addDays(today, 6)
  const nextMonth = addDays(today, 30)
  return (
    <div className="space-y-4">
      <CalendarCard
        date={props.date}
        viewMode={props.viewMode}
        visibleDates={props.visibleDates}
        slotsByDate={props.slotsByDate}
        onSelectDate={props.onSelectDate}
        onMoveRange={props.onMoveRange}
        onSetViewMode={props.onSetViewMode}
      />

      <SettingsCard title="追加するResourceとMenu">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Resource">
            <select value={props.resourceId} onChange={(event) => props.onSelectResource(event.target.value)} className="input">
              {activeResources.length === 0 && <option value="">未登録</option>}
              {activeResources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
            </select>
          </Field>
          <Field label="Menu">
            <select value={props.menuId} onChange={(event) => props.onSelectMenu(event.target.value)} className="input" disabled={!props.resourceId}>
              {activeMenus.length === 0 && <option value="">未登録</option>}
              {activeMenus.map((menu) => <option key={menu.id} value={menu.id}>{menu.name}</option>)}
            </select>
          </Field>
        </div>
      </SettingsCard>

      <ReservationEntryUrlCard
        resources={activeResources}
        menus={activeMenus}
        resourceId={props.resourceId}
        menuId={props.menuId}
        providerConfig={props.providerConfig}
      />

      <SettingsCard title="Slotの追加・削除">
        {!props.resourceId && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">先にResourceを選択してください。</p>}
        {!props.menuId && props.resourceId && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">先にMenuを選択してください。</p>}
        <div className="grid gap-4 lg:grid-cols-2">
          <form action={props.onGenerateSlots} className="rounded-lg border border-green-100 bg-green-50 p-3">
            <p className="text-sm font-bold text-green-900">Slot一括追加</p>
            <p className="mt-1 text-xs text-green-800">選択ResourceのScheduleに合う日だけSlotを作成します。</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="開始日"><input name="dateFrom" type="date" defaultValue={props.date || today} className="input" /></Field>
              <Field label="終了日"><input name="dateTo" type="date" defaultValue={nextWeek} className="input" /></Field>
            </div>
            <p className="mt-2 text-xs text-green-800">目安: 1週間なら {today} - {nextWeek}、1か月なら {today} - {nextMonth}</p>
            <button disabled={props.loading || !props.resourceId || !props.menuId} className="btn-primary mt-3">Slot追加</button>
          </form>
          <form action={props.onDeleteSlots} className="rounded-lg border border-red-100 bg-red-50 p-3">
            <p className="text-sm font-bold text-red-900">Slot一括削除</p>
            <p className="mt-1 text-xs text-red-800">指定範囲の未予約Slotだけ削除します。予約済みSlotは残ります。</p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Field label="開始日"><input name="dateFrom" type="date" defaultValue={props.date || today} className="input" /></Field>
              <Field label="終了日"><input name="dateTo" type="date" defaultValue={props.date || today} className="input" /></Field>
            </div>
            <button disabled={props.loading || !props.resourceId} className="mt-3 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">未予約Slot削除</button>
          </form>
        </div>
      </SettingsCard>

      <OrphanedReservationsMaintenanceCard
        loading={props.loading}
        items={props.orphanedReservations}
        result={props.orphanedMaintenanceResult}
        onLoad={() => props.onLoadOrphanedReservations(100)}
        onDryRun={() => props.onCancelOrphanedReservations(true, 100)}
        onCancel={() => props.onCancelOrphanedReservations(false, 100)}
      />

      <details>
        <summary className="cursor-pointer rounded-xl border border-gray-200 bg-white p-4 text-base font-bold text-gray-900 shadow-sm">Option: Resource、Menu、Scheduleの追加・削除</summary>
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="grid gap-4 xl:grid-cols-[1fr_1fr_1.4fr]">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold text-gray-900">Resource</h3>
                  <button type="button" onClick={props.onToggleResourceForm} className="rounded-full border border-gray-200 px-3 py-1 text-sm font-bold text-gray-700">
                    {props.showResourceForm ? '閉じる' : '+'}
                  </button>
                </div>
                <Field label="選択">
                  <select value={props.resourceId} onChange={(event) => props.onSelectResource(event.target.value)} className="input">
                    {activeResources.length === 0 && <option value="">未登録</option>}
                    {activeResources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
                  </select>
                </Field>
                {currentResource ? (
                  <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                    <p className="font-semibold text-gray-900">{currentResource.name}</p>
                    <p className="mt-1">標準{currentResource.defaultDurationMinutes}分 / 総枠{currentResource.defaultCapacity}</p>
                    <p className="mt-1 text-xs text-gray-500">LINE {currentResource.defaultLineCapacity ?? '-'} / 外部 {currentResource.defaultExternalCapacity ?? '-'}</p>
                  </div>
                ) : <p className="mt-3 text-sm text-gray-400">Resourceがありません。</p>}
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold text-gray-900">Menu</h3>
                  <button type="button" onClick={props.onToggleMenuForm} className="rounded-full border border-gray-200 px-3 py-1 text-sm font-bold text-gray-700" disabled={!props.resourceId}>
                    {props.showMenuForm ? '閉じる' : '+'}
                  </button>
                </div>
                <Field label="選択">
                  <select value={props.menuId} onChange={(event) => props.onSelectMenu(event.target.value)} className="input" disabled={!props.resourceId}>
                    {activeMenus.length === 0 && <option value="">未登録</option>}
                    {activeMenus.map((menu) => <option key={menu.id} value={menu.id}>{menu.name}</option>)}
                  </select>
                </Field>
                {currentMenu ? (
                  <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                    <p className="font-semibold text-gray-900">{currentMenu.name}</p>
                    <p className="mt-1">{currentMenu.durationMinutes}分 / {currentMenu.minPeople}-{currentMenu.maxPeople ?? '上限なし'}名</p>
                    <p className="mt-1 text-xs text-gray-500">大人{currentMenu.priceAdult ?? '-'} / 小学生{currentMenu.priceChild ?? '-'} / 幼児{currentMenu.priceInfant ?? '-'} / 3歳以下{currentMenu.priceUnderThree ?? '-'}</p>
                  </div>
                ) : <p className="mt-3 text-sm text-gray-400">Menuがありません。</p>}
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-sm font-bold text-gray-900">Schedule</h3>
                  <button type="button" onClick={props.onToggleScheduleForm} className="rounded-full border border-gray-200 px-3 py-1 text-sm font-bold text-gray-700" disabled={!props.resourceId}>
                    {props.showScheduleForm ? '閉じる' : '+'}
                  </button>
                </div>
                <div className="mt-2 grid gap-2">
                  {props.schedules.length === 0 ? <p className="text-sm text-gray-400">Scheduleがありません。</p> : props.schedules.map((schedule) => (
                    <div key={schedule.id} className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-semibold text-gray-900">{dayLabels[schedule.dayOfWeek]} {schedule.startTime}-{schedule.endTime}</p>
                        {!schedule.isActive && <span className="rounded-md bg-gray-200 px-2 py-0.5 text-xs text-gray-600">停止中</span>}
                      </div>
                    <p className="mt-1 text-xs text-gray-500">
                      {schedule.slotIntervalMinutes}分間隔 / 総枠{schedule.defaultCapacity} / LINE {schedule.defaultLineCapacity ?? currentResource?.defaultLineCapacity ?? '-'} / 外部 {schedule.defaultExternalCapacity ?? currentResource?.defaultExternalCapacity ?? '-'}
                    </p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {(currentResource || props.showResourceForm || currentMenu || props.showMenuForm || props.showScheduleForm) && (
            <div className="grid gap-4 xl:grid-cols-3">
              <SettingsCard title="Resource編集">
                {props.showResourceForm && (
                  <form action={props.onCreateResource} className="space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <Field label="名前"><input name="name" className="input" placeholder="ブルーベリー摘み取り" /></Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="標準時間"><input name="defaultDurationMinutes" type="number" defaultValue={60} className="input" /></Field>
                      <Field label="総枠"><input name="defaultCapacity" type="number" defaultValue={20} className="input" /></Field>
                    </div>
                    <button disabled={props.loading} className="btn-primary">Resource追加</button>
                  </form>
                )}
                {currentResource && (
                  <ResourceEditor
                    resource={currentResource}
                    loading={props.loading}
                    onSubmit={props.onUpdateResource}
                    onDelete={props.onDeleteResource}
                  />
                )}
                <form action={props.onGoogleOAuth} className="mt-4 border-t border-gray-100 pt-4">
                  <Field label="Google Calendar ID"><input name="calendarId" defaultValue="primary" className="input" /></Field>
                  <button disabled={props.loading} className="btn-secondary mt-3">Google Calendar接続</button>
                </form>
              </SettingsCard>

              <SettingsCard title="Menu編集">
                {!props.resourceId && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">先にResourceを選択してください。</p>}
                {props.showMenuForm && (
                  <form action={props.onCreateMenu} className="space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
                    <Field label="名前"><input name="name" className="input" placeholder="食べ放題60分" /></Field>
                    <Field label="説明"><input name="description" className="input" /></Field>
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="時間"><input name="durationMinutes" type="number" defaultValue={60} className="input" /></Field>
                      <Field label="最小人数"><input name="minPeople" type="number" defaultValue={1} className="input" /></Field>
                      <Field label="大人料金"><input name="priceAdult" type="number" className="input" /></Field>
                      <Field label="子ども料金"><input name="priceChild" type="number" className="input" /></Field>
                      <Field label="幼児料金"><input name="priceInfant" type="number" className="input" /></Field>
                      <Field label="3歳以下料金"><input name="priceUnderThree" type="number" defaultValue={0} className="input" /></Field>
                    </div>
                    <div className="grid gap-2 text-xs text-gray-600">
                      <label><input name="capacityCountAdult" type="checkbox" defaultChecked className="mr-2" />大人は枠を消費</label>
                      <label><input name="capacityCountChild" type="checkbox" defaultChecked className="mr-2" />子どもは枠を消費</label>
                      <label><input name="capacityCountInfant" type="checkbox" defaultChecked className="mr-2" />幼児は枠を消費</label>
                      <label><input name="capacityCountUnderThree" type="checkbox" className="mr-2" />3歳以下は枠を消費</label>
                    </div>
                    <button disabled={props.loading || !props.resourceId} className="btn-primary">Menu追加</button>
                  </form>
                )}
                {currentMenu && (
                  <MenuEditor
                    menu={currentMenu}
                    loading={props.loading}
                    onSubmit={props.onUpdateMenu}
                    onDelete={props.onDeleteMenu}
                  />
                )}
              </SettingsCard>

              <SettingsCard title="Schedule編集">
                {!props.resourceId && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">先にResourceを選択してください。</p>}
                {props.showScheduleForm && (
                  <form action={props.onCreateSchedule} className="space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
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
                        <Field label="総枠"><input name="defaultCapacity" type="number" defaultValue={currentResource?.defaultCapacity ?? 20} className="input" /></Field>
                        <Field label="LINE枠"><input name="defaultLineCapacity" type="number" defaultValue={currentResource?.defaultLineCapacity ?? ''} className="input" /></Field>
                        <Field label="外部枠"><input name="defaultExternalCapacity" type="number" defaultValue={currentResource?.defaultExternalCapacity ?? ''} className="input" /></Field>
                      </div>
                    <button disabled={props.loading || !props.resourceId} className="btn-primary">Schedule追加</button>
                  </form>
                )}
                <div className="mt-4 space-y-3">
                  {props.schedules.map((schedule) => (
                    <ScheduleEditor
                      key={schedule.id}
                      schedule={schedule}
                      loading={props.loading}
                      onSubmit={props.onUpdateSchedule}
                      onDelete={props.onDeleteSchedule}
                    />
                  ))}
                </div>
              </SettingsCard>
            </div>
          )}
        </div>
      </details>
    </div>
  )
}

function ReservationEntryUrlCard({
  resources,
  menus,
  resourceId,
  menuId,
  providerConfig,
}: {
  resources: ReservationResource[]
  menus: ReservationMenu[]
  resourceId: string
  menuId: string
  providerConfig: ApiProviderConfig | null
}) {
  const [channel, setChannel] = useState('google_map')
  const [ref, setRef] = useState('gmaps_2026')
  const [utmSource, setUtmSource] = useState('')
  const [utmMedium, setUtmMedium] = useState('')
  const [utmCampaign, setUtmCampaign] = useState('')
  const [copied, setCopied] = useState(false)
  const selectedResource = resources.find((resource) => resource.id === resourceId)
  const selectedMenu = menus.find((menu) => menu.id === menuId)
  const providerName = providerConfig?.shortName || providerConfig?.displayName || '予約'
  const bookingTitle = providerConfig?.reservation.title || '予約'
  const accentColor = providerConfig?.colors.primary || '#2563eb'
  const params = new URLSearchParams({
    page: 'book',
    mode: 'web',
    channel: channel || 'web',
  })
  if (resourceId) params.set('resourceId', resourceId)
  if (menuId) params.set('menuId', menuId)
  if (ref.trim()) params.set('ref', ref.trim())
  if (utmSource.trim()) params.set('utm_source', utmSource.trim())
  if (utmMedium.trim()) params.set('utm_medium', utmMedium.trim())
  if (utmCampaign.trim()) params.set('utm_campaign', utmCampaign.trim())
  const url = `${workerBaseUrl()}/?${params.toString()}`

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } catch {
      setCopied(false)
      window.prompt('このURLをコピーしてください', url)
    }
  }

  return (
    <SettingsCard title={`${bookingTitle} 導線URL`}>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <div className="space-y-3">
          <p className="text-sm text-gray-600">
            Google Map、Instagram、公式サイト、QRコード用の{providerName}向け予約URLを作成します。予約時の流入元は予約metadataに保存されます。
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="媒体">
              <select value={channel} onChange={(event) => setChannel(event.target.value)} className="input">
                <option value="google_map">Google Map</option>
                <option value="instagram">Instagram</option>
                <option value="website">公式サイト</option>
                <option value="qr">QRコード</option>
                <option value="flyer">チラシ</option>
                <option value="web">Web</option>
              </select>
            </Field>
            <Field label="ref">
              <input value={ref} onChange={(event) => setRef(event.target.value)} className="input" placeholder="gmaps_2026" />
            </Field>
            <Field label="utm_source">
              <input value={utmSource} onChange={(event) => setUtmSource(event.target.value)} className="input" placeholder="google" />
            </Field>
            <Field label="utm_medium">
              <input value={utmMedium} onChange={(event) => setUtmMedium(event.target.value)} className="input" placeholder="profile" />
            </Field>
            <Field label="utm_campaign">
              <input value={utmCampaign} onChange={(event) => setUtmCampaign(event.target.value)} className="input" placeholder="blueberry_2026" />
            </Field>
          </div>
        </div>
        <div className="rounded-xl border border-blue-100 bg-blue-50 p-3">
          <p className="text-xs font-bold" style={{ color: accentColor }}>選択中</p>
          <p className="mt-1 text-sm font-bold text-blue-950">{selectedResource?.name ?? 'Resource未選択'} / {selectedMenu?.name ?? 'Menu未選択'}</p>
          <div className="mt-3 rounded-lg bg-white p-3 text-xs leading-6 text-gray-700 break-all">{url}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" onClick={copyUrl} disabled={!resourceId} className="btn-primary disabled:opacity-50">
              {copied ? 'コピーしました' : 'URLコピー'}
            </button>
            <a href={url} target="_blank" rel="noreferrer" className={`btn-secondary ${!resourceId ? 'pointer-events-none opacity-50' : ''}`}>
              開く
            </a>
          </div>
          {!resourceId && <p className="mt-2 text-xs text-amber-700">先にResourceを選択してください。</p>}
          {!menuId && resourceId && <p className="mt-2 text-xs text-gray-500">Menu未指定でも開けます。ユーザーが画面上でMenuを選択します。</p>}
        </div>
      </div>
    </SettingsCard>
  )
}

function ResourceEditor({
  resource,
  loading,
  onSubmit,
  onDelete,
}: {
  resource: ReservationResource
  loading: boolean
  onSubmit: (resource: ReservationResource, formData: FormData) => void
  onDelete: (resource: ReservationResource) => void
}) {
  return (
    <form action={(formData) => onSubmit(resource, formData)} className="mt-4 space-y-3 rounded-lg border border-gray-100 bg-gray-50 p-3">
      {!resource.isActive && <p className="rounded-md bg-gray-200 px-2 py-1 text-xs text-gray-600">削除済み</p>}
      <Field label="名前"><input name="name" defaultValue={resource.name} className="input" /></Field>
      <Field label="説明"><input name="description" defaultValue={resource.description ?? ''} className="input" /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="標準時間"><input name="defaultDurationMinutes" type="number" defaultValue={resource.defaultDurationMinutes} className="input" /></Field>
        <Field label="総枠"><input name="defaultCapacity" type="number" defaultValue={resource.defaultCapacity} className="input" /></Field>
        <Field label="LINE枠"><input name="defaultLineCapacity" type="number" defaultValue={resource.defaultLineCapacity ?? ''} className="input" /></Field>
        <Field label="外部枠"><input name="defaultExternalCapacity" type="number" defaultValue={resource.defaultExternalCapacity ?? ''} className="input" /></Field>
      </div>
      <Field label="Google connection ID"><input name="googleCalendarConnectionId" defaultValue={resource.googleCalendarConnectionId ?? ''} className="input" /></Field>
      <div className="flex gap-2">
        <button disabled={loading} className="btn-secondary">Resource保存</button>
        {resource.isActive && (
          <button type="button" disabled={loading} onClick={() => onDelete(resource)} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50">
            削除
          </button>
        )}
      </div>
    </form>
  )
}

function MenuEditor({
  menu,
  loading,
  onSubmit,
  onDelete,
}: {
  menu: ReservationMenu
  loading: boolean
  onSubmit: (menu: ReservationMenu, formData: FormData) => void
  onDelete: (menu: ReservationMenu) => void
}) {
  return (
    <details className="rounded-lg border border-gray-100 bg-gray-50 p-3">
      <summary className="cursor-pointer text-sm font-bold text-gray-800">
        {menu.name}{!menu.isActive && <span className="ml-2 rounded-md bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">削除済み</span>}
      </summary>
      <form action={(formData) => onSubmit(menu, formData)} className="mt-3 space-y-3">
        <Field label="名前"><input name="name" defaultValue={menu.name} className="input" /></Field>
        <Field label="説明"><input name="description" defaultValue={menu.description ?? ''} className="input" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="時間"><input name="durationMinutes" type="number" defaultValue={menu.durationMinutes} className="input" /></Field>
          <Field label="最大人数"><input name="maxPeople" type="number" defaultValue={menu.maxPeople ?? ''} className="input" /></Field>
          <Field label="大人料金"><input name="priceAdult" type="number" defaultValue={menu.priceAdult ?? ''} className="input" /></Field>
          <Field label="子ども料金"><input name="priceChild" type="number" defaultValue={menu.priceChild ?? ''} className="input" /></Field>
          <Field label="幼児料金"><input name="priceInfant" type="number" defaultValue={menu.priceInfant ?? ''} className="input" /></Field>
          <Field label="3歳以下料金"><input name="priceUnderThree" type="number" defaultValue={menu.priceUnderThree ?? 0} className="input" /></Field>
        </div>
        <div className="grid gap-2 text-xs text-gray-600">
          <label><input name="capacityCountAdult" type="checkbox" defaultChecked={menu.capacityCountAdult} className="mr-2" />大人は枠を消費</label>
          <label><input name="capacityCountChild" type="checkbox" defaultChecked={menu.capacityCountChild} className="mr-2" />子どもは枠を消費</label>
          <label><input name="capacityCountInfant" type="checkbox" defaultChecked={menu.capacityCountInfant} className="mr-2" />幼児は枠を消費</label>
          <label><input name="capacityCountUnderThree" type="checkbox" defaultChecked={menu.capacityCountUnderThree} className="mr-2" />3歳以下は枠を消費</label>
        </div>
        <div className="flex gap-2">
          <button disabled={loading} className="btn-secondary">Menu保存</button>
          {menu.isActive && (
            <button type="button" disabled={loading} onClick={() => onDelete(menu)} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50">
              削除
            </button>
          )}
        </div>
      </form>
    </details>
  )
}

function ScheduleEditor({
  schedule,
  loading,
  onSubmit,
  onDelete,
}: {
  schedule: ReservationSchedule
  loading: boolean
  onSubmit: (schedule: ReservationSchedule, formData: FormData) => void
  onDelete: (schedule: ReservationSchedule) => void
}) {
  return (
    <details className="rounded-lg border border-gray-100 bg-gray-50 p-3">
      <summary className="cursor-pointer text-sm font-bold text-gray-800">
        {dayLabels[schedule.dayOfWeek]} {schedule.startTime}-{schedule.endTime}
        {!schedule.isActive && <span className="ml-2 rounded-md bg-gray-200 px-2 py-0.5 text-xs font-medium text-gray-600">削除済み</span>}
      </summary>
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
        <div className="flex gap-2">
          <button disabled={loading} className="btn-secondary">schedule保存</button>
          {schedule.isActive && (
            <button type="button" disabled={loading} onClick={() => onDelete(schedule)} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm font-medium text-red-700 disabled:opacity-50">
              削除
            </button>
          )}
        </div>
      </form>
    </details>
  )
}

function OrphanedReservationsMaintenanceCard({
  loading,
  items,
  result,
  onLoad,
  onDryRun,
  onCancel,
}: {
  loading: boolean
  items: OrphanedReservationItem[]
  result: OrphanedCancelResponse | null
  onLoad: () => void | Promise<void>
  onDryRun: () => void | Promise<void>
  onCancel: () => void | Promise<void>
}) {
  const previewItems = items.slice(0, 20)
  const resultText = result
    ? result.dryRun
      ? `dry run: 対象 ${result.count ?? result.scanned ?? items.length} 件`
      : `キャンセル ${result.cancelled} 件 / 失敗 ${result.failed} 件`
    : null

  return (
    <SettingsCard title="メンテナンス: 孤立予約">
      <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-sm text-amber-900">
        <p className="font-bold">既存Resourceに紐づかない有効予約を確認します。</p>
        <p className="mt-1 text-xs">
          Resource削除・停止後に残った予約を、DBから物理削除せずにキャンセル状態へ変更します。まず「対象確認」か「dry run」で件数を確認してください。
        </p>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={loading} onClick={() => void onLoad()} className="btn-secondary">
          対象確認
        </button>
        <button type="button" disabled={loading} onClick={() => void onDryRun()} className="btn-secondary">
          dry run
        </button>
        <button
          type="button"
          disabled={loading || items.length === 0}
          onClick={() => void onCancel()}
          className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          一括キャンセル
        </button>
      </div>
      {resultText && <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-800">{resultText}</p>}
      {result?.errors && result.errors.length > 0 && (
        <div className="mt-3 rounded-lg border border-red-100 bg-red-50 p-3 text-xs text-red-800">
          <p className="font-bold">失敗した予約</p>
          <ul className="mt-2 space-y-1">
            {result.errors.slice(0, 10).map((error) => (
              <li key={error.id}>{error.id}: {error.reason}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4 overflow-hidden rounded-lg border border-gray-200">
        <div className="flex items-center justify-between bg-gray-50 px-3 py-2 text-xs font-bold text-gray-600">
          <span>対象予約</span>
          <span>{items.length}件</span>
        </div>
        {previewItems.length === 0 ? (
          <p className="p-3 text-sm text-gray-400">まだ確認していない、または対象予約がありません。</p>
        ) : (
          <div className="divide-y divide-gray-100">
            {previewItems.map(({ reason, resourceName, reservation }) => (
              <div key={reservation.id} className="p-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-gray-900">{reservation.customerName || reservation.title || reservation.id}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {reservation.reservationDate} {formatTime(reservation.startAt)} / {reservation.totalPeople}名 / {sourceLabel(reservation.source)}
                    </p>
                    <p className="mt-1 text-xs text-amber-800">{orphanReasonLabel(reason)}{resourceName ? `: ${resourceName}` : ''}</p>
                  </div>
                  <StatusBadge status={reservation.status} />
                </div>
              </div>
            ))}
          </div>
        )}
        {items.length > previewItems.length && (
          <p className="border-t border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-500">表示は先頭20件までです。</p>
        )}
      </div>
    </SettingsCard>
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
    priceUnderThree: nullableNumber(formData.get('priceUnderThree')),
    capacityCountAdult: formData.get('capacityCountAdult') === 'on',
    capacityCountChild: formData.get('capacityCountChild') === 'on',
    capacityCountInfant: formData.get('capacityCountInfant') === 'on',
    capacityCountUnderThree: formData.get('capacityCountUnderThree') === 'on',
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
