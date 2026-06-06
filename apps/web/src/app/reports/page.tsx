'use client'

/**
 * L-TRACK 互換: レポート画面 (期間別/月別/日別)
 *
 * GET /api/reports/summary でトラックリンク × 期間軸の集計を取得。
 * カラムは L-TRACK レポートと互換 (クリック / 登録 / 登録率 / ブロック1H/3H/24H/全体 / AF件数 / 報酬額)。
 */

import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'

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

export default function ReportsPage() {
  const { selectedAccountId } = useAccount()
  const [rows, setRows] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [granularity, setGranularity] = useState<'total' | 'month' | 'day'>('total')

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

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [granularity, selectedAccountId])

  const pct = (n: number, d: number) => (d > 0 ? `${((n / d) * 100).toFixed(1)}%` : '—')

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6 lg:px-8">
        <Header
          title="レポート"
          description="トラックリンク別の集計（L-TRACK 互換: クリック/登録/ブロック/AF）"
        />

        {error && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="mb-4 inline-flex rounded border bg-white p-1 text-sm">
          {(['total', 'month', 'day'] as const).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGranularity(g)}
              className={`rounded px-3 py-1 ${
                granularity === g ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-gray-50'
              }`}
            >
              {g === 'total' ? '期間別' : g === 'month' ? '月別' : '日別'}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="rounded border bg-white p-6 text-sm text-gray-500">読み込み中…</div>
        ) : rows.length === 0 ? (
          <div className="rounded border bg-white p-6 text-sm text-gray-500">
            該当データなし
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white">
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
        )}
      </main>
    </div>
  )
}
