'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { Badge } from '@cloudflare/kumo/components/badge'
import type { BadgeVariant } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Table } from '@cloudflare/kumo/components/table'
import { Tabs } from '@cloudflare/kumo/components/tabs'
import type { Tag } from '@line-crm/shared'
import { api, type ApiBroadcast, type BroadcastInsight } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'

const BroadcastForm = dynamic(() => import('@/components/broadcasts/broadcast-form'))
const BroadcastDetail = dynamic(() => import('@/components/broadcasts/broadcast-detail'))

const ccPrompts = [
  {
    title: '配信メッセージを作成',
    prompt: `一斉配信用のメッセージを作成してください。
1. 配信目的: [目的を指定]
2. ターゲット: 全員 / タグ指定
3. メッセージタイプ: テキスト / 画像 / Flex
効果的なメッセージ文面を提案してください。`,
  },
  {
    title: '配信スケジュール最適化',
    prompt: `配信スケジュールを最適化してください。
1. 過去の配信実績から最適な時間帯を分析
2. 曜日別の開封率を確認
3. 推奨スケジュールを提案
データに基づいた根拠も示してください。`,
  },
]

const statusConfig: Record<ApiBroadcast['status'], { label: string; variant: BadgeVariant }> = {
  draft: { label: '下書き', variant: 'neutral' },
  scheduled: { label: '予約済み', variant: 'info' },
  sending: { label: '送信中', variant: 'warning' },
  sent: { label: '送信完了', variant: 'success' },
}

function formatDatetime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export default function BroadcastsPage() {
  const detailId = useSearchParams().get('id')
  if (detailId) return <BroadcastDetail broadcastId={detailId} />
  return <BroadcastList />
}

type BroadcastTab = 'single' | 'dedup' | 'all'

