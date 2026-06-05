'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'

type GetResp = Awaited<ReturnType<typeof api.trackedLinks.get>>
type Detail = Extract<GetResp, { success: true }>['data']

export default function TrackedLinkDetailPage() {
  const params = useParams<{ id: string }>()
  const { selectedAccountId } = useAccount()
  const id = params?.id
  const [data, setData] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    ;(async () => {
      setLoading(true)
      const r = await api.trackedLinks.get(id, { lineAccountId: selectedAccountId })
      if (r.success) setData(r.data as Detail)
      else setError((r as { error?: string }).error ?? '取得に失敗しました')
      setLoading(false)
    })()
  }, [id, selectedAccountId])

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-4 text-sm">
          <Link href="/tracked-links" className="text-blue-600 hover:underline">
            ← 一覧に戻る
          </Link>
        </div>
        <Header title={data?.name ?? 'トラックリンク詳細'} description={data?.originalUrl ?? ''} />

        {error && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded border bg-white p-6 text-sm text-gray-500">読み込み中…</div>
        ) : !data ? (
          <div className="rounded border bg-white p-6 text-sm text-gray-500">
            データがありません
          </div>
        ) : (
          <>
            <div className="mb-6 grid grid-cols-2 gap-4 rounded border bg-white p-4 text-sm sm:grid-cols-4">
              <div>
                <div className="text-xs text-gray-500">媒体</div>
                <div className="font-medium">{data.mediaName ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">モード</div>
                <div className="font-medium">
                  {data.skipLiff ? '認証スキップ' : 'LIFF（高精度）'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">AF確定</div>
                <div className="font-medium">
                  {data.afConfirmType === 'immediate' ? '即時' : data.afConfirmType}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">クリック総数</div>
                <div className="font-medium tabular-nums">
                  {data.clickCount.toLocaleString()}
                </div>
              </div>
            </div>

            <div className="mb-4 rounded border bg-white p-4 text-sm">
              <div className="text-xs text-gray-500">トラッキングURL</div>
              <div className="mt-1 break-all font-mono text-blue-700">{data.trackingUrl}</div>
              <div className="mt-3 text-xs text-gray-500">遷移先URL</div>
              <div className="mt-1 break-all text-gray-700">{data.originalUrl}</div>
            </div>

            <h2 className="mt-8 mb-2 text-lg font-semibold text-gray-900">
              クリックログ（最新50件）
            </h2>
            {data.clicks.length === 0 ? (
              <div className="rounded border bg-white p-4 text-sm text-gray-500">
                クリック履歴がありません
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border bg-white">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                        クリック日時
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">
                        友だち
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {data.clicks.map((c: Detail['clicks'][number]) => (
                      <tr key={c.id}>
                        <td className="px-4 py-2 text-sm text-gray-700">{c.clickedAt}</td>
                        <td className="px-4 py-2 text-sm">
                          {c.friendId ? (
                            <Link
                              href={`/friends/${c.friendId}`}
                              className="text-blue-700 hover:underline"
                            >
                              {c.friendDisplayName ?? c.friendId}
                            </Link>
                          ) : (
                            <span className="text-gray-400">未紐付け</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
