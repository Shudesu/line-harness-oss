'use client'

import { useEffect, useMemo, useState } from 'react'
import { fetchApi } from '@/lib/api'

type Period = 'day' | 'month'

type FriendRouteStats = {
  id: string | null
  refCode: string
  name: string
  url: string
  isActive: boolean
  totalFriends: number
  series: { bucket: string; count: number }[]
}

type FriendRouteStatsResponse = {
  routes: FriendRouteStats[]
  period: Period
  dateFrom: string
  dateTo: string
}

function defaultDateRange() {
  const now = new Date()
  const to = now.toISOString().slice(0, 10)
  const from = new Date(now)
  from.setDate(from.getDate() - 29)
  return { dateFrom: from.toISOString().slice(0, 10), dateTo: to }
}

export function AnalyticsTab({ lineAccountId }: { lineAccountId?: string }) {
  const initialRange = useMemo(() => defaultDateRange(), [])
  const [period, setPeriod] = useState<Period>('day')
  const [dateFrom, setDateFrom] = useState(initialRange.dateFrom)
  const [dateTo, setDateTo] = useState(initialRange.dateTo)
  const [routes, setRoutes] = useState<FriendRouteStats[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState('')
  const [newRouteName, setNewRouteName] = useState('')
  const [newRefCode, setNewRefCode] = useState('')

  const totalFriends = routes.reduce((sum, route) => sum + route.totalFriends, 0)
  const maxSeriesCount = Math.max(1, ...routes.flatMap((route) => route.series.map((point) => point.count)))

  async function loadRoutes() {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ period, dateFrom, dateTo })
      if (lineAccountId) params.set('lineAccountId', lineAccountId)
      const res = await fetchApi<{ success: boolean; data: FriendRouteStatsResponse; error?: string }>(
        `/api/analytics/friend-routes?${params.toString()}`,
      )
      if (!res.success) throw new Error(res.error || '経路データを取得できませんでした。')
      setRoutes(res.data.routes)
    } catch (err) {
      setError(err instanceof Error ? err.message : '経路データを取得できませんでした。')
    } finally {
      setLoading(false)
    }
  }

  async function createRoute() {
    const name = newRouteName.trim()
    if (!name) {
      setError('経路名を入力してください。')
      return
    }
    setCreating(true)
    setError('')
    try {
      const res = await fetchApi<{ success: boolean; data: FriendRouteStats; error?: string }>('/api/analytics/friend-routes', {
        method: 'POST',
        body: JSON.stringify({
          name,
          refCode: newRefCode.trim() || undefined,
        }),
      })
      if (!res.success) throw new Error(res.error || '経路URLを作成できませんでした。')
      setNewRouteName('')
      setNewRefCode('')
      await loadRoutes()
      await copyUrl(res.data.url)
    } catch (err) {
      setError(err instanceof Error ? err.message : '経路URLを作成できませんでした。')
    } finally {
      setCreating(false)
    }
  }

  async function copyUrl(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(url)
      window.setTimeout(() => setCopied((current) => (current === url ? '' : current)), 1600)
    } catch {
      setError('URLをコピーできませんでした。画面上のURLを直接コピーしてください。')
    }
  }

  useEffect(() => {
    void loadRoutes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, dateFrom, dateTo, lineAccountId])

  return (
    <section className="space-y-4">
      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-black text-gray-950">友達追加の経路</p>
            <p className="mt-1 text-xs leading-5 text-gray-500">Instagram、Google Map、チラシなど、入口ごとの友達追加数だけを見ます。</p>
          </div>
          <button
            type="button"
            onClick={() => void loadRoutes()}
            className="self-start rounded-full border border-gray-200 bg-white px-3 py-1.5 text-xs font-bold text-gray-700 hover:bg-gray-50"
          >
            再読込
          </button>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_150px_150px_120px]">
          <label className="text-xs font-bold text-gray-600">
            表示単位
            <select
              value={period}
              onChange={(event) => setPeriod(event.target.value as Period)}
              className="mt-1 w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900"
            >
              <option value="day">日ごと</option>
              <option value="month">月ごと</option>
            </select>
          </label>
          <label className="text-xs font-bold text-gray-600">
            開始日
            <input value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} type="date" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          </label>
          <label className="text-xs font-bold text-gray-600">
            終了日
            <input value={dateTo} onChange={(event) => setDateTo(event.target.value)} type="date" className="mt-1 w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" />
          </label>
          <div className="rounded-xl bg-emerald-50 px-3 py-2">
            <p className="text-xs font-bold text-emerald-700">総追加数</p>
            <p className="text-2xl font-black text-emerald-900">{totalFriends}</p>
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <p className="text-sm font-black text-gray-950">経路URLを発行</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_190px_auto]">
          <input
            value={newRouteName}
            onChange={(event) => setNewRouteName(event.target.value)}
            placeholder="例: Google Map、Instagramプロフィール"
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
          />
          <input
            value={newRefCode}
            onChange={(event) => setNewRefCode(event.target.value)}
            placeholder="任意: google-map"
            className="rounded-xl border border-gray-200 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void createRoute()}
            disabled={creating}
            className="rounded-xl bg-gray-950 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {creating ? '作成中' : 'URL発行'}
          </button>
        </div>
        <p className="mt-2 text-xs leading-5 text-gray-500">発行したURLを媒体ごとに貼ります。LINE友達追加後、どのURLから来たかが保存されます。</p>
      </div>

      {error && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">{error}</div>}

      <div className="grid gap-3">
        {loading ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm">読み込み中です。</div>
        ) : routes.length === 0 ? (
          <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm">まだ経路URLがありません。まずURLを発行してください。</div>
        ) : (
          routes.map((route) => (
            <RouteCard key={route.refCode} route={route} maxSeriesCount={maxSeriesCount} copied={copied === route.url} onCopy={() => void copyUrl(route.url)} />
          ))
        )}
      </div>
    </section>
  )
}