function BroadcastList() {
  const { selectedAccountId } = useAccount()
  const [broadcasts, setBroadcasts] = useState<ApiBroadcast[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [insights, setInsights] = useState<Record<string, BroadcastInsight>>({})
  const [fetchingInsight, setFetchingInsight] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<BroadcastTab>('all')
  const [deleteTarget, setDeleteTarget] = useState<ApiBroadcast | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadInsight = async (id: string) => {
    try {
      const res = await api.broadcasts.getInsight(id)
      if (res.success && res.data) setInsights((current) => ({ ...current, [id]: res.data! }))
    } catch { /* non-blocking */ }
  }

  const handleFetchInsight = async (id: string) => {
    setFetchingInsight(id)
    try {
      const res = await api.broadcasts.fetchInsight(id)
      if (res.success && res.data) setInsights((current) => ({ ...current, [id]: res.data }))
      else if (!res.success) setError(res.error)
    } catch {
      setError('インサイトの取得に失敗しました')
    } finally {
      setFetchingInsight(null)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [broadcastsRes, tagsRes] = await Promise.all([
        api.broadcasts.list({ accountId: selectedAccountId || undefined }),
        api.tags.list(),
      ])
      if (broadcastsRes.success) setBroadcasts(broadcastsRes.data)
      else setError(broadcastsRes.error)
      if (tagsRes.success) setTags(tagsRes.data)
    } catch {
      setError('データの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => { void load() }, [load])
  useEffect(() => { broadcasts.filter((item) => item.status === 'sent').forEach((item) => { void loadInsight(item.id) }) }, [broadcasts])

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setError('')
    try {
      const response = await api.broadcasts.delete(deleteTarget.id)
      if (!response.success) setError(response.error)
      else await load()
      setDeleteTarget(null)
    } catch {
      setError('削除に失敗しました')
    } finally {
      setDeleting(false)
    }
  }

  const getTagName = (tagId: string | null) => tagId ? tags.find((tag) => tag.id === tagId)?.name ?? null : null
  const dedupCount = broadcasts.filter((item) => item.targetType === 'multi-account-dedup').length
  const singleCount = broadcasts.length - dedupCount
  const visibleBroadcasts = broadcasts.filter((item) => activeTab === 'all' || (activeTab === 'dedup' ? item.targetType === 'multi-account-dedup' : item.targetType !== 'multi-account-dedup'))

  return (
    <div>
      <Header
        title="一斉配信"
        description="配信対象を選び、メッセージをすぐ送信または予約します。"
        action={<Button type="button" variant={showCreate ? 'secondary' : 'primary'} icon={showCreate ? undefined : PlusIcon} onClick={() => setShowCreate((current) => !current)}>{showCreate ? '作成を閉じる' : '新規配信'}</Button>}
      />

      {error ? <Banner className="mb-4" variant="error" title="操作を完了できませんでした" description={error} /> : null}

      {showCreate ? <BroadcastForm tags={tags} onSuccess={() => { setShowCreate(false); void load() }} onCancel={() => setShowCreate(false)} /> : null}

      {!loading && broadcasts.length > 0 ? (
        <Tabs
          className="mb-4 w-fit"
          variant="underline"
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as BroadcastTab)}
          tabs={[
            { value: 'all', label: `全部 (${broadcasts.length})` },
            { value: 'single', label: `単アカ配信 (${singleCount})` },
            { value: 'dedup', label: `複アカ重複除外 (${dedupCount})` },
          ]}
        />
      ) : null}

      {loading ? (
        <LayerCard className="flex min-h-48 items-center justify-center gap-2 text-sm text-kumo-subtle"><Loader size="sm" />配信を読み込み中</LayerCard>
      ) : broadcasts.length === 0 ? (
        <Empty size="sm" title="配信がありません" description="新規配信から最初のメッセージを作成してください。" contents={<Button type="button" variant="primary" icon={PlusIcon} onClick={() => setShowCreate(true)}>新規配信</Button>} />
      ) : visibleBroadcasts.length === 0 ? (
        <Empty size="sm" title="このタブに配信はありません" description={activeTab === 'dedup' ? '複数アカウントの重複除外配信はまだありません。' : '別のタブを選択してください。'} />
      ) : (
        <LayerCard className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <Table className="min-w-[860px]">
              <Table.Header>
                <Table.Row>
                  <Table.Head>配信タイトル</Table.Head>
                  <Table.Head>状態</Table.Head>
                  <Table.Head>配信対象</Table.Head>
                  <Table.Head>予約日時</Table.Head>
                  <Table.Head>送信完了日時</Table.Head>
                  <Table.Head>実績</Table.Head>
                  <Table.Head><span className="sr-only">操作</span></Table.Head>
                </Table.Row>
              </Table.Header>
              <Table.Body>
                {visibleBroadcasts.map((broadcast) => {
                  const status = statusConfig[broadcast.status]
                  const tagName = getTagName(broadcast.targetTagId)
                  const isDedup = broadcast.targetType === 'multi-account-dedup'
                  const insight = insights[broadcast.id]
                  return (
                    <Table.Row key={broadcast.id}>
                      <Table.Cell>
                        <div className="flex items-center gap-2">
                          <Link href={`/broadcasts?id=${broadcast.id}`} className="font-medium text-kumo-link hover:underline">{broadcast.title}</Link>
                          {isDedup ? <Badge variant="purple">複アカ</Badge> : null}
                        </div>
                        <p className="mt-0.5 text-xs text-kumo-subtle">{broadcast.messageType === 'text' ? 'テキスト' : broadcast.messageType === 'image' ? '画像' : 'Flex'}</p>
                      </Table.Cell>
                      <Table.Cell>
                        <Badge variant={status.variant} appearance="dot">{status.label}</Badge>
                        {broadcast.lastError ? (
                          <p className="mt-1 max-w-56 text-xs text-kumo-danger" title={broadcast.lastError}>{broadcast.lastError}</p>
                        ) : null}
                      </Table.Cell>
                      <Table.Cell>{isDedup ? `重複除外${tagName ? `：${tagName}` : ''}` : broadcast.targetType === 'all' ? '全員' : tagName ? `タグ：${tagName}` : 'タグ指定'}</Table.Cell>
                      <Table.Cell className="text-kumo-subtle">{formatDatetime(broadcast.scheduledAt)}</Table.Cell>
                      <Table.Cell className="text-kumo-subtle">{formatDatetime(broadcast.sentAt)}</Table.Cell>
                      <Table.Cell>
                        {broadcast.status !== 'sent' ? '-' : insight ? (
                          <div className="space-y-0.5 text-xs text-kumo-subtle">
                            {insight.delivered != null ? <p>配信 <strong className="text-kumo-strong">{insight.delivered.toLocaleString('ja-JP')}</strong></p> : null}
                            {insight.uniqueImpression != null ? <p>開封 <strong className="text-kumo-info">{insight.uniqueImpression.toLocaleString('ja-JP')}</strong>{insight.openRate != null ? ` (${(insight.openRate * 100).toFixed(1)}%)` : ''}</p> : null}
                            {insight.uniqueClick != null ? <p>クリック <strong className="text-kumo-success">{insight.uniqueClick.toLocaleString('ja-JP')}</strong>{insight.clickRate != null ? ` (${(insight.clickRate * 100).toFixed(1)}%)` : ''}</p> : null}
                          </div>
                        ) : (
                          <Button type="button" size="xs" variant="ghost" loading={fetchingInsight === broadcast.id} onClick={() => void handleFetchInsight(broadcast.id)}>インサイト取得</Button>
                        )}
                      </Table.Cell>
                      <Table.Cell className="text-right">
                        {broadcast.status === 'draft' || broadcast.status === 'scheduled' ? <Button type="button" size="xs" variant="secondary-destructive" icon={TrashIcon} onClick={() => setDeleteTarget(broadcast)}>削除</Button> : null}
                      </Table.Cell>
                    </Table.Row>
                  )
                })}
              </Table.Body>
            </Table>
          </div>
        </LayerCard>
      )}

      <Dialog.Root role="alertdialog" open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null) }}>
        <Dialog size="base" className="p-6">
          <Dialog.Title className="text-lg font-semibold text-kumo-strong">配信を削除しますか？</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-kumo-subtle">「{deleteTarget?.title ?? ''}」を削除します。この操作は取り消せません。</Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary" disabled={deleting}>キャンセル</Button>} />
            <Button type="button" variant="destructive" loading={deleting} onClick={() => void handleDelete()}>削除する</Button>
          </div>
        </Dialog>
      </Dialog.Root>

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
