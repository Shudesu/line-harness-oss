'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { bookingApi, type BookingRequest } from '@/lib/api'
import { getApiBase } from '@/lib/api-base'
import { useAccount } from '@/contexts/account-context'
import {
  getBookingTimeGroup,
  isRecentlyReceived,
  matchesTimeFilter,
  sortBookings,
  type BookingSort,
  type BookingTimeFilter,
  type BookingTimeGroup,
} from './booking-view'
import { Badge } from '@cloudflare/kumo/components/badge'
import type { BadgeVariant } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Select } from '@cloudflare/kumo/components/select'

const STATUS_FILTERS: Array<{ key: string; label: string }> = [
  { key: 'all', label: 'すべて' },
  { key: 'requested', label: '未承認' },
  { key: 'confirmed', label: '確定' },
  { key: 'completed', label: '完了' },
  { key: 'cancelled', label: 'キャンセル' },
  { key: 'rejected', label: '拒否' },
  { key: 'expired', label: '期限切れ' },
  { key: 'no_show', label: '無断' },
]

const TIME_FILTERS: Array<{ key: BookingTimeFilter; label: string }> = [
  { key: 'upcoming', label: '今日以降' },
  { key: 'today', label: '今日' },
  { key: 'future', label: '明日以降' },
  { key: 'past', label: '過去' },
  { key: 'all', label: '全期間' },
]

const statusBadgeColor: Record<string, string> = {
  requested: 'bg-amber-100 text-amber-800 ring-amber-200',
  confirmed: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  rejected: 'bg-gray-100 text-gray-700 ring-gray-200',
  expired: 'bg-gray-100 text-gray-600 ring-gray-200',
  cancelled: 'bg-gray-100 text-gray-600 ring-gray-200',
  completed: 'bg-blue-100 text-blue-800 ring-blue-200',
  no_show: 'bg-red-100 text-red-800 ring-red-200',
}

const statusLabel: Record<string, string> = {
  requested: '未承認',
  confirmed: '確定',
  rejected: '拒否',
  expired: '期限切れ',
  cancelled: 'キャンセル',
  completed: '完了',
  no_show: '無断',
}

const actionLabel: Record<string, string> = {
  approve: '承認',
  reject: '拒否',
  cancel: 'キャンセル',
  no_show: '無断キャンセル',
  complete: '完了',
}

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric',
  day: 'numeric',
  weekday: 'short',
  timeZone: 'Asia/Tokyo',
})

const timeFormatter = new Intl.DateTimeFormat('ja-JP', {
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Tokyo',
})

const receivedFormatter = new Intl.DateTimeFormat('ja-JP', {
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  timeZone: 'Asia/Tokyo',
})

