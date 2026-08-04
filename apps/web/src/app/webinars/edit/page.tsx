'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Header from '@/components/layout/header'
import WebinarForm from '@/components/webinars/webinar-form'
import {
  webinarApi,
  type Webinar,
  type WebinarSakuraComment,
  type WebinarAnalytics,
  type WebinarUserComment,
} from '@/lib/api'

function fmtSec(sec: number): string {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}

function fmtSession(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString('ja-JP')
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'

function CommentsTab({ webinarId }: { webinarId: string }) {
  const [comments, setComments] = useState<WebinarSakuraComment[]>([])
  const [loading, setLoading] = useState(true)
  const [importJson, setImportJson] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [isErrorMessage, setIsErrorMessage] = useState(false)

  useEffect(() => {
    webinarApi
      .comments(webinarId)
      .then((res) => setComments(res.data))
      .finally(() => setLoading(false))
  }, [webinarId])

  const update = (i: number, patch: Partial<WebinarSakuraComment>) =>
    setComments((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  const save = async () => {
    setMessage(null)
    try {
      const sorted = [...comments].sort((a, b) => a.atSeconds - b.atSeconds)
      const res = await webinarApi.saveComments(webinarId, sorted)
      setComments(sorted)
      setIsErrorMessage(false)
      setMessage(`${res.data.count}件保存しました`)
    } catch (err) {
      setIsErrorMessage(true)
      setMessage(`保存に失敗しました: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  // サーバー側 (PUT /api/webinars/:id/comments) と同じ検証条件を事前に適用する。
  // ここで弾いておかないと、不正な行が NaN / "undefined" のまま
  // 「◯件読み込みました」と成功表示されてしまい、保存時のサーバー 400 で
  // 初めて気づく上にどの行が悪いか分からない。
  function validateImportRow(raw: unknown): WebinarSakuraComment | string {
    if (typeof raw !== 'object' || raw === null) return 'オブジェクトではありません'
    const rec = raw as Record<string, unknown>
    const atSeconds = Math.floor(Number(rec.atSeconds))
    if (!Number.isFinite(atSeconds) || atSeconds < 0) return 'atSeconds が不正です'
    const authorName = typeof rec.authorName === 'string' ? rec.authorName.trim() : ''
    if (!authorName) return 'authorName が空です'
    if (authorName.length > 50) return 'authorName が50字を超えています'
    const body = typeof rec.body === 'string' ? rec.body.trim() : ''
    if (!body) return 'body が空です'
    if (body.length > 500) return 'body が500字を超えています'
    return { atSeconds, authorName, body }
  }

  const doImport = () => {
    try {
      const parsed = JSON.parse(importJson) as unknown
      if (!Array.isArray(parsed)) throw new Error('配列ではありません')
      const rows: WebinarSakuraComment[] = []
      for (let i = 0; i < parsed.length; i++) {
        const result = validateImportRow(parsed[i])
        if (typeof result === 'string') {
          throw new Error(`${i + 1}行目が不正です: ${result}`)
        }
        rows.push(result)
      }
      setComments(rows)
      setImportJson('')
      setIsErrorMessage(false)
      setMessage(`${rows.length}件読み込みました（保存ボタンで確定）`)
    } catch (err) {
      setIsErrorMessage(true)
      setMessage(`JSON が不正です: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  if (loading) {
    return <div className="text-gray-500 text-sm">読み込み中...</div>
  }

  return (
    <div className="space-y-4">
      {message && (
        <div
          className={`p-3 rounded-lg text-sm border ${
            isErrorMessage
              ? 'bg-red-50 border-red-200 text-red-700'
              : 'bg-blue-50 border-blue-200 text-blue-800'
          }`}
        >
          {message}
        </div>
      )}
      <div>
        <p className="mb-1 text-sm text-gray-600">
          JSON 一括インポート（形式: {'[{"atSeconds":10,"authorName":"田中","body":"こんばんは"}]'}）
        </p>
        <textarea
          value={importJson}
          onChange={(e) => setImportJson(e.target.value)}
          rows={4}
          className="w-full rounded-lg border border-gray-300 p-2 font-mono text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={doImport}
          className="mt-1 px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          読み込む
        </button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left text-gray-500">
            <th className="w-24 py-1 font-medium">秒数</th>
            <th className="w-40 font-medium">名前</th>
            <th className="font-medium">本文</th>
            <th className="w-12"></th>
          </tr>
        </thead>
        <tbody>
          {comments.map((c, i) => (
            <tr key={i} className="border-b border-gray-100">
              <td className="py-1 pr-2">
                <input
                  type="number"
                  value={c.atSeconds}
                  onChange={(e) => update(i, { atSeconds: Number(e.target.value) })}
                  className={`${inputClass} w-20`}
                />
              </td>
              <td className="pr-2">
                <input
                  value={c.authorName}
                  onChange={(e) => update(i, { authorName: e.target.value })}
                  className={inputClass}
                />
              </td>
              <td className="pr-2">
                <input
                  value={c.body}
                  onChange={(e) => update(i, { body: e.target.value })}
                  className={inputClass}
                />
              </td>
              <td>
                <button
                  onClick={() => setComments((prev) => prev.filter((_, j) => j !== i))}
                  className="text-red-500 hover:text-red-600"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2">
        <button
          onClick={() => setComments((prev) => [...prev, { atSeconds: 0, authorName: '', body: '' }])}
          className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          ＋ 追加
        </button>
        <button
          onClick={() => void save()}
          className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          保存
        </button>
      </div>
    </div>
  )
}

function AnalyticsTab({ webinarId }: { webinarId: string }) {
  const [analytics, setAnalytics] = useState<WebinarAnalytics | null>(null)
  const [userComments, setUserComments] = useState<WebinarUserComment[]>([])

  useEffect(() => {
    webinarApi.analytics(webinarId).then((res) => setAnalytics(res.data))
    webinarApi.userComments(webinarId).then((res) => setUserComments(res.data))
  }, [webinarId])

  if (!analytics) return <div className="text-gray-500 text-sm">読み込み中...</div>

  const maxDropoff = Math.max(1, ...analytics.dropoff.map((d) => d.viewers))

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-2 font-semibold text-gray-900">セッション別</h3>
        {analytics.sessions.length === 0 ? (
          <p className="text-sm text-gray-500">まだ視聴データがありません</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-1 font-medium">開始日時</th>
                <th className="font-medium">参加者</th>
                <th className="font-medium">平均視聴</th>
                <th className="font-medium">CTAクリック</th>
                <th className="font-medium">CTR</th>
              </tr>
            </thead>
            <tbody>
              {analytics.sessions.map((s) => (
                <tr key={s.sessionStartAt} className="border-b border-gray-100">
                  <td className="py-1">{fmtSession(s.sessionStartAt)}</td>
                  <td>{s.viewers}</td>
                  <td>{fmtSec(s.avgWatchedSeconds)}</td>
                  <td>{s.ctaClicks}</td>
                  <td>{s.viewers > 0 ? `${Math.round((s.ctaClicks / s.viewers) * 100)}%` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section>
        <h3 className="mb-2 font-semibold text-gray-900">離脱位置分布（最終視聴位置・10分刻み）</h3>
        {analytics.dropoff.length === 0 ? (
          <p className="text-sm text-gray-500">まだ視聴データがありません</p>
        ) : (
          analytics.dropoff.map((d) => (
            <div key={d.bucketStart} className="mb-1 flex items-center gap-2 text-xs">
              <span className="w-16 shrink-0 text-gray-500">{fmtSec(d.bucketStart)}〜</span>
              <div className="h-4 bg-blue-500 rounded" style={{ width: `${(d.viewers / maxDropoff) * 100}%` }} />
              <span>{d.viewers}</span>
            </div>
          ))
        )}
      </section>
      <section>
        <h3 className="mb-2 font-semibold text-gray-900">視聴者コメント</h3>
        {userComments.length === 0 ? (
          <p className="text-sm text-gray-500">まだコメントがありません</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-left text-gray-500">
                <th className="py-1 font-medium">友だち</th>
                <th className="font-medium">位置</th>
                <th className="font-medium">本文</th>
                <th className="font-medium">セッション</th>
              </tr>
            </thead>
            <tbody>
              {userComments.map((c) => (
                <tr key={c.id} className="border-b border-gray-100">
                  <td className="py-1">{c.friendName ?? c.friendId.slice(0, 8)}</td>
                  <td>{fmtSec(c.atSeconds)}</td>
                  <td>{c.body}</td>
                  <td className="text-gray-500">{fmtSession(c.sessionStartAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

const TABS = [
  ['settings', '設定'],
  ['comments', 'サクラコメント'],
  ['analytics', '分析'],
] as const

type TabKey = (typeof TABS)[number][0]

function EditWebinarInner() {
  const id = useSearchParams().get('id')
  const [webinar, setWebinar] = useState<Webinar | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('settings')

  useEffect(() => {
    if (!id) return
    setLoading(true)
    webinarApi
      .get(id)
      .then((res) => setWebinar(res.data))
      .catch((err) => setLoadError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false))
  }, [id])

  if (!id) {
    return (
      <>
        <Header title="ウェビナー編集" />
        <div className="p-6 text-red-700">id クエリが必要です</div>
      </>
    )
  }
  if (loading) {
    return (
      <>
        <Header title="ウェビナー編集" />
        <div className="p-6 text-gray-500">読み込み中...</div>
      </>
    )
  }
  if (loadError || !webinar) {
    return (
      <>
        <Header title="ウェビナー編集" />
        <div className="p-6 text-red-700">{loadError ?? '見つかりませんでした'}</div>
      </>
    )
  }

  return (
    <>
      <Header title={webinar.title} />
      <div className="p-6 max-w-4xl mx-auto">
        <p className="mb-4 font-mono text-xs text-gray-500 break-all">
          配信URL: https://liff.line.me/{'{liffId}'}/?page=webinar&slug={webinar.slug}&liffId={'{liffId}'}
        </p>

        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="flex border-b border-gray-200">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex-1 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                  tab === key
                    ? 'border-blue-600 text-blue-600 bg-blue-50'
                    : 'border-transparent text-gray-600 hover:bg-gray-50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="p-6">
            {tab === 'settings' && <WebinarForm initial={webinar} />}
            {tab === 'comments' && <CommentsTab webinarId={webinar.id} />}
            {tab === 'analytics' && <AnalyticsTab webinarId={webinar.id} />}
          </div>
        </div>
      </div>
    </>
  )
}

export default function EditWebinarPage() {
  return (
    <Suspense
      fallback={
        <>
          <Header title="ウェビナー編集" />
          <div className="p-6 text-gray-500">読み込み中...</div>
        </>
      }
    >
      <EditWebinarInner />
    </Suspense>
  )
}
