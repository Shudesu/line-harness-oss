import { useState } from 'react'
import FlexPreviewComponent from '@/components/flex-preview'
import { LineMessageBubble } from '@/components/line-message-bubble'
import { fetchApi } from '@/lib/api'
import type {
  ApiExternalCustomer,
  ApiExternalCustomerLink,
  ConsoleChat,
  ConsoleChatDetail,
  ConsoleFriend,
  ConsoleTag,
  ConsoleTemplate,
  CsvImportState,
  ExternalCustomerForm,
} from '../types'
import { formatDateTime, normalizeTemplatePreview, statusClass, statusLabel } from '../utils'

type ChatPanel = 'chat' | 'templates' | 'customer' | 'forms' | 'tags'

type FormSummary = {
  id: string
  name: string
  submitCount?: number
}

type FormSubmission = {
  id: string
  formId: string
  friendId: string | null
  friendName?: string | null
  data: Record<string, unknown> | string
  createdAt: string
}

export function SupportTab(props: {
  chats: ConsoleChat[]
  chatDetail: ConsoleChatDetail | null
  selectedChatId: string | null
  setSelectedChatId: (id: string | null) => void
  templates: ConsoleTemplate[]
  tags: ConsoleTag[]
  selectedFriend: ConsoleFriend | null
  notesDraft: string
  setNotesDraft: (value: string) => void
  savingNotes: boolean
  onSaveNotes: () => void
  updatingTagId: string | null
  onAddTag: (tagId: string) => void
  onRemoveTag: (tagId: string) => void
  externalQuery: string
  setExternalQuery: (value: string) => void
  externalResults: ApiExternalCustomer[]
  externalLinks: ApiExternalCustomerLink[]
  externalLoading: boolean
  externalForm: ExternalCustomerForm
  setExternalForm: (value: ExternalCustomerForm) => void
  onSearchExternalCustomers: () => void
  onCreateExternalCustomer: () => void
  onLinkExternalCustomer: (customer: ApiExternalCustomer) => void
  onUnlinkExternalCustomer: (externalCustomerId: string) => void
  csvImportState: CsvImportState
  onImportExternalCustomerCsv: (file: File | undefined) => void
  message: string
  setMessage: (value: string) => void
  sending: boolean
  onSendMessage: () => void
  onSendTemplate: (template: ConsoleTemplate) => void
  search: string
  setSearch: (value: string) => void
  searching: boolean
  friendResults: ConsoleFriend[]
  onSearchFriends: () => void
  onOpenFriendChat: (friend: ConsoleFriend) => void
  friendTagsById: Record<string, ConsoleTag[]>
}) {
  const [panel, setPanel] = useState<ChatPanel>('chat')
  const visibleChats = props.chats.filter((chat) => {
    const q = props.search.trim().toLowerCase()
    if (!q) return true
    return chat.friendName.toLowerCase().includes(q)
  })

  const openChat = (chatId: string) => {
    props.setSelectedChatId(chatId)
    setPanel('chat')
  }

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Messages</p>
            <h2 className="text-xl font-black text-gray-950">メッセージ対応</h2>
            <p className="mt-1 text-sm text-gray-500">友だちをタップするとチャットをモーダルで開きます。</p>
          </div>
          <div className="flex gap-2">
            <input
              value={props.search}
              onChange={(event) => props.setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') props.onSearchFriends()
              }}
              className="min-w-0 rounded-xl border border-gray-200 px-3 py-2 text-sm"
              placeholder="名前・電話で検索"
            />
            <button onClick={props.onSearchFriends} disabled={props.searching} className="rounded-xl bg-gray-900 px-4 py-2 text-sm font-bold text-white disabled:opacity-50">
              検索
            </button>
          </div>
        </div>
      </section>

      {props.friendResults.length > 0 && (
        <section className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-sm font-bold text-emerald-950">検索結果</p>
          <div className="mt-3 grid gap-2 md:grid-cols-2 lg:grid-cols-3">
            {props.friendResults.map((friend) => (
              <button key={friend.id} onClick={() => { props.onOpenFriendChat(friend); setPanel('chat') }} className="rounded-xl bg-white p-3 text-left shadow-sm hover:bg-emerald-50">
                <p className="truncate text-sm font-bold text-gray-950">{friend.displayName}</p>
                <p className="mt-1 text-xs text-gray-500">{friend.isFollowing === false ? 'ブロック/未フォローの可能性' : 'チャットを開く'}</p>
              </button>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-3xl border border-gray-200 bg-white shadow-sm">
        <div className="grid divide-y divide-gray-100 md:grid-cols-2 md:divide-x md:divide-y-0 lg:grid-cols-3">
          {visibleChats.length === 0 ? (
            <p className="p-5 text-sm text-gray-500">直近30日のチャットはありません。</p>
          ) : (
            visibleChats.map((chat) => (
              <button key={chat.id} onClick={() => openChat(chat.id)} className="p-4 text-left hover:bg-gray-50">
                <div className="flex items-center gap-3">
                  {chat.friendPictureUrl ? (
                    <img src={chat.friendPictureUrl} alt="" className="h-11 w-11 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-11 w-11 items-center justify-center rounded-full bg-gray-100 text-sm font-bold text-gray-500">
                      {chat.friendName.charAt(0) || '?'}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-gray-950">{chat.friendName}</p>
                    <p className="text-xs text-gray-400">{formatDateTime(chat.lastMessageAt)}</p>
                    <ChatTagRow tags={props.friendTagsById[chat.friendId] || []} />
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusClass[chat.status]}`}>{statusLabel[chat.status]}</span>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      {props.selectedChatId && (
        <ChatModal
          {...props}
          panel={panel}
          setPanel={setPanel}
          onClose={() => props.setSelectedChatId(null)}
        />
      )}
    </div>
  )
}

function ChatModal(props: Parameters<typeof SupportTab>[0] & {
  panel: ChatPanel
  setPanel: (panel: ChatPanel) => void
  onClose: () => void
}) {
  const selectedTagIds = new Set(props.selectedFriend?.tags?.map((tag) => tag.id) || [])
  const panelButton = (id: ChatPanel, label: string) => (
    <button
      onClick={() => props.setPanel(id)}
      className={`rounded-full px-3 py-1.5 text-xs font-bold ${props.panel === id ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-0 sm:items-center sm:p-4">
      <section className="flex max-h-[94vh] w-full flex-col rounded-t-3xl bg-white shadow-2xl sm:mx-auto sm:max-w-5xl sm:rounded-3xl">
        <div className="border-b border-gray-100 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-lg font-black text-gray-950">{props.chatDetail?.friendName || '読み込み中...'}</p>
              <p className="mt-1 text-xs text-gray-500">顧客対応・テンプレート・タグ管理をこの画面で完結します。</p>
            </div>
            <button onClick={props.onClose} className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-bold text-gray-700 hover:bg-gray-200">閉じる</button>
          </div>
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {panelButton('chat', 'チャット')}
            {panelButton('templates', 'テンプレート')}
            {panelButton('customer', '顧客情報')}
            {panelButton('forms', 'フォーム回答')}
            {panelButton('tags', 'タグ')}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-slate-50 p-4">
          {props.panel === 'chat' && <ChatPanelContent {...props} />}
          {props.panel === 'templates' && <TemplatePanel {...props} />}
          {props.panel === 'customer' && <CustomerPanel {...props} />}
          {props.panel === 'forms' && <FriendFormsPanel friendId={props.chatDetail?.friendId || props.selectedFriend?.id || null} />}
          {props.panel === 'tags' && <TagPanel {...props} selectedTagIds={selectedTagIds} />}
        </div>

        <div className="border-t border-gray-100 bg-white p-4">
          <div className="flex gap-2">
            <textarea
              value={props.message}
              onChange={(event) => props.setMessage(event.target.value)}
              placeholder="返信を入力..."
              rows={2}
              className="min-h-[64px] flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
            />
            <button
              onClick={props.onSendMessage}
              disabled={!props.chatDetail || !props.message.trim() || props.sending}
              className="self-end rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-40"
            >
              送信
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

function ChatPanelContent(props: Parameters<typeof SupportTab>[0]) {
  if (!props.chatDetail) {
    return <div className="flex h-72 items-center justify-center text-sm text-gray-400">チャットを読み込み中です。</div>
  }
  if (!props.chatDetail.messages?.length) {
    return <div className="flex h-72 items-center justify-center text-sm text-gray-400">メッセージ履歴がありません。</div>
  }
  return (
    <div className="space-y-3">
      {props.chatDetail.messages.map((msg) => {
        const outgoing = msg.direction === 'outgoing' || msg.senderType === 'operator'
        return (
          <LineMessageBubble
            key={msg.id}
            content={msg.content}
            messageType={msg.messageType}
            outgoing={outgoing}
            createdAt={msg.createdAt}
            avatarUrl={props.chatDetail?.friendPictureUrl}
            maxWidth={outgoing || msg.messageType !== 'flex' ? 320 : 300}
          />
        )
      })}
    </div>
  )
}

function FriendFormsPanel({ friendId }: { friendId: string | null }) {
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [items, setItems] = useState<Array<{ form: FormSummary; submission: FormSubmission }>>([])

  const load = async () => {
    if (!friendId || loading) return
    setLoading(true)
    setError('')
    try {
      const formsRes = await fetchApi<{ success: boolean; data: FormSummary[]; error?: string }>('/api/forms')
      if (!formsRes.success) throw new Error(formsRes.error || 'フォーム一覧を取得できませんでした。')
      const collected: Array<{ form: FormSummary; submission: FormSubmission }> = []
      for (const form of formsRes.data) {
        const res = await fetchApi<{ success: boolean; data: FormSubmission[]; error?: string }>(`/api/forms/${encodeURIComponent(form.id)}/submissions`)
        if (!res.success) continue
        for (const submission of res.data) {
          if (submission.friendId === friendId) collected.push({ form, submission })
        }
      }
      collected.sort((a, b) => String(b.submission.createdAt).localeCompare(String(a.submission.createdAt)))
      setItems(collected)
      setLoaded(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'フォーム回答を取得できませんでした。')
    } finally {
      setLoading(false)
    }
  }

  if (!friendId) {
    return <div className="rounded-2xl bg-white p-5 text-sm text-gray-500 shadow-sm">友達情報を読み込み中です。</div>
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-black text-gray-950">フォーム回答</p>
            <p className="mt-1 text-xs text-gray-500">この顧客が送信したフォーム回答を確認します。</p>
          </div>
          <button onClick={() => void load()} disabled={loading} className="rounded-xl bg-gray-900 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">
            {loading ? '取得中' : loaded ? '再取得' : '回答を見る'}
          </button>
        </div>
      </div>
      {error && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}</div>}
      {loaded && items.length === 0 && <div className="rounded-2xl bg-white p-5 text-sm text-gray-500 shadow-sm">この顧客のフォーム回答はありません。</div>}
      {items.map(({ form, submission }) => {
        const data = typeof submission.data === 'string' ? safeParseObject(submission.data) : submission.data
        return (
          <article key={submission.id} className="rounded-2xl bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-black text-gray-950">{form.name}</p>
                <p className="mt-1 text-xs text-gray-400">{formatDateTime(submission.createdAt)}</p>
              </div>
              <span className="rounded-full bg-emerald-50 px-2 py-1 text-xs font-bold text-emerald-700">回答</span>
            </div>
            <dl className="mt-3 grid gap-2 sm:grid-cols-2">
              {Object.entries(data || {}).map(([key, value]) => (
                <div key={key} className="rounded-xl bg-gray-50 p-3">
                  <dt className="text-[11px] font-bold text-gray-400">{key}</dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm font-semibold text-gray-800">{formatSubmissionValue(value)}</dd>
                </div>
              ))}
            </dl>
          </article>
        )
      })}
    </div>
  )
}

function safeParseObject(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function formatSubmissionValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

function ChatTagRow({ tags }: { tags: ConsoleTag[] }) {
  if (tags.length === 0) return null
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {tags.slice(0, 3).map((tag) => (
        <span
          key={tag.id}
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
            tag.kind === 'system' || tag.isLocked ? 'bg-blue-50 text-blue-700' : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {tag.kind === 'system' || tag.isLocked ? 'SYS ' : ''}{tag.name}
        </span>
      ))}
      {tags.length > 3 && <span className="text-[10px] font-bold text-gray-400">+{tags.length - 3}</span>}
    </div>
  )
}

function TemplatePanel(props: Parameters<typeof SupportTab>[0]) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {props.templates.map((template) => {
        const flexPreviewable = template.messageType === 'flex' && template.messageContent.trim().startsWith('{')
        return (
          <article key={template.id} className="min-w-[260px] max-w-[320px] rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-gray-950">{template.name}</p>
                <p className="mt-1 text-xs text-gray-500">{template.category} / {template.messageType}</p>
              </div>
              <button onClick={() => props.onSendTemplate(template)} disabled={!props.chatDetail || props.sending} className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">
                送る
              </button>
            </div>
            <div className="mt-3 rounded-xl bg-gray-50 p-3">
              {flexPreviewable ? (
                <FlexPreviewComponent content={template.messageContent} maxWidth={240} />
              ) : template.messageType === 'image' ? (
                <img src={template.messageContent.trim()} alt="テンプレート画像" className="max-h-48 rounded-lg object-contain" />
              ) : (
                <p className="whitespace-pre-wrap text-sm text-gray-700">{normalizeTemplatePreview(template)}</p>
              )}
            </div>
          </article>
        )
      })}
      {props.templates.length === 0 && <p className="text-sm text-gray-500">テンプレートがありません。</p>}
    </div>
  )
}

function CustomerPanel(props: Parameters<typeof SupportTab>[0]) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-sm font-black text-gray-950">顧客メモ</p>
        <p className="mt-1 text-xs text-gray-500">{props.selectedFriend?.displayName || props.chatDetail?.friendName || '顧客未選択'}</p>
        <textarea
          value={props.notesDraft}
          onChange={(event) => props.setNotesDraft(event.target.value)}
          rows={6}
          className="mt-3 w-full resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm"
          placeholder="メモを入力"
        />
        <button onClick={props.onSaveNotes} disabled={props.savingNotes} className="mt-3 w-full rounded-xl bg-emerald-500 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
          {props.savingNotes ? '保存中...' : 'メモ保存'}
        </button>
      </section>

      <section className="rounded-2xl bg-white p-4 shadow-sm">
        <p className="text-sm font-black text-gray-950">外部顧客</p>
        <p className="mt-1 text-xs text-gray-500">既存予約システムの名前・電話・メールと紐づけます。</p>
        <div className="mt-3 space-y-2">
          {props.externalLinks.map((link) => (
            <div key={link.id} className="rounded-xl bg-emerald-50 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-emerald-950">{link.customer.name || '名前未設定'}</p>
                  <p className="text-xs text-emerald-700">{link.customer.phone || link.customer.email || link.customer.source}</p>
                </div>
                <button onClick={() => props.onUnlinkExternalCustomer(link.externalCustomerId)} className="text-xs font-bold text-emerald-800">解除</button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input value={props.externalQuery} onChange={(event) => props.setExternalQuery(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="電話・名前" />
          <button onClick={props.onSearchExternalCustomers} disabled={props.externalLoading} className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">検索</button>
        </div>
        <div className="mt-3 space-y-2">
          {props.externalResults.map((customer) => (
            <div key={customer.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
              <p className="truncate text-sm font-bold text-gray-900">{customer.name || '名前未設定'}</p>
              <p className="text-xs text-gray-500">{customer.phone || customer.email || customer.source}</p>
              <button onClick={() => props.onLinkExternalCustomer(customer)} disabled={!props.selectedFriend || props.externalLoading} className="mt-2 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">紐づけ</button>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}

function TagPanel(props: Parameters<typeof SupportTab>[0] & { selectedTagIds: Set<string> }) {
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-sm font-black text-gray-950">タグ管理</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {props.selectedFriend?.tags?.map((tag) => (
          <button key={tag.id} onClick={() => props.onRemoveTag(tag.id)} disabled={props.updatingTagId === tag.id} className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
            {tag.name} ×
          </button>
        ))}
        {!props.selectedFriend?.tags?.length && <p className="text-sm text-gray-500">タグはまだありません。</p>}
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {props.tags.filter((tag) => !props.selectedTagIds.has(tag.id)).map((tag) => (
          <button key={tag.id} onClick={() => props.onAddTag(tag.id)} disabled={props.updatingTagId === tag.id || !props.selectedFriend} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-left text-sm font-bold text-gray-800 hover:bg-gray-100 disabled:opacity-40">
            + {tag.name}
          </button>
        ))}
      </div>
    </div>
  )
}
