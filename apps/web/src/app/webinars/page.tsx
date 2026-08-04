'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { webinarApi, type Webinar } from '@/lib/api'

const STATUS_LABEL: Record<Webinar['status'], string> = {
  draft: '下書き', active: '公開中', archived: 'アーカイブ',
}

const STATUS_BADGE: Record<Webinar['status'], string> = {
  draft: 'bg-gray-100 text-gray-600',
  active: 'bg-green-100 text-green-700',
  archived: 'bg-amber-100 text-amber-700',
}

function scheduleSummary(w: Webinar): string {
  if (w.schedule.length === 0) return '未設定'
  const DAYS = ['日', '月', '火', '水', '木', '金', '土']
  return w.schedule
    .map((r) => {
      if (r.type === 'daily') return `毎日 ${r.time}`
      if (r.type === 'weekly') return `毎週${(r.days ?? []).map((d) => DAYS[d]).join('・')} ${r.time}`
      return r.at ? new Date(r.at).toLocaleString('ja-JP') : ''
    })
    .join(' / ')
}

export default function WebinarsPage() {
  const [items, setItems] = useState<Webinar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await webinarApi.list()
      setItems(res.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return (
    <>
      <Header
        title="オートウェビナー"
        description="録画を疑似ライブ配信し、視聴中の CTA クリックまで計測できます"
        action={
          <Link
            href="/webinars/new"
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            ＋ 新しいウェビナー
          </Link>
        }
      />
      <div className="p-6 max-w-6xl mx-auto">
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-gray-500">
            読み込み中...
          </div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
            <div className="text-gray-700 font-medium mb-2">ウェビナーがまだありません</div>
            <p className="text-sm text-gray-500 mb-4">
              録画動画をアップロードしてスケジュールを設定すると、友だちが毎回「今始まったばかり」の疑似ライブとして視聴できます。
            </p>
            <Link
              href="/webinars/new"
              className="inline-block px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
            >
              最初のウェビナーを作成
            </Link>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-500">
                  <th className="py-3 px-4 font-medium">タイトル</th>
                  <th className="font-medium">slug</th>
                  <th className="font-medium">スケジュール</th>
                  <th className="font-medium">状態</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((w) => (
                  <tr key={w.id} className="border-b border-gray-100 last:border-0 hover:bg-gray-50">
                    <td className="py-3 px-4 font-medium text-gray-900">{w.title}</td>
                    <td className="text-gray-500 font-mono text-xs">{w.slug}</td>
                    <td className="text-gray-600">{scheduleSummary(w)}</td>
                    <td>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${STATUS_BADGE[w.status]}`}>
                        {STATUS_LABEL[w.status]}
                      </span>
                    </td>
                    <td className="text-right px-4">
                      <Link href={`/webinars/edit?id=${w.id}`} className="text-blue-600 hover:underline">
                        編集
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  )
}
