'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { eventsApi, type EventBookingItem, type EventDetail } from '@/lib/api'
import { Badge } from '@cloudflare/kumo/components/badge'
import type { BadgeVariant } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Table } from '@cloudflare/kumo/components/table'

const STATUS_TABS: Array<{ key: string; label: string }> = [
  { key: 'requested', label: '承認待ち' },
  { key: 'confirmed', label: '確定' },
  { key: 'rejected', label: '拒否' },
  { key: 'cancelled', label: 'キャンセル' },
  { key: 'expired', label: '期限切れ' },
  { key: 'attended', label: '参加済' },
  { key: 'no_show', label: '無断' },
  { key: 'all', label: '全件' },
]

const statusBadge: Record<string, string> = {
  requested: 'bg-yellow-100 text-yellow-800',
  confirmed: 'bg-green-100 text-green-800',
  rejected: 'bg-gray-100 text-gray-700',
  cancelled: 'bg-gray-100 text-gray-600',
  expired: 'bg-gray-100 text-gray-500',
  attended: 'bg-blue-100 text-blue-800',
  no_show: 'bg-red-100 text-red-800',
}

function formatJp(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function BookingsInner() {
  const params = useSearchParams()
  const eventId = params.get('id')
  const { selectedAccountId, accounts } = useAccount()
  const [event, setEvent] = useState<EventDetail | null>(null)
  const [items, setItems] = useState<EventBookingItem[]>([])
  const [tab, setTab] = useState<string>('requested')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!selectedAccountId || !eventId) return
    setLoading(true)
    setError(null)
    try {
      const filters = tab === 'all' ? {} : { status: tab }
      const [evRes, listRes] = await Promise.all([
        event == null ? eventsApi.getEvent(selectedAccountId, eventId) : Promise.resolve(event),
        eventsApi.listBookings(selectedAccountId, eventId, filters),
      ])
      setEvent(evRes)
      setItems(listRes.items)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId, eventId, tab])

  useEffect(() => {
    void refresh()
  }, [refresh])

  if (!eventId) {
    return <div className="p-4 text-red-700">id クエリが必要です</div>
  }

  async function decide(id: string, action: 'confirm' | 'reject') {
    if (!selectedAccountId || !eventId) return
    let reason: string | undefined
    if (action === 'reject') {
      const r = window.prompt('拒否理由（任意・admin内部メモ。友だちには固定文面）')
      if (r === null) return
      reason = r || undefined
    }
    setBusy(true)
    try {
      await eventsApi.decideBooking(selectedAccountId, eventId, id, action, reason)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function adminCancel(id: string) {
    if (!selectedAccountId || !eventId) return
    setBusy(true)
    try {
      await eventsApi.adminCancelBooking(selectedAccountId, eventId, id)
      setCancelTarget(null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function markStatus(id: string, status: 'attended' | 'no_show') {
    if (!selectedAccountId || !eventId) return
    setBusy(true)
    try {
      await eventsApi.updateBooking(selectedAccountId, eventId, id, { status })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Header title={event?.name ?? 'イベント予約管理'} />
      <div className="p-6 max-w-6xl mx-auto">
        <div className="mb-4 flex items-center gap-2 text-sm">
          <Link href="/events" className="text-blue-600 hover:underline">イベント一覧</Link>
          <span className="text-gray-400">/</span>
          <Link href={`/events/edit?id=${eventId}`} className="text-blue-600 hover:underline">
            {event?.name ?? '編集'}
          </Link>
          <span className="text-gray-400">/</span>
          <span className="text-gray-700">予約管理</span>
        </div>

        <div className="mb-4">
          <h1 className="text-2xl font-bold text-gray-900">{event?.name ?? 'イベント予約管理'}</h1>
          <p className="text-sm text-gray-500 mt-0.5">予約の承認・キャンセル・出欠管理</p>
        </div>

        {error && (
          <Banner className="mb-4" variant="error" title="操作を完了できませんでした" description={error} />
        )}

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="flex border-b border-gray-200 overflow-x-auto">
            {STATUS_TABS.map((t) => (
              <Button type="button" size="sm" variant={tab === t.key ? 'primary' : 'ghost'}
                key={t.key}
                onClick={() => setTab(t.key)}
                className="whitespace-nowrap"
              >
                {t.label}
              </Button>
            ))}
          </div>

          {loading ? (
            <div className="p-12"><Loader className="mx-auto" /></div>
          ) : items.length === 0 ? (
            <Empty title="該当する予約はありません" description="別の状態を選択してください。" />
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <Table.Header><Table.Row><Table.Head>友だち</Table.Head><Table.Head>経由アカ</Table.Head><Table.Head>予約枠</Table.Head><Table.Head>状態</Table.Head><Table.Head>受付日時</Table.Head><Table.Head className="text-right">操作</Table.Head></Table.Row></Table.Header>
                <Table.Body>
                  {items.map((b) => {
                    const acct = accounts.find((a) => a.id === b.line_account_id)
                    const accountLabel = acct
                      ? `${acct.country ? acct.country + ' ' : ''}${acct.name}`
                      : (b.line_account_id ?? '').slice(0, 8)
                    return (
                    <Table.Row key={b.id}>
                      <Table.Cell className="text-kumo-default">
                        {b.friend_display_name ?? b.friend_id.slice(0, 8)}
                      </Table.Cell>
                      <Table.Cell className="text-kumo-subtle text-xs">{accountLabel}</Table.Cell>
                      <Table.Cell>{formatJp(b.slot_starts_at)}</Table.Cell>
                      <Table.Cell><Badge variant={({ requested: 'warning', confirmed: 'success', attended: 'info', no_show: 'error' } as Record<string, BadgeVariant>)[b.status] ?? 'neutral'}>{STATUS_TABS.find((t) => t.key === b.status)?.label ?? b.status}</Badge></Table.Cell>
                      <Table.Cell className="text-kumo-subtle text-xs">{formatJp(b.requested_at)}</Table.Cell>
                      <Table.Cell className="text-right">
                        {b.status === 'requested' && (
                          <div className="inline-flex gap-1.5">
                            <Button type="button" size="xs" variant="primary"
                              onClick={() => decide(b.id, 'confirm')}
                              disabled={busy}
                            >
                              承認
                            </Button>
                            <Button type="button" size="xs" variant="destructive"
                              onClick={() => decide(b.id, 'reject')}
                              disabled={busy}
                            >
                              拒否
                            </Button>
                          </div>
                        )}
                        {b.status === 'confirmed' && (
                          <div className="inline-flex gap-1.5">
                            <Button type="button" size="xs" variant="primary"
                              onClick={() => markStatus(b.id, 'attended')}
                              disabled={busy}
                            >
                              参加済
                            </Button>
                            <Button type="button" size="xs" variant="destructive"
                              onClick={() => markStatus(b.id, 'no_show')}
                              disabled={busy}
                            >
                              無断
                            </Button>
                            <Button type="button" size="xs" variant="secondary"
                              onClick={() => setCancelTarget(b.id)}
                              disabled={busy}
                            >
                              キャンセル
                            </Button>
                          </div>
                        )}
                      </Table.Cell>
                    </Table.Row>
                    )
                  })}
                </Table.Body>
              </Table>
            </div>
          )}
        </div>
        <Dialog.Root role="alertdialog" open={cancelTarget !== null} onOpenChange={(open) => { if (!open && !busy) setCancelTarget(null) }}><Dialog><Dialog.Title>運営側でキャンセルしますか？</Dialog.Title><Dialog.Description className="mt-2">予約をキャンセルし、友だちへLINE通知を送ります。</Dialog.Description><div className="mt-6 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setCancelTarget(null)}>戻る</Button><Button type="button" variant="destructive" loading={busy} onClick={() => { if (cancelTarget) void adminCancel(cancelTarget) }}>キャンセルする</Button></div></Dialog></Dialog.Root>
      </div>
    </>
  )
}

export default function EventBookingsPage() {
  return (
    <Suspense fallback={<div className="p-4 text-gray-500">読み込み中...</div>}>
      <BookingsInner />
    </Suspense>
  )
}
