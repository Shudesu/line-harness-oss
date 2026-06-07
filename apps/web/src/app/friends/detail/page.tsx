'use client'

/**
 * L-TRACK 互換: 友だち詳細ページ (attribution 表示)
 *
 * /api/friends/:id + /api/friends/:id/attribution を呼んで:
 *   - 基本情報 (display_name, line_user_id, is_following, etc.)
 *   - First-touch attribution (first_tracked_link_id)
 *   - 最新クリック (ltp/fbclid/gclid/twclid/ttclid/utm_xxx/UA/IP/country)
 *   - 最新 ref_tracking (entry_route 経由含む)
 */

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'

interface FriendBasic {
  id: string
  line_user_id: string
  display_name: string | null
  picture_url: string | null
  is_following: number
  status_message: string | null
  created_at: string
  updated_at: string
  first_tracked_link_id: string | null
}

interface Attribution {
  firstTrackedLink: { id: string; name: string; media_name: string | null } | null
  latestClick: Record<string, unknown> | null
  latestRefTracking: Record<string, unknown> | null
}

export default function FriendDetailPage() {
  return (
    <Suspense fallback={<div className="p-8 text-sm text-gray-500">読み込み中…</div>}>
      <Inner />
    </Suspense>
  )
}

function Inner() {
  const sp = useSearchParams()
  const id = sp?.get('id') ?? null
  const { selectedAccountId } = useAccount()
  const [friend, setFriend] = useState<FriendBasic | null>(null)
  const [attribution, setAttribution] = useState<Attribution | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) return
    ;(async () => {
      setLoading(true)
      // Server enforces account boundary when lineAccountId is provided.
      // Falling back to undefined keeps the legacy compatibility path on the
      // worker (account boundary disabled).
      const accountQs = selectedAccountId
        ? `?lineAccountId=${encodeURIComponent(selectedAccountId)}`
        : ''
      const [fRes, aRes] = await Promise.all([
        fetchApi<{ success: boolean; data: FriendBasic; error?: string }>(
          `/api/friends/${id}${accountQs}`,
        ),
        fetchApi<{ success: boolean; data: Attribution; error?: string }>(
          `/api/friends/${id}/attribution${accountQs}`,
        ),
      ])
      if (fRes.success) setFriend(fRes.data)
      else setError(fRes.error ?? '友だち情報の取得に失敗しました')
      if (aRes.success) setAttribution(aRes.data)
      setLoading(false)
    })()
  }, [id, selectedAccountId])

  const click = (attribution?.latestClick ?? {}) as Record<string, unknown>
  const ref = (attribution?.latestRefTracking ?? {}) as Record<string, unknown>

  const attr = (key: string) => (click[key] ?? ref[key] ?? null) as string | null

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-4 text-sm">
          <Link href="/friends" className="text-blue-600 hover:underline">
            ← 友だち一覧に戻る
          </Link>
        </div>
        <Header
          title={friend?.display_name ?? '友だち詳細'}
          description={friend ? `LINE userId: ${friend.line_user_id}` : ''}
        />

        {error && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded border bg-white p-6 text-sm text-gray-500">読み込み中…</div>
        ) : !friend ? (
          <div className="rounded border bg-white p-6 text-sm text-gray-500">データなし</div>
        ) : (
          <>
            <div className="mb-6 grid grid-cols-2 gap-4 rounded border bg-white p-4 text-sm sm:grid-cols-4">
              <div>
                <div className="text-xs text-gray-500">状態</div>
                <div className="font-medium">
                  {friend.is_following ? '✅ 友だち' : '🚫 ブロック中'}
                </div>
              </div>
              <div>
                <div className="text-xs text-gray-500">追加日時</div>
                <div className="font-medium tabular-nums">{friend.created_at}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">更新日時</div>
                <div className="font-medium tabular-nums">{friend.updated_at}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500">ステータスメッセージ</div>
                <div className="font-medium">{friend.status_message ?? '—'}</div>
              </div>
            </div>

            <h2 className="mt-8 mb-2 text-lg font-semibold text-gray-900">
              First-touch 流入元
            </h2>
            {attribution?.firstTrackedLink ? (
              <div className="rounded border bg-white p-4 text-sm">
                <div>
                  <span className="text-gray-500">トラックリンク:</span>{' '}
                  <Link
                    href={`/tracked-links/detail?id=${attribution.firstTrackedLink.id}`}
                    className="text-blue-700 hover:underline"
                  >
                    {attribution.firstTrackedLink.name}
                  </Link>
                </div>
                {attribution.firstTrackedLink.media_name && (
                  <div className="mt-1">
                    <span className="text-gray-500">媒体:</span>{' '}
                    {attribution.firstTrackedLink.media_name}
                  </div>
                )}
              </div>
            ) : (
              <div className="rounded border bg-white p-4 text-sm text-gray-500">
                first-touch のトラックリンクが紐付いていません（直接友だち追加 or 紐付け失敗）
              </div>
            )}

            <h2 className="mt-8 mb-2 text-lg font-semibold text-gray-900">
              アトリビューション（L-TRACK 互換）
            </h2>
            <div className="overflow-x-auto rounded-lg border bg-white">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <tbody className="divide-y divide-gray-200">
                  <AttrRow label="ltp" value={attr('ltp')} mono />
                  <AttrRow label="fbclid" value={attr('fbclid')} mono />
                  <AttrRow label="gclid" value={attr('gclid')} mono />
                  <AttrRow label="twclid" value={attr('twclid')} mono />
                  <AttrRow label="ttclid" value={attr('ttclid')} mono />
                  <AttrRow label="utm_source" value={attr('utm_source')} />
                  <AttrRow label="utm_medium" value={attr('utm_medium')} />
                  <AttrRow label="utm_campaign" value={attr('utm_campaign')} />
                  <AttrRow label="utm_content" value={attr('utm_content')} />
                  <AttrRow label="utm_term" value={attr('utm_term')} />
                  <AttrRow label="User Agent" value={attr('user_agent')} mono />
                  <AttrRow label="IP Address" value={attr('ip_address')} mono />
                  <AttrRow label="国" value={attr('country')} />
                  <AttrRow
                    label="マッチ方式"
                    value={attr('match_strategy')}
                  />
                  <AttrRow
                    label="confidence"
                    value={attr('match_confidence')}
                  />
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  )
}

function AttrRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string | null
  mono?: boolean
}) {
  return (
    <tr>
      <td className="w-44 px-4 py-2 text-xs font-medium text-gray-500">{label}</td>
      <td className={`px-4 py-2 text-gray-800 ${mono ? 'font-mono text-xs break-all' : ''}`}>
        {value ?? <span className="text-gray-400">—</span>}
      </td>
    </tr>
  )
}
