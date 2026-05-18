'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  ApiResponse,
  ExternalReservationSourceResponse,
  ReservationMenu,
  ReservationResource,
  ReservationResponse,
  ReservationSlotWithAvailability,
  Tag,
  Template,
} from '@line-crm/shared'
import {
  api,
  fetchApi,
  type ApiBroadcast,
  type ApiCalendarConnection,
  type ApiGmailImportRule,
  type ApiGmailImportRun,
  type ApiGmailImportRunResult,
  type ApiGmailLabel,
  type ApiUserEvent,
  type ApiEventDefinition,
  type ApiEventTagRule,
  type CalendarSyncResult,
} from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import FlexPreviewComponent from '@/components/flex-preview'

type Tab = 'reservations' | 'chats' | 'broadcasts'
type SettingsModal = 'menu' | 'jalan' | 'calendar' | 'events' | null
type ReservationViewFilter = 'all' | 'line' | 'jalan' | 'time'

type ChatItem = {
  id: string
  friendId: string
  friendName: string
  friendPictureUrl: string | null
  status: 'unread' | 'in_progress' | 'resolved'
  lastMessageAt: string | null
}

type ChatMessage = {
  id: string
  content: string
  senderType?: string
  direction?: 'incoming' | 'outgoing'
  createdAt: string
}

type ChatDetail = ChatItem & { messages?: ChatMessage[] }
type ExternalSource = ExternalReservationSourceResponse & {
  rawText?: string | null
  parsedPayload?: string | null
  externalReservationId?: string | null
  dedupeKey?: string | null
}

type GmailRuleDraft = {
  connectionId: string
  name: string
  fromEmail: string
  query: string
  unprocessedLabelId: string
  processedLabelId: string
  reviewLabelId: string
  failedLabelId: string
  resourceId: string
  menuId: string
  maxResults: number
}

type BroadcastDraft = {
  title: string
  messageType: ApiBroadcast['messageType']
  messageContent: string
  templateId: string
  cardTitle: string
  cardBody: string
  cardButtonLabel: string
  cardUrl: string
  cardImageUrl: string
  cardSize: 'kilo' | 'mega' | 'giga'
  cardTitleSize: 'lg' | 'xl' | 'xxl'
  cardBodySize: 'xs' | 'sm' | 'md'
}

type EventRuleDraft = {
  name: string
  eventType: string
  action: 'add_tag' | 'remove_tag'
  tagId: string
  conditionKey: string
  conditionValue: string
  priority: number
}

const defaultBroadcastDraft: BroadcastDraft = {
  title: '',
  messageType: 'text',
  messageContent: '',
  templateId: '',
  cardTitle: 'ブルーベリー予約はこちら',
  cardBody: '日付と時間を選んで、かんたんに予約できます。',
  cardButtonLabel: '予約する',
  cardUrl: '',
  cardImageUrl: '',
  cardSize: 'mega',
  cardTitleSize: 'xl',
  cardBodySize: 'sm',
}

const defaultEventRuleDraft: EventRuleDraft = {
  name: '',
  eventType: 'rich_menu.tap',
  action: 'add_tag',
  tagId: '',
  conditionKey: 'action',
  conditionValue: 'booking',
  priority: 0,
}

const tabs: Array<{ key: Tab; label: string; hint: string }> = [
  { key: 'reservations', label: '予約', hint: '今日の枠と予約客' },
  { key: 'chats', label: 'チャット', hint: '未読・対応中だけ' },
  { key: 'broadcasts', label: '一斉配信', hint: '下書き確認と送信' },
]

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
    const current = new Date(start)
    current.setDate(start.getDate() + index)
    return toYmd(current)
  })
}

function formatTime(value: string | null): string {
  if (!value) return '-'
  const match = value.match(/T(\d{2}:\d{2})/)
  return match?.[1] ?? value.slice(11, 16) ?? value
}

function formatDateTime(value: string | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
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

function hasPriceDetails(reservation: ReservationResponse): boolean {
  return reservationPriceDetails(reservation) !== null
}

async function apiData<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetchApi<ApiResponse<T>>(path, options)
  if (!res.success) throw new Error(res.error || 'API request failed')
  return res.data
}

function reservationName(reservation: ReservationResponse): string {
  return reservation.customerName || reservation.title || '名前未登録'
}

function activeReservation(reservation: ReservationResponse): boolean {
  return reservation.status === 'pending' || reservation.status === 'confirmed'
}

function slotAvailabilityLabel(slot: ReservationSlotWithAvailability): { mark: string; text: string; className: string } {
  if (!slot.availability.available) return { mark: '×', text: '満席', className: 'bg-red-50 text-red-700' }
  const remaining = slot.availability.remainingCapacity
  if (remaining >= 3) return { mark: '◎', text: `残${remaining}`, className: 'bg-blue-50 text-blue-700' }
  return { mark: '△', text: `残${remaining}`, className: 'bg-amber-50 text-amber-700' }
}

function googleSyncReasonLabel(reason: string): string {
  const labels: Record<string, string> = {
    resource_not_found: '予約枠に紐づく予約対象が見つかりません',
    resource_not_connected: '予約対象にGoogle connection IDが設定されていません',
    connection_not_usable: 'Google接続のアクセストークンを利用できません',
  }
  return labels[reason] ?? reason
}

function sourceBadge(source: ReservationResponse['source']): string {
  if (source === 'line') return 'LINE'
  if (source === 'jalan') return 'じゃらん'
  return source
}

function toChatItem(raw: unknown): ChatItem {
  const item = raw as Partial<ChatItem> & { friend?: { displayName?: string; pictureUrl?: string | null } }
  return {
    id: String(item.id ?? ''),
    friendId: String(item.friendId ?? ''),
    friendName: String(item.friendName ?? item.friend?.displayName ?? '名前未登録'),
    friendPictureUrl: item.friendPictureUrl ?? item.friend?.pictureUrl ?? null,
    status: item.status === 'resolved' || item.status === 'in_progress' || item.status === 'unread' ? item.status : 'unread',
    lastMessageAt: item.lastMessageAt ?? null,
  }
}

function toChatDetail(raw: unknown, fallback?: ChatItem): ChatDetail {
  const item = raw as Partial<ChatDetail>
  return {
    ...(fallback ?? toChatItem(raw)),
    ...toChatItem({ ...fallback, ...item }),
    messages: Array.isArray(item.messages) ? item.messages : [],
  }
}

