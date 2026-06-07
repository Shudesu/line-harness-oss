'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { api, fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'
import FlexPreviewComponent from '@/components/flex-preview'
import FriendInfoSidebar from '@/components/chats/friend-info-sidebar'
import ImageUploader, { type ImageUploaderValue } from '@/components/shared/image-uploader'
import { Badge, EmptyState, Input, cx } from '@/components/ui/primitives'

const PINNED_CHATS_KEY = 'hyhome-harness:pinned-chat-friend-ids'
const MESSAGE_GROUP_THRESHOLD_MS = 5000

interface Chat {
  id: string
  friendId: string
  friendName: string
  friendPictureUrl: string | null
  operatorId: string | null
  status: 'unread' | 'in_progress' | 'resolved'
  notes: string | null
  lastMessageAt: string | null
  lastMessageContent: string | null
  lastMessageDirection: 'incoming' | 'outgoing' | null
  lastMessageType: string | null
  createdAt: string
  updatedAt: string
}

interface ChatMessage {
  id: string
  direction: 'incoming' | 'outgoing'
  messageType: string
  content: string
  createdAt: string
}

interface ChatDetail extends Chat {
  friendName: string
  friendPictureUrl: string | null
  messages?: ChatMessage[]
}

type StatusFilter = 'all' | 'unread' | 'in_progress' | 'resolved'

const statusFilters: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全て' },
  { key: 'unread', label: '未読' },
  { key: 'in_progress', label: '対応中' },
  { key: 'resolved', label: '解決済' },
]

const SHOW_LOADING_PREF_KEY = 'lh_chat_show_loading_indicator'
const LOADING_SECONDS_PREF_KEY = 'lh_chat_loading_seconds'
const LOADING_REFRESH_INTERVAL_MS = 4000

function formatDatetime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function sameYmd(aIso: string, bIso: string): boolean {
  const a = new Date(aIso)
  const b = new Date(bIso)
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  )
}

