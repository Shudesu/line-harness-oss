'use client'

import { useCallback, useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import { useAutoRefresh } from '@/hooks/use-auto-refresh'

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
  // on the next render via formatRelative. (タブ非表示中は止まり、復帰時に
  // 即時 tick するのでラベルが古いまま見えることはない)
  const [, setTick] = useState(0)
  useAutoRefresh(() => setTick((t) => t + 1), { intervalMs: 60_000 })

  return (
    <div className="space-y-8">
      <Header
        title="重複検出"
        description="複数アカウントに重複している友だちを把握し、配信コストの無駄を減らすためのビューです。"
      />

      {loading && !data ? (
        <div className="rounded-lg bg-white p-8 text-center text-gray-500 shadow-sm">
          読み込み中…
        </div>
      ) : !data ? (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error || '集計の取得に失敗しました'}
        </div>
      ) : (
        <>
          {/* When a refresh fails but we still have a previous snapshot, show
              the error inline above the data instead of replacing the whole
              page — losing the dashboard for a transient 500 is worse than
              showing slightly stale numbers with a warning. */}
          {error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
              再計算に失敗しました: {error}
            </div>
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
              <button
                type="button"
                onClick={() => load({ forceRefresh: true })}
                disabled={refreshing}
                className="rounded-md border border-gray-200 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {refreshing ? '再計算中…' : '再計算'}
              </button>
            </div>
          </div>

          <section>
            <h2 className="text-lg font-semibold text-gray-900">アカウント別ブレイクダウン</h2>
            {data.perAccount.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">アカウントが登録されていません。</p>
            ) : (
              <div className="mt-3 overflow-hidden rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-3">アカウント</th>
                      <th className="px-4 py-3 text-right">友だち数</th>
                      <th className="px-4 py-3 text-right">うち重複</th>
                      <th className="px-4 py-3 text-right">重複率</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {data.perAccount.map((row) => (
                      <tr key={row.accountId}>
                        <td className="px-4 py-3 font-medium text-gray-900">{row.accountName}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmt.format(row.friends)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{fmt.format(row.dups)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {(row.dupRate * 100).toFixed(0)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
              <div className="mt-3 overflow-x-auto rounded-lg bg-white shadow-sm ring-1 ring-gray-200">
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                    <tr>
                      <th className="px-4 py-3">行 \ 列</th>
                      {data.perAccount.map((col) => (
                        <th
                          key={col.accountId}
                          className="px-4 py-3 text-right whitespace-nowrap"
                        >
                          {col.accountName}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {data.perAccount.map((row) => (
                      <tr key={row.accountId}>
                        <td className="px-4 py-3 font-medium text-gray-900 whitespace-nowrap">
                          {row.accountName}
                        </td>
                        {data.perAccount.map((col) => {
                          if (row.accountId === col.accountId) {
                            return (
                              <td
                                key={col.accountId}
                                className="px-4 py-3 text-right text-gray-300"
                              >
                                —
                              </td>
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
                            <td
                              key={col.accountId}
                              className="px-4 py-3 text-right tabular-nums whitespace-nowrap"
                            >
                              {fmt.format(overlap)}{' '}
                              <span className="text-xs text-gray-400">
                                ({(rate * 100).toFixed(0)}%)
                              </span>
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
    <div className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-gray-200">
      <div className="text-xs font-medium text-gray-500">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{value}</div>
      {hint ? <div className="mt-1 text-xs text-gray-400">{hint}</div> : null}
    </div>
  )
}
