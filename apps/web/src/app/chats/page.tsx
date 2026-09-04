'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { parseStickerMessageContent, stickerFallback } from '@line-crm/shared'
import { api, fetchApi } from '@/lib/api'
import { UNANSWERED_REFRESH_EVENT } from '@/lib/events'
import { useAccount } from '@/contexts/account-context'
import CcPromptButton from '@/components/cc-prompt-button'
import FlexPreviewComponent from '@/components/flex-preview'
import FriendInfoSidebar from '@/components/chats/friend-info-sidebar'
import ImageUploader, { type ImageUploaderValue } from '@/components/shared/image-uploader'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Input } from '@cloudflare/kumo/components/input'
import { Radio } from '@cloudflare/kumo/components/radio'
import { Select } from '@cloudflare/kumo/components/select'

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

// リッチメニューのタブ切替 (richmenuswitch) は、webhook が postback data
// `switch-to-<切替先ページUUID>` を incoming text として messages_log に記録する
// (rich-menu-publisher.ts / webhook.ts 参照)。生の data を吹き出しで見せると
// ノイズなので、チャット表示ではシステム行「リッチメニュー切替」に置き換える。
// source カラムでは判別できない — migration 028 の backfill が既存の postback
// incoming を 'user' に倒しているため、content パターンで判定する。
const RICH_MENU_SWITCH_RE =
  /^switch-to-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
function isRichMenuSwitch(msg: { direction: string; messageType: string; content: string }): boolean {
  return msg.direction === 'incoming' && msg.messageType === 'text' && RICH_MENU_SWITCH_RE.test(msg.content)
}

interface ChatDetail extends Chat {
  friendName: string
  friendPictureUrl: string | null
  messages?: ChatMessage[]
}

type StatusFilter = 'all' | 'unread' | 'in_progress' | 'resolved'

const statusConfig: Record<Chat['status'], { label: string; className: string }> = {
  unread: { label: '未読', className: 'bg-red-100 text-red-700' },
  in_progress: { label: '対応中', className: 'bg-yellow-100 text-yellow-700' },
  resolved: { label: '解決済', className: 'bg-green-100 text-green-700' },
}

const statusFilters: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全て' },
  { key: 'unread', label: '未読' },
  { key: 'in_progress', label: '対応中' },
  { key: 'resolved', label: '解決済' },
]

const SHOW_LOADING_PREF_KEY = 'lh_chat_show_loading_indicator'
// 一覧の1ページ件数。worker 側 /api/chats のデフォルト LIMIT と揃える。
const CHAT_PAGE_SIZE = 300
const LOADING_SECONDS_PREF_KEY = 'lh_chat_loading_seconds'
const LOADING_REFRESH_INTERVAL_MS = 4000