function formatYmdSlash(iso: string): string {
  const d = new Date(iso)
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`
}

const WEEKDAY_JA = ['日', '月', '火', '水', '木', '金', '土'] as const
function formatDateSeparator(iso: string): string {
  const d = new Date(iso)
  return `${d.getMonth() + 1}/${d.getDate()} ${WEEKDAY_JA[d.getDay()]}`
}

function formatFullDatetime(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/**
 * 一覧で表示する preview と検索対象を同じ文字列に揃えるための helper。
 * 「画像」「Flexメッセージ」など type 表記を出している先頭の絵文字付きラベルを返す。
 * 通常テキストは改行を空白に潰し、長すぎる場合は 60 文字で切る (検索用にも十分)。
 */
function chatPreviewText(chat: Chat): string {
  switch (chat.lastMessageType) {
    case 'image': return '📷 画像'
    case 'flex': return '📋 Flexメッセージ'
    case 'sticker': return '🎨 スタンプ'
    case 'video': return '🎥 動画'
    case 'audio': return '🎤 音声'
    case 'file': return '📎 ファイル'
    case 'location': return '📍 位置情報'
    default: return (chat.lastMessageContent ?? '').replace(/\n+/g, ' ').slice(0, 60)
  }
}

const ccPrompts = [
  {
    title: 'チャット対応テンプレート',
    prompt: `チャット対応で使えるテンプレートメッセージを作成してください。
1. よくある質問への回答テンプレート（挨拶、FAQ、サポート）
2. クレーム対応用の丁寧な返信テンプレート
3. フォローアップメッセージのテンプレート
手順を示してください。`,
  },
  {
    title: '未対応チャット確認',
    prompt: `未対応のチャットを確認し、対応優先度を整理してください。
1. 未読・対応中のチャット数を集計
2. 最終メッセージからの経過時間で優先度を判定
3. 長時間未対応のチャットへの対応アクションを提案
結果をレポートしてください。`,
  },
]

interface FriendItem {
  id: string
  displayName: string
  pictureUrl: string | null
  isFollowing: boolean
}

interface MessageLog {
  id: string
  direction: 'incoming' | 'outgoing'
  messageType: string
  content: string
  createdAt: string
}

function DirectMessagePanel({ friendId, friend, onBack, onSent }: {
  friendId: string
  friend: FriendItem | null
  onBack: () => void
  onSent: () => void
}) {
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [messages, setMessages] = useState<MessageLog[]>([])
  const [loadingMessages, setLoadingMessages] = useState(true)
  const isComposingRef = useRef(false)
  const sendLockRef = useRef(false)

  useEffect(() => {
    const loadMessages = async () => {
      setLoadingMessages(true)
      try {
        const res = await fetchApi<{ success: boolean; data: MessageLog[] }>(
          `/api/friends/${friendId}/messages`
        )
        if (res.success) setMessages(res.data)
      } catch { /* silent */ }
      setLoadingMessages(false)
    }
    loadMessages()
  }, [friendId])

  const handleSend = async () => {
    if (!message.trim() || sending || sendLockRef.current) return
    sendLockRef.current = true
    setSending(true)
    try {
      await fetchApi(`/api/friends/${friendId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content: message, messageType: 'text' }),
      })
      setMessages((prev) => [...prev, {
        id: crypto.randomUUID(),
        direction: 'outgoing',
        messageType: 'text',
        content: message,
        createdAt: new Date().toISOString(),
      }])
      setMessage('')
    } catch { /* silent */ }
    setSending(false)
    sendLockRef.current = false
  }

  function renderContent(msg: MessageLog) {
    if (msg.messageType === 'text') return msg.content
    if (msg.messageType === 'flex') {
      try {
        const parsed = JSON.parse(msg.content)
        // Extract ALL text from flex (up to 200 chars)
        const texts: string[] = []
        const collectText = (obj: Record<string, unknown>) => {
          if (texts.join(' ').length > 200) return
          if (obj.type === 'text' && typeof obj.text === 'string') {
            const t = (obj.text as string).trim()
            if (t && !t.startsWith('{{')) texts.push(t)
          }
          for (const key of ['header', 'body', 'footer']) {
            if (obj[key]) collectText(obj[key] as Record<string, unknown>)
          }
          if (Array.isArray(obj.contents)) {
            for (const c of obj.contents) collectText(c as Record<string, unknown>)
          }
        }
        collectText(parsed)
        return texts.slice(0, 4).join('\n') || '[Flex Message]'
      } catch { return '[Flex Message]' }
    }
    return `[${msg.messageType}]`
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-4 border-b border-gray-200 flex items-center gap-3">
        <button onClick={onBack} className="lg:hidden text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        {friend?.pictureUrl ? (
          <img src={friend.pictureUrl} alt="" className="w-8 h-8 rounded-full" />
        ) : (
          <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center">
            <span className="text-gray-500 text-xs">{(friend?.displayName || '?').charAt(0)}</span>
          </div>
        )}
        <div>
          <p className="text-sm font-bold text-gray-900">{friend?.displayName || '不明'}</p>
          <p className="text-xs text-gray-400">メッセージ履歴</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loadingMessages ? (
          <p className="text-center text-gray-400 text-sm">読み込み中...</p>
        ) : messages.length === 0 ? (
          <p className="text-center text-gray-400 text-sm">メッセージ履歴がありません</p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}>
              <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                msg.direction === 'outgoing'
                  ? 'bg-green-500 text-white'
                  : 'bg-gray-100 text-gray-900'
              }`}>
                <p className="text-sm whitespace-pre-wrap break-words">{renderContent(msg)}</p>
                <p className={`text-xs mt-1 ${msg.direction === 'outgoing' ? 'text-green-200' : 'text-gray-400'}`}>
                  {new Date(msg.createdAt).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            </div>
          ))
        )}
      </div>
      <div className="px-4 py-3 border-t border-gray-200">
        <div className="flex gap-2">
          <input
            type="text"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onCompositionStart={() => { isComposingRef.current = true }}
            onCompositionEnd={() => { isComposingRef.current = false }}
            onKeyDown={(e) => {
              // IME変換確定のEnterでは送信しない
              if (e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229) return
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                handleSend()
              }
            }}
            placeholder="メッセージを入力..."
            className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
          />
          <button
            onClick={handleSend}
            disabled={!message.trim() || sending}
            className="px-4 py-2 rounded-lg text-white text-sm font-medium disabled:opacity-50"
            style={{ backgroundColor: '#06C755' }}
          >
            {sending ? '...' : '送信'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ChatListRow({
  chat,
  isSelected,
  isPinned,
  onSelect,
  onTogglePin,
}: {
  chat: Chat
  isSelected: boolean
  isPinned: boolean
  onSelect: () => void
  onTogglePin: () => void
}) {
  // 「真の自発（要対応）」= chat.status='unread'。webhook 側で auto_reply に
  // マッチしなかった incoming のみ unread に設定される。auto_reply trigger
  // (キーワード "コスト比較" 等) は matched 扱いで unread 化しない。
  // bold / 強調表示はこの status を使う。
  const needsAttention = chat.status === 'unread'
  // 表示と検索で同じ文字列を使うため module-level helper (chatPreviewText) に集約。
  const preview = chatPreviewText(chat)

  // ステータスは Badge で表現（情報量を増やすが圧迫しないよう小さく）
  const statusBadge = (() => {
    if (chat.status === 'unread') return <Badge tone="danger" className="px-1.5 py-0">未対応</Badge>
    if (chat.status === 'in_progress') return <Badge tone="warning" className="px-1.5 py-0">対応中</Badge>
    if (chat.status === 'resolved') return <Badge tone="success" className="px-1.5 py-0">対応済</Badge>
    return null
  })()

  return (
    <div
      className={cx(
        'group relative border-b border-gray-100 transition-colors',
        isSelected ? 'bg-green-50' : 'hover:bg-gray-50',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="w-full text-left px-4 py-3 pr-9"
      >
        <div className="flex items-start gap-3">
          {chat.friendPictureUrl ? (
            <img src={chat.friendPictureUrl} alt="" className="w-10 h-10 rounded-full flex-shrink-0 object-cover" />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
              <span className="text-gray-500 text-sm">{chat.friendName.charAt(0) || '?'}</span>
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                {chat.status === 'unread' && (
                  <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" aria-label="未読" />
                )}
                <p className={cx('text-sm truncate', needsAttention ? 'font-semibold text-gray-900' : 'font-medium text-gray-900')}>
                  {chat.friendName}
                </p>
              </div>
              <span className="text-[10px] text-gray-400 flex-shrink-0">{formatDatetime(chat.lastMessageAt)}</span>
            </div>
            <p
              className={cx(
                'text-xs mt-0.5 truncate',
                needsAttention ? 'text-gray-900 font-medium' : 'text-gray-500',
              )}
              title={preview}
            >
              {chat.lastMessageDirection === 'outgoing' && (
                <span className="text-gray-400 mr-1">↪</span>
              )}
              {preview || <span className="italic text-gray-300">(まだメッセージなし)</span>}
            </p>
            <div className="mt-1 flex items-center gap-1.5">
              {statusBadge}
            </div>
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onTogglePin()
        }}
        aria-label={isPinned ? 'ピン留めを解除' : 'ピン留めする'}
        title={isPinned ? 'ピン留めを解除' : 'ピン留めする'}
        className={cx(
          'absolute top-2 right-2 rounded-md p-1 text-sm leading-none transition',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400',
          isPinned ? 'text-amber-500 hover:text-amber-600' : 'text-gray-300 hover:text-amber-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
        )}
      >
        {isPinned ? '★' : '☆'}
      </button>
    </div>
  )
}

export default function ChatsPage() {
  const { selectedAccountId } = useAccount()
  const [chats, setChats] = useState<Chat[]>([])
  const [allFriends, setAllFriends] = useState<FriendItem[]>([])
  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)
  const [selectedFriendId, setSelectedFriendId] = useState<string | null>(null)
  const [chatDetail, setChatDetail] = useState<ChatDetail | null>(null)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const statusFilterRef = useRef<StatusFilter>('all')
  const unansweredOnlyRef = useRef(false)
  const [unansweredOnly, setUnansweredOnly] = useState(() => {
    if (typeof window === 'undefined') return false
    return new URLSearchParams(window.location.search).get('unanswered') === '1'
  })

  // unansweredOnly 変更時に URL を書き戻す
  useEffect(() => {
    if (typeof window === 'undefined') return
    const urlParams = new URLSearchParams(window.location.search)
    if (unansweredOnly) urlParams.set('unanswered', '1')
    else urlParams.delete('unanswered')
    const qs = urlParams.toString()
    const url = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    window.history.replaceState(null, '', url)
  }, [unansweredOnly])
  // Send mode: 'enter' = Enter sends, Shift+Enter = newline; 'shift-enter' = reverse
  const [sendMode, setSendMode] = useState<'enter' | 'shift-enter'>('enter')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState('')
  const [messageContent, setMessageContent] = useState('')
  const [pendingImage, setPendingImage] = useState<ImageUploaderValue | null>(null)
  const [sending, setSending] = useState(false)
  const sendLockRef = useRef(false)
  const [notes, setNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [showLoadingIndicator, setShowLoadingIndicator] = useState(false)
  const [loadingSeconds, setLoadingSeconds] = useState(5)
  const lastLoadingTriggerAtRef = useRef<Record<string, number>>({})
  const [isMessageInputFocused, setIsMessageInputFocused] = useState(false)
  const isComposingRef = useRef(false)
  const messagesScrollRef = useRef<HTMLDivElement | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [pinnedIds, setPinnedIds] = useState<string[]>([])

  // Load pinned chat ids from localStorage (SSR-safe)
  useEffect(() => {
    try {
      const raw = localStorage.getItem(PINNED_CHATS_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed) && parsed.every((v): v is string => typeof v === 'string')) {
        setPinnedIds(parsed)
      }
    } catch {
      // ignore corrupt localStorage value
    }
  }, [])

  const togglePin = useCallback((friendId: string) => {
    setPinnedIds((prev) => {
      const next = prev.includes(friendId)
        ? prev.filter((id) => id !== friendId)
        : [...prev, friendId]
      try {
        localStorage.setItem(PINNED_CHATS_KEY, JSON.stringify(next))
      } catch {
        // ignore
      }
      return next
    })
  }, [])

  // `/` key focuses the search box, unless user is already typing in a field.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/') return
      const target = e.target as HTMLElement | null
      if (!target) return
      const tag = target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable) return
      e.preventDefault()
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  useEffect(() => {
    try {
      const rawEnabled = localStorage.getItem(SHOW_LOADING_PREF_KEY)
      const rawSeconds = localStorage.getItem(LOADING_SECONDS_PREF_KEY)
      if (rawEnabled !== null) setShowLoadingIndicator(rawEnabled === '1')
      if (rawSeconds) {
        const n = Number.parseInt(rawSeconds, 10)
        if (Number.isFinite(n) && n >= 5 && n <= 60) setLoadingSeconds(n)
      }
    } catch {
      // localStorage unavailable
    }
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(SHOW_LOADING_PREF_KEY, showLoadingIndicator ? '1' : '0')
      localStorage.setItem(LOADING_SECONDS_PREF_KEY, String(loadingSeconds))
    } catch {
      // localStorage unavailable
    }
  }, [showLoadingIndicator, loadingSeconds])

  const loadChats = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params: { status?: string; accountId?: string; unansweredOnly?: boolean } = {}
      if (statusFilter !== 'all' && !unansweredOnly) params.status = statusFilter
      if (selectedAccountId) params.accountId = selectedAccountId
      if (unansweredOnly) params.unansweredOnly = true
      const chatRes = await api.chats.list(params)
      if (chatRes.success) {
        setChats(chatRes.data as unknown as Chat[])
      }
    } catch {
      setError('チャットの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, selectedAccountId, unansweredOnly])

  // Friends list (for the "new direct message" modal) — loaded lazily in the background
  // Previously fetched 800 friends in parallel with chats, which blocked the initial render.
  const loadAllFriends = useCallback(async () => {
    try {
      const friendRes = await api.friends.list({ accountId: selectedAccountId || undefined, limit: '800' })
      if (friendRes.success) {
        setAllFriends((friendRes.data as unknown as { items: FriendItem[] }).items)
      }
    } catch { /* silent */ }
  }, [selectedAccountId])

  useEffect(() => { void loadAllFriends() }, [loadAllFriends])

  // Keep refs in sync so setChats updater can read the latest filter without stale closure
  useEffect(() => { statusFilterRef.current = statusFilter }, [statusFilter])
  useEffect(() => { unansweredOnlyRef.current = unansweredOnly }, [unansweredOnly])

  // Load/save sendMode preference (guarded — privacy-restricted browsers throw)
  useEffect(() => {
    try {
      const saved = localStorage.getItem('chat.sendMode')
      if (saved === 'enter' || saved === 'shift-enter') setSendMode(saved)
    } catch { /* localStorage unavailable */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem('chat.sendMode', sendMode) } catch { /* ignore */ }
  }, [sendMode])

  const loadChatDetail = useCallback(async (chatId: string) => {
    setDetailLoading(true)
    setError('')
    try {
      const res = await api.chats.get(chatId)
      if (res.success) {
        setChatDetail(res.data as unknown as ChatDetail)
        setNotes((res.data as unknown as ChatDetail).notes || '')
      } else {
        // API は 200 で success:false を返す可能性 (例: 404 lookup)。詳細を画面に出す。
        const errMsg = (res as { error?: string }).error ?? '不明なエラー'
        setError(`チャット詳細の読み込みに失敗しました: ${errMsg}`)
      }
    } catch (err) {
      // ネットワーク / parse / auth fail などの例外。empty catch だと原因不明だったので詳細を出す。
      const msg = err instanceof Error ? err.message : String(err)
      setError(`チャット詳細の読み込みに失敗しました: ${msg}`)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    loadChats()
  }, [loadChats])

  // Deep-link from other pages (e.g. /form-submissions): ?friend=<friendId>
  // chat list returns id = friend_id, so selectedChatId === friendId is correct.
  // If no chat exists yet, loadChatDetail will fail and the user can fall back to
  // the friend list — acceptable for now.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const friendId = params.get('friend')
    if (friendId) setSelectedChatId(friendId)
  }, [])

  useEffect(() => {
    if (selectedChatId) {
      loadChatDetail(selectedChatId)
    } else {
      setChatDetail(null)
    }
  }, [selectedChatId, loadChatDetail])

  // Surface deep-linked chats in the sidebar even when the current account
  // filter or status filter would exclude them — otherwise the user replies
  // and the conversation stays invisible until they refresh.
  // Re-runs when `chats` changes (e.g. after loadChats refetches on filter
  // change) so the synthetic entry is re-injected if the next API result
  // does not include it. Returning `prev` unchanged when already present
  // avoids any update loop.
  useEffect(() => {
    if (!chatDetail) return
    setChats((prev) => {
      if (prev.some((c) => c.id === chatDetail.id)) return prev
      // /api/chats/:id may not populate the lastMessage* fields; derive
      // from the messages array as a fallback so the sidebar preview is
      // not stuck on "(まだメッセージなし)".
      const lastMsg = chatDetail.messages?.[chatDetail.messages.length - 1]
      const entry: Chat = {
        id: chatDetail.id,
        friendId: chatDetail.friendId,
        friendName: chatDetail.friendName,
        friendPictureUrl: chatDetail.friendPictureUrl,
        operatorId: chatDetail.operatorId ?? null,
        status: chatDetail.status,
        notes: chatDetail.notes ?? null,
        lastMessageAt: chatDetail.lastMessageAt ?? lastMsg?.createdAt ?? null,
        lastMessageContent: chatDetail.lastMessageContent ?? lastMsg?.content ?? null,
        lastMessageDirection: chatDetail.lastMessageDirection ?? lastMsg?.direction ?? null,
        lastMessageType: chatDetail.lastMessageType ?? lastMsg?.messageType ?? null,
        createdAt: chatDetail.createdAt,
        updatedAt: chatDetail.updatedAt,
      }
      return [entry, ...prev]
    })
  }, [chatDetail, chats])

  // 詳細が新しくロードされたら最下部（＝最新メッセージ）までスクロールする。
  // そこから上にスクロールすれば過去のメッセージを辿れる（LINE受信画面と同じUX）。
  // ユーザーが手動でスクロールしたら delayed auto-scroll は発動させない。
  useEffect(() => {
    if (!chatDetail?.messages || chatDetail.messages.length === 0) return
    const el = messagesScrollRef.current
    if (!el) return
    el.scrollTop = el.scrollHeight
    let userScrolled = false
    const onScroll = () => {
      if (!messagesScrollRef.current) return
      const current = messagesScrollRef.current
      // 下端から一定以上離れたらユーザー操作とみなす
      if (current.scrollHeight - current.scrollTop - current.clientHeight > 20) {
        userScrolled = true
      }
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    // 画像/Flex の表示後に高さが増える場合に追従するフォロワー（ユーザーがスクロール済みなら発動させない）
    const id = window.setTimeout(() => {
      if (userScrolled || !messagesScrollRef.current) return
      messagesScrollRef.current.scrollTop = messagesScrollRef.current.scrollHeight
    }, 150)
    return () => {
      window.clearTimeout(id)
      el.removeEventListener('scroll', onScroll)
    }
  }, [chatDetail?.id, chatDetail?.messages?.length])

  // Auto-resize textarea as messageContent grows
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [messageContent])

  const handleSelectChat = (chatId: string) => {
    setSelectedChatId(chatId)
    setMessageContent('')
    setPendingImage(null)
  }

  const triggerLoadingAnimation = useCallback(async (chatId: string) => {
    if (!showLoadingIndicator) return

    const now = Date.now()
    const last = lastLoadingTriggerAtRef.current[chatId] ?? 0
    if (now - last < LOADING_REFRESH_INTERVAL_MS) return
    lastLoadingTriggerAtRef.current[chatId] = now

    try {
      await fetchApi<{ success: boolean }>(`/api/chats/${chatId}/loading`, {
        method: 'POST',
        body: JSON.stringify({ loadingSeconds }),
      })
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'unknown'
      setError(`ローディング表示の開始に失敗しました: ${detail}`)
    }
  }, [showLoadingIndicator, loadingSeconds])

  const handleSendMessage = async () => {
    if (!selectedChatId || sending || sendLockRef.current) return
    if (!messageContent.trim() && !pendingImage) return
    const sendingChatId = selectedChatId  // capture the chat id for this send
    sendLockRef.current = true
    setSending(true)
    try {
      const now = new Date().toISOString()
      // --- Image send path (runs first when image is present) ---
      if (pendingImage && pendingImage.mode === 'line-image') {
        const imgPayload = JSON.stringify({
          originalContentUrl: pendingImage.originalContentUrl,
          previewImageUrl: pendingImage.previewImageUrl,
        })
        await api.chats.send(sendingChatId, { messageType: 'image', content: imgPayload })
        setPendingImage(null)
        // Optimistic update for image
        setChatDetail((prev) => (prev && prev.id === sendingChatId) ? {
          ...prev,
          lastMessageAt: now,
          status: 'in_progress',
          messages: [
            ...(prev.messages ?? []),
            {
              id: crypto.randomUUID(),
              direction: 'outgoing',
              messageType: 'image',
              content: imgPayload,
              createdAt: now,
            },
          ],
        } : prev)
        setChats((prev) => {
          const exists = prev.some((c) => c.id === sendingChatId)
          if (!exists) return prev
          const currentFilter = statusFilterRef.current
          const currentUnansweredOnly = unansweredOnlyRef.current
          const updated = prev.map((c) => c.id === sendingChatId ? {
            ...c,
            lastMessageAt: now,
            status: 'in_progress' as const,
            lastMessageContent: '[画像]',
            lastMessageDirection: 'outgoing' as const,
            lastMessageType: 'image' as const,
          } : c)
          let filtered = currentFilter === 'all' ? updated : updated.filter((c) => c.status === currentFilter)
          if (currentUnansweredOnly) {
            // 未対応モードでは、自分が返信したばかりの chat はもう未対応ではないのでリストから除外
            filtered = filtered.filter((c) => c.id !== sendingChatId)
          }
          return [...filtered].sort((a, b) => {
            const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
            const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
            return bt - at
          })
        })
      }
      // --- Text send path (runs independently — both paths execute when both image and text are present) ---
      if (messageContent.trim()) {
        const content = messageContent.trim()
        await api.chats.send(sendingChatId, { content })
        setMessageContent('')
        // Optimistic update: append message locally instead of refetching (prevents scroll jump / full reload feel)
        // Only mutate chatDetail if it still corresponds to the chat we just sent to
        setChatDetail((prev) => (prev && prev.id === sendingChatId) ? {
          ...prev,
          lastMessageAt: now,
          status: 'in_progress',
          messages: [
            ...(prev.messages ?? []),
            {
              id: crypto.randomUUID(),
              direction: 'outgoing',
              messageType: 'text',
              content,
              createdAt: now,
            },
          ],
        } : prev)
        setChats((prev) => {
          // Skip reconciliation if the list no longer contains this chat (e.g. tab changed mid-send)
          const exists = prev.some((c) => c.id === sendingChatId)
          if (!exists) return prev
          const currentFilter = statusFilterRef.current
          const currentUnansweredOnly = unansweredOnlyRef.current
          const updated = prev.map((c) => c.id === sendingChatId ? {
            ...c,
            lastMessageAt: now,
            status: 'in_progress' as const,
            // 一覧の preview も即時更新する。incoming 優先ロジックで上書きされ得るが、
            // 楽観 UI では「operator が今送った文面」が一瞬見えるのが期待動作。
            // 次回 loadChats() で server 側の真の最新 (incoming 優先) に reconcile される。
            lastMessageContent: content,
            lastMessageDirection: 'outgoing' as const,
            lastMessageType: 'text' as const,
          } : c)
          // Drop rows that no longer match the current tab (e.g. replying from 未読 moves chat to in_progress)
          let filtered = currentFilter === 'all' ? updated : updated.filter((c) => c.status === currentFilter)
          if (currentUnansweredOnly) {
            // 未対応モードでは、自分が返信したばかりの chat はもう未対応ではないのでリストから除外
            filtered = filtered.filter((c) => c.id !== sendingChatId)
          }
          return [...filtered].sort((a, b) => {
            const at = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0
            const bt = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0
            return bt - at
          })
        })
      }
    } catch {
      setError('メッセージの送信に失敗しました。')
    } finally {
      setSending(false)
      sendLockRef.current = false
    }
  }

  const handleStatusUpdate = async (newStatus: Chat['status']) => {
    if (!selectedChatId) return
    try {
      await api.chats.update(selectedChatId, { status: newStatus })
      loadChatDetail(selectedChatId)
      loadChats()
    } catch {
      setError('ステータスの更新に失敗しました。')
    }
  }

  const handleSaveNotes = async () => {
    if (!selectedChatId) return
    setSavingNotes(true)
    try {
      await api.chats.update(selectedChatId, { notes })
      loadChatDetail(selectedChatId)
    } catch {
      setError('メモの保存に失敗しました。')
    } finally {
      setSavingNotes(false)
    }
  }

  // Apply search filter to the chat list (matches display name or last message preview).
  // Then partition into pinned vs unpinned for two-section rendering.
  // 検索対象は一覧表示と同じ chatPreviewText を使う (画像/Flex/スタンプ等の type ラベルでも引っかかるように)。
  const { pinnedChats, normalChats } = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    const filtered = q
      ? chats.filter((c) => {
          const name = (c.friendName || '').toLowerCase()
          const preview = chatPreviewText(c).toLowerCase()
          return name.includes(q) || preview.includes(q)
        })
      : chats
    const pinSet = new Set(pinnedIds)
    const pinned: Chat[] = []
    const normal: Chat[] = []
    for (const c of filtered) {
      if (pinSet.has(c.id)) pinned.push(c)
      else normal.push(c)
    }
    return { pinnedChats: pinned, normalChats: normal }
  }, [chats, searchQuery, pinnedIds])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    // IME変換確定のEnterでは送信しない
    if (e.nativeEvent.isComposing || isComposingRef.current || e.keyCode === 229) return
    if (e.key !== 'Enter') return
    // sendMode 'enter': Enter単体で送信、Shift+Enterは改行
    // sendMode 'shift-enter': Shift+Enterで送信、Enter単体は改行
    const shouldSend = sendMode === 'enter' ? !e.shiftKey : e.shiftKey
    if (shouldSend) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  return (
    <div>
      <Header title="オペレーターチャット" />

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="flex gap-4 h-[calc(100vh-120px)] lg:h-[calc(100vh-180px)]">
        {/* Left Panel: Chat List */}
        <div className={`w-full lg:w-96 lg:flex-shrink-0 bg-white rounded-lg shadow-sm border border-gray-200 flex-col overflow-hidden ${selectedChatId ? 'hidden lg:flex' : 'flex'}`}>
          {/* タブ (全て / 未読 / 対応中 / 解決済) は意図的に削除。直近メッセージが見やすい LINE 風一覧を優先。 */}

          {/* Search bar (sticky) */}
          <div className="sticky top-0 z-10 bg-white border-b border-gray-100 px-3 py-2">
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 1 1 0-16 8 8 0 0 1 0 16z" />
              </svg>
              <Input
                ref={searchInputRef}
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="会話・名前を検索（/ でフォーカス）"
                aria-label="会話・名前を検索"
                className="mt-0 pl-8 py-1.5 text-sm"
              />
            </div>
          </div>

          {/* Filter row */}
          <div className="px-3 py-2 border-b border-gray-100 flex flex-wrap items-center gap-2">
            {statusFilters.map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                disabled={unansweredOnly}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  statusFilter === f.key
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                } ${unansweredOnly ? 'opacity-40 cursor-not-allowed' : ''}`}
              >
                {f.label}
              </button>
            ))}
            <label className="flex items-center gap-1.5 text-xs font-medium whitespace-nowrap ml-auto cursor-pointer select-none">
              <input
                type="checkbox"
                checked={unansweredOnly}
                onChange={(e) => setUnansweredOnly(e.target.checked)}
                className="rounded"
              />
              🔥 未対応のみ
            </label>
          </div>

          {/* Chat List */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div>
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="px-4 py-3 border-b border-gray-100 animate-pulse">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 space-y-2">
                        <div className="h-3 bg-gray-200 rounded w-32" />
                        <div className="h-2 bg-gray-100 rounded w-20" />
                      </div>
                      <div className="h-5 bg-gray-100 rounded-full w-12" />
                    </div>
                  </div>
                ))}
              </div>
            ) : pinnedChats.length === 0 && normalChats.length === 0 ? (
              <div className="p-4">
                <EmptyState
                  title={searchQuery ? '一致するチャットがありません' : 'チャットはまだありません'}
                  description={searchQuery ? '検索条件を変えるか、フィルタを「全て」に切り替えてください。' : 'LINE からメッセージが届くとここに表示されます。'}
                />
              </div>
            ) : (
              <>
                {pinnedChats.length > 0 && (
                  <>
                    <div className="px-4 py-1.5 bg-amber-50/60 border-b border-amber-100">
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                        ★ ピン留め
                      </span>
                    </div>
                    {pinnedChats.map((chat) => (
                      <ChatListRow
                        key={`pinned-${chat.id}`}
                        chat={chat}
                        isSelected={selectedChatId === chat.id && !selectedFriendId}
                        isPinned
                        onSelect={() => { setSelectedFriendId(null); handleSelectChat(chat.id) }}
                        onTogglePin={() => togglePin(chat.id)}
                      />
                    ))}
                    {normalChats.length > 0 && (
                      <div className="h-2 bg-gray-50 border-y border-gray-100" aria-hidden />
                    )}
                  </>
                )}
                {normalChats.map((chat) => (
                  <ChatListRow
                    key={chat.id}
                    chat={chat}
                    isSelected={selectedChatId === chat.id && !selectedFriendId}
                    isPinned={false}
                    onSelect={() => { setSelectedFriendId(null); handleSelectChat(chat.id) }}
                    onTogglePin={() => togglePin(chat.id)}
                  />
                ))}
              </>
            )}
          </div>
        </div>

        {/* Right Panel: Chat Detail */}
        <div className={`flex-1 bg-white rounded-lg shadow-sm border border-gray-200 flex-col overflow-hidden ${selectedChatId || selectedFriendId ? 'flex' : 'hidden lg:flex'}`}>
          {selectedFriendId && !selectedChatId ? (
            /* Direct message to friend without existing chat */
            <DirectMessagePanel
              friendId={selectedFriendId}
              friend={allFriends.find((f) => f.id === selectedFriendId) || null}
              onBack={() => setSelectedFriendId(null)}
              onSent={() => { setSelectedFriendId(null); loadChats(); }}
            />
          ) : !selectedChatId ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-gray-400 text-sm">チャットを選択してください</p>
            </div>
          ) : detailLoading ? (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-gray-400 text-sm">読み込み中...</p>
            </div>
          ) : chatDetail ? (
            <>
              {/* Chat Header */}
              <div className="px-4 py-4 border-b border-gray-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={() => setSelectedChatId(null)}
                    className="lg:hidden flex-shrink-0 p-1 -ml-1 text-gray-500 hover:text-gray-700"
                    aria-label="戻る"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>
                  {chatDetail.friendPictureUrl && (
                    <img src={chatDetail.friendPictureUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {chatDetail.friendName}
                    </p>
                    <span className="inline-block mt-1">
                      {chatDetail.status === 'unread' ? (
                        <Badge tone="danger">未対応</Badge>
                      ) : chatDetail.status === 'in_progress' ? (
                        <Badge tone="warning">対応中</Badge>
                      ) : (
                        <Badge tone="success">対応済</Badge>
                      )}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {unansweredOnly && chats.length > 1 && (
                    <button
                      type="button"
                      onClick={() => {
                        const idx = chats.findIndex((c) => c.id === selectedChatId)
                        if (idx < 0) return
                        const next = chats[(idx + 1) % chats.length]
                        if (next && next.id !== selectedChatId) {
                          setSelectedChatId(next.id)
                        }
                      }}
                      className="rounded-md bg-emerald-600 px-3 py-1.5 min-h-[44px] lg:min-h-0 text-sm font-medium text-white hover:bg-emerald-700"
                      title="次の未対応 friend に進む"
                    >
                      次の未対応 →
                    </button>
                  )}
                  {chatDetail.status !== 'unread' && (
                    <button
                      onClick={() => handleStatusUpdate('unread')}
                      className="px-3 py-1 min-h-[44px] lg:min-h-0 text-xs font-medium text-red-600 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                    >
                      未読に戻す
                    </button>
                  )}
                  {chatDetail.status !== 'in_progress' && (
                    <button
                      onClick={() => handleStatusUpdate('in_progress')}
                      className="px-3 py-1 min-h-[44px] lg:min-h-0 text-xs font-medium text-yellow-700 bg-yellow-50 hover:bg-yellow-100 rounded-md transition-colors"
                    >
                      対応中にする
                    </button>
                  )}
                  {chatDetail.status !== 'resolved' && (
                    <button
                      onClick={() => handleStatusUpdate('resolved')}
                      className="px-3 py-1 min-h-[44px] lg:min-h-0 text-xs font-medium text-green-700 bg-green-50 hover:bg-green-100 rounded-md transition-colors"
                    >
                      解決済にする
                    </button>
                  )}
                </div>
              </div>

              {/*
                Messages — iMessage / LINE 風 chat bubbles
                前提: chatDetail.messages は createdAt 昇順。日付区切りと 5 秒 grouping
                はこの順序に依存している。/api/chats/:id は DESC で取った後 reverse()
                して昇順で返している (route.ts 参照)。WebSocket 追加や追加ページング
                を入れる際は、ここに渡る前に昇順整列を必ず守ること。
              */}
              <div ref={messagesScrollRef} className="flex-1 overflow-y-auto p-4 bg-gray-50">
                {(!chatDetail.messages || chatDetail.messages.length === 0) ? (
                  <div className="text-center py-8">
                    <p className="text-gray-400 text-sm">メッセージはまだありません。</p>
                  </div>
                ) : (
                  (chatDetail.messages ?? []).map((msg, idx) => {
                    const allMsgs = chatDetail.messages ?? []
                    const prevMsg = idx > 0 ? allMsgs[idx - 1] : null
                    const nextMsg = idx < allMsgs.length - 1 ? allMsgs[idx + 1] : null
                    const showDateSep = !prevMsg || !sameYmd(prevMsg.createdAt, msg.createdAt)
                    const isOutgoing = msg.direction === 'outgoing'

                    // 同じ送り手から 5 秒以内に続いたメッセージは「グループ内」とみなして
                    // バブル間の縦余白を詰める (iMessage 風)。送り手切替や 5 秒超の隙間では通常余白。
                    const gapToPrevMs =
                      prevMsg && prevMsg.direction === msg.direction && !showDateSep
                        ? new Date(msg.createdAt).getTime() - new Date(prevMsg.createdAt).getTime()
                        : Number.POSITIVE_INFINITY
                    const inGroupWithPrev = gapToPrevMs >= 0 && gapToPrevMs < MESSAGE_GROUP_THRESHOLD_MS
                    const gapToNextMs =
                      nextMsg && nextMsg.direction === msg.direction && sameYmd(nextMsg.createdAt, msg.createdAt)
                        ? new Date(nextMsg.createdAt).getTime() - new Date(msg.createdAt).getTime()
                        : Number.POSITIVE_INFINITY
                    const inGroupWithNext = gapToNextMs >= 0 && gapToNextMs < MESSAGE_GROUP_THRESHOLD_MS
                    // showDateSep 時はその上で my-3 separator が入るので gap は 0 で良い。
                    const wrapperMarginTop = showDateSep ? 'mt-0' : inGroupWithPrev ? 'mt-1' : 'mt-3'
                    // グループ末尾のメッセージのみ下に時刻ラベルを出す（連続中は省略してすっきり見せる）。
                    const showTimestampBelow = !inGroupWithNext

                    // メッセージ表示の分岐
                    let bubbleContent: React.ReactNode
                    if (msg.messageType === 'flex') {
                      bubbleContent = (
                        <div className="max-w-[300px]">
                          <FlexPreviewComponent content={msg.content} maxWidth={280} />
                        </div>
                      )
                    } else if (msg.messageType === 'image') {
                      try {
                        const parsed = JSON.parse(msg.content) as { originalContentUrl?: string; previewImageUrl?: string }
                        bubbleContent = (
                          <img src={parsed.originalContentUrl || parsed.previewImageUrl} alt="" className="max-w-[200px] rounded" />
                        )
                      } catch {
                        bubbleContent = <span>🖼️ [画像]</span>
                      }
                    } else {
                      bubbleContent = <span>{msg.content}</span>
                    }

                    return (
                      <div key={msg.id} className={wrapperMarginTop}>
                        {showDateSep && (
                          <div className="flex items-center gap-2 my-3" aria-label={formatYmdSlash(msg.createdAt)}>
                            <span className="flex-1 h-px bg-gray-200" aria-hidden />
                            <span className="text-[11px] font-medium text-gray-500 px-2">
                              {formatDateSeparator(msg.createdAt)}
                            </span>
                            <span className="flex-1 h-px bg-gray-200" aria-hidden />
                          </div>
                        )}
                        <div
                          className={cx('flex items-end gap-2', isOutgoing ? 'justify-end' : 'justify-start')}
                        >
                          {/* 相手のアイコン（incoming のグループ末尾だけ表示。連続中は揃いを保つ余白に） */}
                          {!isOutgoing && (
                            inGroupWithNext ? (
                              <div className="w-8 flex-shrink-0" aria-hidden />
                            ) : chatDetail.friendPictureUrl ? (
                              <img src={chatDetail.friendPictureUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0 mb-1 object-cover" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-gray-300 flex-shrink-0 mb-1" />
                            )
                          )}

                          <div className={cx('flex flex-col', isOutgoing ? 'items-end' : 'items-start')}>
                            {/* メッセージバブル (hover で full datetime を title 属性で見せる) */}
                            <div
                              title={formatFullDatetime(msg.createdAt)}
                              className={cx(
                                'max-w-[320px] px-3 py-2 text-sm break-words whitespace-pre-wrap shadow-sm',
                                isOutgoing
                                  ? 'rounded-tl-2xl rounded-tr-md rounded-bl-2xl rounded-br-2xl text-white'
                                  : 'rounded-tl-md rounded-tr-2xl rounded-bl-2xl rounded-br-2xl bg-gray-200 text-gray-900',
                              )}
                              style={isOutgoing ? { backgroundColor: '#06C755' } : undefined}
                            >
                              {bubbleContent}
                            </div>
                            {/* 時刻 — グループ末尾のみ表示 (連続中は省略してコンパクトに) */}
                            {showTimestampBelow && (
                              <span className="text-[11px] text-gray-400 mt-0.5 px-1">
                                {new Date(msg.createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Notes */}
              <div className="px-4 py-2 border-t border-gray-200 bg-gray-50">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="メモを入力..."
                    className="flex-1 text-xs border border-gray-300 rounded-md px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-green-500"
                  />
                  <button
                    onClick={handleSaveNotes}
                    disabled={savingNotes}
                    className="px-2 py-1 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50"
                  >
                    {savingNotes ? '保存中...' : 'メモ保存'}
                  </button>
                </div>
              </div>

              {/* Send Message Form */}
              <div className="px-4 py-3 border-t border-gray-200">
                <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-gray-600">
                  <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={showLoadingIndicator}
                      onChange={(e) => setShowLoadingIndicator(e.target.checked)}
                      className="h-4 w-4 rounded border-gray-300 text-green-600 focus:ring-green-500"
                    />
                    入力中ローディングを表示
                  </label>
                  <select
                    value={loadingSeconds}
                    onChange={(e) => setLoadingSeconds(Number.parseInt(e.target.value, 10))}
                    disabled={!showLoadingIndicator}
                    className="border border-gray-300 rounded-md px-2 py-1 bg-white disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    {[5, 10, 15, 20, 30, 45, 60].map((sec) => (
                      <option key={sec} value={sec}>{sec}秒</option>
                    ))}
                  </select>
                  <span className="text-gray-500">送信キー:</span>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      checked={sendMode === 'enter'}
                      onChange={() => setSendMode('enter')}
                      className="accent-green-600"
                    />
                    <span>Enter</span>
                  </label>
                  <label className="flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      checked={sendMode === 'shift-enter'}
                      onChange={() => setSendMode('shift-enter')}
                      className="accent-green-600"
                    />
                    <span>Shift+Enter</span>
                  </label>
                </div>
                <div className="mb-2">
                  <ImageUploader
                    mode="line-image"
                    value={pendingImage}
                    onChange={setPendingImage}
                    label="画像を送る (任意)"
                  />
                </div>
                <div className="flex items-end gap-2">
                  <textarea
                    ref={textareaRef}
                    rows={2}
                    value={messageContent}
                    style={{ maxHeight: '200px', overflowY: 'auto' }}
                    onChange={(e) => {
                      const value = e.target.value
                      setMessageContent(value)
                      if (selectedChatId && isMessageInputFocused && value.trim()) {
                        void triggerLoadingAnimation(selectedChatId)
                      }
                    }}
                    onCompositionStart={() => { isComposingRef.current = true }}
                    onCompositionEnd={() => { isComposingRef.current = false }}
                    onFocus={() => {
                      setIsMessageInputFocused(true)
                      if (selectedChatId) {
                        void triggerLoadingAnimation(selectedChatId)
                      }
                    }}
                    onBlur={() => setIsMessageInputFocused(false)}
                    onKeyDown={handleKeyDown}
                    placeholder="メッセージを入力..."
                    className="flex-1 text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-green-500 resize-none overflow-y-auto"
                  />
                  <button
                    onClick={handleSendMessage}
                    disabled={sending || (!messageContent.trim() && !pendingImage)}
                    className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ backgroundColor: '#06C755' }}
                  >
                    {sending ? '送信中...' : '送信'}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </div>

        {/* Right-most Panel: 友だち詳細サイドバー — chat detail を開いている時のみ表示 */}
        {/*
          friendId は **現在の selection** を優先する。chatDetail の load 中は前の chat
          のデータが残ったままなので、それを参照するとサイドバーだけ前の友だちを
          表示し続けて pane 間の不整合になる。selection ID 自体が friend_id なので
          直接渡せる (chat list SQL が `id: f.id` で friend_id を返す)。
        */}
        {(selectedChatId || selectedFriendId) && (
          <div className="hidden xl:flex">
            <FriendInfoSidebar
              friendId={selectedFriendId || selectedChatId}
              chatStatus={
                chatDetail && chatDetail.id === (selectedFriendId || selectedChatId)
                  ? { status: chatDetail.status, notes: chatDetail.notes }
                  : undefined
              }
            />
          </div>
        )}
      </div>
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