export default function BookingsPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [statusFilter, setStatusFilter] = useState('all')
  const [timeFilter, setTimeFilter] = useState<BookingTimeFilter>('upcoming')
  const [sort, setSort] = useState<BookingSort>('schedule')
  const [items, setItems] = useState<BookingRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<{ id: string; action: 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete' } | null>(null)
  const [deciding, setDeciding] = useState(false)

  const liffId = selectedAccount?.liffId ?? null
  const workerBase = getApiBase() ?? ''
  const shareUrl = workerBase && liffId
    ? `${workerBase}/o?liffId=${encodeURIComponent(liffId)}&page=salon-book`
    : null
  const copied = copiedUrl !== null && copiedUrl === shareUrl

  async function copyUrl(url: string | null) {
    if (!url) return
    try {
      await navigator.clipboard.writeText(url)
      setCopiedUrl(url)
      setTimeout(() => {
        setCopiedUrl((current) => (current === url ? null : current))
      }, 2000)
    } catch {
      window.prompt('コピーしてください:', url)
    }
  }

  const load = useCallback(async () => {
    if (!selectedAccountId) {
      setItems([])
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    setItems([])
    try {
      const response = await bookingApi.listRequests(selectedAccountId, 'all')
      setItems(response.requests)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    load()
  }, [load])

  async function handleDecide(
    id: string,
    action: 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete',
  ) {
    if (!selectedAccountId) return
    setPendingAction({ id, action })
  }

  async function confirmDecision() {
    if (!selectedAccountId || !pendingAction) return
    setDeciding(true)
    try {
      await bookingApi.decideRequest(selectedAccountId, pendingAction.id, pendingAction.action)
      setPendingAction(null)
      await load()
    } catch (e) {
      alert(`操作に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
    } finally {
      setDeciding(false)
    }
  }

  const counts = useMemo(() => {
    const referenceNow = new Date()
    return {
      requested: items.filter((item) => item.status === 'requested').length,
      today: items.filter((item) => getBookingTimeGroup(item.starts_at, referenceNow) === 'today').length,
      future: items.filter((item) => getBookingTimeGroup(item.starts_at, referenceNow) === 'future').length,
      past: items.filter((item) => getBookingTimeGroup(item.starts_at, referenceNow) === 'past').length,
    }
  }, [items])

  const statusCounts = useMemo(() => {
    const result: Record<string, number> = { all: items.length }
    for (const item of items) result[item.status] = (result[item.status] ?? 0) + 1
    return result
  }, [items])

  const groupedItems = useMemo(() => {
    const referenceNow = new Date()
    const groups: Record<BookingTimeGroup, BookingRequest[]> = {
      today: [],
      future: [],
      past: [],
    }
    for (const item of items) {
      if (statusFilter !== 'all' && item.status !== statusFilter) continue
      if (!matchesTimeFilter(item.starts_at, timeFilter, referenceNow)) continue
      groups[getBookingTimeGroup(item.starts_at, referenceNow)].push(item)
    }
    groups.today = sortBookings(groups.today, sort, 'today')
    groups.future = sortBookings(groups.future, sort, 'future')
    groups.past = sortBookings(groups.past, sort, 'past')
    return groups
  }, [items, sort, statusFilter, timeFilter])

  const visibleCount = groupedItems.today.length + groupedItems.future.length + groupedItems.past.length

  function showRequested() {
    setStatusFilter('requested')
    setTimeFilter('all')
    setSort('received')
  }

  function showTime(filter: BookingTimeFilter) {
    setStatusFilter('all')
    setTimeFilter(filter)
    setSort('schedule')
  }

  return (
    <div>
      <Header
        title="予約管理"
        description="今日の予定と新しい予約を、ここから確認・対応できます"
      />

      {selectedAccountId && (
        <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-blue-900">
            <LinkIcon />
            お客様向け 予約フォーム URL
          </div>
          {shareUrl ? (
            <>
              <div className="flex items-center gap-2">
                <Input
                  aria-label="お客様向け予約フォームURL"
                  readOnly
                  value={shareUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 font-mono text-xs"
                />
                <Button
                  type="button"
                  variant="primary"
                  onClick={() => copyUrl(shareUrl)}
                >
                  {copied ? 'コピー済' : 'コピー'}
                </Button>
              </div>
              <p className="mt-2 text-xs text-blue-700">
                LINE / OpenChat / IG DM で共有できます。タップすると LINE の予約画面が開きます。
              </p>
            </>
          ) : (
            <p className="text-xs text-amber-700">
              このアカウントには LIFF ID が未設定です。
              <Link href="/accounts" className="ml-1 underline">アカウント設定</Link> で登録してください。
            </p>
          )}
        </div>
      )}

      {error && (
        <Banner className="mb-4" variant="error" title="予約を読み込めませんでした" description={error} />
      )}

      {selectedAccountId && !loading && (
        <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <SummaryCard
            label="要対応"
            count={counts.requested}
            helper="未承認の予約"
            tone="amber"
            active={statusFilter === 'requested'}
            onClick={showRequested}
          />
          <SummaryCard
            label="今日"
            count={counts.today}
            helper="本日の予約"
            tone="blue"
            active={timeFilter === 'today' && statusFilter === 'all'}
            onClick={() => showTime('today')}
          />
          <SummaryCard
            label="今後"
            count={counts.future}
            helper="明日以降"
            tone="green"
            active={timeFilter === 'future' && statusFilter === 'all'}
            onClick={() => showTime('future')}
          />
          <SummaryCard
            label="過去"
            count={counts.past}
            helper="終了した日程"
            tone="gray"
            active={timeFilter === 'past' && statusFilter === 'all'}
            onClick={() => showTime('past')}
          />
        </div>
      )}

      {selectedAccountId && !loading && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="space-y-3">
              <FilterGroup label="期間">
                {TIME_FILTERS.map(({ key, label }) => (
                  <FilterButton
                    key={key}
                    active={timeFilter === key}
                    onClick={() => setTimeFilter(key)}
                  >
                    {label}
                  </FilterButton>
                ))}
              </FilterGroup>
              <FilterGroup label="状態">
                {STATUS_FILTERS.map(({ key, label }) => (
                  <FilterButton
                    key={key}
                    active={statusFilter === key}
                    onClick={() => setStatusFilter(key)}
                  >
                    {label}
                    <span className="ml-1 opacity-60">{statusCounts[key] ?? 0}</span>
                  </FilterButton>
                ))}
              </FilterGroup>
            </div>
            <div className="shrink-0 min-w-52">
              <Select
                label="並び順"
                value={sort}
                onValueChange={(value) => setSort((value ?? 'schedule') as BookingSort)}
                items={{ schedule: '予約日時が近い順', received: '受付が新しい順' }}
              />
            </div>
          </div>
        </div>
      )}

      {!selectedAccountId ? (
        <EmptyPanel>サイドバーでアカウントを選択してください</EmptyPanel>
      ) : loading ? (
        <EmptyPanel>読み込み中…</EmptyPanel>
      ) : visibleCount === 0 ? (
        <EmptyPanel>
          <div className="font-medium text-gray-700">条件に合う予約はありません</div>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setStatusFilter('all')
              setTimeFilter('all')
            }}
            className="mt-2"
          >
            絞り込みを解除
          </Button>
        </EmptyPanel>
      ) : (
        <div className="space-y-5">
          {groupedItems.today.length > 0 && (
            <BookingSection
              title="今日の予約"
              helper="まず確認する予定"
              tone="blue"
              items={groupedItems.today}
              onAction={handleDecide}
            />
          )}
          {groupedItems.future.length > 0 && (
            <BookingSection
              title="今後の予約"
              helper="明日以降の予定"
              tone="green"
              items={groupedItems.future}
              onAction={handleDecide}
            />
          )}
          {groupedItems.past.length > 0 && (
            <BookingSection
              title="過去の予約"
              helper="新しい日付から表示"
              tone="gray"
              items={groupedItems.past}
              onAction={handleDecide}
              collapsible={timeFilter === 'all'}
            />
          )}
        </div>
      )}
      <Dialog.Root role="alertdialog" open={pendingAction !== null} onOpenChange={(open) => { if (!open && !deciding) setPendingAction(null) }}>
        <Dialog><Dialog.Title>予約を「{pendingAction ? actionLabel[pendingAction.action] : ''}」しますか？</Dialog.Title><Dialog.Description className="mt-2">予約の状態を変更します。内容を確認して実行してください。</Dialog.Description><div className="mt-6 flex justify-end gap-2"><Button type="button" variant="secondary" disabled={deciding} onClick={() => setPendingAction(null)}>キャンセル</Button><Button type="button" variant={pendingAction?.action === 'approve' || pendingAction?.action === 'complete' ? 'primary' : 'destructive'} loading={deciding} onClick={confirmDecision}>実行する</Button></div></Dialog>
      </Dialog.Root>
    </div>
  )
}

function SummaryCard({
  label,
  count,
  helper,
  tone,
  active,
  onClick,
}: {
  label: string
  count: number
  helper: string
  tone: 'amber' | 'blue' | 'green' | 'gray'
  active: boolean
  onClick: () => void
}) {
  const tones = {
    amber: 'border-amber-200 bg-amber-50 text-amber-900',
    blue: 'border-blue-200 bg-blue-50 text-blue-900',
    green: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    gray: 'border-gray-200 bg-gray-50 text-gray-800',
  }
  return (
    <Button
      type="button"
      variant="secondary"
      onClick={onClick}
      className={`rounded-xl border p-4 text-left transition hover:-translate-y-0.5 hover:shadow-sm ${tones[tone]} ${active ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-2xl font-bold tabular-nums">{count}</span>
      </div>
      <div className="mt-1 text-xs opacity-70">{helper}</div>
    </Button>
  )
}

function FilterGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <span className="w-8 shrink-0 pt-1.5 text-xs font-semibold text-gray-400">{label}</span>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  )
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      size="xs"
      variant={active ? 'primary' : 'ghost'}
      onClick={onClick}
      shape="base"
    >
      {children}
    </Button>
  )
}

function BookingSection({
  title,
  helper,
  tone,
  items,
  onAction,
  collapsible = false,
}: {
  title: string
  helper: string
  tone: 'blue' | 'green' | 'gray'
  items: BookingRequest[]
  onAction: (
    id: string,
    action: 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete',
  ) => void
  collapsible?: boolean
}) {
  const dotColor = {
    blue: 'bg-blue-500',
    green: 'bg-emerald-500',
    gray: 'bg-gray-400',
  }[tone]
  const heading = (
    <div className="flex items-center gap-3">
      <span className={`h-2.5 w-2.5 rounded-full ${dotColor}`} />
      <div>
        <h2 className="text-sm font-bold text-gray-900">
          {title} <span className="ml-1 font-normal text-gray-400">{items.length}件</span>
        </h2>
        <p className="text-xs text-gray-500">{helper}</p>
      </div>
    </div>
  )
  const cards = (
    <div className="mt-3 space-y-2">
      {items.map((booking) => (
        <BookingCard key={booking.id} booking={booking} onAction={onAction} />
      ))}
    </div>
  )

  if (collapsible) {
    return (
      <details className="group rounded-xl border border-gray-200 bg-gray-50 p-4">
        <summary className="flex cursor-pointer list-none items-center justify-between">
          {heading}
          <ChevronIcon />
        </summary>
        {cards}
      </details>
    )
  }

  return (
    <section>
      <div className="px-1">{heading}</div>
      {cards}
    </section>
  )
}

function BookingCard({
  booking,
  onAction,
}: {
  booking: BookingRequest
  onAction: (
    id: string,
    action: 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete',
  ) => void
}) {
  const startsAt = new Date(booking.starts_at)
  const recentlyReceived = isRecentlyReceived(booking.requested_at)

  return (
    <article className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-gray-300">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex shrink-0 items-center gap-3 lg:w-36">
          <div className="flex h-14 w-14 shrink-0 flex-col items-center justify-center rounded-xl bg-gray-900 text-white">
            <span className="text-xs leading-none opacity-70">{dateFormatter.format(startsAt)}</span>
            <span className="mt-1 text-base font-bold leading-none">{timeFormatter.format(startsAt)}</span>
          </div>
          <div className="lg:hidden">
            <StatusAndNew status={booking.status} recentlyReceived={recentlyReceived} />
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <Link
              href={`/chats?friend=${booking.friend_id}`}
              className="font-bold text-gray-900 hover:text-blue-600 hover:underline"
            >
              {booking.friend_name ?? '名前未取得'}
            </Link>
            <span className="hidden lg:inline-flex">
              <StatusAndNew status={booking.status} recentlyReceived={recentlyReceived} />
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-600">
            <span>{booking.menu_name}</span>
            <span className="text-gray-300">•</span>
            <span>担当: {booking.staff_name}</span>
            {booking.price_at_booking > 0 && (
              <>
                <span className="text-gray-300">•</span>
                <span className="tabular-nums">¥{booking.price_at_booking.toLocaleString()}</span>
              </>
            )}
          </div>
          <div className="mt-1 text-xs text-gray-400">
            {receivedFormatter.format(new Date(booking.requested_at))} 受付
          </div>
          {booking.customer_note && (
            <details className="group/note mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-gray-700">
              <summary className="cursor-pointer list-none font-medium text-amber-800">
                <span className="group-open/note:hidden">要望を見る</span>
                <span className="hidden group-open/note:inline">要望を閉じる</span>
                <span className="ml-2 font-normal text-amber-700/70">{booking.customer_note.slice(0, 45)}{booking.customer_note.length > 45 ? '…' : ''}</span>
              </summary>
              <p className="mt-2 whitespace-pre-wrap border-t border-amber-200 pt-2 leading-6">
                {booking.customer_note}
              </p>
            </details>
          )}
        </div>

        <div className="shrink-0 border-t border-gray-100 pt-3 lg:border-l lg:border-t-0 lg:pl-4 lg:pt-0">
          <ActionButtons
            status={booking.status}
            onAction={(action) => onAction(booking.id, action)}
          />
        </div>
      </div>
    </article>
  )
}

function StatusAndNew({ status, recentlyReceived }: { status: string; recentlyReceived: boolean }) {
  const statusVariant: Record<string, BadgeVariant> = { requested: 'warning', confirmed: 'success', completed: 'info', no_show: 'error' }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant={statusVariant[status] ?? 'neutral'}>{statusLabel[status] ?? status}</Badge>
      {recentlyReceived && (
        <Badge variant="info">NEW</Badge>
      )}
    </span>
  )
}

function ActionButtons({
  status,
  onAction,
}: {
  status: string
  onAction: (action: 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete') => void
}) {
  if (status === 'requested') {
    return (
      <div className="flex gap-2 lg:flex-col">
        <Button
          type="button"
          onClick={() => onAction('approve')}
          size="sm"
          variant="primary"
          className="flex-1 lg:w-24"
        >
          承認
        </Button>
        <Button
          type="button"
          onClick={() => onAction('reject')}
          size="sm"
          variant="destructive"
          className="flex-1 lg:w-24"
        >
          拒否
        </Button>
      </div>
    )
  }
  if (status === 'confirmed') {
    return (
      <div className="flex flex-wrap gap-1.5 lg:w-28 lg:flex-col">
        <Button
          type="button"
          onClick={() => onAction('complete')}
          size="xs"
          variant="primary"
          className="flex-1"
        >
          完了
        </Button>
        <Button
          type="button"
          onClick={() => onAction('no_show')}
          size="xs"
          variant="destructive"
          className="flex-1"
        >
          無断
        </Button>
        <Button
          type="button"
          onClick={() => onAction('cancel')}
          size="xs"
          variant="secondary"
          className="flex-1"
        >
          取消
        </Button>
      </div>
    )
  }
  return <span className="text-xs text-gray-400">操作なし</span>
}

function EmptyPanel({ children }: { children: React.ReactNode }) {
  return (
    <LayerCard className="p-12 text-center text-sm text-kumo-subtle">
      {children}
    </LayerCard>
  )
}

function LinkIcon() {
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.8 10.2a4 4 0 0 1 5.7 0l1.4 1.4a4 4 0 0 1 0 5.7l-3 3a4 4 0 0 1-5.7 0L10 18.3m.2-4.5a4 4 0 0 1-5.7 0l-1.4-1.4a4 4 0 0 1 0-5.7l3-3a4 4 0 0 1 5.7 0L14 5.7" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg className="h-5 w-5 text-gray-400 transition group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
    </svg>
  )
}
