'use client'

/**
 * L-TRACK 互換: レポート画面 (期間別/月別/日別)
 *
 * GET /api/reports/summary でトラックリンク × 期間軸の集計を取得。
 * カラムは L-TRACK レポートと互換 (クリック / 登録 / 登録率 / ブロック1H/3H/24H/全体 / AF件数 / 報酬額)。
 *
 * 拡張: ページ下部に「流入経路別 / タグ別 / 時間帯別」の分析カードを追加。
 * - GET /api/reports/by-source (entry_routes 別の友だち追加)
 * - GET /api/reports/by-tag    (タグ別の friend 数)
 * - GET /api/reports/by-hour   (時間帯別 incoming / outgoing メッセージ)
 *
 * 既存テーブルは保持し、下に縦並びでカードを追加する (placement のレイアウト崩しを避けるため)。
 */

import { useEffect, useState } from 'react'

import Header from '@/components/layout/header'
import { BarChart, type SeriesPoint } from '@/components/ui/charts'
import {
  Banner,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
} from '@/components/ui/primitives'
import { useAccount } from '@/contexts/account-context'
import { fetchApi } from '@/lib/api'

interface ReportRow {
  bucket: string
  tracked_link_id: string
  tracked_link_name: string
  media_name: string | null
  af_confirm_type: 'immediate' | '1h' | '3h' | '24h'
  af_amount: number | null
  click_count: number
  friend_add_count: number
  block_1h: number
  block_3h: number
  block_24h: number
  block_total: number
  af_confirmed_count: number
  af_revenue_yen: number
}

// 拡張分析の応答型
interface SourceRow {
  ref_code: string
  name: string
  count: number
}

interface TagRow {
  tag_id: string
  name: string
  color: string | null
  count: number
}

interface HourRow {
  hour: number
  incoming: number
  outgoing: number
}

type AnalyticsDays = 7 | 30 | 90