function StickerMessageImage({ content }: { content: string }) {
  const [failed, setFailed] = useState(false)
  const sticker = parseStickerMessageContent(content)
  const fallback = stickerFallback(content)

  if (!sticker || failed) return <span>{fallback}</span>

  return (
    <img
      src={sticker.stickerUrl}
      alt={fallback}
      className="max-h-[140px] max-w-[140px] object-contain"
      loading="lazy"
      onError={() => setFailed(true)}
    />
  )
}

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
    if (msg.messageType === 'sticker') {
      return <StickerMessageImage content={msg.content} />
    }
    return `[${msg.messageType}]`
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-4 border-b border-gray-200 flex items-center gap-3">
        <Button type="button" size="xs" shape="square" variant="ghost" title="戻る" onClick={onBack} className="lg:hidden">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </Button>
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
          messages.map((msg, idx) => {
            // チャット詳細画面と同じく、リッチメニュー切替 postback はシステム行。
            // 連続タップは先頭の1行だけ残す。
            if (isRichMenuSwitch(msg)) {
              if (idx > 0 && isRichMenuSwitch(messages[idx - 1])) return null
              return (
                <div key={msg.id} className="flex justify-center">
                  <span className="text-[11px] text-gray-400 bg-gray-100 px-2.5 py-0.5 rounded-full">
                    リッチメニュー切替
                  </span>
                </div>
              )
            }
            return (
            <div key={msg.id} className={`flex ${msg.direction === 'outgoing' ? 'justify-end' : 'justify-start'}`}>
              {/* flex はチャット詳細画面と同じくバブルに包まず素のカードで描画する */}
              {msg.messageType === 'flex' ? (
                <div className="max-w-[92%] min-w-0">
                  <FlexPreviewComponent content={msg.content} />
                  <p className="text-xs mt-1 text-gray-400">
                    {new Date(msg.createdAt).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              ) : (
                <div className={`max-w-[75%] rounded-2xl px-4 py-2 ${
                  msg.direction === 'outgoing'
                    ? 'bg-green-500 text-white'
                    : 'bg-gray-100 text-gray-900'
                }`}>
                  <div className="text-sm whitespace-pre-wrap break-words">{renderContent(msg)}</div>
                  <p className={`text-xs mt-1 ${msg.direction === 'outgoing' ? 'text-green-200' : 'text-gray-400'}`}>
                    {new Date(msg.createdAt).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                </div>
              )}
            </div>
            )
          })
        )}
      </div>
      <div className="px-4 py-3 border-t border-gray-200">
        <div className="flex gap-2">
          <Input
            aria-label="メッセージ"
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
            className="flex-1"
          />
          <Button type="button" variant="primary" loading={sending}
            onClick={handleSend}
            disabled={!message.trim() || sending}
          >
            送信
          </Button>
        </div>
      </div>
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
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMoreChats, setHasMoreChats] = useState(false)
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
  // OAM(公式LINEマネージャー)風レイアウト: 添付・設定・メモは折りたたみ、
  // メッセージ表示領域を最大化する
  const [showImagePicker, setShowImagePicker] = useState(false)
  const [showComposerSettings, setShowComposerSettings] = useState(false)
  const [showMobileMemo, setShowMobileMemo] = useState(false)
  const composerSettingsRef = useRef<HTMLDivElement | null>(null)
  const composerSettingsButtonRef = useRef<HTMLButtonElement | null>(null)

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

  // ページング用カーソル。表示リストは楽観更新で並び替わるため、
  // 「サーバから最後に受け取った行」を ref で保持して次ページの起点にする
  // (offset 方式だと新着で行が押し下げられた分が欠落する)。
  const nextCursorRef = useRef<{ at: string; id: string } | null>(null)

  const buildListParams = useCallback((cursor: { at: string; id: string } | null) => {
    const params: {
      status?: string; accountId?: string; unansweredOnly?: boolean;
      limit?: number; beforeAt?: string; beforeId?: string;
    } = {}
    if (statusFilter !== 'all' && !unansweredOnly) params.status = statusFilter
    if (selectedAccountId) params.accountId = selectedAccountId
    if (unansweredOnly) params.unansweredOnly = true
    else params.limit = CHAT_PAGE_SIZE
    if (cursor) {
      params.beforeAt = cursor.at
      params.beforeId = cursor.id
    }
    return params
  }, [statusFilter, selectedAccountId, unansweredOnly])

  const loadChats = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const chatRes = await api.chats.list(buildListParams(null))
      if (chatRes.success) {
        const rows = chatRes.data as unknown as Chat[]
        setChats(rows)
        const last = rows[rows.length - 1]
        nextCursorRef.current = last?.lastMessageAt ? { at: last.lastMessageAt, id: last.id } : null
        // ページ丁度いっぱい返ってきた = 続きがある可能性が高い (unansweredOnly は全件返る)
        setHasMoreChats(!unansweredOnly && rows.length === CHAT_PAGE_SIZE)
      }
    } catch {
      setError('チャットの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [buildListParams, unansweredOnly])

  // 「さらに読み込む」— サーバ由来カーソルの続きを取得して末尾に追加する。
  // 楽観更新との競合に備えて既存 id は除外し、重複表示を防ぐ。
  const loadMoreChats = useCallback(async () => {
    if (loadingMore) return
    const cursor = nextCursorRef.current
    if (!cursor) {
      setHasMoreChats(false)
      return
    }
    setLoadingMore(true)
    try {
      const chatRes = await api.chats.list(buildListParams(cursor))
      if (chatRes.success) {
        const rows = chatRes.data as unknown as Chat[]
        setChats((prev) => {
          const seen = new Set(prev.map((c) => c.id))
          return [...prev, ...rows.filter((r) => !seen.has(r.id))]
        })
        const last = rows[rows.length - 1]
        nextCursorRef.current = last?.lastMessageAt ? { at: last.lastMessageAt, id: last.id } : null
        setHasMoreChats(rows.length === CHAT_PAGE_SIZE)
      }
    } catch {
      setError('チャットの追加読み込みに失敗しました。')
    } finally {
      setLoadingMore(false)
    }
  }, [loadingMore, buildListParams])

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

  // チャットを開いたら入力欄に自動フォーカスする — 「クリックしてもフォーカスが
  // 入らない」報告への対処で、そもそもクリックを不要にする。モバイルでは
  // ソフトキーボードが勝手に開いてしまうためデスクトップ (lg+) のみ。
  useEffect(() => {
    if (!chatDetail?.id) return
    if (typeof window === 'undefined') return
    if (!window.matchMedia('(min-width: 1024px)').matches) return
    textareaRef.current?.focus()
  }, [chatDetail?.id])

  const handleSelectChat = (chatId: string) => {
    setSelectedChatId(chatId)
    setMessageContent('')
    setPendingImage(null)
    setShowImagePicker(false)
    setShowComposerSettings(false)
    setShowMobileMemo(false)
  }

  // ⚙ 設定ポップオーバーは浮いた要素なので、外側クリックと Escape で閉じる。
  // トグルボタン自身は除外する — ここで閉じると onClick のトグルが即座に開き直してしまう。
  // 📎 の画像アップローダーはポップオーバーではなくインライン展開で、選択操作の途中に
  // 閉じられると困るため対象にしない (pendingImage がある間は開いたままが正しい)。
  useEffect(() => {
    if (!showComposerSettings) return
    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (composerSettingsRef.current?.contains(target)) return
      if (composerSettingsButtonRef.current?.contains(target)) return
      setShowComposerSettings(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowComposerSettings(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [showComposerSettings])

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
      // ベストエフォート機能なので UI エラーにはしない。入力欄フォーカスの
      // たびに発火するため、setError でバナーを挿入するとその瞬間に
      // レイアウトが動き、クリックしようとした入力欄が逃げる (実害あり)。
      console.warn('[chats] loading indicator request failed:', err)
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
          // 未対応モード時は status filter を skip (worker 側で status を絞ってないため
          // 楽観更新で applied するとリストが歪む — Codex Round 1)
          let filtered = currentUnansweredOnly
            ? updated
            : (currentFilter === 'all' ? updated : updated.filter((c) => c.status === currentFilter))
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
            // 一覧の preview も即時更新する。server 側も direction/source を問わず
            // 実際の最新メッセージを返すため、次回 loadChats() 後も同じ表示になる。
            lastMessageContent: content,
            lastMessageDirection: 'outgoing' as const,
            lastMessageType: 'text' as const,
          } : c)
          // Drop rows that no longer match the current tab (e.g. replying from 未読 moves chat to in_progress)
          // 未対応モード時は status filter を skip (worker 側で status を絞ってないため
          // 楽観更新で applied するとリストが歪む — Codex Round 1)
          let filtered = currentUnansweredOnly
            ? updated
            : (currentFilter === 'all' ? updated : updated.filter((c) => c.status === currentFilter))
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
      // 手動返信で未対応が 1 件減るので、サイドバーのバッジを即時更新させる
      window.dispatchEvent(new Event(UNANSWERED_REFRESH_EVENT))
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
      // 解決済/未読の切替は未対応バッジに影響するので即時更新させる
      window.dispatchEvent(new Event(UNANSWERED_REFRESH_EVENT))
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
    // OAM(公式LINEマネージャー)風フルスクリーンレイアウト:
    // app-shell がこのページをフルブリード (余白なし・高さ = シェルの残り全部)
    // で描画するので、ここは flex-1 で受けるだけ。viewport 単位の高さ計算は
    // 使わない — バナーやモバイル URL バーの分ずれてコンポーザーがはみ出すため。
    <div className="flex flex-col flex-1 min-h-0 bg-white">
      {/* Error */}
      {error && (
        <div className="m-2 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* Left Panel: Chat List */}
        <div className={`w-full lg:w-80 xl:w-96 lg:flex-shrink-0 bg-white border-r border-gray-200 flex-col overflow-hidden ${selectedChatId ? 'hidden lg:flex' : 'flex'}`}>
          {/* タブ (全て / 未読 / 対応中 / 解決済) は意図的に削除。直近メッセージが見やすい LINE 風一覧を優先。 */}

          {/* Filter row */}
          <div className="px-3 py-2 border-b border-gray-100 flex flex-wrap items-center gap-2">
            {statusFilters.map((f) => (
              <Button type="button" size="xs" variant={statusFilter === f.key ? 'primary' : 'ghost'}
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                disabled={unansweredOnly}
                className={unansweredOnly ? 'opacity-40' : ''}
              >
                {f.label}
              </Button>
            ))}
            <div className="ml-auto whitespace-nowrap">
              <Checkbox
                label="🔥 未対応のみ"
                checked={unansweredOnly}
                onCheckedChange={setUnansweredOnly}
              />
            </div>
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
            ) : (
              <>
                {chats.map((chat) => {
                  const isSelected = selectedChatId === chat.id
                  // 「真の自発（要対応）」= chat.status='unread'。webhook 側で auto_reply に
                  // マッチしなかった incoming のみ unread に設定される。auto_reply trigger
                  // (キーワード "コスト比較" 等) は matched 扱いで unread 化しない。
                  // bold / 🟥 の表示はこの status を使う。direction だけだと button 押下も
                  // 強調してしまって S/N 比が悪化する。
                  const needsAttention = chat.status === 'unread'
                  // 最新メッセージの本文 preview。flex/image は文字列で見せても意味が薄いので type 表記に置換。
                  const previewRaw = chat.lastMessageContent ?? ''
                  const preview = (() => {
                    if (RICH_MENU_SWITCH_RE.test(previewRaw)) return 'リッチメニュー切替'
                    if (chat.lastMessageType === 'image') return '📷 画像'
                    if (chat.lastMessageType === 'flex') return '📋 Flexメッセージ'
                    if (chat.lastMessageType === 'sticker') return '🎨 スタンプ'
                    if (chat.lastMessageType === 'video') return '🎥 動画'
                    if (chat.lastMessageType === 'audio') return '🎤 音声'
                    if (chat.lastMessageType === 'file') return '📎 ファイル'
                    if (chat.lastMessageType === 'location') return '📍 位置情報'
                    return previewRaw.replace(/\n+/g, ' ').slice(0, 60)
                  })()
                  return (
                    <button
                      key={chat.id}
                      onClick={() => { setSelectedFriendId(null); handleSelectChat(chat.id); }}
                      className={`w-full text-left px-4 py-3 border-b border-gray-100 transition-colors ${
                        isSelected && !selectedFriendId ? 'bg-green-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {chat.friendPictureUrl ? (
                          <img src={chat.friendPictureUrl} alt="" className="w-10 h-10 rounded-full flex-shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0">
                            <span className="text-gray-500 text-sm">{chat.friendName.charAt(0)}</span>
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-1.5 min-w-0 flex-1">
                              {chat.status === 'unread' && (
                                <span className="w-2 h-2 rounded-full bg-red-500 flex-shrink-0" aria-label="未読" />
                              )}
                              <p className="text-sm font-medium text-gray-900 truncate">{chat.friendName}</p>
                            </div>
                            <span className="text-[10px] text-gray-400 flex-shrink-0">{formatDatetime(chat.lastMessageAt)}</span>
                          </div>
                          <p
                            className={`text-xs mt-0.5 truncate ${
                              needsAttention
                                ? 'text-gray-900 font-medium'
                                : 'text-gray-400'
                            }`}
                            title={preview}
                          >
                            {chat.lastMessageDirection === 'outgoing' && (
                              <span className="text-gray-400 mr-1">↪</span>
                            )}
                            {preview || <span className="italic text-gray-300">(まだメッセージなし)</span>}
                          </p>
                        </div>
                      </div>
                    </button>
                  )
                })}
                {hasMoreChats && !unansweredOnly && (
                  <Button type="button" variant="ghost" loading={loadingMore}
                    onClick={() => { void loadMoreChats() }}
                    disabled={loadingMore}
                    className="w-full px-4 py-3 text-sm text-green-700 hover:bg-green-50 disabled:opacity-50 border-b border-gray-100"
                  >
                    {loadingMore ? '読み込み中...' : 'さらに読み込む'}
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Center Panel: Chat Detail */}
        <div className={`flex-1 min-w-0 bg-white flex-col overflow-hidden ${selectedChatId || selectedFriendId ? 'flex' : 'hidden lg:flex'}`}>
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
              {/* Chat Header — flex-shrink-0: 低いビューポートでもヘッダーとコンポーザーは
                  高さを保ち、縮むのはメッセージ一覧だけにする */}
              <div className="flex-shrink-0 px-4 py-2.5 border-b border-gray-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Button type="button" size="xs" shape="square" variant="ghost" title="戻る"
                    onClick={() => setSelectedChatId(null)}
                    className="lg:hidden flex-shrink-0 p-1 -ml-1 text-gray-500 hover:text-gray-700"
                    aria-label="戻る"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </Button>
                  {chatDetail.friendPictureUrl && (
                    <img src={chatDetail.friendPictureUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">
                      {chatDetail.friendName}
                    </p>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium mt-1 ${statusConfig[chatDetail.status].className}`}
                    >
                      {statusConfig[chatDetail.status].label}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {/* メモはPC(xl+)では右サイドバーに常設。狭い画面のみトグルで表示する */}
                  <Button type="button" size="sm" variant={showMobileMemo ? 'primary' : 'secondary'}
                    onClick={() => setShowMobileMemo((v) => !v)}
                    className="xl:hidden"
                    title="メモを表示"
                  >
                    📝 メモ
                  </Button>
                  {unansweredOnly && chats.length > 1 && (
                  <Button type="button" size="sm" variant="primary"
                      onClick={() => {
                        const idx = chats.findIndex((c) => c.id === selectedChatId)
                        // idx < 0 = current chat is no longer in the list (e.g. just sent a reply)
                        // → fall back to the head of the list so the queue keeps moving
                        const nextIdx = idx < 0 ? 0 : (idx + 1) % chats.length
                        const next = chats[nextIdx]
                        if (next && next.id !== selectedChatId) {
                          setSelectedChatId(next.id)
                        }
                      }}
                      title="次の未対応 friend に進む"
                    >
                      次の未対応 →
                    </Button>
                  )}
                  {chatDetail.status !== 'unread' && (
                    <Button type="button" size="sm" variant="destructive"
                      onClick={() => handleStatusUpdate('unread')}
                    >
                      未読に戻す
                    </Button>
                  )}
                  {chatDetail.status !== 'in_progress' && (
                    <Button type="button" size="sm" variant="secondary"
                      onClick={() => handleStatusUpdate('in_progress')}
                    >
                      対応中にする
                    </Button>
                  )}
                  {chatDetail.status !== 'resolved' && (
                    <Button type="button" size="sm" variant="primary"
                      onClick={() => handleStatusUpdate('resolved')}
                    >
                      解決済にする
                    </Button>
                  )}
                </div>
              </div>

              {/* Messages — LINE-style chat bubbles */}
              <div ref={messagesScrollRef} className="flex-1 overflow-y-auto overflow-x-hidden p-4 space-y-2" style={{ backgroundColor: '#7494C0' }}>
                {(!chatDetail.messages || chatDetail.messages.length === 0) ? (
                  <div className="text-center py-8">
                    <p className="text-white/60 text-sm">メッセージはまだありません。</p>
                  </div>
                ) : (
                  (chatDetail.messages ?? []).map((msg, idx) => {
                    const allMsgs = chatDetail.messages ?? []
                    const prevMsg = idx > 0 ? allMsgs[idx - 1] : null
                    const showDateSep = !prevMsg || !sameYmd(prevMsg.createdAt, msg.createdAt)
                    const isOutgoing = msg.direction === 'outgoing'

                    // リッチメニュー切替の postback はバブルにせずシステム行で表示。
                    // 同日内の連続タップは先頭の1行に ×N でまとめる（タブを行き来する
                    // だけで数十行埋まるのを防ぐ）。
                    if (isRichMenuSwitch(msg)) {
                      const isRunContinuation =
                        prevMsg != null && isRichMenuSwitch(prevMsg) && sameYmd(prevMsg.createdAt, msg.createdAt)
                      if (isRunContinuation) {
                        return null
                      }
                      let runLength = 1
                      for (let j = idx + 1; j < allMsgs.length; j++) {
                        if (isRichMenuSwitch(allMsgs[j]) && sameYmd(allMsgs[j].createdAt, msg.createdAt)) runLength++
                        else break
                      }
                      return (
                        <div key={msg.id}>
                          {showDateSep && (
                            <div className="flex justify-center my-3">
                              <span className="text-[11px] text-white/85 bg-black/20 px-2.5 py-0.5 rounded-full">
                                {formatYmdSlash(msg.createdAt)}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-center my-1.5">
                            <span className="text-[11px] text-white/70 bg-black/15 px-2.5 py-0.5 rounded-full">
                              リッチメニュー切替{runLength > 1 ? ` ×${runLength}` : ''}
                              {' · '}
                              {new Date(msg.createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      )
                    }

                    // メッセージ表示の分岐。
                    // flex は LINE 本体と同じく吹き出し (背景色つきバブル) に包まない。
                    // カード自体が完成された UI なので、緑バブルに入れると余白と背景が
                    // 二重になる上、狭い max-w に押し込まれて崩れる。
                    // sticker はバブルに残す — 画像 404 時のテキストフォールバックが
                    // 裸だと青背景に無彩色文字で浮いてしまう (Codex Review 指摘)。
                    const isBareContent = msg.messageType === 'flex'
                    let bubbleContent: React.ReactNode
                    if (msg.messageType === 'flex') {
                      bubbleContent = <FlexPreviewComponent content={msg.content} />
                    } else if (msg.messageType === 'image') {
                      try {
                        const parsed = JSON.parse(msg.content)
                        bubbleContent = (
                          <img src={parsed.originalContentUrl || parsed.previewImageUrl} alt="" className="max-w-[200px] rounded" />
                        )
                      } catch {
                        bubbleContent = <span>🖼️ [画像]</span>
                      }
                    } else if (msg.messageType === 'sticker') {
                      bubbleContent = <StickerMessageImage content={msg.content} />
                    } else {
                      bubbleContent = <span>{msg.content}</span>
                    }

                    return (
                      <div key={msg.id}>
                        {showDateSep && (
                          <div className="flex justify-center my-3">
                            <span className="text-[11px] text-white/85 bg-black/20 px-2.5 py-0.5 rounded-full">
                              {formatYmdSlash(msg.createdAt)}
                            </span>
                          </div>
                        )}
                        <div
                          className={`flex items-end gap-2 ${isOutgoing ? 'justify-end' : 'justify-start'}`}
                        >
                          {/* 相手のアイコン（incoming のみ） */}
                          {!isOutgoing && (
                            chatDetail.friendPictureUrl ? (
                              <img src={chatDetail.friendPictureUrl} alt="" className="w-8 h-8 rounded-full flex-shrink-0 mb-1" />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-gray-300 flex-shrink-0 mb-1" />
                            )
                          )}

                          {/* w-full が要る: 吹き出しの max-w が % 指定なので、
                              親の幅が確定していないとパーセントを解決できず
                              min-content（1 文字幅）まで潰れて縦一列に改行される */}
                          <div className={`flex flex-col w-full min-w-0 ${isOutgoing ? 'items-end' : 'items-start'}`}>
                            {/* メッセージバブル。flex / sticker はバブル chrome なしで直接置く */}
                            {isBareContent ? (
                              <div className="max-w-[92%] lg:max-w-[80%] min-w-0">
                                {bubbleContent}
                              </div>
                            ) : (
                              <div
                                className={`max-w-[75%] lg:max-w-[60%] px-3 py-2 text-sm break-words whitespace-pre-wrap ${
                                  isOutgoing
                                    ? 'rounded-tl-2xl rounded-tr-md rounded-bl-2xl rounded-br-2xl bg-kumo-brand text-kumo-inverse'
                                    : 'rounded-tl-md rounded-tr-2xl rounded-bl-2xl rounded-br-2xl bg-white text-gray-900'
                                }`}
                              >
                                {bubbleContent}
                              </div>
                            )}
                            {/* 時刻 */}
                            <span className="text-xs text-white/50 mt-0.5 px-1">
                              {new Date(msg.createdAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Notes — PC(xl+)は右サイドバーに常設。狭い画面のみトグル表示 */}
              {showMobileMemo && (
                <div className="xl:hidden px-4 py-2 border-t border-gray-200 bg-gray-50">
                  <div className="flex items-center gap-2">
                    <Input
                      aria-label="友だちメモ"
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="メモを入力..."
                      className="flex-1 text-xs"
                    />
                    <Button type="button" size="xs" variant="secondary" loading={savingNotes}
                      onClick={handleSaveNotes}
                      disabled={savingNotes}
                    >
                      メモ保存
                    </Button>
                  </div>
                </div>
              )}

              {/* Send Message Form — OAM風コンパクト構成。
                  画像添付は 📎、ローディング/送信キー設定は ⚙ に格納し、
                  通常時は入力欄1行だけにしてメッセージ表示領域を最大化する */}
              {/* z-30 + bg-white: 何かの浮遊要素が万一重なってもコンポーザーが
                  最前面でクリックを受ける。onClick はボタン/入力要素以外の余白
                  クリックを入力欄フォーカスに変換する (当たり判定を行全体に拡大) */}
              <div
                className="relative z-30 bg-white flex-shrink-0 px-4 pt-3 pb-5 border-t border-gray-200"
                onClick={(e) => {
                  const t = e.target as HTMLElement
                  if (t.closest('button, textarea, input, select, label, a')) return
                  textareaRef.current?.focus()
                }}
              >
                {showComposerSettings && (
                  <div
                    ref={composerSettingsRef}
                    role="dialog"
                    aria-label="送信設定"
                    className="absolute bottom-full left-2 z-20 mb-1 w-72 rounded-lg border border-gray-200 bg-white p-3 shadow-lg space-y-3 text-xs text-gray-600"
                  >
                    <div className="flex items-center gap-2">
                      <Checkbox
                          label="入力中ローディングを表示"
                          checked={showLoadingIndicator}
                          onCheckedChange={setShowLoadingIndicator}
                        />
                      <Select
                        aria-label="ローディング秒数"
                        value={loadingSeconds}
                        onValueChange={(value) => setLoadingSeconds(Number.parseInt(String(value ?? 10), 10))}
                        disabled={!showLoadingIndicator}
                        items={Object.fromEntries([5, 10, 15, 20, 30, 45, 60].map((sec) => [sec, `${sec}秒`]))}
                      />
                    </div>
                    <div className="flex items-center gap-3">
                      <Radio.Group legend="送信キー" value={sendMode} onValueChange={setSendMode} className="flex gap-3"><Radio.Item value="enter" label="Enter" /><Radio.Item value="shift-enter" label="Shift+Enter" /></Radio.Group>
                    </div>
                  </div>
                )}
                {(showImagePicker || pendingImage) && (
                  <div className="mb-2">
                    <ImageUploader
                      mode="line-image"
                      value={pendingImage}
                      onChange={setPendingImage}
                      label="画像を送る (任意)"
                    />
                  </div>
                )}
                {/* 標準的なチャットコンポーザー (Slack / ChatGPT 型):
                    1枚の枠の中に「上: textarea 全幅 / 下: ツールバー行」。
                    - textarea が幅いっぱい = クリックターゲット最大
                    - アイコン/送信は独立した下段行 = 入力領域と重ならない
                    - 枠内のどこをクリックしても入力欄にフォーカス */}
                <div
                  className="rounded-2xl border border-gray-300 bg-white cursor-text transition-colors focus-within:border-green-500 focus-within:ring-2 focus-within:ring-green-100"
                  onClick={(e) => {
                    const t = e.target as HTMLElement
                    if (t.closest('button, textarea, input, select, label, a')) return
                    textareaRef.current?.focus()
                  }}
                >
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
                    className="block w-full resize-none border-0 bg-transparent px-4 pt-3 pb-1 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
                  />
                  <div className="flex items-center gap-0.5 px-2 pb-2">
                    <Button
                      type="button"
                      size="sm"
                      shape="square"
                      variant={showImagePicker || pendingImage ? 'primary' : 'ghost'}
                      onClick={() => setShowImagePicker((v) => !v)}
                      title="画像を添付"
                      aria-label="画像を添付"
                    >
                      <svg className="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      shape="square"
                      variant={showComposerSettings ? 'primary' : 'ghost'}
                      ref={composerSettingsButtonRef}
                      onClick={() => setShowComposerSettings((v) => !v)}
                      aria-expanded={showComposerSettings}
                      title="送信設定 (ローディング表示・送信キー)"
                      aria-label="送信設定"
                    >
                      <svg className="w-5 h-5 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </Button>
                    <span className="ml-auto mr-2 hidden sm:inline text-[11px] text-gray-300 select-none">
                      {sendMode === 'enter' ? 'Enter で送信' : 'Shift+Enter で送信'}
                    </span>
                    <Button
                      type="button"
                      variant="primary"
                      loading={sending}
                      onClick={handleSendMessage}
                      disabled={sending || (!messageContent.trim() && !pendingImage)}
                    >
                      送信
                    </Button>
                  </div>
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
          // xl 未満で 3 カラムにすると中央のチャット列が 160px 前後まで潰れ、
          // コンポーザーが収まらなくなる。サイドバーは xl 以上でのみ出す。
          <div className="hidden xl:flex">
            <FriendInfoSidebar
              friendId={selectedFriendId || selectedChatId}
              chatStatus={
                chatDetail && chatDetail.id === (selectedFriendId || selectedChatId)
                  ? { status: chatDetail.status, notes: chatDetail.notes }
                  : undefined
              }
              {...(selectedChatId && chatDetail && chatDetail.id === selectedChatId
                ? {
                    notesValue: notes,
                    onNotesChange: setNotes,
                    onSaveNotes: handleSaveNotes,
                    savingNotes,
                  }
                : {})}
            />
          </div>
        )}
      </div>
      {/* コンポーザーが画面下端まで来るレイアウトなので、既定位置 (bottom-6 right-6) だと
          送信ボタンに重なってクリックを奪う。xl 以上では友だち詳細サイドバーの上に
          浮くので無害だが、サイドバーが消える xl 未満では入力欄の真上に来てしまい、
          複数行入力で伸びた textarea のクリックを奪う。xl 未満では表示しない。 */}
      <CcPromptButton prompts={ccPrompts} positionClassName="max-xl:hidden bottom-24 right-6" />
    </div>
  )
}
