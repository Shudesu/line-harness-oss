'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Empty } from '@cloudflare/kumo/components/empty'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Table } from '@cloudflare/kumo/components/table'

interface PerAccountStat {
  accountId: string
  accountName: string
  friends: number
  dups: number
  dupRate: number
}

interface PairwiseOverlap {
  fromAccountId: string
  toAccountId: string
  overlap: number
}

interface DuplicatesStatsData {
  totalFollowing: number
  uniquePeople: number
  friendDups: number
  duplicateGroups: number
  wastedPerBroadcastYen: number
  msgUnitYen: number
  perAccount: PerAccountStat[]
  // Optional: an older worker deployment (mid-rollout) may not include this
  // field. Guarded at every access site below; do not assume non-empty.
  pairwiseOverlap?: PairwiseOverlap[]
  // Optional during rolling deploys.
  computedAt?: string
}

function formatRelative(iso: string): string {
  const elapsedMs = Date.now() - new Date(iso).getTime()
  if (elapsedMs < 0) return 'たった今'
  const sec = Math.floor(elapsedMs / 1000)
  if (sec < 60) return `${sec}秒前`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}分前`
  const hr = Math.floor(min / 60)
  return `${hr}時間前`
}

const fmt = new Intl.NumberFormat('ja-JP')

export default function DuplicatesPage() {
  const [data, setData] = useState<DuplicatesStatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async (opts?: { forceRefresh?: boolean }) => {
    if (opts?.forceRefresh) setRefreshing(true)
    setError('')
    try {
      const res = await api.duplicates.stats(opts)
      if (res.success) {
        setData(res.data)
      } else {
        setError('集計の取得に失敗しました')
      }
    } catch {
      setError('集計の取得に失敗しました')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Tick once a minute so the "○分前に計算" label keeps refreshing while
  // the operator leaves the page open. setNow reads Date.now() implicitly
  // on the next render via formatRelative.
  const [, setTick] = useState(0)
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 60_000)
    return () => clearInterval(interval)
  }, [])

  return (
    <div className="space-y-8">
      <Header
        title="重複検出"
        description="複数アカウントに重複している友だちを把握し、配信コストの無駄を減らすためのビューです。"
      />

      {loading && !data ? (
        <LayerCard className="p-8"><Loader className="mx-auto" /></LayerCard>
      ) : !data ? (
        <Banner variant="error" title="集計を取得できませんでした" description={error || '時間をおいて再度お試しください。'} />
      ) : (
        <>
          {/* When a refresh fails but we still have a previous snapshot, show
              the error inline above the data instead of replacing the whole
              page — losing the dashboard for a transient 500 is worse than
              showing slightly stale numbers with a warning. */}
          {error && (
            <Banner variant="alert" title="再計算に失敗しました" description={error} />
          )}
          <section className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard label="友だち総数" value={fmt.format(data.totalFollowing)} />
            <StatCard label="ユニーク人数" value={fmt.format(data.uniquePeople)} />
            <StatCard
              label="余分な配信回数"
              value={fmt.format(data.friendDups)}
              hint="重複ぶんの送信"
            />
            <StatCard
              label="1配信あたり浪費"
              value={`¥${fmt.format(data.wastedPerBroadcastYen)}`}
              hint={`¥${data.msgUnitYen}/通 換算`}
            />
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-gray-500">
            <p>
              月10本配信なら約{' '}
              <span className="font-medium text-gray-700">
                ¥{fmt.format(data.wastedPerBroadcastYen * 10)}
              </span>{' '}
              の浪費です。
            </p>
            <div className="flex items-center gap-3">
              {data.computedAt && (
                <span className="text-xs text-gray-400">
                  {formatRelative(data.computedAt)}に計算
                </span>
              )}
              <Button
                type="button"
                size="xs"
                variant="secondary"
                loading={refreshing}
                onClick={() => load({ forceRefresh: true })}
                disabled={refreshing}
              >
                再計算
              </Button>
            </div>
          </div>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">アカウント別ブレイクダウン</h2>
            {data.perAccount.length === 0 ? (
              <Empty title="アカウントが登録されていません" description="アカウント追加後に重複状況を確認できます。" />
            ) : (
              <LayerCard className="mt-3 overflow-hidden p-0">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.Head>アカウント</Table.Head>
                      <Table.Head className="text-right">友だち数</Table.Head>
                      <Table.Head className="text-right">うち重複</Table.Head>
                      <Table.Head className="text-right">重複率</Table.Head>
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {data.perAccount.map((row) => (
                      <Table.Row key={row.accountId}>
                        <Table.Cell className="font-medium text-kumo-strong">{row.accountName}</Table.Cell>
                        <Table.Cell className="text-right tabular-nums">{fmt.format(row.friends)}</Table.Cell>
                        <Table.Cell className="text-right tabular-nums">{fmt.format(row.dups)}</Table.Cell>
                        <Table.Cell className="text-right tabular-nums">
                          {(row.dupRate * 100).toFixed(0)}%
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </LayerCard>
            )}
          </section>

          {data.perAccount.length >= 2 && data.pairwiseOverlap && (() => {
            // Bind the optional array to a local so the inner map closures
            // keep the non-undefined narrowing.
            const pairwise = data.pairwiseOverlap
            return (
            <section>
              <h2 className="text-lg font-semibold text-gray-900">アカウント間 重複マトリックス</h2>
              <p className="mt-1 text-sm text-gray-500">
                行アカウントの友だちのうち、列アカウントにも居る人数 (行アカに対する割合)。
              </p>
              <LayerCard className="mt-3 overflow-x-auto p-0">
                <Table>
                  <Table.Header>
                    <Table.Row>
                      <Table.Head>行 \ 列</Table.Head>
                      {data.perAccount.map((col) => (
                        <Table.Head
                          key={col.accountId}
                          className="px-4 py-3 text-right whitespace-nowrap"
                        >
                          {col.accountName}
                        </Table.Head>
                      ))}
                    </Table.Row>
                  </Table.Header>
                  <Table.Body>
                    {data.perAccount.map((row) => (
                      <Table.Row key={row.accountId}>
                        <Table.Cell className="font-medium text-kumo-strong whitespace-nowrap">
                          {row.accountName}
                        </Table.Cell>
                        {data.perAccount.map((col) => {
                          if (row.accountId === col.accountId) {
                            return (
                              <Table.Cell
                                key={col.accountId}
                                className="px-4 py-3 text-right text-gray-300"
                              >
                                —
                              </Table.Cell>
                            )
                          }
                          const pair = pairwise.find(
                            (p) =>
                              p.fromAccountId === row.accountId &&
                              p.toAccountId === col.accountId,
                          )
                          const overlap = pair?.overlap ?? 0
                          const rate = row.friends > 0 ? overlap / row.friends : 0
                          return (
                            <Table.Cell
                              key={col.accountId}
                              className="px-4 py-3 text-right tabular-nums whitespace-nowrap"
                            >
                              {fmt.format(overlap)}{' '}
                              <span className="text-xs text-gray-400">
                                ({(rate * 100).toFixed(0)}%)
                              </span>
                            </Table.Cell>
                          )
                        })}
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table>
              </LayerCard>
            </section>
            )
          })()}
        </>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <LayerCard className="p-4">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-gray-400">{hint}</div> : null}
    </LayerCard>
  )
}
