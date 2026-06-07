'use client'

import { useState } from 'react'

// SECURITY (緊急血止め 2026-06-07):
// 旧実装は `NEXT_PUBLIC_ADMIN_API_KEY` をクライアントバンドルに埋め込んで
// 本番 JS に admin shared secret を露出していた。hyhome フォークでは
// self-update を運用しないため、この履歴ページも一時的に無効化する。
// 将来復活させる場合は staff Bearer (lh_api_key) ベースの認証 +
// requireRole('owner') guard に張り替えること。

interface Row {
  id: string
  started_at: number
  completed_at: number | null
  from_version: string
  to_version: string
  status: string
  error: string | null
  rollback_expires_at: number | null
}

export default function UpdatesPage() {
  const [rows] = useState<Row[]>([])
  const [error] = useState<string | null>(
    'self-update is disabled in this fork (admin api key leak fix)',
  )

  return (
    <div className="max-w-3xl mx-auto p-6">
      <h1 className="text-xl font-semibold mb-4">アップデート履歴</h1>
      {error && (
        <div className="text-red-700 bg-red-50 p-3 rounded mb-4 text-sm">
          履歴取得に失敗: {error}
        </div>
      )}
      {!error && rows.length === 0 && (
        <p className="text-gray-500 text-sm">履歴はまだありません。</p>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-gray-600 border-b">
              <tr>
                <th className="py-2 pr-4">開始</th>
                <th className="py-2 pr-4">From → To</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2">Rollback</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0">
                  <td className="py-2 pr-4">
                    {new Date(r.started_at).toLocaleString('ja-JP', {
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="py-2 pr-4 font-mono text-xs">
                    {r.from_version} → {r.to_version}
                  </td>
                  <td className="py-2 pr-4">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${statusClass(r.status)}`}
                    >
                      {r.status}
                    </span>
                  </td>
                  <td className="py-2">
                    {r.status === 'success' &&
                    r.rollback_expires_at &&
                    Date.now() < r.rollback_expires_at ? (
                      <button
                        onClick={() =>
                          alert('rollback not implemented in MVP — use CLI')
                        }
                        className="underline text-blue-600 text-xs"
                      >
                        Rollback
                      </button>
                    ) : (
                      <span className="text-gray-400 text-xs">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function statusClass(s: string): string {
  if (s === 'success') return 'bg-green-100 text-green-800'
  if (s === 'rolled_back') return 'bg-amber-100 text-amber-800'
  if (s === 'failed') return 'bg-red-100 text-red-800'
  if (s === 'running') return 'bg-blue-100 text-blue-800'
  return 'bg-gray-100 text-gray-800'
}