export default function ReservationOpsPage() {
  const { selectedAccountId } = useAccount()
  const [tab, setTab] = useState<Tab>('reservations')
  const [settingsModal, setSettingsModal] = useState<SettingsModal>(null)
  const [date, setDate] = useState(toYmd(new Date()))
  const [resources, setResources] = useState<ReservationResource[]>([])
  const [menusByResource, setMenusByResource] = useState<Record<string, ReservationMenu[]>>({})
  const [resourceId, setResourceId] = useState('')
  const [slots, setSlots] = useState<ReservationSlotWithAvailability[]>([])
  const [reservations, setReservations] = useState<ReservationResponse[]>([])
  const [externalSources, setExternalSources] = useState<ExternalSource[]>([])
  const [chats, setChats] = useState<ChatItem[]>([])
  const [selectedChat, setSelectedChat] = useState<ChatDetail | null>(null)
  const [selectedReservation, setSelectedReservation] = useState<ReservationResponse | null>(null)
  const [reservationCalendarOpen, setReservationCalendarOpen] = useState(false)
  const [reservationViewFilter, setReservationViewFilter] = useState<ReservationViewFilter>('all')
  const [reply, setReply] = useState('')
  const [broadcasts, setBroadcasts] = useState<ApiBroadcast[]>([])
  const [calendarConnections, setCalendarConnections] = useState<ApiCalendarConnection[]>([])
  const [calendarId, setCalendarId] = useState('primary')
  const [gmailLabels, setGmailLabels] = useState<ApiGmailLabel[]>([])
  const [gmailImportRules, setGmailImportRules] = useState<ApiGmailImportRule[]>([])
  const [gmailImportRuns, setGmailImportRuns] = useState<ApiGmailImportRun[]>([])
  const [gmailLastRun, setGmailLastRun] = useState<ApiGmailImportRunResult | null>(null)
  const [templates, setTemplates] = useState<Template[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [events, setEvents] = useState<ApiUserEvent[]>([])
  const [eventDefinitions, setEventDefinitions] = useState<ApiEventDefinition[]>([])
  const [eventTagRules, setEventTagRules] = useState<ApiEventTagRule[]>([])
  const [gmailRuleDraft, setGmailRuleDraft] = useState<GmailRuleDraft>({
    connectionId: '',
    name: 'じゃらん予約メール',
    fromEmail: '',
    query: '{from:reservation@activityboard.jp from:reservation_cancel@activityboard.jp} newer_than:30d',
    unprocessedLabelId: '',
    processedLabelId: '',
    reviewLabelId: '',
    failedLabelId: '',
    resourceId: '',
    menuId: '',
    maxResults: 10,
  })
  const [broadcastDraft, setBroadcastDraft] = useState<BroadcastDraft>(defaultBroadcastDraft)
  const [eventRuleDraft, setEventRuleDraft] = useState<EventRuleDraft>(defaultEventRuleDraft)
  const [imageUrl, setImageUrl] = useState('')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [calendarSettingsOpen, setCalendarSettingsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const activeReservations = reservations.filter(activeReservation)
  const unreadChats = chats.filter((chat) => chat.status === 'unread')

  const reservationsBySlot = useMemo(() => {
    const grouped = new Map<string, ReservationResponse[]>()
    for (const reservation of reservations) {
      if (!reservation.slotId) continue
      grouped.set(reservation.slotId, [...(grouped.get(reservation.slotId) ?? []), reservation])
    }
    return grouped
  }, [reservations])

  const loadReservations = useCallback(async (nextResourceId = resourceId, nextDate = date) => {
    const allResources = await apiData<ReservationResource[]>('/api/reservation-resources')
    const resolvedResourceId = nextResourceId || allResources.find((resource) => resource.isActive)?.id || allResources[0]?.id || ''
    setResources(allResources)
    setResourceId(resolvedResourceId)
    const menuEntries = await Promise.all(allResources.map(async (resource) => {
      const menus = await apiData<ReservationMenu[]>(`/api/reservation-resources/${encodeURIComponent(resource.id)}/menus`)
      return [resource.id, menus] as const
    }))
    setMenusByResource(Object.fromEntries(menuEntries))
    const [nextReservations, nextSlots] = await Promise.all([
      apiData<ReservationResponse[]>(`/api/reservations?date=${encodeURIComponent(nextDate)}`),
      resolvedResourceId
        ? apiData<ReservationSlotWithAvailability[]>(`/api/reservation-slots?resourceId=${encodeURIComponent(resolvedResourceId)}&date=${encodeURIComponent(nextDate)}&people=1`)
        : Promise.resolve([]),
    ])
    setReservations(nextReservations)
    setSlots(nextSlots)
  }, [date, resourceId])

  const loadChats = useCallback(async () => {
    const [unread, inProgress] = await Promise.all([
      api.chats.list({ status: 'unread', accountId: selectedAccountId || undefined }),
      api.chats.list({ status: 'in_progress', accountId: selectedAccountId || undefined }),
    ])
    const next = [
      ...(unread.success ? unread.data : []),
      ...(inProgress.success ? inProgress.data : []),
    ].map(toChatItem)
    setChats(next)
    if (selectedChat && !next.some((chat) => chat.id === selectedChat.id)) setSelectedChat(null)
  }, [selectedAccountId, selectedChat])

  const loadExternalSources = useCallback(async () => {
    setExternalSources(await apiData<ExternalSource[]>('/api/external-reservation-sources?parseStatus=needs_review&limit=30'))
  }, [])

  const loadBroadcasts = useCallback(async () => {
    const res = await api.broadcasts.list({ accountId: selectedAccountId || undefined })
    if (res.success) setBroadcasts(res.data)
    else throw new Error(res.error)
  }, [selectedAccountId])

  const loadTemplates = useCallback(async () => {
    const res = await api.templates.list()
    if (res.success) setTemplates(res.data)
    else throw new Error(res.error)
  }, [])

  const loadEventSettings = useCallback(async () => {
    const [tagRes, eventRes, definitionRes, ruleRes] = await Promise.all([
      api.tags.list(),
      api.events.list({ lineAccountId: selectedAccountId || undefined, limit: 30 }),
      api.events.definitions(),
      api.events.rules(),
    ])
    if (!tagRes.success) throw new Error(tagRes.error)
    if (!eventRes.success) throw new Error(eventRes.error)
    if (!definitionRes.success) throw new Error(definitionRes.error)
    if (!ruleRes.success) throw new Error(ruleRes.error)
    setTags(tagRes.data)
    setEvents(eventRes.data)
    setEventDefinitions(definitionRes.data)
    setEventTagRules(ruleRes.data)
    if (tagRes.data.length > 0) {
      setEventRuleDraft((current) => ({
        ...current,
        tagId: current.tagId || tagRes.data.find((tag) => (tag as Tag & { kind?: string }).kind === 'custom')?.id || tagRes.data[0].id,
      }))
    }
  }, [selectedAccountId])

  const loadCalendarConnections = useCallback(async () => {
    const res = await api.calendar.listConnections()
    if (res.success) setCalendarConnections(res.data)
    else throw new Error(res.error)
  }, [])

  const loadGmailImports = useCallback(async () => {
    const [rules, runs] = await Promise.all([
      api.gmailImports.listRules(),
      api.gmailImports.listRuns({ limit: 10 }),
    ])
    if (!rules.success) throw new Error(rules.error)
    if (!runs.success) throw new Error(runs.error)
    setGmailImportRules(rules.data)
    setGmailImportRuns(runs.data)
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      await Promise.all([loadReservations(), loadChats(), loadExternalSources(), loadBroadcasts(), loadTemplates(), loadCalendarConnections(), loadGmailImports(), loadEventSettings()])
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [loadReservations, loadChats, loadExternalSources, loadBroadcasts, loadTemplates, loadCalendarConnections, loadGmailImports, loadEventSettings])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  const runAction = async (action: () => Promise<void>, success: string) => {
    setSaving(true)
    setNotice('')
    setError('')
    try {
      await action()
      setNotice(success)
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const selectChat = async (chat: ChatItem) => {
    setError('')
    try {
      const res = await api.chats.get(chat.id)
      if (!res.success) throw new Error(res.error)
      setSelectedChat(toChatDetail(res.data, chat))
      setTab('chats')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'チャット詳細の取得に失敗しました')
    }
  }

  const sendReply = async () => {
    if (!selectedChat || !reply.trim()) return
    if (!confirm(`${selectedChat.friendName} さんに返信します。送信後はLINEに配信されます。よいですか？`)) return
    await runAction(async () => {
      await api.chats.send(selectedChat.id, { content: reply.trim(), messageType: 'text' })
      setReply('')
      const detail = await api.chats.get(selectedChat.id)
      if (detail.success) setSelectedChat(toChatDetail(detail.data, selectedChat))
    }, '返信を送信しました')
  }

  const markExternalIgnored = async (source: ExternalSource) => {
    await runAction(async () => {
      await apiData(`/api/external-reservation-sources/${encodeURIComponent(source.id)}/parse-status`, {
        method: 'PUT',
        body: JSON.stringify({ parseStatus: 'ignored', lastError: null }),
      })
    }, '外部取り込みを確認済みにしました')
  }

  const loadGmailLabels = async (connectionId = gmailRuleDraft.connectionId) => {
    if (!connectionId) {
      setError('先にGoogle接続を選択してください')
      return
    }
    setSaving(true)
    setNotice('')
    setError('')
    try {
      const res = await api.gmailImports.labels(connectionId)
      if (!res.success) throw new Error(res.error)
      setGmailLabels(res.data)
      setNotice('Gmailラベルを取得しました')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gmailラベルの取得に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const createGmailImportRule = async () => {
    await runAction(async () => {
      if (!gmailRuleDraft.connectionId) throw new Error('Google接続を選択してください')
      if (!gmailRuleDraft.unprocessedLabelId || !gmailRuleDraft.processedLabelId || !gmailRuleDraft.reviewLabelId || !gmailRuleDraft.failedLabelId) {
        throw new Error('未処理/処理済み/要確認/失敗のGmailラベルを選択してください')
      }
      if (!gmailRuleDraft.resourceId || !gmailRuleDraft.menuId) {
        throw new Error('取り込み先の予約対象とメニューを選択してください')
      }
      const res = await api.gmailImports.createRule({
        connectionId: gmailRuleDraft.connectionId,
        name: gmailRuleDraft.name.trim() || 'じゃらん予約メール',
        fromEmail: gmailRuleDraft.fromEmail.trim() || null,
        query: gmailRuleDraft.query.trim() || null,
        unprocessedLabelId: gmailRuleDraft.unprocessedLabelId,
        processedLabelId: gmailRuleDraft.processedLabelId,
        reviewLabelId: gmailRuleDraft.reviewLabelId,
        failedLabelId: gmailRuleDraft.failedLabelId,
        resourceId: gmailRuleDraft.resourceId,
        menuId: gmailRuleDraft.menuId,
        maxResults: gmailRuleDraft.maxResults,
        isActive: true,
      })
      if (!res.success) throw new Error(res.error)
    }, 'Gmail取り込みルールを作成しました')
  }

  const deleteGmailImportRule = async (rule: ApiGmailImportRule) => {
    if (!confirm(`「${rule.name}」を停止します。Cronで自動取り込みされなくなります。よいですか？`)) return
    await runAction(async () => {
      const res = await api.gmailImports.deleteRule(rule.id)
      if (!res.success) throw new Error(res.error)
    }, 'Gmail取り込みルールを停止しました')
  }

  const runGmailImport = async (rule: ApiGmailImportRule, dryRun: boolean) => {
    await runAction(async () => {
      const res = await api.gmailImports.runRule(rule.id, { dryRun, maxResults: Math.min(rule.maxResults, 10) })
      if (!res.success) throw new Error(res.error)
      setGmailLastRun(res.data)
    }, dryRun ? 'Gmail取り込みのテスト解析を実行しました' : 'Gmail取り込みを実行しました')
  }

  const createBroadcastDraft = async () => {
    if (!broadcastDraft.title.trim() || !broadcastDraft.messageContent.trim()) return
    await runAction(async () => {
      const res = await api.broadcasts.create({
        title: broadcastDraft.title.trim(),
        messageType: broadcastDraft.messageType,
        messageContent: broadcastDraft.messageContent.trim(),
        targetType: 'all',
        status: 'draft',
        lineAccountId: selectedAccountId || null,
      })
      if (!res.success) throw new Error(res.error)
      setBroadcastDraft(defaultBroadcastDraft)
    }, '一斉配信の下書きを作成しました')
  }

  const createEventTagRule = async () => {
    await runAction(async () => {
      if (!eventRuleDraft.name.trim()) throw new Error('ルール名を入力してください')
      if (!eventRuleDraft.eventType) throw new Error('イベントを選択してください')
      if (!eventRuleDraft.tagId) throw new Error('付与/削除するタグを選択してください')
      const conditions = eventRuleDraft.conditionKey.trim() && eventRuleDraft.conditionValue.trim()
        ? { [eventRuleDraft.conditionKey.trim()]: eventRuleDraft.conditionValue.trim() }
        : {}
      const res = await api.events.createRule({
        name: eventRuleDraft.name.trim(),
        eventType: eventRuleDraft.eventType,
        action: eventRuleDraft.action,
        tagId: eventRuleDraft.tagId,
        conditions,
        priority: eventRuleDraft.priority,
        isActive: true,
      })
      if (!res.success) throw new Error(res.error)
      setEventRuleDraft((current) => ({
        ...defaultEventRuleDraft,
        eventType: current.eventType,
        tagId: current.tagId,
        conditionKey: current.conditionKey,
      }))
    }, 'イベントタグルールを作成しました')
  }

  const deleteEventTagRule = async (rule: ApiEventTagRule) => {
    if (!confirm(`「${rule.name}」を削除します。今後この条件ではタグが自動変更されません。よいですか？`)) return
    await runAction(async () => {
      const res = await api.events.deleteRule(rule.id)
      if (!res.success) throw new Error(res.error)
    }, 'イベントタグルールを削除しました')
  }

  const uploadImage = async (file: File | null) => {
    if (!file) return;
    setNotice('')
    setError('')
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      setError('画像は png / jpeg / gif / webp のみ対応です')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('画像サイズは5MB以下にしてください')
      return
    }
    setUploadingImage(true)
    try {
      const data = await fileToDataUrl(file)
      const res = await fetchApi<ApiResponse<{ url: string }>>('/api/images', {
        method: 'POST',
        body: JSON.stringify({ data, mimeType: file.type, filename: file.name }),
      })
      if (!res.success) throw new Error(res.error || '画像アップロードに失敗しました')
      setImageUrl(res.data.url)
      setNotice('画像をアップロードしました。URLをコピーして配信本文やリッチメニューに使えます。')
    } catch (err) {
      setError(err instanceof Error ? err.message : '画像アップロードに失敗しました')
    } finally {
      setUploadingImage(false)
    }
  }

  const sendBroadcast = async (broadcast: ApiBroadcast) => {
    if (!confirm(`「${broadcast.title}」を一斉配信します。対象が全員の場合、友だち全体に送られます。よいですか？`)) return
    await runAction(async () => {
      const res = await api.broadcasts.send(broadcast.id)
      if (!res.success) throw new Error(res.error)
    }, '一斉配信を開始しました')
  }

  const startGoogleOAuth = async () => {
    await runAction(async () => {
      const res = await api.calendar.oauthUrl({ calendarId, returnTo: window.location.href })
      if (!res.success) throw new Error(res.error)
      window.location.assign(res.data.url)
    }, 'Google Calendar接続を開始しました')
  }

  const deleteCalendarConnection = async (connection: ApiCalendarConnection) => {
    if (!confirm(`${connection.calendarId} のGoogle Calendar連携を削除します。予約対象に設定中の場合は同期されなくなります。よいですか？`)) return
    await runAction(async () => {
      const res = await api.calendar.deleteConnection(connection.id)
      if (!res.success) throw new Error(res.error)
    }, 'Google Calendar連携を削除しました')
  }

  const assignCalendarConnection = async (resourceIdToUpdate: string, connectionId: string) => {
    if (!resourceIdToUpdate) return
    await runAction(async () => {
      const resource = resources.find((item) => item.id === resourceIdToUpdate)
      if (!resource) throw new Error('予約対象が見つかりません')
      await apiData(`/api/reservation-resources/${encodeURIComponent(resourceIdToUpdate)}`, {
        method: 'PUT',
        body: JSON.stringify({
          name: resource.name,
          googleCalendarConnectionId: connectionId || null,
        }),
      })
    }, connectionId ? '予約対象にGoogle Calendar連携を設定しました' : '予約対象からGoogle Calendar連携を外しました')
  }

  const syncTodayReservationsToCalendar = async () => {
    const active = reservations.filter(activeReservation)
    if (active.length === 0) {
      setNotice('同期対象の予約はありません')
      return
    }
    if (!confirm(`${date} の有効予約 ${active.length}件をGoogle Calendarへ同期します。既に同期済みの予約は二重作成しません。よいですか？`)) return
    setSaving(true)
    setNotice('')
    setError('')
    try {
      const results: CalendarSyncResult[] = []
      for (const reservation of active) {
        const res = await api.calendar.syncReservation(reservation.id)
        if (!res.success) throw new Error(res.error)
        results.push(res.data.sync)
      }
      const created = results.filter((item) => item.status === 'created').length
      const alreadySynced = results.filter((item) => item.status === 'already_synced').length
      const skipped = results.filter((item) => item.status === 'skipped').length
      const failed = results.filter((item) => item.status === 'failed').length
      const firstProblem = results.find((item) => item.status === 'failed' || item.status === 'skipped')
      const reason = firstProblem && 'reason' in firstProblem ? googleSyncReasonLabel(firstProblem.reason) : ''
      setNotice(
        `Google Calendar同期: 作成 ${created}件 / 同期済み ${alreadySynced}件 / スキップ ${skipped}件 / 失敗 ${failed}件`
        + (reason ? `（例: ${reason}）` : ''),
      )
      await loadAll()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Google Calendar同期に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:px-0">
        <div className="flex min-w-max gap-2">
        <SummaryCard label={`${date}の予約`} value={`${activeReservations.length}件`} tone="green" />
        <SummaryCard label="未読チャット" value={`${unreadChats.length}件`} tone="red" />
        </div>
      </div>

      <div className="sticky top-0 z-20 -mx-4 mt-3 border-y border-gray-100 bg-white/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:shadow-sm">
        <div className="flex items-center gap-2 overflow-x-auto">
          {tabs.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold transition ${tab === item.key ? 'bg-green-600 text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'}`}
            >
              {item.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSettingsModal('menu')}
            className="shrink-0 rounded-full border border-gray-300 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50"
          >
            設定
          </button>
        </div>
      </div>

      {(notice || error) && (
        <div className={`mt-4 rounded-xl p-3 text-sm ${error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700'}`}>
          {error || notice}
        </div>
      )}

      {loading ? (
        <div className="mt-8 text-sm text-gray-400">読み込み中...</div>
      ) : (
        <div className="mt-5">
          {tab === 'reservations' && (
            <ReservationsPanel
              date={date}
              resources={resources}
              resourceId={resourceId}
              slots={slots}
              reservationsBySlot={reservationsBySlot}
              reservations={reservations}
              selectedReservation={selectedReservation}
              calendarOpen={reservationCalendarOpen}
              viewFilter={reservationViewFilter}
              onDateChange={(nextDate) => {
                setDate(nextDate)
                setSelectedReservation(null)
                void loadReservations(resourceId, nextDate)
              }}
              onResourceChange={(nextResourceId) => {
                setResourceId(nextResourceId)
                setSelectedReservation(null)
                void loadReservations(nextResourceId, date)
              }}
              onViewFilterChange={setReservationViewFilter}
              onSelectReservation={setSelectedReservation}
              onOpenCalendar={() => setReservationCalendarOpen(true)}
              onCloseCalendar={() => setReservationCalendarOpen(false)}
            />
          )}
          {tab === 'chats' && (
            <ChatsPanel
              chats={chats}
              selectedChat={selectedChat}
              reply={reply}
              saving={saving}
              onSelect={selectChat}
              onReplyChange={setReply}
              onSendReply={sendReply}
            />
          )}
          {tab === 'broadcasts' && (
            <BroadcastPanel
              broadcasts={broadcasts}
              templates={templates}
              draft={broadcastDraft}
              imageUrl={imageUrl}
              saving={saving}
              uploadingImage={uploadingImage}
              onDraftChange={setBroadcastDraft}
              onCreateDraft={createBroadcastDraft}
              onSend={sendBroadcast}
              onUploadImage={uploadImage}
            />
          )}
        </div>
      )}

      {settingsModal === 'menu' && (
        <SettingsModalShell title="設定" onClose={() => setSettingsModal(null)}>
          <div className="grid gap-3 sm:grid-cols-2">
            <button type="button" onClick={() => setSettingsModal('jalan')} className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-left hover:bg-amber-100">
              <p className="font-bold text-amber-950">じゃらん / Gmail設定</p>
              <p className="mt-1 text-sm text-amber-800">Gmailラベル、取り込みルール、要確認メールを管理します。</p>
            </button>
            <button type="button" onClick={() => setSettingsModal('calendar')} className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-left hover:bg-blue-100">
              <p className="font-bold text-blue-950">Google Calendar設定</p>
              <p className="mt-1 text-sm text-blue-800">Google接続、予約対象への紐づけ、選択日の同期を管理します。</p>
            </button>
            <button type="button" onClick={() => setSettingsModal('events')} className="rounded-2xl border border-purple-200 bg-purple-50 p-4 text-left hover:bg-purple-100">
              <p className="font-bold text-purple-950">タグ / イベント設定</p>
              <p className="mt-1 text-sm text-purple-800">予約導線・リッチメニュー反応からタグを自動付与します。</p>
            </button>
          </div>
        </SettingsModalShell>
      )}

      {settingsModal === 'jalan' && (
        <SettingsModalShell title="じゃらん / Gmail設定" onClose={() => setSettingsModal(null)}>
          <JalanPanel
            sources={externalSources}
            saving={saving}
            connections={calendarConnections}
            resources={resources}
            menusByResource={menusByResource}
            labels={gmailLabels}
            rules={gmailImportRules}
            runs={gmailImportRuns}
            lastRun={gmailLastRun}
            draft={gmailRuleDraft}
            onDraftChange={setGmailRuleDraft}
            onLoadLabels={loadGmailLabels}
            onCreateRule={createGmailImportRule}
            onDeleteRule={deleteGmailImportRule}
            onRunRule={runGmailImport}
            onIgnore={markExternalIgnored}
          />
        </SettingsModalShell>
      )}

      {settingsModal === 'calendar' && (
        <SettingsModalShell title="Google Calendar設定" onClose={() => setSettingsModal(null)}>
          <CalendarPanel
            connections={calendarConnections}
            resources={resources}
            reservations={reservations}
            selectedDate={date}
            calendarId={calendarId}
            saving={saving}
            settingsOpen={calendarSettingsOpen}
            onCalendarIdChange={setCalendarId}
            onConnect={startGoogleOAuth}
            onDelete={deleteCalendarConnection}
            onAssignResource={assignCalendarConnection}
            onSyncReservations={syncTodayReservationsToCalendar}
            onOpenSettings={() => setCalendarSettingsOpen(true)}
            onCloseSettings={() => setCalendarSettingsOpen(false)}
          />
        </SettingsModalShell>
      )}

      {settingsModal === 'events' && (
        <SettingsModalShell title="タグ / イベント設定" onClose={() => setSettingsModal(null)}>
          <EventsPanel
            events={events}
            definitions={eventDefinitions}
            rules={eventTagRules}
            tags={tags}
            draft={eventRuleDraft}
            saving={saving}
            onDraftChange={setEventRuleDraft}
            onCreateRule={createEventTagRule}
            onDeleteRule={deleteEventTagRule}
          />
        </SettingsModalShell>
      )}
    </div>
  )
}

function CalendarPanel({
  connections,
  resources,
  reservations,
  selectedDate,
  calendarId,
  saving,
  settingsOpen,
  onCalendarIdChange,
  onConnect,
  onDelete,
  onAssignResource,
  onSyncReservations,
  onOpenSettings,
  onCloseSettings,
}: {
  connections: ApiCalendarConnection[]
  resources: ReservationResource[]
  reservations: ReservationResponse[]
  selectedDate: string
  calendarId: string
  saving: boolean
  settingsOpen: boolean
  onCalendarIdChange: (value: string) => void
  onConnect: () => void
  onDelete: (connection: ApiCalendarConnection) => void
  onAssignResource: (resourceId: string, connectionId: string) => void
  onSyncReservations: () => void
  onOpenSettings: () => void
  onCloseSettings: () => void
}) {
  const activeReservations = reservations.filter(activeReservation)
  const activeConnections = connections.filter((connection) => connection.isActive)
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-bold text-gray-900">Google Calendar</h2>
          <p className="mt-1 text-sm text-gray-500">
            予約確定時に、予約対象へ紐づいたカレンダーへ予定を作成します。
          </p>
        </div>
        <button
          type="button"
          onClick={onOpenSettings}
          className="w-fit rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50"
        >
          接続設定
        </button>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl bg-gray-50 p-3">
          <p className="text-xs font-bold text-gray-500">有効な接続</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{activeConnections.length}件</p>
        </div>
        <div className="rounded-xl bg-gray-50 p-3">
          <p className="text-xs font-bold text-gray-500">選択日の有効予約</p>
          <p className="mt-1 text-xl font-bold text-gray-900">{activeReservations.length}件</p>
        </div>
        <div className="rounded-xl bg-gray-50 p-3">
          <p className="text-xs font-bold text-gray-500">紐づき済み予約対象</p>
          <p className="mt-1 text-xl font-bold text-gray-900">
            {resources.filter((resource) => resource.googleCalendarConnectionId).length}件
          </p>
        </div>
      </div>

      <button
        disabled={saving || activeReservations.length === 0}
        onClick={onSyncReservations}
        className="mt-4 rounded-lg bg-green-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
      >
        {selectedDate} の有効予約 {activeReservations.length}件を同期
      </button>

      <div className="mt-4 space-y-2">
        {connections.length === 0 ? (
          <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-400">Google Calendar連携はまだありません。接続設定から追加してください。</p>
        ) : connections.map((connection) => {
          const linkedResources = resources.filter((resource) => resource.googleCalendarConnectionId === connection.id)
          return (
            <div key={connection.id} className="rounded-xl border border-gray-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-gray-900">{connection.calendarId}</p>
                  <p className="text-xs text-gray-500">状態: {connection.isActive ? '有効' : '無効'} / 予約対象 {linkedResources.length}件</p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${connection.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                  {connection.isActive ? '接続中' : '停止'}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:mx-auto sm:max-w-3xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Google Calendar接続設定</h3>
                <p className="mt-1 text-sm text-gray-500">接続追加、削除、予約対象への紐づけをここで管理します。</p>
              </div>
              <button type="button" onClick={onCloseSettings} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold text-gray-700">閉じる</button>
            </div>

            <label className="mt-4 block text-xs font-medium text-gray-600">
              連携するCalendar ID
              <input
                value={calendarId}
                onChange={(event) => onCalendarIdChange(event.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                placeholder="primary または calendar-id@example.com"
              />
            </label>
            <button
              disabled={saving || !calendarId.trim()}
              onClick={onConnect}
              className="mt-3 rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              Google Calendar接続開始
            </button>

            <div className="mt-5 space-y-3">
              <p className="text-sm font-bold text-gray-900">接続中のカレンダー</p>
              {connections.length === 0 ? (
                <p className="rounded-xl bg-gray-50 p-4 text-center text-sm text-gray-400">Google Calendar連携はまだありません。</p>
              ) : connections.map((connection) => {
                const linkedResources = resources.filter((resource) => resource.googleCalendarConnectionId === connection.id)
                return (
                  <div key={connection.id} className="rounded-xl border border-gray-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-gray-900">{connection.calendarId}</p>
                        <p className="mt-1 text-xs text-gray-500">Connection ID: {connection.id}</p>
                        <p className="mt-1 text-xs text-gray-500">
                          認証: {connection.authType} / 状態: {connection.isActive ? '有効' : '無効'} / 作成: {formatDateTime(connection.createdAt)}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-2">
                          {linkedResources.length === 0 ? (
                            <span className="text-xs text-gray-400">予約対象未設定</span>
                          ) : linkedResources.map((resource) => (
                            <span key={resource.id} className="rounded-full bg-green-50 px-2 py-1 text-xs font-bold text-green-700">{resource.name}</span>
                          ))}
                        </div>
                      </div>
                      <button
                        disabled={saving}
                        onClick={() => onDelete(connection)}
                        className="shrink-0 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="mt-5 rounded-xl border border-gray-200 bg-gray-50 p-3">
              <p className="text-sm font-bold text-gray-900">予約対象への紐づけ</p>
              <div className="mt-3 space-y-2">
                {resources.length === 0 ? (
                  <p className="text-sm text-gray-400">予約対象がありません。</p>
                ) : resources.map((resource) => (
                  <label key={resource.id} className="grid gap-2 rounded-lg bg-white p-3 text-xs font-medium text-gray-600 sm:grid-cols-[1fr_1.4fr] sm:items-center">
                    <span>{resource.name}</span>
                    <select
                      value={resource.googleCalendarConnectionId ?? ''}
                      disabled={saving}
                      onChange={(event) => onAssignResource(resource.id, event.target.value)}
                      className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
                    >
                      <option value="">未連携</option>
                      {connections.map((connection) => (
                        <option key={connection.id} value={connection.id}>{connection.calendarId}</option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('画像ファイルを読み込めませんでした'))
    reader.readAsDataURL(file)
  })
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone: 'green' | 'red' | 'amber' | 'blue' }) {
  const colors = {
    green: 'bg-green-50 text-green-700 border-green-100',
    red: 'bg-red-50 text-red-700 border-red-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
  }
  return (
    <div className={`min-w-[112px] rounded-xl border px-3 py-2 ${colors[tone]}`}>
      <p className="text-[11px] font-medium leading-tight opacity-80">{label}</p>
      <p className="mt-0.5 text-base font-bold leading-tight">{value}</p>
    </div>
  )
}

function SettingsModalShell({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[90vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:mx-auto sm:max-w-5xl sm:rounded-2xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-gray-900">{title}</h2>
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold text-gray-700">
            閉じる
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function EventsPanel({
  events,
  definitions,
  rules,
  tags,
  draft,
  saving,
  onDraftChange,
  onCreateRule,
  onDeleteRule,
}: {
  events: ApiUserEvent[]
  definitions: ApiEventDefinition[]
  rules: ApiEventTagRule[]
  tags: Tag[]
  draft: EventRuleDraft
  saving: boolean
  onDraftChange: (draft: EventRuleDraft) => void
  onCreateRule: () => void
  onDeleteRule: (rule: ApiEventTagRule) => void
}) {
  const tagName = useCallback((tagId: string) => tags.find((tag) => tag.id === tagId)?.name ?? '削除済みタグ', [tags])
  const definitionName = useCallback((eventType: string) => definitions.find((item) => item.eventType === eventType)?.name ?? eventType, [definitions])
  const customTags = tags.filter((tag) => (tag as Tag & { kind?: string }).kind !== 'system')
  const selectableTags = customTags.length > 0 ? customTags : tags

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="text-base font-bold text-gray-900">イベントからタグを自動変更</h3>
        <p className="mt-1 text-sm text-gray-500">
          例: リッチメニューの予約ボタンを押した人に「予約興味あり」タグを付ける。
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-gray-600">
            ルール名
            <input
              value={draft.name}
              onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="予約ボタン反応タグ"
            />
          </label>
          <label className="text-xs font-medium text-gray-600">
            対象イベント
            <select
              value={draft.eventType}
              onChange={(event) => onDraftChange({ ...draft, eventType: event.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {definitions.map((definition) => (
                <option key={definition.id} value={definition.eventType}>
                  {definition.name} / {definition.eventType}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-gray-600">
            条件キー
            <input
              value={draft.conditionKey}
              onChange={(event) => onDraftChange({ ...draft, conditionKey: event.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="action"
            />
          </label>
          <label className="text-xs font-medium text-gray-600">
            条件値
            <input
              value={draft.conditionValue}
              onChange={(event) => onDraftChange({ ...draft, conditionValue: event.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="booking"
            />
          </label>
          <label className="text-xs font-medium text-gray-600">
            アクション
            <select
              value={draft.action}
              onChange={(event) => onDraftChange({ ...draft, action: event.target.value as EventRuleDraft['action'] })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="add_tag">タグを付ける</option>
              <option value="remove_tag">タグを外す</option>
            </select>
          </label>
          <label className="text-xs font-medium text-gray-600">
            対象タグ
            <select
              value={draft.tagId}
              onChange={(event) => onDraftChange({ ...draft, tagId: event.target.value })}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">タグを選択</option>
              {selectableTags.map((tag) => (
                <option key={tag.id} value={tag.id}>
                  {tag.name}{(tag as Tag & { kind?: string }).kind === 'system' ? '（system）' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 rounded-xl bg-purple-50 p-3 text-xs text-purple-900">
          <p className="font-bold">条件の考え方</p>
          <p className="mt-1">リッチメニューで `action=booking` を送る場合、条件キーは `action`、条件値は `booking` にします。条件を空にすると、そのイベント全てに反応します。</p>
        </div>

        <button
          type="button"
          disabled={saving || !draft.name.trim() || !draft.eventType || !draft.tagId}
          onClick={onCreateRule}
          className="mt-4 rounded-lg bg-purple-700 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
        >
          ルールを作成
        </button>

        <div className="mt-5">
          <h4 className="text-sm font-bold text-gray-900">設定済みルール</h4>
          <div className="mt-2 space-y-2">
            {rules.length === 0 ? (
              <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-400">イベントタグルールはまだありません。</p>
            ) : rules.map((rule) => (
              <div key={rule.id} className="rounded-xl border border-gray-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-gray-900">{rule.name}</p>
                    <p className="mt-1 text-xs text-gray-500">
                      {definitionName(rule.eventType)} → {rule.action === 'add_tag' ? '付与' : '削除'}: {tagName(rule.tagId)}
                    </p>
                    <p className="mt-1 break-all text-xs text-gray-400">条件: {rule.conditions}</p>
                  </div>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => onDeleteRule(rule)}
                    className="shrink-0 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50"
                  >
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white p-4">
        <h3 className="text-base font-bold text-gray-900">直近イベント</h3>
        <p className="mt-1 text-sm text-gray-500">予約導線やリッチメニューの反応がここに残ります。</p>
        <div className="mt-4 space-y-2">
          {events.length === 0 ? (
            <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-400">イベントはまだありません。</p>
          ) : events.map((event) => (
            <div key={event.id} className="rounded-xl border border-gray-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-semibold text-gray-900">{event.eventName || definitionName(event.eventType)}</p>
                  <p className="mt-1 text-xs text-gray-500">{event.eventType} / {event.eventSource}</p>
                  <p className="mt-1 text-xs text-gray-400">{formatDateTime(event.occurredAt)}</p>
                </div>
                <span className="shrink-0 rounded-full bg-gray-100 px-2 py-1 text-xs font-bold text-gray-600">
                  {event.subjectType || 'event'}
                </span>
              </div>
              {event.metadata && event.metadata !== '{}' && (
                <details className="mt-2 text-xs text-gray-500">
                  <summary className="cursor-pointer font-bold">metadata</summary>
                  <pre className="mt-2 max-h-32 overflow-auto rounded-lg bg-gray-50 p-2">{event.metadata}</pre>
                </details>
              )}
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function ReservationsPanel({
  date,
  resources,
  resourceId,
  slots,
  reservationsBySlot,
  reservations,
  selectedReservation,
  calendarOpen,
  viewFilter,
  onDateChange,
  onResourceChange,
  onViewFilterChange,
  onSelectReservation,
  onOpenCalendar,
  onCloseCalendar,
}: {
  date: string
  resources: ReservationResource[]
  resourceId: string
  slots: ReservationSlotWithAvailability[]
  reservationsBySlot: Map<string, ReservationResponse[]>
  reservations: ReservationResponse[]
  selectedReservation: ReservationResponse | null
  calendarOpen: boolean
  viewFilter: ReservationViewFilter
  onDateChange: (date: string) => void
  onResourceChange: (resourceId: string) => void
  onViewFilterChange: (filter: ReservationViewFilter) => void
  onSelectReservation: (reservation: ReservationResponse | null) => void
  onOpenCalendar: () => void
  onCloseCalendar: () => void
}) {
  const [calendarMonth, setCalendarMonth] = useState(date.slice(0, 7))
  const [slotDateMarks, setSlotDateMarks] = useState<Record<string, boolean>>({})
  const [loadingSlotMarks, setLoadingSlotMarks] = useState(false)
  useEffect(() => {
    setCalendarMonth(date.slice(0, 7))
  }, [date])
  const calendarDates = monthDates(`${calendarMonth}-01`)
  const selectedMonth = parseYmd(`${calendarMonth}-01`)
  useEffect(() => {
    if (!calendarOpen || !resourceId) return
    let cancelled = false
    setLoadingSlotMarks(true)
    const dates = monthDates(`${calendarMonth}-01`)
    Promise.all(dates.map(async (targetDate) => {
      try {
        const daySlots = await apiData<ReservationSlotWithAvailability[]>(
          `/api/reservation-slots?resourceId=${encodeURIComponent(resourceId)}&date=${encodeURIComponent(targetDate)}&people=1`,
        )
        return [targetDate, daySlots.length > 0] as const
      } catch {
        return [targetDate, false] as const
      }
    })).then((entries) => {
      if (!cancelled) setSlotDateMarks(Object.fromEntries(entries))
    }).finally(() => {
      if (!cancelled) setLoadingSlotMarks(false)
    })
    return () => {
      cancelled = true
    }
  }, [calendarOpen, calendarMonth, resourceId])
  const selectedResourceName = resources.find((resource) => resource.id === resourceId)?.name ?? '予約対象未選択'
  const activeReservations = reservations.filter(activeReservation)
  const filteredReservations = activeReservations.filter((reservation) => {
    if (viewFilter === 'line') return reservation.source === 'line'
    if (viewFilter === 'jalan') return reservation.source === 'jalan'
    return true
  })
  const totalPeople = activeReservations.reduce((sum, reservation) => sum + reservation.totalPeople, 0)
  const remaining = slots.reduce((sum, slot) => sum + Math.max(0, slot.availability.remainingCapacity), 0)
  const reservationsByTime = filteredReservations.reduce<Record<string, ReservationResponse[]>>((acc, reservation) => {
    const key = formatTime(reservation.startAt)
    acc[key] = [...(acc[key] ?? []), reservation]
    return acc
  }, {})
  const times = Object.keys(reservationsByTime).sort()
  const filterItems: Array<{ key: ReservationViewFilter; label: string }> = [
    { key: 'all', label: 'All' },
    { key: 'line', label: 'LINE' },
    { key: 'jalan', label: 'じゃらん' },
    { key: 'time', label: '時間別' },
  ]
  const moveCalendarMonth = (direction: -1 | 1) => {
    const next = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + direction, 1)
    setCalendarMonth(toYmd(next).slice(0, 7))
  }
  return (
    <section className="space-y-4">
      <div className="sticky top-0 z-20 -mx-4 border-y border-gray-100 bg-white/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:shadow-sm">
        <div className="flex gap-2 overflow-x-auto pb-1">
          <button type="button" onClick={onOpenCalendar} className="shrink-0 rounded-full bg-blue-600 px-4 py-2 text-sm font-bold text-white">
            カレンダー
          </button>
          <select value={resourceId} onChange={(event) => onResourceChange(event.target.value)} className="min-w-48 shrink-0 rounded-full border border-gray-300 px-3 py-2 text-sm">
            {resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
          </select>
        </div>
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {filterItems.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onViewFilterChange(item.key)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold ${viewFilter === item.key ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700'}`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {calendarOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="max-h-[86vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:mx-auto sm:max-w-xl sm:rounded-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="font-bold text-gray-900">日付を選択</p>
                <p className="mt-0.5 text-xs text-gray-500">{selectedMonth.getFullYear()}年{selectedMonth.getMonth() + 1}月</p>
              </div>
              <button type="button" onClick={onCloseCalendar} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold text-gray-700">閉じる</button>
            </div>
            {loadingSlotMarks && <p className="mb-2 text-xs text-gray-400">予約枠のある日を確認中...</p>}
            <div className="flex items-center justify-between gap-2">
              <button type="button" onClick={() => moveCalendarMonth(-1)} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold text-gray-700">前月</button>
              <input
                type="month"
                value={calendarMonth}
                onChange={(event) => setCalendarMonth(event.target.value || date.slice(0, 7))}
                className="min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
              <button type="button" onClick={() => moveCalendarMonth(1)} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold text-gray-700">次月</button>
            </div>
            <div className="mt-4 grid grid-cols-7 gap-1 text-center text-[11px] font-bold text-gray-400">
              {['日', '月', '火', '水', '木', '金', '土'].map((label) => <div key={label}>{label}</div>)}
            </div>
            <div className="mt-2 grid grid-cols-7 gap-1">
              {calendarDates.map((d) => {
                const current = parseYmd(d)
                const inMonth = current.getMonth() === selectedMonth.getMonth()
                return (
                  <button
                    key={d}
                    type="button"
                    onClick={() => { onDateChange(d); onCloseCalendar() }}
                    className={`min-h-[42px] rounded-xl border text-sm font-bold transition ${d === date ? 'border-blue-500 bg-blue-600 text-white' : inMonth ? 'border-gray-200 bg-white text-gray-800 hover:bg-blue-50' : 'border-gray-100 bg-gray-50 text-gray-300'}`}
                  >
                    <span className="block leading-tight">{Number(d.slice(-2))}</span>
                    {slotDateMarks[d] && <span className={`block text-[11px] leading-tight ${d === date ? 'text-white' : 'text-green-600'}`}>○</span>}
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {viewFilter === 'time' && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <h3 className="font-bold text-gray-900">時間別の予約枠</h3>
          <div className="mt-3 grid gap-2">
            {slots.length === 0 ? <p className="text-sm text-gray-400">予約枠はありません。</p> : slots.map((slot) => {
              const slotReservations = (reservationsBySlot.get(slot.id) ?? []).filter(activeReservation)
              const availability = slotAvailabilityLabel(slot)
              return (
                <details key={slot.id} className="rounded-xl border border-gray-200" open={slotReservations.length > 0}>
                  <summary className="flex cursor-pointer list-none items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-2">
                    <span className="font-bold text-gray-900">{formatTime(slot.startAt)} - {formatTime(slot.endAt)}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-500">{slotReservations.length}組</span>
                      <span className={`rounded-full px-2 py-1 text-xs font-bold ${availability.className}`}>{availability.mark} {availability.text}</span>
                    </span>
                  </summary>
                  {slotReservations.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-gray-400">予約なし</p>
                  ) : (
                    <div className="divide-y divide-gray-100">
                      {slotReservations.map((reservation) => (
                        <button key={reservation.id} type="button" onClick={() => onSelectReservation(reservation)} className="w-full p-3 text-left hover:bg-gray-50">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-gray-900">{reservationName(reservation)}</p>
                              <p className="mt-1 text-xs text-gray-500">{reservation.totalPeople}名 / {reservation.customerPhone || '電話未登録'}</p>
                              {hasPriceDetails(reservation) && <p className="mt-1 text-xs font-semibold text-amber-700">{formatPriceSummary(reservation)}</p>}
                            </div>
                            <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">{sourceBadge(reservation.source)}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </details>
              )
            })}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-bold text-gray-900">{selectedResourceName} / {date}</p>
        <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
          <OpsDailyMetric label="予約" value={`${activeReservations.length}件`} />
          <OpsDailyMetric label="人数" value={`${totalPeople}名`} />
          <OpsDailyMetric label="枠数" value={`${slots.length}枠`} />
          <OpsDailyMetric label="残数合計" value={`${remaining}`} />
        </div>
      </div>

      {viewFilter !== 'time' && (
        <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-bold text-gray-900">予約客リスト</h3>
            <p className="text-xs font-bold text-gray-500">{filteredReservations.length}件</p>
          </div>
          <div className="mt-3 space-y-3">
            {times.length === 0 ? <p className="text-sm text-gray-400">予約はありません。</p> : times.map((time) => (
              <section key={time} className="rounded-xl border border-gray-200">
                <div className="flex items-center justify-between border-b border-gray-100 bg-gray-50 px-3 py-2">
                  <p className="font-bold text-gray-900">{time}</p>
                  <p className="text-xs text-gray-500">{reservationsByTime[time].length}組</p>
                </div>
                <div className="divide-y divide-gray-100">
                  {reservationsByTime[time].map((reservation) => (
                    <button key={reservation.id} type="button" onClick={() => onSelectReservation(reservation)} className="w-full p-3 text-left hover:bg-gray-50">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-semibold text-gray-900">{reservationName(reservation)}</p>
                          <p className="mt-1 text-xs text-gray-500">{reservation.totalPeople}名 / {reservation.customerPhone || '電話未登録'}</p>
                          {hasPriceDetails(reservation) && <p className="mt-1 text-xs font-semibold text-amber-700">{formatPriceSummary(reservation)}</p>}
                        </div>
                        <span className="rounded-full bg-gray-100 px-2 py-1 text-xs text-gray-600">{sourceBadge(reservation.source)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
      {selectedReservation && (
        <OpsReservationDetailModal reservation={selectedReservation} onClose={() => onSelectReservation(null)} />
      )}
    </section>
  )
}

function OpsDailyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-blue-50 px-3 py-2">
      <p className="text-[11px] font-bold text-blue-700">{label}</p>
      <p className="mt-0.5 text-lg font-black text-blue-950">{value}</p>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-3 rounded-lg bg-gray-50 px-3 py-2">
      <dt className="text-xs font-bold text-gray-500">{label}</dt>
      <dd className="min-w-0 break-words text-sm text-gray-900">{value}</dd>
    </div>
  )
}

function OpsReservationDetailModal({ reservation, onClose }: { reservation: ReservationResponse; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[88vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:mx-auto sm:max-w-lg sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{reservationName(reservation)}</h3>
            <p className="mt-1 text-xs text-gray-500">{sourceBadge(reservation.source)} / {reservation.status}</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold text-gray-700">閉じる</button>
        </div>
        <dl className="mt-4 space-y-2 text-sm">
          <Info label="時間" value={`${formatTime(reservation.startAt)} - ${formatTime(reservation.endAt)}`} />
          <Info label="電話" value={reservation.customerPhone || '-'} />
          <Info label="メール" value={reservation.customerEmail || '-'} />
          <Info label="人数" value={`${reservation.totalPeople}名 大人${reservation.adultCount} / 小学生${reservation.childCount} / 幼児${reservation.infantCount} / 3歳以下${reservation.underThreeCount}`} />
          <Info label="枠消費" value={`${reservation.capacityPeople}枠`} />
          {hasPriceDetails(reservation) && <Info label="料金" value={formatPriceDetails(reservation)} />}
          <Info label="状態" value={reservation.status} />
          <Info label="外部ID" value={reservation.externalReservationId || '-'} />
        </dl>
      </div>
    </div>
  )
}

function ChatsPanel({
  chats,
  selectedChat,
  reply,
  saving,
  onSelect,
  onReplyChange,
  onSendReply,
}: {
  chats: ChatItem[]
  selectedChat: ChatDetail | null
  reply: string
  saving: boolean
  onSelect: (chat: ChatItem) => void
  onReplyChange: (value: string) => void
  onSendReply: () => void
}) {
  return (
    <section className="grid gap-4 xl:grid-cols-[360px_1fr]">
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 px-4 py-3">
          <h2 className="text-base font-bold text-gray-900">未対応チャット</h2>
          <p className="mt-1 text-xs text-gray-500">未読・対応中のみ表示します。</p>
        </div>
        <div className="max-h-[68vh] overflow-y-auto">
          {chats.length === 0 ? <p className="text-sm text-gray-400">未読・対応中のチャットはありません。</p> : chats.map((chat) => (
            <button key={chat.id} onClick={() => onSelect(chat)} className={`w-full border-b border-gray-100 p-3 text-left transition ${selectedChat?.id === chat.id ? 'bg-green-50' : 'hover:bg-gray-50'}`}>
              <div className="flex items-center gap-3">
                {chat.friendPictureUrl ? (
                  <img src={chat.friendPictureUrl} alt="" className="h-10 w-10 shrink-0 rounded-full" />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm font-bold text-gray-500">
                    {chat.friendName.slice(0, 1)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-semibold text-gray-900">{chat.friendName}</p>
                    <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-bold ${chat.status === 'unread' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{chat.status === 'unread' ? '未読' : '対応中'}</span>
                  </div>
                  <p className="mt-1 text-xs text-gray-400">最終: {formatDateTime(chat.lastMessageAt)}</p>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
        {!selectedChat ? <p className="p-6 text-sm text-gray-400">左からチャットを選択してください。</p> : (
          <>
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-base font-bold text-gray-900">{selectedChat.friendName} さんとの会話</h2>
              <p className="mt-1 text-xs text-gray-500">Automationの返信も送信ログに残す設計です。</p>
            </div>
            <div className="max-h-[56vh] space-y-2 overflow-y-auto bg-[#7494C0] p-4">
              {(selectedChat.messages ?? []).length === 0 ? <p className="text-sm text-gray-400">履歴がありません。</p> : (selectedChat.messages ?? []).map((message) => (
                <div key={message.id} className={`flex ${(message.direction === 'outgoing' || message.senderType === 'operator') ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm shadow-sm ${(message.direction === 'outgoing' || message.senderType === 'operator') ? 'bg-green-500 text-white' : 'bg-white text-gray-800'}`}>
                    <p className="whitespace-pre-wrap break-words">{message.content}</p>
                    <p className="mt-1 text-[11px] opacity-70">{formatDateTime(message.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-100 p-4">
              <textarea value={reply} onChange={(event) => onReplyChange(event.target.value)} rows={3} className="w-full rounded-xl border border-gray-300 p-3 text-sm" placeholder="返信内容を入力" />
              <button disabled={saving || !reply.trim()} onClick={onSendReply} className="mt-3 rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">送信前確認して返信</button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function JalanPanel({
  sources,
  saving,
  connections,
  resources,
  menusByResource,
  labels,
  rules,
  runs,
  lastRun,
  draft,
  onDraftChange,
  onLoadLabels,
  onCreateRule,
  onDeleteRule,
  onRunRule,
  onIgnore,
}: {
  sources: ExternalSource[]
  saving: boolean
  connections: ApiCalendarConnection[]
  resources: ReservationResource[]
  menusByResource: Record<string, ReservationMenu[]>
  labels: ApiGmailLabel[]
  rules: ApiGmailImportRule[]
  runs: ApiGmailImportRun[]
  lastRun: ApiGmailImportRunResult | null
  draft: GmailRuleDraft
  onDraftChange: (value: GmailRuleDraft) => void
  onLoadLabels: (connectionId?: string) => void
  onCreateRule: () => void
  onDeleteRule: (rule: ApiGmailImportRule) => void
  onRunRule: (rule: ApiGmailImportRule, dryRun: boolean) => void
  onIgnore: (source: ExternalSource) => void
}) {
  const selectedMenus = draft.resourceId ? menusByResource[draft.resourceId] ?? [] : []
  const activeRules = rules.filter((rule) => rule.isActive)
  return (
    <section className="grid gap-4 xl:grid-cols-[1fr_1fr]">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">じゃらんGmail取り込み設定</h2>
        <p className="mt-1 text-sm text-gray-500">
          Gmailで未処理ラベルを付けたじゃらんメールだけを読み、予約DBへ取り込みます。Google連携はGmail権限付きで再接続してください。
        </p>

        <div className="mt-4 grid gap-3">
          <label className="text-xs font-bold text-gray-600">
            Google接続
            <div className="mt-1 flex gap-2">
              <select
                value={draft.connectionId}
                onChange={(event) => onDraftChange({ ...draft, connectionId: event.target.value })}
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">選択してください</option>
                {connections.map((connection) => (
                  <option key={connection.id} value={connection.id}>{connection.calendarId}</option>
                ))}
              </select>
              <button
                type="button"
                disabled={saving || !draft.connectionId}
                onClick={() => onLoadLabels(draft.connectionId)}
                className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold text-gray-700 disabled:opacity-50"
              >
                ラベル取得
              </button>
            </div>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldMini label="ルール名">
              <input value={draft.name} onChange={(event) => onDraftChange({ ...draft, name: event.target.value })} className="input" />
            </FieldMini>
            <FieldMini label="差出人">
              <input value={draft.fromEmail} onChange={(event) => onDraftChange({ ...draft, fromEmail: event.target.value })} className="input" />
            </FieldMini>
          </div>

          <FieldMini label="Gmail検索条件">
            <input value={draft.query} onChange={(event) => onDraftChange({ ...draft, query: event.target.value })} className="input" />
          </FieldMini>

          <div className="grid gap-3 sm:grid-cols-2">
            <LabelSelect label="未処理ラベル" value={draft.unprocessedLabelId} labels={labels} onChange={(value) => onDraftChange({ ...draft, unprocessedLabelId: value })} />
            <LabelSelect label="処理済みラベル" value={draft.processedLabelId} labels={labels} onChange={(value) => onDraftChange({ ...draft, processedLabelId: value })} />
            <LabelSelect label="要確認ラベル" value={draft.reviewLabelId} labels={labels} onChange={(value) => onDraftChange({ ...draft, reviewLabelId: value })} />
            <LabelSelect label="失敗ラベル" value={draft.failedLabelId} labels={labels} onChange={(value) => onDraftChange({ ...draft, failedLabelId: value })} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <FieldMini label="取り込み先 Resource">
              <select
                value={draft.resourceId}
                onChange={(event) => onDraftChange({ ...draft, resourceId: event.target.value, menuId: '' })}
                className="input"
              >
                <option value="">選択してください</option>
                {resources.map((resource) => (
                  <option key={resource.id} value={resource.id}>{resource.name}</option>
                ))}
              </select>
            </FieldMini>
            <FieldMini label="取り込み先 Menu">
              <select value={draft.menuId} onChange={(event) => onDraftChange({ ...draft, menuId: event.target.value })} className="input">
                <option value="">選択してください</option>
                {selectedMenus.map((menu) => (
                  <option key={menu.id} value={menu.id}>{menu.name}</option>
                ))}
              </select>
            </FieldMini>
          </div>

          <FieldMini label="1回の最大取得数">
            <input
              type="number"
              min={1}
              max={50}
              value={draft.maxResults}
              onChange={(event) => onDraftChange({ ...draft, maxResults: Number(event.target.value || 10) })}
              className="input"
            />
          </FieldMini>

          <button disabled={saving} onClick={onCreateRule} className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
            取り込みルールを作成
          </button>
        </div>

        <div className="mt-5 space-y-2">
          <p className="text-sm font-bold text-gray-900">有効な取り込みルール</p>
          {activeRules.length === 0 ? <p className="rounded-xl bg-gray-50 p-4 text-sm text-gray-400">まだルールがありません。</p> : activeRules.map((rule) => (
            <div key={rule.id} className="rounded-xl border border-gray-200 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-gray-900">{rule.name}</p>
                  <p className="mt-1 text-xs text-gray-500">from: {rule.fromEmail || '-'} / 最大{rule.maxResults}件 / 最終: {formatDateTime(rule.lastRunAt)}</p>
                </div>
                <button disabled={saving} onClick={() => onDeleteRule(rule)} className="shrink-0 rounded-lg border border-red-200 px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50">停止</button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button disabled={saving} onClick={() => onRunRule(rule, true)} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold text-gray-700 disabled:opacity-50">テスト解析</button>
                <button disabled={saving} onClick={() => onRunRule(rule, false)} className="rounded-lg bg-green-700 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">今すぐ取り込み</button>
              </div>
            </div>
          ))}
        </div>

        {lastRun && (
          <div className="mt-5 rounded-xl border border-blue-100 bg-blue-50 p-3">
            <p className="text-sm font-bold text-blue-950">直近実行結果</p>
            <p className="mt-1 text-xs text-blue-800">
              取得 {lastRun.fetchedCount}件 / 取込 {lastRun.importedCount}件 / 要確認 {lastRun.reviewCount}件 / 失敗 {lastRun.failedCount}件
            </p>
            <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
              {lastRun.items.map((item) => (
                <p key={item.gmailMessageId} className="rounded-lg bg-white px-2 py-1 text-xs text-gray-700">
                  {item.parseStatus} / {item.eventType} / {item.externalId || item.gmailMessageId}{item.error ? ` / ${item.error}` : ''}
                </p>
              ))}
            </div>
          </div>
        )}

        <div className="mt-5 space-y-2">
          <p className="text-sm font-bold text-gray-900">実行履歴</p>
          {runs.length === 0 ? <p className="text-sm text-gray-400">履歴はありません。</p> : runs.slice(0, 5).map((run) => (
            <div key={run.id} className="rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600">
              {formatDateTime(run.startedAt)} / {run.status} / 取得{run.fetchedCount} 取込{run.importedCount} 要確認{run.reviewCount} 失敗{run.failedCount}
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">じゃらん要確認メール</h2>
        <p className="mt-1 text-sm text-gray-500">updated、枠超過、経路未設定など、自動反映しないメールだけ表示します。</p>
        <div className="mt-4 grid gap-3">
          {sources.length === 0 ? <p className="rounded-xl bg-gray-50 p-6 text-center text-sm text-gray-400">要確認メールはありません。</p> : sources.map((source) => (
            <details key={source.id} className="rounded-xl border border-amber-100 bg-amber-50">
              <summary className="cursor-pointer px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-bold text-amber-950">{source.eventType} / {source.parseStatus}</p>
                    <p className="text-xs text-amber-800">{formatDateTime(source.receivedAt)} / {source.externalReservationId || source.dedupeKey || '外部IDなし'}</p>
                  </div>
                  <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-amber-700">要確認</span>
                </div>
              </summary>
              <div className="border-t border-amber-100 bg-white p-4">
                <p className="text-xs font-bold text-gray-500">エラー/メモ</p>
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{source.lastError || 'なし'}</p>
                <p className="mt-3 text-xs font-bold text-gray-500">本文抜粋</p>
                <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-600">{source.rawText || source.parsedPayload || '本文なし'}</p>
                <button disabled={saving} onClick={() => onIgnore(source)} className="mt-3 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 disabled:opacity-50">確認済みにする</button>
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  )
}

function FieldMini({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-xs font-bold text-gray-600">
      {label}
      <div className="mt-1">{children}</div>
    </label>
  )
}

function LabelSelect({ label, value, labels, onChange }: { label: string; value: string; labels: ApiGmailLabel[]; onChange: (value: string) => void }) {
  return (
    <FieldMini label={label}>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="input">
        <option value="">選択してください</option>
        {labels.map((item) => (
          <option key={item.id} value={item.id}>{item.name}</option>
        ))}
      </select>
    </FieldMini>
  )
}

function BroadcastPanel({
  broadcasts,
  templates,
  draft,
  imageUrl,
  saving,
  uploadingImage,
  onDraftChange,
  onCreateDraft,
  onSend,
  onUploadImage,
}: {
  broadcasts: ApiBroadcast[]
  templates: Template[]
  draft: BroadcastDraft
  imageUrl: string
  saving: boolean
  uploadingImage: boolean
  onDraftChange: (value: BroadcastDraft) => void
  onCreateDraft: () => void
  onSend: (broadcast: ApiBroadcast) => void
  onUploadImage: (file: File | null) => void
}) {
  const active = broadcasts.filter((broadcast) => broadcast.status === 'draft' || broadcast.status === 'scheduled')
  const flexPreviewable = draft.messageType === 'flex' && draft.messageContent.trim().startsWith('{')
  const applyTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId)
    if (!template) {
      onDraftChange({ ...draft, templateId })
      return
    }
    onDraftChange({
      ...draft,
      templateId,
      title: draft.title.trim() ? draft.title : template.name,
      messageType: template.messageType as ApiBroadcast['messageType'],
      messageContent: template.messageContent,
    })
  }
  const applyCard = () => {
    const nextDraft = { ...draft, cardImageUrl: draft.cardImageUrl || imageUrl }
    onDraftChange({
      ...nextDraft,
      messageType: 'flex',
      messageContent: buildBroadcastFlexCard(nextDraft),
      title: nextDraft.title.trim() ? nextDraft.title : nextDraft.cardTitle,
      templateId: '',
    })
  }
  return (
    <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">一斉配信下書き</h2>
        <p className="mt-1 text-sm text-gray-500">テンプレートを選んで内容をコピーし、下書きとして保存します。送信は確認ダイアログを通します。</p>
        <label className="mt-4 block text-xs font-bold text-gray-600">
          テンプレートを流用
          <select
            value={draft.templateId}
            onChange={(event) => applyTemplate(event.target.value)}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="">テンプレートを選択しない</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>{template.name} / {template.messageType}</option>
            ))}
          </select>
        </label>
        <div className="mt-4 rounded-xl border border-dashed border-blue-200 bg-blue-50 p-3">
          <p className="text-sm font-bold text-blue-950">画像URL発行</p>
          <p className="mt-1 text-xs text-blue-800">画像をWorker/R2にアップロードし、公開URLを発行します。5MB以下の png / jpeg / gif / webp に対応します。</p>
          <input
            type="file"
            accept="image/png,image/jpeg,image/gif,image/webp"
            disabled={uploadingImage}
            onChange={(event) => onUploadImage(event.target.files?.[0] ?? null)}
            className="mt-3 w-full rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm"
          />
          {imageUrl && (
            <div className="mt-3 rounded-lg bg-white p-3">
              <p className="text-xs font-bold text-gray-500">発行URL</p>
              <div className="mt-1 flex gap-2">
                <input readOnly value={imageUrl} className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-xs text-gray-700" />
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(imageUrl)}
                  className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold text-gray-700"
                >
                  コピー
                </button>
              </div>
              <img src={imageUrl} alt="アップロード画像プレビュー" className="mt-3 max-h-32 rounded-lg border border-gray-100 object-contain" />
            </div>
          )}
        </div>
        <details className="mt-4 rounded-xl border border-green-100 bg-green-50 p-3">
          <summary className="cursor-pointer text-sm font-bold text-green-950">カードをフォームから作成</summary>
          <div className="mt-3 grid gap-3">
            <input value={draft.cardTitle} onChange={(event) => onDraftChange({ ...draft, cardTitle: event.target.value })} className="rounded-lg border border-green-200 px-3 py-2 text-sm" placeholder="カードタイトル" />
            <textarea value={draft.cardBody} onChange={(event) => onDraftChange({ ...draft, cardBody: event.target.value })} rows={3} className="rounded-lg border border-green-200 p-3 text-sm" placeholder="説明文" />
            <div className="grid gap-2 sm:grid-cols-2">
              <input value={draft.cardButtonLabel} onChange={(event) => onDraftChange({ ...draft, cardButtonLabel: event.target.value })} className="rounded-lg border border-green-200 px-3 py-2 text-sm" placeholder="ボタン名" />
              <input value={draft.cardUrl} onChange={(event) => onDraftChange({ ...draft, cardUrl: event.target.value })} className="rounded-lg border border-green-200 px-3 py-2 text-sm" placeholder="リンクURL" />
            </div>
            <input value={draft.cardImageUrl || imageUrl} onChange={(event) => onDraftChange({ ...draft, cardImageUrl: event.target.value })} className="rounded-lg border border-green-200 px-3 py-2 text-sm" placeholder="画像URL" />
            <div className="grid gap-2 sm:grid-cols-3">
              <select value={draft.cardSize} onChange={(event) => onDraftChange({ ...draft, cardSize: event.target.value as BroadcastDraft['cardSize'] })} className="rounded-lg border border-green-200 px-3 py-2 text-sm">
                <option value="kilo">カード小</option>
                <option value="mega">カード標準</option>
                <option value="giga">カード大</option>
              </select>
              <select value={draft.cardTitleSize} onChange={(event) => onDraftChange({ ...draft, cardTitleSize: event.target.value as BroadcastDraft['cardTitleSize'] })} className="rounded-lg border border-green-200 px-3 py-2 text-sm">
                <option value="lg">タイトル小</option>
                <option value="xl">タイトル標準</option>
                <option value="xxl">タイトル大</option>
              </select>
              <select value={draft.cardBodySize} onChange={(event) => onDraftChange({ ...draft, cardBodySize: event.target.value as BroadcastDraft['cardBodySize'] })} className="rounded-lg border border-green-200 px-3 py-2 text-sm">
                <option value="xs">本文小</option>
                <option value="sm">本文標準</option>
                <option value="md">本文大</option>
              </select>
            </div>
            <button type="button" onClick={applyCard} className="w-fit rounded-lg bg-green-700 px-3 py-2 text-xs font-bold text-white">
              カードを配信内容に反映
            </button>
          </div>
        </details>
        <input value={draft.title} onChange={(event) => onDraftChange({ ...draft, title: event.target.value })} className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="配信タイトル" />
        <select value={draft.messageType} onChange={(event) => onDraftChange({ ...draft, messageType: event.target.value as ApiBroadcast['messageType'] })} className="mt-3 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm">
          <option value="text">テキスト</option>
          <option value="image">画像</option>
          <option value="flex">Flexカード</option>
        </select>
        <textarea value={draft.messageContent} onChange={(event) => onDraftChange({ ...draft, messageContent: event.target.value })} rows={8} className="mt-3 w-full rounded-lg border border-gray-300 p-3 font-mono text-xs" placeholder="配信本文またはFlex JSON" />
        <button disabled={saving || !draft.title.trim() || !draft.messageContent.trim()} onClick={onCreateDraft} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">下書き作成</button>
      </div>
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">プレビュー / 送信待ち</h2>
        <div className="mt-3 rounded-xl border border-gray-200 bg-gray-50 p-3">
          <p className="text-xs font-bold text-gray-500">現在の配信イメージ</p>
          <div className="mt-3">
            {draft.messageType === 'flex' && flexPreviewable ? (
              <FlexPreviewComponent content={draft.messageContent} maxWidth={draft.cardSize === 'giga' ? 340 : draft.cardSize === 'kilo' ? 260 : 300} />
            ) : draft.messageType === 'image' && draft.messageContent.trim() ? (
              <img src={draft.messageContent.trim()} alt="配信画像プレビュー" className="max-h-64 rounded-lg border border-gray-200 object-contain" />
            ) : (
              <div className="whitespace-pre-wrap rounded-lg bg-white p-3 text-sm text-gray-800">{draft.messageContent || '配信内容のプレビューがここに表示されます。'}</div>
            )}
          </div>
        </div>
        <div className="mt-3 space-y-2">
          {active.length === 0 ? <p className="text-sm text-gray-400">送信待ちの配信はありません。</p> : active.map((broadcast) => (
            <div key={broadcast.id} className="rounded-xl border border-gray-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="font-semibold text-gray-900">{broadcast.title}</p>
                  <p className="text-xs text-gray-500">{broadcast.status} / 対象: {broadcast.targetType === 'all' ? '全員' : 'タグ指定'}</p>
                </div>
                <button disabled={saving} onClick={() => onSend(broadcast)} className="rounded-lg bg-red-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">確認して送信</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}

function buildBroadcastFlexCard(input: BroadcastDraft): string {
  const title = input.cardTitle.trim() || 'お知らせ'
  const body = input.cardBody.trim() || '詳細をご確認ください。'
  const buttonLabel = input.cardButtonLabel.trim() || '詳しく見る'
  const linkUrl = input.cardUrl.trim() || 'https://example.com'
  const imageUrl = input.cardImageUrl.trim()
  const bubble: Record<string, unknown> = {
    type: 'bubble',
    size: input.cardSize,
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        { type: 'text', text: title, weight: 'bold', size: input.cardTitleSize, wrap: true, color: '#1F4F7A' },
        { type: 'text', text: body, size: input.cardBodySize, wrap: true, color: '#4B5563' },
      ],
    },
    footer: {
      type: 'box',
      layout: 'vertical',
      spacing: 'sm',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: '#69A3D0',
          action: { type: 'uri', label: buttonLabel, uri: linkUrl },
        },
      ],
    },
  }
  if (imageUrl) {
    bubble.hero = {
      type: 'image',
      url: imageUrl,
      size: 'full',
      aspectRatio: '20:13',
      aspectMode: 'cover',
    }
  }
  return JSON.stringify(bubble, null, 2)
}
