'use client'

/**
 * L-TRACK 互換: ポストバック履歴ページ
 *
 * GET /api/reports/postback で ad_conversion_logs 横断取得して一覧表示。
 * フィルター: status / platform / 期間 / friendId。
 */

import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import {
  Button,
  Card,
  CardContent,
  Badge,
  Banner,
  Label,
  Select,
  EmptyState,
} from '@/components/ui/primitives'

interface Row {
  id: string
  ad_platform_id: string
  platform_name: string | null
  friend_id: string
  friend_display_name: string | null
  event_name: string
  click_id: string | null
  click_id_type: string | null
  status: 'sent' | 'failed'
  error_message: string | null
  created_at: string
}

export default function PostbackHistoryPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<'' | 'sent' | 'failed'>('')
  const [platformName, setPlatformName] = useState('')

  const load = async () => {
    setLoading(true)
    const qs = new URLSearchParams()
    if (status) qs.set('status', status)
    if (platformName) qs.set('platformName', platformName)
    qs.set('limit', '500')
    const r = await fetchApi<{ success: boolean; data: Row[]; error?: string }>(
      `/api/reports/postback?${qs}`,
    )
    if (r.success) setRows(r.data)
    else setError(r.error ?? '取得失敗')
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, platformName])

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Header
          title="ポストバック履歴"
          description="広告CV送信(CAPI) と外部イベント送信の履歴一覧（L-TRACK 互換）"
        />

        {error && (
          <Banner tone="danger" className="mb-4">
            {error}
          </Banner>
        )}

        <Card className="mb-4">
          <CardContent className="flex flex-wrap items-center gap-3 py-3 text-sm">
            <Label className="flex items-center gap-2 m-0">
              <span className="text-gray-600">ステータス:</span>
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value as '' | 'sent' | 'failed')}
                className="mt-0 w-auto py-1"
              >
                <option value="">すべて</option>
                <option value="sent">sent</option>
                <option value="failed">failed</option>
              </Select>
            </Label>
            <Label className="flex items-center gap-2 m-0">
              <span className="text-gray-600">媒体:</span>
              <Select
                value={platformName}
                onChange={(e) => setPlatformName(e.target.value)}
                className="mt-0 w-auto py-1"
              >
                <option value="">すべて</option>
                <option value="meta">Meta</option>
                <option value="google">Google</option>
                <option value="tiktok">TikTok</option>
                <option value="x">X</option>
              </Select>
            </Label>
            <Button
              type="button"
              onClick={load}
              size="sm"
            >
              再取得
            </Button>
          </CardContent>
        </Card>

        {loading ? (
          <Card>
            <CardContent className="pt-6 pb-6 text-sm text-gray-500">読み込み中…</CardContent>
          </Card>
        ) : rows.length === 0 ? (
          <EmptyState title="該当する履歴がありません" />
        ) : (
          <Card className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">時刻</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">媒体</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">イベント</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">友だち</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">click_id</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">状態</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">エラー</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-2 tabular-nums text-gray-700">{r.created_at}</td>
                    <td className="px-4 py-2 text-gray-700">{r.platform_name ?? '—'}</td>
                    <td className="px-4 py-2 font-medium">{r.event_name}</td>
                    <td className="px-4 py-2">
                      {r.friend_display_name ?? <span className="text-gray-400">{r.friend_id}</span>}
                    </td>
                    <td className="px-4 py-2 font-mono text-xs break-all tabular-nums">
                      {r.click_id ? `${r.click_id_type ?? ''}=${r.click_id.slice(0, 20)}…` : '—'}
                    </td>
                    <td className="px-4 py-2">
                      {r.status === 'sent' ? (
                        <Badge tone="success">sent</Badge>
                      ) : (
                        <Badge tone="danger">failed</Badge>
                      )}
                    </td>
                    <td className="px-4 py-2 text-xs text-red-700">{r.error_message ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </main>
    </div>
  )
}