function RouteCard({
  route,
  maxSeriesCount,
  copied,
  onCopy,
}: {
  route: FriendRouteStats
  maxSeriesCount: number
  copied: boolean
  onCopy: () => void
}) {
  return (
    <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-black text-gray-950">{route.name}</p>
            {!route.isActive && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-bold text-gray-500">停止中</span>}
          </div>
          <p className="mt-1 break-all text-xs text-gray-500">{route.url}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <div className="rounded-xl bg-blue-50 px-3 py-2 text-right">
            <p className="text-[11px] font-bold text-blue-600">追加</p>
            <p className="text-lg font-black text-blue-900">{route.totalFriends}</p>
          </div>
          <button type="button" onClick={onCopy} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50">
            {copied ? 'コピー済み' : 'URLコピー'}
          </button>
        </div>
      </div>

      <div className="mt-4 flex items-end gap-1 overflow-x-auto pb-1">
        {route.series.length === 0 ? (
          <p className="text-sm text-gray-400">この期間の追加はありません。</p>
        ) : (
          route.series.map((point) => (
            <div key={`${route.refCode}-${point.bucket}`} className="flex min-w-[42px] flex-col items-center gap-1">
              <div className="flex h-24 w-full items-end rounded-lg bg-gray-50 px-1">
                <div
                  className="w-full rounded-md bg-[#69A3D0]"
                  style={{ height: `${Math.max(8, (point.count / maxSeriesCount) * 96)}px` }}
                  title={`${point.bucket}: ${point.count}件`}
                />
              </div>
              <p className="text-[10px] font-bold text-gray-500">{point.count}</p>
              <p className="max-w-[52px] truncate text-[10px] text-gray-400">{point.bucket}</p>
            </div>
          ))
        )}
      </div>
    </article>
  )
}
