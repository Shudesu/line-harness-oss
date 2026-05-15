'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  ApiResponse,
  ExternalReservationSourceResponse,
  ReservationResource,
  ReservationResponse,
  ReservationSlotWithAvailability,
} from '@line-crm/shared'
import { api, fetchApi, type ApiBroadcast, type ApiCalendarConnection, type CalendarSyncResult } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

type Tab = 'reservations' | 'chats' | 'jalan' | 'broadcasts' | 'calendar'

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

const tabs: Array<{ key: Tab; label: string; hint: string }> = [
  { key: 'reservations', label: '予約', hint: '今日の枠と予約客' },
  { key: 'chats', label: 'チャット', hint: '未読・対応中だけ' },
  { key: 'jalan', label: 'じゃらん', hint: '要確認メール' },
  { key: 'broadcasts', label: '一斉配信', hint: '下書き確認と送信' },
  { key: 'calendar', label: 'カレンダー', hint: 'Google連携状態' },
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

function formatTime(value: string | null): string {
  if (!value) return '-'
  const match = value.match(/T(\d{2}:\d{2})/)
  return match?.[1] ?? value.slice(11, 16) ?? value
}

function formatDateTime(value: string | null): string {
  if (!value) return '-'
  return new Date(value).toLocaleString('ja-JP', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
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
  const [date, setDate] = useState(toYmd(new Date()))
  const [resources, setResources] = useState<ReservationResource[]>([])
  const [resourceId, setResourceId] = useState('')
  const [slots, setSlots] = useState<ReservationSlotWithAvailability[]>([])
  const [reservations, setReservations] = useState<ReservationResponse[]>([])
  const [externalSources, setExternalSources] = useState<ExternalSource[]>([])
  const [chats, setChats] = useState<ChatItem[]>([])
  const [selectedChat, setSelectedChat] = useState<ChatDetail | null>(null)
  const [selectedReservation, setSelectedReservation] = useState<ReservationResponse | null>(null)
  const [reservationCalendarOpen, setReservationCalendarOpen] = useState(false)
  const [reply, setReply] = useState('')
  const [broadcasts, setBroadcasts] = useState<ApiBroadcast[]>([])
  const [calendarConnections, setCalendarConnections] = useState<ApiCalendarConnection[]>([])
  const [calendarId, setCalendarId] = useState('primary')
  const [broadcastDraft, setBroadcastDraft] = useState({ title: '', messageContent: '' })
  const [imageUrl, setImageUrl] = useState('')
  const [uploadingImage, setUploadingImage] = useState(false)
  const [calendarSettingsOpen, setCalendarSettingsOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const activeReservations = reservations.filter(activeReservation)
  const unreadChats = chats.filter((chat) => chat.status === 'unread')
  const draftBroadcasts = broadcasts.filter((broadcast) => broadcast.status === 'draft' || broadcast.status === 'scheduled')
  const activeCalendarConnections = calendarConnections.filter((connection) => connection.isActive)

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

  const loadCalendarConnections = useCallback(async () => {
    const res = await api.calendar.listConnections()
    if (res.success) setCalendarConnections(res.data)
    else throw new Error(res.error)
  }, [])

  const loadAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      await Promise.all([loadReservations(), loadChats(), loadExternalSources(), loadBroadcasts(), loadCalendarConnections()])
    } catch (err) {
      setError(err instanceof Error ? err.message : '読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [loadReservations, loadChats, loadExternalSources, loadBroadcasts, loadCalendarConnections])

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

  const createBroadcastDraft = async () => {
    if (!broadcastDraft.title.trim() || !broadcastDraft.messageContent.trim()) return
    await runAction(async () => {
      const res = await api.broadcasts.create({
        title: broadcastDraft.title.trim(),
        messageType: 'text',
        messageContent: broadcastDraft.messageContent.trim(),
        targetType: 'all',
        status: 'draft',
        lineAccountId: selectedAccountId || null,
      })
      if (!res.success) throw new Error(res.error)
      setBroadcastDraft({ title: '', messageContent: '' })
    }, '一斉配信の下書きを作成しました')
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
      window.open(res.data.url, '_blank', 'noopener,noreferrer')
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
        <SummaryCard label="本日の予約" value={`${activeReservations.length}件`} tone="green" />
        <SummaryCard label="未読チャット" value={`${unreadChats.length}件`} tone="red" />
        <SummaryCard label="じゃらん要確認" value={`${externalSources.length}件`} tone="amber" />
        <SummaryCard label="配信下書き" value={`${draftBroadcasts.length}件`} tone="blue" />
        <SummaryCard label="Google連携" value={`${activeCalendarConnections.length}件`} tone="green" />
        </div>
      </div>

      <div className="sticky top-0 z-20 -mx-4 mt-3 border-y border-gray-100 bg-white/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:shadow-sm">
        <div className="flex gap-2 overflow-x-auto">
          {tabs.map((item) => (
            <button
              key={item.key}
              onClick={() => setTab(item.key)}
              className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold transition ${tab === item.key ? 'bg-green-600 text-white' : 'bg-gray-50 text-gray-700 hover:bg-gray-100'}`}
            >
              {item.label}
            </button>
          ))}
          <a href="/reservations" className="shrink-0 rounded-full border border-gray-300 px-4 py-2 text-sm font-bold text-gray-700 hover:bg-gray-50">
            詳細設定
          </a>
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
          {tab === 'jalan' && (
            <JalanPanel sources={externalSources} saving={saving} onIgnore={markExternalIgnored} />
          )}
          {tab === 'broadcasts' && (
            <BroadcastPanel
              broadcasts={broadcasts}
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
          {tab === 'calendar' && (
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
          )}
        </div>
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

function ReservationsPanel({
  date,
  resources,
  resourceId,
  slots,
  reservationsBySlot,
  reservations,
  selectedReservation,
  calendarOpen,
  onDateChange,
  onResourceChange,
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
  onDateChange: (date: string) => void
  onResourceChange: (resourceId: string) => void
  onSelectReservation: (reservation: ReservationResponse | null) => void
  onOpenCalendar: () => void
  onCloseCalendar: () => void
}) {
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(startOfWeek(date), index))
  const selectedResourceName = resources.find((resource) => resource.id === resourceId)?.name ?? '予約対象未選択'
  const activeReservations = reservations.filter(activeReservation)
  const totalPeople = activeReservations.reduce((sum, reservation) => sum + reservation.totalPeople, 0)
  const remaining = slots.reduce((sum, slot) => sum + Math.max(0, slot.availability.remainingCapacity), 0)
  const reservationsByTime = activeReservations.reduce<Record<string, ReservationResponse[]>>((acc, reservation) => {
    const key = formatTime(reservation.startAt)
    acc[key] = [...(acc[key] ?? []), reservation]
    return acc
  }, {})
  const times = Object.keys(reservationsByTime).sort()
  return (
    <section className="space-y-4">
      <div className="sticky top-0 z-20 -mx-4 border-y border-gray-100 bg-white/95 px-4 py-2 backdrop-blur sm:mx-0 sm:rounded-2xl sm:border sm:shadow-sm">
        <div className="flex gap-2 overflow-x-auto">
          <button type="button" onClick={onOpenCalendar} className="shrink-0 rounded-full bg-blue-600 px-4 py-2 text-sm font-bold text-white">
            カレンダー
          </button>
          <input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} className="shrink-0 rounded-full border border-gray-300 px-3 py-2 text-sm" />
          <select value={resourceId} onChange={(event) => onResourceChange(event.target.value)} className="min-w-48 shrink-0 rounded-full border border-gray-300 px-3 py-2 text-sm">
            {resources.map((resource) => <option key={resource.id} value={resource.id}>{resource.name}</option>)}
          </select>
        </div>
      </div>

      {calendarOpen && (
        <div className="fixed inset-0 z-50 flex items-end bg-black/40 p-0 sm:items-center sm:p-4">
          <div className="max-h-[86vh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:mx-auto sm:max-w-xl sm:rounded-2xl">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="font-bold text-gray-900">日付を選択</p>
              <button type="button" onClick={onCloseCalendar} className="rounded-lg border border-gray-300 px-3 py-2 text-xs font-bold text-gray-700">閉じる</button>
            </div>
            <input type="date" value={date} onChange={(event) => { onDateChange(event.target.value); onCloseCalendar() }} className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
            <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
              {weekDates.map((d) => (
                <button key={d} type="button" onClick={() => { onDateChange(d); onCloseCalendar() }} className={`min-w-[72px] rounded-2xl border px-3 py-2 text-center transition ${d === date ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'}`}>
                  <p className="text-[11px] font-bold">{['日', '月', '火', '水', '木', '金', '土'][parseYmd(d).getDay()]}</p>
                  <p className="text-xl font-black leading-tight">{Number(d.slice(-2))}</p>
                </button>
              ))}
            </div>
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

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h3 className="font-bold text-gray-900">予約客リスト</h3>
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
          <Info label="人数" value={`${reservation.totalPeople}名 大人${reservation.adultCount} / 子ども${reservation.childCount} / 幼児${reservation.infantCount}`} />
          <Info label="枠消費" value={`${reservation.capacityPeople}枠`} />
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
    <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">未対応チャット</h2>
        <div className="mt-3 space-y-2">
          {chats.length === 0 ? <p className="text-sm text-gray-400">未読・対応中のチャットはありません。</p> : chats.map((chat) => (
            <button key={chat.id} onClick={() => onSelect(chat)} className="w-full rounded-xl border border-gray-200 p-3 text-left hover:bg-gray-50">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold text-gray-900">{chat.friendName}</p>
                <span className={`rounded-full px-2 py-1 text-xs font-bold ${chat.status === 'unread' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>{chat.status === 'unread' ? '未読' : '対応中'}</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">最終: {formatDateTime(chat.lastMessageAt)}</p>
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">返信</h2>
        {!selectedChat ? <p className="mt-3 text-sm text-gray-400">左からチャットを選択してください。</p> : (
          <>
            <p className="mt-1 text-sm text-gray-500">{selectedChat.friendName} さんとの会話</p>
            <div className="mt-4 max-h-80 space-y-2 overflow-y-auto rounded-xl bg-gray-50 p-3">
              {(selectedChat.messages ?? []).length === 0 ? <p className="text-sm text-gray-400">履歴がありません。</p> : (selectedChat.messages ?? []).map((message) => (
                <div key={message.id} className={`flex ${(message.direction === 'outgoing' || message.senderType === 'operator') ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${(message.direction === 'outgoing' || message.senderType === 'operator') ? 'bg-green-600 text-white' : 'bg-white text-gray-800'}`}>
                    <p className="whitespace-pre-wrap break-words">{message.content}</p>
                    <p className="mt-1 text-[11px] opacity-70">{formatDateTime(message.createdAt)}</p>
                  </div>
                </div>
              ))}
            </div>
            <textarea value={reply} onChange={(event) => onReplyChange(event.target.value)} rows={4} className="mt-4 w-full rounded-xl border border-gray-300 p-3 text-sm" placeholder="返信内容を入力" />
            <button disabled={saving || !reply.trim()} onClick={onSendReply} className="mt-3 rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">送信前確認して返信</button>
          </>
        )}
      </div>
    </section>
  )
}

function JalanPanel({ sources, saving, onIgnore }: { sources: ExternalSource[]; saving: boolean; onIgnore: (source: ExternalSource) => void }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-bold text-gray-900">じゃらんメール管理</h2>
      <p className="mt-1 text-sm text-gray-500">自動反映しない `updated` や枠超過など、確認が必要なメールだけ表示します。</p>
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
    </section>
  )
}

function BroadcastPanel({
  broadcasts,
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
  draft: { title: string; messageContent: string }
  imageUrl: string
  saving: boolean
  uploadingImage: boolean
  onDraftChange: (value: { title: string; messageContent: string }) => void
  onCreateDraft: () => void
  onSend: (broadcast: ApiBroadcast) => void
  onUploadImage: (file: File | null) => void
}) {
  const active = broadcasts.filter((broadcast) => broadcast.status === 'draft' || broadcast.status === 'scheduled')
  return (
    <section className="grid gap-4 xl:grid-cols-[0.8fr_1.2fr]">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">一斉配信下書き</h2>
        <p className="mt-1 text-sm text-gray-500">この画面では安全のため、まず下書きを作成します。送信は確認ダイアログを通します。</p>
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
        <input value={draft.title} onChange={(event) => onDraftChange({ ...draft, title: event.target.value })} className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="配信タイトル" />
        <textarea value={draft.messageContent} onChange={(event) => onDraftChange({ ...draft, messageContent: event.target.value })} rows={6} className="mt-3 w-full rounded-lg border border-gray-300 p-3 text-sm" placeholder="配信本文" />
        <button disabled={saving || !draft.title.trim() || !draft.messageContent.trim()} onClick={onCreateDraft} className="mt-3 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">下書き作成</button>
      </div>
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-bold text-gray-900">送信待ち</h2>
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