export default function ReportsPage() {
  const { selectedAccountId } = useAccount()
  const [rows, setRows] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [granularity, setGranularity] = useState<'total' | 'month' | 'day'>('total')

  // 拡張分析セクション state
  const [analyticsDays, setAnalyticsDays] = useState<AnalyticsDays>(30)
  const [sourceRows, setSourceRows] = useState<SourceRow[]>([])
  const [tagRows, setTagRows] = useState<TagRow[]>([])
  const [hourRows, setHourRows] = useState<HourRow[]>([])
  const [analyticsLoading, setAnalyticsLoading] = useState(true)
  const [analyticsError, setAnalyticsError] = useState('')

  const load = async () => {
    setLoading(true)
    const qs = new URLSearchParams()
    qs.set('granularity', granularity)
    if (selectedAccountId) qs.set('lineAccountId', selectedAccountId)
    const r = await fetchApi<{ success: boolean; data: ReportRow[]; error?: string }>(
      `/api/reports/summary?${qs}`,
    )
    if (r.success) setRows(r.data)
    else setError(r.error ?? '取得失敗')
    setLoading(false)
  }

  const loadAnalytics = async () => {
    setAnalyticsLoading(true)
    setAnalyticsError('')
    const qsBase = new URLSearchParams()
    qsBase.set('days', String(analyticsDays))
    if (selectedAccountId) qsBase.set('lineAccountId', selectedAccountId)
    const qs = qsBase.toString()

    try {
      const [src, tg, hr] = await Promise.all([
        fetchApi<{
          success: boolean
          data?: { days: number; rows: SourceRow[] }
          error?: string
        }>(`/api/reports/by-source?${qs}`),
        fetchApi<{
          success: boolean
          data?: { days: number; rows: TagRow[] }
          error?: string
        }>(`/api/reports/by-tag?${qs}`),
        fetchApi<{
          success: boolean
          data?: { days: number; rows: HourRow[] }
          error?: string
        }>(`/api/reports/by-hour?${qs}`),
      ])
      // 失敗した API は rows をクリアして古い結果を残さない
      if (src.success && src.data) setSourceRows(src.data.rows)
      else {
        setSourceRows([])
        setAnalyticsError(src.error ?? '流入経路別 取得失敗')
      }
      if (tg.success && tg.data) setTagRows(tg.data.rows)
      else {
        setTagRows([])
        setAnalyticsError(tg.error ?? 'タグ別 取得失敗')
      }
      if (hr.success && hr.data) setHourRows(hr.data.rows)
      else {
        setHourRows([])
        setAnalyticsError(hr.error ?? '時間帯別 取得失敗')
      }
    } catch (err) {
      setSourceRows([])
      setTagRows([])
      setHourRows([])
      setAnalyticsError(err instanceof Error ? err.message : '取得失敗')
    } finally {
      setAnalyticsLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, selectedAccountId])

  useEffect(() => {
    loadAnalytics()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analyticsDays, selectedAccountId])

  const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—')

  // 横棒チャート用: max を基準に幅 %
  const maxCount = (arr: { count: number }[]) =>
    arr.length === 0 ? 1 : Math.max(1, ...arr.map((x) => x.count))

  const top10Source = sourceRows.slice(0, 10)
  const top10Tag = tagRows.slice(0, 10)

  // 時間帯別 BarChart 用に SeriesPoint へ変換 (合計 = incoming + outgoing)
  const hourSeriesTotal: SeriesPoint[] = hourRows.map((r) => ({
    date: `${String(r.hour).padStart(2, '0')}:00`,
    count: r.incoming + r.outgoing,
  }))

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
        <Header
          title="レポート"
          description="トラックリンク別の集計（L-TRACK 互換: クリック/登録/ブロック/AF）"
        />

        {error && (
          <Banner tone="danger" className="mb-4">
            {error}
          </Banner>
        )}

        <div className="mb-4 inline-flex gap-1 rounded-md border border-gray-200 bg-white p-1">
          {(['total', 'month', 'day'] as const).map((g) => (
            <Button
              key={g}
              type="button"
              size="sm"
              variant={granularity === g ? 'primary' : 'ghost'}
              onClick={() => setGranularity(g)}
            >
              {g === 'total' ? '期間別' : g === 'month' ? '月別' : '日別'}
            </Button>
          ))}
        </div>

        {loading ? (
          <Card>
            <CardContent className="py-6 text-sm text-gray-500">読み込み中…</CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <EmptyState title="該当データなし" />
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {granularity !== 'total' && (
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">期間</th>
                    )}
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">媒体</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">トラックリンク</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">クリック</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">登録</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">登録率</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">1Hブロック</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">3Hブロック</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">24Hブロック</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">全体ブロック</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">AF確定</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">単価</th>
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-500">報酬</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {rows.map((r) => (
                    <tr key={`${r.bucket}-${r.tracked_link_id}`}>
                      {granularity !== 'total' && (
                        <td className="px-3 py-2 tabular-nums text-gray-700">{r.bucket}</td>
                      )}
                      <td className="px-3 py-2 text-gray-700">{r.media_name ?? '—'}</td>
                      <td className="px-3 py-2 text-gray-900">{r.tracked_link_name}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.click_count.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.friend_add_count.toLocaleString()}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pct(r.friend_add_count, r.click_count)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.block_1h}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.block_3h}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.block_24h}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.block_total}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.af_confirmed_count}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.af_amount ?? '—'}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {r.af_revenue_yen ? `¥${r.af_revenue_yen.toLocaleString()}` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}

        {/* ─── 拡張分析セクション ─────────────────────── */}
        <div className="mt-10">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold tracking-tight text-gray-900">
                深掘り分析
              </h2>
              <p className="mt-0.5 text-sm text-gray-500">
                流入経路 / タグ / 時間帯別の登録・アクティビティ
              </p>
            </div>
            <div className="inline-flex gap-1 rounded-md border border-gray-200 bg-white p-1">
              {([7, 30, 90] as const).map((d) => (
                <Button
                  key={d}
                  type="button"
                  size="sm"
                  variant={analyticsDays === d ? 'primary' : 'ghost'}
                  onClick={() => setAnalyticsDays(d)}
                >
                  {d}日
                </Button>
              ))}
            </div>
          </div>

          {analyticsError && (
            <Banner tone="danger" className="mb-4">
              {analyticsError}
            </Banner>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* 流入経路別 */}
            <Card>
              <CardHeader>
                <CardTitle>流入経路別 友だち追加</CardTitle>
                <CardDescription>
                  entry_routes 別の追加数 (上位10件 / 直近 {analyticsDays} 日)
                </CardDescription>
              </CardHeader>
              <CardContent>
                {analyticsLoading ? (
                  <p className="text-sm text-gray-500">読み込み中…</p>
                ) : top10Source.length === 0 ? (
                  <p className="text-sm text-gray-500">該当データなし</p>
                ) : (
                  <HorizontalBarList
                    rows={top10Source.map((r) => ({
                      key: r.ref_code,
                      label: r.name,
                      count: r.count,
                    }))}
                    max={maxCount(top10Source)}
                    accentColor="#3B82F6"
                  />
                )}
              </CardContent>
            </Card>

            {/* タグ別 */}
            <Card>
              <CardHeader>
                <CardTitle>タグ別 友だち数</CardTitle>
                <CardDescription>
                  期間内に付与されたタグ (上位10件 / 直近 {analyticsDays} 日)
                </CardDescription>
              </CardHeader>
              <CardContent>
                {analyticsLoading ? (
                  <p className="text-sm text-gray-500">読み込み中…</p>
                ) : top10Tag.length === 0 ? (
                  <p className="text-sm text-gray-500">該当データなし</p>
                ) : (
                  <HorizontalBarList
                    rows={top10Tag.map((r) => ({
                      key: r.tag_id,
                      label: r.name,
                      count: r.count,
                      color: r.color ?? undefined,
                    }))}
                    max={maxCount(top10Tag)}
                    accentColor="#06C755"
                  />
                )}
              </CardContent>
            </Card>

            {/* 時間帯別 (24h, full width) */}
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>時間帯別 メッセージ</CardTitle>
                <CardDescription>
                  0-23 時 (JST) のメッセージ送受信合計 (直近 {analyticsDays} 日)
                </CardDescription>
              </CardHeader>
              <CardContent>
                {analyticsLoading ? (
                  <p className="text-sm text-gray-500">読み込み中…</p>
                ) : hourRows.length === 0 ? (
                  <p className="text-sm text-gray-500">該当データなし</p>
                ) : (
                  <div>
                    <BarChart
                      data={hourSeriesTotal}
                      width={720}
                      height={140}
                      barColor="#06C755"
                    />
                    <div
                      className="mt-1 grid gap-[2px] text-[10px] tabular-nums text-gray-400"
                      style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}
                    >
                      {hourRows.map((r) => (
                        <span key={r.hour} className="text-center">
                          {r.hour}
                        </span>
                      ))}
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-gray-600 sm:grid-cols-4">
                      <Stat
                        label="受信合計"
                        value={hourRows.reduce((a, b) => a + b.incoming, 0)}
                      />
                      <Stat
                        label="送信合計"
                        value={hourRows.reduce((a, b) => a + b.outgoing, 0)}
                      />
                      <Stat
                        label="ピーク時間 (合計)"
                        value={
                          hourRows.reduce(
                            (best, r) =>
                              r.incoming + r.outgoing > best.total
                                ? { hour: r.hour, total: r.incoming + r.outgoing }
                                : best,
                            { hour: 0, total: -1 },
                          ).hour
                        }
                        suffix="時"
                      />
                      <Stat
                        label="ピーク時間 (受信)"
                        value={
                          hourRows.reduce(
                            (best, r) =>
                              r.incoming > best.total
                                ? { hour: r.hour, total: r.incoming }
                                : best,
                            { hour: 0, total: -1 },
                          ).hour
                        }
                        suffix="時"
                      />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}

// ─── 横棒リスト (流入経路別 / タグ別 共通) ───────────
function HorizontalBarList({
  rows,
  max,
  accentColor,
}: {
  rows: { key: string; label: string; count: number; color?: string }[]
  max: number
  accentColor: string
}) {
  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const widthPct = max > 0 ? Math.max(2, (r.count / max) * 100) : 0
        const barColor = r.color ?? accentColor
        return (
          <li key={r.key} className="flex items-center gap-3 text-sm">
            <span
              className="w-40 truncate text-gray-700"
              title={r.label}
            >
              {r.label}
            </span>
            <div className="relative h-5 flex-1 overflow-hidden rounded bg-gray-100">
              <div
                className="h-full rounded"
                style={{ width: `${widthPct}%`, backgroundColor: barColor, opacity: 0.85 }}
              />
            </div>
            <span className="w-12 text-right tabular-nums text-gray-900">
              {r.count.toLocaleString()}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function Stat({
  label,
  value,
  suffix,
}: {
  label: string
  value: number
  suffix?: string
}) {
  return (
    <div className="rounded-md border border-gray-100 bg-gray-50 px-3 py-2">
      <div className="text-[11px] text-gray-500">{label}</div>
      <div className="mt-0.5 text-base font-semibold tabular-nums text-gray-900">
        {value.toLocaleString('ja-JP')}
        {suffix ? <span className="ml-0.5 text-xs text-gray-500">{suffix}</span> : null}
      </div>
    </div>
  )
}
