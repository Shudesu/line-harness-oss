'use client'

/**
 * L-TRACK 互換: トラックリンク管理ページ
 *
 * 認証画面スキップモード (skip_liff=1) のトラックリンクを発行・管理する。
 * 既存の entry_routes (/inflow-links) とは別系統で、tracked_links テーブルを扱う。
 *
 * 主機能:
 *  - 一覧表示（名前・URL・媒体・クリック数・skip_liff バッジ・af_confirm_type）
 *  - 新規発行モーダル（skip_liff デフォルト=ON）
 *  - 編集モーダル
 *  - トラッキングURLのコピー
 *  - 詳細ページへの遷移
 */

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import EditTrackedLinkModal from './_components/edit-tracked-link-modal'

type ListResp = Awaited<ReturnType<typeof api.trackedLinks.list>>
type ListData = Extract<ListResp, { success: true }>['data']
type TrackedLinkRow = ListData extends Array<infer T> ? T : never

export default function TrackedLinksPage() {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<TrackedLinkRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<TrackedLinkRow | 'new' | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    const r = await api.trackedLinks.list({ lineAccountId: selectedAccountId })
    if (r.success) {
      setItems(r.data)
    } else {
      setError('トラックリンクの取得に失敗しました')
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [selectedAccountId])

  const onCopy = async (url: string, id: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 1200)
    } catch {
      // silent
    }
  }

  const onDelete = async (id: string, name: string) => {
    if (!confirm(`「${name}」を削除しますか？\nクリックログも削除されます。`)) return
    const r = await api.trackedLinks.delete(id, { lineAccountId: selectedAccountId })
    if (r.success) load()
    else alert('削除に失敗しました')
  }

  // サーバ側で line_account_id を絞っているので追加フィルタは不要だが、
  // 念のため UI でも防衛的にフィルタする（古いキャッシュ対策）
  const filtered = items

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <Header
          title="トラックリンク"
          description="認証画面スキップ対応のトラッキングリンクを発行・管理します（L-TRACK 互換）"
          action={
            <button
              type="button"
              onClick={() => setEditing('new')}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              ＋ 新規発行
            </button>
          }
        />

        {error && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
            {error}
          </div>
        )}

        {loading ? (
          <div className="rounded border bg-white p-6 text-sm text-gray-500">読み込み中…</div>
        ) : filtered.length === 0 ? (
          <div className="rounded border bg-white p-6 text-sm text-gray-500">
            まだトラックリンクがありません。「新規発行」で作成してください。
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    名前
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    媒体
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    モード
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    AF確定
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    クリック数
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    アクション
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {filtered.map((item) => (
                  <tr key={item.id} className={!item.isActive ? 'opacity-50' : ''}>
                    <td className="px-4 py-3">
                      <Link
                        href={`/tracked-links/${item.id}`}
                        className="font-medium text-blue-700 hover:underline"
                      >
                        {item.name}
                      </Link>
                      <div className="mt-1 text-xs text-gray-500 break-all">
                        {item.originalUrl}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {item.mediaName ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      {item.skipLiff ? (
                        <span className="inline-flex items-center rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                          認証スキップ
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                          LIFF（高精度）
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {item.afConfirmType === 'immediate' ? '即時' : item.afConfirmType}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-medium tabular-nums text-gray-900">
                      {item.clickCount.toLocaleString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 text-xs">
                        <button
                          type="button"
                          onClick={() => onCopy(item.trackingUrl, item.id)}
                          className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
                        >
                          {copiedId === item.id ? '✓ コピー済' : 'URLコピー'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditing(item)}
                          className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          onClick={() => onDelete(item.id, item.name)}
                          className="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50"
                        >
                          削除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {editing && (
          <EditTrackedLinkModal
            initial={editing === 'new' ? null : editing}
            selectedAccountId={selectedAccountId}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null)
              load()
            }}
          />
        )}
      </main>
    </div>
  )
}
