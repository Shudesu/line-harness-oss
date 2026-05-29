import Link from 'next/link'
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
import { formatDateTime, normalizeTemplatePreview, renderMessageSender, shortText, statusClass, statusLabel } from '../utils'

export function SupportTab(props: {
  chats: ConsoleChat[]
  chatDetail: ConsoleChatDetail | null
  selectedChatId: string | null
  setSelectedChatId: (id: string) => void
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
}) {
  const selectedTagIds = new Set(props.selectedFriend?.tags?.map((tag) => tag.id) || [])

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)_340px]">
      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-4">
          <p className="text-sm font-bold text-gray-950">対応するチャット</p>
          <p className="mt-1 text-xs text-gray-500">直近30日の会話から選びます。</p>
        </div>
        <div className="max-h-[680px] overflow-y-auto">
          {props.chats.length === 0 ? (
            <p className="p-4 text-sm text-gray-500">直近30日のチャットはありません。</p>
          ) : (
            props.chats.map((chat) => (
              <button
                key={chat.id}
                onClick={() => props.setSelectedChatId(chat.id)}
                className={`w-full border-b border-gray-100 px-4 py-3 text-left hover:bg-gray-50 ${
                  props.selectedChatId === chat.id ? 'bg-emerald-50' : ''
                }`}
              >
                <div className="flex items-center gap-3">
                  {chat.friendPictureUrl ? (
                    <img src={chat.friendPictureUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-sm font-bold text-gray-500">
                      {chat.friendName.charAt(0) || '?'}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-950">{chat.friendName}</p>
                    <p className="mt-0.5 text-xs text-gray-400">{formatDateTime(chat.lastMessageAt)}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${statusClass[chat.status]}`}>
                    {statusLabel[chat.status]}
                  </span>
                </div>
              </button>
            ))
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-4">
          <p className="text-sm font-bold text-gray-950">{props.chatDetail?.friendName || 'チャットを選択'}</p>
          <p className="mt-1 text-xs text-gray-500">テンプレートを使いながら素早く返信します。</p>
        </div>

        <div className="h-[390px] overflow-y-auto bg-slate-50 p-4">
          {!props.chatDetail ? (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">左からチャットを選択してください。</div>
          ) : props.chatDetail.messages?.length ? (
            <div className="space-y-3">
              {props.chatDetail.messages.map((msg) => {
                const outgoing = msg.direction === 'outgoing' || msg.senderType === 'operator'
                return (
                  <div key={msg.id} className={`flex ${outgoing ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[82%] rounded-2xl px-4 py-2 text-sm ${
                      outgoing ? 'bg-emerald-500 text-white' : 'bg-white text-gray-800 shadow-sm'
                    }`}>
                      <p className="whitespace-pre-wrap break-words">{shortText(msg.content, 400)}</p>
                      <p className={`mt-1 text-[11px] ${outgoing ? 'text-emerald-50' : 'text-gray-400'}`}>
                        {renderMessageSender(msg)} / {formatDateTime(msg.createdAt)}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-gray-400">メッセージ履歴がありません。</div>
          )}
        </div>

        <div className="border-t border-gray-100 p-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {props.templates.map((template) => (
              <button
                key={template.id}
                onClick={() => props.onSendTemplate(template)}
                disabled={!props.chatDetail || props.sending}
                className="rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                title={normalizeTemplatePreview(template)}
              >
                {template.name}
              </button>
            ))}
            <Link href="/templates" className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-200">
              テンプレート管理
            </Link>
          </div>
          <div className="flex gap-2">
            <textarea
              value={props.message}
              onChange={(event) => props.setMessage(event.target.value)}
              placeholder="返信を入力..."
              rows={3}
              className="min-h-[84px] flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
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

      <aside className="space-y-4">
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-950">顧客検索</p>
          <div className="mt-3 flex gap-2">
            <input
              value={props.search}
              onChange={(event) => props.setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') props.onSearchFriends()
              }}
              className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm"
              placeholder="山田 / 090..."
            />
            <button onClick={props.onSearchFriends} disabled={props.searching} className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
              検索
            </button>
          </div>
          <div className="mt-3 space-y-2">
            {props.friendResults.map((friend) => (
              <button key={friend.id} onClick={() => props.onOpenFriendChat(friend)} className="w-full rounded-lg border border-gray-100 bg-gray-50 p-3 text-left hover:bg-gray-100">
                <p className="truncate text-sm font-semibold text-gray-900">{friend.displayName}</p>
                <p className="mt-1 text-xs text-gray-500">{friend.isFollowing === false ? 'ブロック/未フォローの可能性' : 'チャットを開く'}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-950">顧客メモ・タグ</p>
          {props.selectedFriend ? (
            <>
              <p className="mt-1 text-xs text-gray-500">{props.selectedFriend.displayName}</p>
              <textarea
                value={props.notesDraft}
                onChange={(event) => props.setNotesDraft(event.target.value)}
                rows={3}
                className="mt-3 w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm"
                placeholder="メモを入力"
              />
              <button onClick={props.onSaveNotes} disabled={props.savingNotes} className="mt-2 w-full rounded-lg bg-emerald-500 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">
                {props.savingNotes ? '保存中...' : 'メモ保存'}
              </button>
              <div className="mt-3 flex flex-wrap gap-2">
                {props.selectedFriend.tags?.map((tag) => (
                  <button key={tag.id} onClick={() => props.onRemoveTag(tag.id)} disabled={props.updatingTagId === tag.id} className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    {tag.name} ×
                  </button>
                ))}
              </div>
              <select onChange={(event) => event.target.value && props.onAddTag(event.target.value)} value="" className="mt-3 w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                <option value="">タグを追加</option>
                {props.tags.filter((tag) => !selectedTagIds.has(tag.id)).map((tag) => (
                  <option key={tag.id} value={tag.id}>{tag.name}</option>
                ))}
              </select>
            </>
          ) : (
            <p className="mt-2 text-sm text-gray-500">チャットを選択してください。</p>
          )}
        </section>

        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-bold text-gray-950">外部顧客と紐づけ</p>
          <p className="mt-1 text-xs text-gray-500">既存予約システムの名前・電話・メールとLINE友だちをつなぎます。</p>
          <div className="mt-3 flex gap-2">
            <input value={props.externalQuery} onChange={(event) => props.setExternalQuery(event.target.value)} className="min-w-0 flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="電話・名前" />
            <button onClick={props.onSearchExternalCustomers} disabled={props.externalLoading} className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">検索</button>
          </div>
          <div className="mt-3 space-y-2">
            {props.externalLinks.map((link) => (
              <div key={link.id} className="rounded-lg bg-emerald-50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-emerald-950">{link.customer.name || '名前未設定'}</p>
                    <p className="text-xs text-emerald-700">{link.customer.phone || link.customer.email || link.customer.source}</p>
                  </div>
                  <button onClick={() => props.onUnlinkExternalCustomer(link.externalCustomerId)} className="text-xs font-bold text-emerald-800">解除</button>
                </div>
              </div>
            ))}
            {props.externalResults.map((customer) => (
              <div key={customer.id} className="rounded-lg border border-gray-100 bg-gray-50 p-3">
                <p className="truncate text-sm font-semibold text-gray-900">{customer.name || '名前未設定'}</p>
                <p className="text-xs text-gray-500">{customer.phone || customer.email || customer.source}</p>
                <button onClick={() => props.onLinkExternalCustomer(customer)} disabled={!props.selectedFriend || props.externalLoading} className="mt-2 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50">紐づけ</button>
              </div>
            ))}
          </div>
          <div className="mt-4 grid gap-2">
            <input value={props.externalForm.name} onChange={(event) => props.setExternalForm({ ...props.externalForm, name: event.target.value })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="外部顧客名" />
            <input value={props.externalForm.phone} onChange={(event) => props.setExternalForm({ ...props.externalForm, phone: event.target.value })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="電話番号" />
            <input value={props.externalForm.email} onChange={(event) => props.setExternalForm({ ...props.externalForm, email: event.target.value })} className="rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="メール" />
            <button onClick={props.onCreateExternalCustomer} disabled={props.externalLoading} className="rounded-lg bg-gray-900 px-3 py-2 text-sm font-bold text-white disabled:opacity-50">外部顧客を作成</button>
          </div>
          <label className="mt-3 block rounded-lg border border-dashed border-gray-200 p-3 text-xs text-gray-500">
            CSV取り込み
            <input type="file" accept=".csv,text/csv" className="mt-2 block w-full text-xs" onChange={(event) => props.onImportExternalCustomerCsv(event.target.files?.[0])} disabled={props.csvImportState.importing} />
          </label>
          {props.csvImportState.message && <p className="mt-2 text-xs text-gray-500">{props.csvImportState.message}</p>}
        </section>
      </aside>
    </div>
  )
}
