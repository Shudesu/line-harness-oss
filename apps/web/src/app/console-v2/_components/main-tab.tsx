import type { ApiUserEvent, ConsoleChat, ConsoleForm, ConsoleTrackedLink } from '../types'
import { formatDateTime, statusClass, statusLabel } from '../utils'
import { MiniList, MiniListItem, SummaryCard } from './shared'

export function MainTab({
  loading,
  chats,
  friendCount,
  trackedLinks,
  forms,
  recentEvents,
  onOpenMessages,
}: {
  loading: boolean
  chats: ConsoleChat[]
  friendCount: number | null
  trackedLinks: ConsoleTrackedLink[]
  forms: ConsoleForm[]
  recentEvents: ApiUserEvent[]
  onOpenMessages: () => void
}) {
  const unreadCount = chats.filter((chat) => chat.status === 'unread').length
  const inProgressCount = chats.filter((chat) => chat.status === 'in_progress').length
  const totalClicks = trackedLinks.reduce((sum, link) => sum + (link.clickCount || 0), 0)
  const topLinks = [...trackedLinks].sort((a, b) => b.clickCount - a.clickCount).slice(0, 5)
  const priorityChats = chats.filter((chat) => chat.status !== 'resolved').slice(0, 5)

  return (
    <div className="space-y-4">
      <section className="rounded-3xl border border-emerald-100 bg-gradient-to-br from-emerald-50 to-white p-5 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Today</p>
        <h2 className="mt-1 text-2xl font-black text-gray-950">今日の対応状況</h2>
        <p className="mt-1 text-sm text-gray-500">未読と対応中を先に処理し、空いた時間で配信とフォームを確認します。</p>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="未読チャット" value={loading ? '-' : unreadCount} tone="red" />
        <SummaryCard label="対応中" value={loading ? '-' : inProgressCount} tone="amber" />
        <SummaryCard label="友だち数" value={loading ? '-' : friendCount ?? '-'} tone="green" />
        <SummaryCard label="流入クリック" value={loading ? '-' : totalClicks} tone="blue" />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-bold text-gray-950">今見るべきチャット</p>
              <p className="mt-1 text-xs text-gray-500">未読・対応中を優先表示します。</p>
            </div>
            <button onClick={onOpenMessages} className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-white">
              開く
            </button>
          </div>
          <div className="mt-3 divide-y divide-gray-100">
            {priorityChats.length > 0 ? (
              priorityChats.map((chat) => (
                <div key={chat.id} className="flex items-center gap-3 py-3">
                  {chat.friendPictureUrl ? (
                    <img src={chat.friendPictureUrl} alt="" className="h-10 w-10 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100 text-sm font-bold text-gray-500">
                      {chat.friendName.charAt(0) || '?'}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-gray-950">{chat.friendName}</p>
                    <p className="text-xs text-gray-400">{formatDateTime(chat.lastMessageAt)}</p>
                  </div>
                  <span className={`rounded-full border px-2 py-0.5 text-xs font-bold ${statusClass[chat.status]}`}>{statusLabel[chat.status]}</span>
                </div>
              ))
            ) : (
              <p className="py-4 text-sm text-gray-500">優先対応のチャットはありません。</p>
            )}
          </div>
        </section>

        <aside className="space-y-4">
          <MiniList title="クリック上位" href="/tracked-links" empty="リンクなし">
            {topLinks.map((link) => <MiniListItem key={link.id} title={link.name} sub={`${link.clickCount}クリック`} />)}
          </MiniList>
          <MiniList title="フォーム" href="/form-submissions" empty="フォームなし">
            {forms.slice(0, 5).map((form) => <MiniListItem key={form.id} title={form.name} sub={`${form.submitCount ?? 0}件の回答`} />)}
          </MiniList>
        </aside>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-bold text-gray-950">直近イベント</p>
        <div className="mt-3 grid gap-2 md:grid-cols-2">
          {recentEvents.slice(0, 6).map((event) => (
            <div key={event.id} className="rounded-xl bg-gray-50 px-3 py-2">
              <p className="truncate text-sm font-semibold text-gray-900">{event.eventName || event.eventType}</p>
              <p className="mt-1 text-xs text-gray-400">{event.eventSource} / {formatDateTime(event.createdAt)}</p>
            </div>
          ))}
          {recentEvents.length === 0 && <p className="text-sm text-gray-500">直近イベントはありません。</p>}
        </div>
      </section>
    </div>
  )
}
