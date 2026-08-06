'use client'

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/layout/header'
import WebinarForm from '@/components/webinars/webinar-form'
import {
  fetchApi,
  webinarApi,
  type WebinarCtaCard,
  type Webinar,
  type WebinarSakuraComment,
  type WebinarAnalytics,
  type WebinarUserComment,
} from '@/lib/api'

function fmtSec(sec: number): string {
  // 負 = 開始前 (待機ルーム) の相対時刻。-330 → -5:30
  const sign = sec < 0 ? '-' : ''
  const abs = Math.abs(sec)
  const h = Math.floor(abs / 3600)
  const m = Math.floor((abs % 3600) / 60)
  const s = abs % 60
  return h > 0
    ? `${sign}${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${sign}${m}:${String(s).padStart(2, '0')}`
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
    // 負の atSeconds = 開始前 (待機ルーム) コメント。サーバーと同じく -3600 まで許容
    if (!Number.isFinite(atSeconds) || atSeconds < -3600) return 'atSeconds が不正です (-3600〜)'
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

function percent(value: number, total: number): string {
  return total > 0 ? `${Math.round((value / total) * 100)}%` : '—'
}

function compactDateTime(value: string): string {
  return new Date(value).toLocaleString('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function ParticipantAvatar({
  name,
  pictureUrl,
  size = 'md',
}: {
  name: string
  pictureUrl: string | null
  size?: 'sm' | 'md' | 'lg'
}) {
  const sizeClass = size === 'lg' ? 'h-11 w-11 text-sm' : size === 'sm' ? 'h-7 w-7 text-[10px]' : 'h-9 w-9 text-xs'
  if (pictureUrl) {
    return (
      <img
        src={pictureUrl}
        alt=""
        className={`${sizeClass} shrink-0 rounded-full bg-slate-100 object-cover ring-2 ring-white`}
      />
    )
  }
  return (
    <span className={`${sizeClass} flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-100 to-indigo-100 font-bold text-blue-700 ring-2 ring-white`}>
      {name.trim().charAt(0) || '?'}
    </span>
  )
}

function AnalyticsTab({ webinarId, durationSeconds }: { webinarId: string; durationSeconds: number }) {
  const [analytics, setAnalytics] = useState<WebinarAnalytics | null>(null)
  const [userComments, setUserComments] = useState<WebinarUserComment[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setError(null)
    Promise.all([webinarApi.analytics(webinarId), webinarApi.userComments(webinarId)])
      .then(([analyticsRes, commentsRes]) => {
        setAnalytics(analyticsRes.data)
        setUserComments(commentsRes.data)
      })
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
  }, [webinarId])

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700">
        分析データを読み込めませんでした。ページを再読み込みしてください。
      </div>
    )
  }
  if (!analytics) return <div className="text-gray-500 text-sm">読み込み中...</div>

  const { summary } = analytics
  const maxDropoff = Math.max(1, ...analytics.dropoff.map((d) => d.viewers))
  const daily = analytics.daily.slice(-14)
  const maxDaily = Math.max(
    1,
    ...daily.flatMap((d) => [d.reservations, d.viewers, d.ctaClicks, d.formSubmissions]),
  )
  const recentParticipants = analytics.participants.slice(0, 16)
  const funnel = [
    { label: '参加', value: summary.viewers, color: 'bg-blue-500', note: 'ユニーク' },
    { label: '5分視聴', value: summary.watched5m, color: 'bg-cyan-500', note: percent(summary.watched5m, summary.viewers) },
    { label: 'CTAクリック', value: summary.ctaClicks, color: 'bg-violet-500', note: percent(summary.ctaClicks, summary.viewers) },
    { label: 'フォーム送信', value: summary.formSubmissions, color: 'bg-emerald-500', note: percent(summary.formSubmissions, summary.viewers) },
  ]
  const metricCards = [
    {
      label: 'ユニーク参加者',
      value: summary.viewers.toLocaleString('ja-JP'),
      detail: `予約 ${summary.reservations.toLocaleString('ja-JP')}人`,
      tone: 'from-blue-50 to-white border-blue-100',
      dot: 'bg-blue-500',
    },
    {
      label: '予約者の参加率',
      value: percent(summary.registeredAndJoined, summary.reservations),
      detail: `${summary.registeredAndJoined.toLocaleString('ja-JP')} / ${summary.reservations.toLocaleString('ja-JP')}人`,
      tone: 'from-cyan-50 to-white border-cyan-100',
      dot: 'bg-cyan-500',
    },
    {
      label: '90%以上視聴',
      value: percent(summary.completed, summary.viewers),
      detail: `${summary.completed.toLocaleString('ja-JP')}人・平均 ${fmtSec(summary.avgWatchedSeconds)}`,
      tone: 'from-violet-50 to-white border-violet-100',
      dot: 'bg-violet-500',
    },
    {
      label: 'フォーム送信',
      value: summary.formSubmissions.toLocaleString('ja-JP'),
      detail: `CTAから ${percent(summary.formSubmissions, summary.ctaClicks)}`,
      tone: 'from-emerald-50 to-white border-emerald-100',
      dot: 'bg-emerald-500',
    },
  ]

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">Performance overview</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-950">参加の流れをひと目で確認</h2>
          <p className="mt-1 text-sm text-slate-500">再入場や複数回参加は、同じ友だちとしてまとめています。</p>
        </div>
        {analytics.participants.length > 0 && (
          <div className="flex items-center gap-3 rounded-full border border-slate-200 bg-white px-3 py-2 shadow-sm">
            <div className="flex -space-x-2">
              {analytics.participants.slice(0, 5).map((p) => (
                <ParticipantAvatar
                  key={p.friendId}
                  name={p.friendName ?? '友だち'}
                  pictureUrl={p.pictureUrl}
                  size="sm"
                />
              ))}
            </div>
            <span className="text-xs font-medium text-slate-600">最近の参加者</span>
          </div>
        )}
      </div>

      <section className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        {metricCards.map((metric) => (
          <div key={metric.label} className={`rounded-2xl border bg-gradient-to-br p-4 ${metric.tone}`}>
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
              <span className={`h-2 w-2 rounded-full ${metric.dot}`} />
              {metric.label}
            </div>
            <div className="mt-3 text-3xl font-bold tracking-tight text-slate-950">{metric.value}</div>
            <div className="mt-1 text-xs text-slate-500">{metric.detail}</div>
          </div>
        ))}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,1.4fr)]">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-900">参加ファネル</h3>
              <p className="mt-1 text-xs text-slate-500">どこで人数が減っているか</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">全期間</span>
          </div>
          <div className="mt-5 space-y-4">
            {funnel.map((stage) => (
              <div key={stage.label}>
                <div className="mb-1.5 flex items-center justify-between text-xs">
                  <span className="font-medium text-slate-700">{stage.label}</span>
                  <span className="text-slate-500"><strong className="text-slate-900">{stage.value}</strong>人 · {stage.note}</span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className={`h-full rounded-full ${stage.color}`}
                    style={{ width: `${Math.max(stage.value > 0 ? 3 : 0, (stage.value / Math.max(1, summary.viewers)) * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4">
            <div>
              <div className="text-[11px] text-slate-500">15分以上視聴</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{summary.watched15m}人</div>
            </div>
            <div>
              <div className="text-[11px] text-slate-500">CTA → フォーム</div>
              <div className="mt-1 text-lg font-bold text-slate-900">{percent(summary.formSubmissions, summary.ctaClicks)}</div>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-slate-900">日別の参加ペース</h3>
              <p className="mt-1 text-xs text-slate-500">直近14日・日ごとのユニーク人数</p>
            </div>
            <div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
              <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-slate-300" />予約</span>
              <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-blue-500" />参加</span>
              <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-violet-500" />CTA</span>
              <span className="flex items-center gap-1"><i className="h-2 w-2 rounded-full bg-emerald-500" />フォーム</span>
            </div>
          </div>
          {daily.length === 0 ? (
            <div className="flex h-52 items-center justify-center text-sm text-slate-400">まだ日別データがありません</div>
          ) : (
            <div className="mt-5 flex h-52 items-end gap-2 overflow-x-auto border-b border-slate-200 pb-7">
              {daily.map((day) => (
                <div key={day.date} className="relative flex h-full min-w-10 flex-1 items-end justify-center gap-0.5" title={`${day.date} 予約${day.reservations}・参加${day.viewers}・CTA${day.ctaClicks}・フォーム${day.formSubmissions}`}>
                  <div className="w-2 rounded-t bg-slate-300" style={{ height: `${Math.max(day.reservations > 0 ? 3 : 0, (day.reservations / maxDaily) * 100)}%` }} />
                  <div className="w-2 rounded-t bg-blue-500" style={{ height: `${Math.max(day.viewers > 0 ? 3 : 0, (day.viewers / maxDaily) * 100)}%` }} />
                  <div className="w-2 rounded-t bg-violet-500" style={{ height: `${Math.max(day.ctaClicks > 0 ? 3 : 0, (day.ctaClicks / maxDaily) * 100)}%` }} />
                  <div className="w-2 rounded-t bg-emerald-500" style={{ height: `${Math.max(day.formSubmissions > 0 ? 3 : 0, (day.formSubmissions / maxDaily) * 100)}%` }} />
                  <span className="absolute -bottom-6 whitespace-nowrap text-[10px] text-slate-400">
                    {new Date(`${day.date}T00:00:00+09:00`).toLocaleDateString('ja-JP', { month: 'numeric', day: 'numeric' })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-bold text-slate-900">最近の参加者</h3>
            <p className="mt-1 text-xs text-slate-500">顔写真・視聴状況・フォーム到達を友だち単位で表示</p>
          </div>
          <span className="text-xs text-slate-500">全 {analytics.participants.length.toLocaleString('ja-JP')}人</span>
        </div>
        {recentParticipants.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-400">まだ参加者がいません</div>
        ) : (
          <>
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="bg-slate-50/80 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-5 py-3">参加者</th>
                    <th className="px-4 py-3">最終参加</th>
                    <th className="px-4 py-3">視聴</th>
                    <th className="px-4 py-3">アクション</th>
                    <th className="px-5 py-3 text-right">詳細</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentParticipants.map((p) => {
                    const name = p.friendName ?? `友だち ${p.friendId.slice(0, 6)}`
                    const watchedRate = Math.min(100, Math.round((p.maxWatchedSeconds / Math.max(1, durationSeconds)) * 100))
                    return (
                      <tr key={p.friendId} className="hover:bg-blue-50/30">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <ParticipantAvatar name={name} pictureUrl={p.pictureUrl} size="lg" />
                            <div className="min-w-0">
                              <div className="max-w-48 truncate font-semibold text-slate-900">{name}</div>
                              <div className="mt-0.5 text-[11px] text-slate-400">{p.sessions > 1 ? `${p.sessions}回参加` : p.registered ? '予約から参加' : '直接参加'}</div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5 text-xs text-slate-600">{compactDateTime(p.latestJoinedAt)}</td>
                        <td className="w-48 px-4 py-3.5">
                          <div className="flex items-center justify-between text-[11px] text-slate-500">
                            <span>{fmtSec(p.maxWatchedSeconds)}</span><span>{watchedRate}%</span>
                          </div>
                          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100">
                            <div className="h-full rounded-full bg-blue-500" style={{ width: `${watchedRate}%` }} />
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          <div className="flex flex-wrap gap-1.5">
                            {p.formSubmittedAt ? (
                              <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">フォーム送信</span>
                            ) : p.ctaClickedAt ? (
                              <span className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-semibold text-violet-700">CTAクリック</span>
                            ) : (
                              <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-medium text-slate-500">視聴のみ</span>
                            )}
                          </div>
                        </td>
                        <td className="px-5 py-3.5 text-right">
                          <Link href={`/chats?friend=${p.friendId}`} className="text-xs font-semibold text-blue-600 hover:text-blue-700">チャットを見る →</Link>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="divide-y divide-slate-100 md:hidden">
              {recentParticipants.map((p) => {
                const name = p.friendName ?? `友だち ${p.friendId.slice(0, 6)}`
                return (
                  <Link key={p.friendId} href={`/chats?friend=${p.friendId}`} className="flex items-center gap-3 p-4 active:bg-slate-50">
                    <ParticipantAvatar name={name} pictureUrl={p.pictureUrl} size="lg" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-900">{name}</div>
                      <div className="mt-1 text-[11px] text-slate-500">{compactDateTime(p.latestJoinedAt)} · {fmtSec(p.maxWatchedSeconds)}視聴</div>
                    </div>
                    <span className={`h-2.5 w-2.5 rounded-full ${p.formSubmittedAt ? 'bg-emerald-500' : p.ctaClickedAt ? 'bg-violet-500' : 'bg-slate-300'}`} />
                  </Link>
                )
              })}
            </div>
          </>
        )}
      </section>

      <details className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-5">
          <div>
            <h3 className="font-bold text-slate-900">視聴維持・回別の詳細</h3>
            <p className="mt-1 text-xs text-slate-500">必要なときだけ、離脱位置と各回の数字を確認</p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 group-open:bg-blue-50 group-open:text-blue-700">{analytics.sessions.length}回 ▾</span>
        </summary>
        <div className="grid gap-6 border-t border-slate-100 p-5 xl:grid-cols-2">
          <div>
            <h4 className="mb-3 text-sm font-semibold text-slate-800">最終視聴位置</h4>
            {analytics.dropoff.length === 0 ? (
              <p className="text-sm text-slate-400">まだ視聴データがありません</p>
            ) : analytics.dropoff.map((d) => (
              <div key={d.bucketStart} className="mb-2 flex items-center gap-2 text-xs">
                <span className="w-16 shrink-0 text-slate-500">{fmtSec(d.bucketStart)}〜</span>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-blue-500" style={{ width: `${(d.viewers / maxDropoff) * 100}%` }} />
                </div>
                <span className="w-7 text-right font-semibold text-slate-700">{d.viewers}</span>
              </div>
            ))}
          </div>
          <div className="min-w-0">
            <h4 className="mb-3 text-sm font-semibold text-slate-800">直近の開催回</h4>
            <div className="max-h-80 overflow-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[520px] text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                  <tr><th className="px-3 py-2 font-medium">開始</th><th className="font-medium">参加</th><th className="font-medium">平均視聴</th><th className="font-medium">CTA</th></tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {analytics.sessions.slice(0, 30).map((s) => (
                    <tr key={s.sessionStartAt}><td className="px-3 py-2 text-slate-700">{fmtSession(s.sessionStartAt)}</td><td>{s.viewers}</td><td>{fmtSec(s.avgWatchedSeconds)}</td><td>{s.ctaClicks} ({percent(s.ctaClicks, s.viewers)})</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </details>

      {userComments.length > 0 && (
        <details className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center justify-between p-5">
            <div><h3 className="font-bold text-slate-900">視聴者コメント</h3><p className="mt-1 text-xs text-slate-500">実際に届いたコメントを参加者の顔と一緒に確認</p></div>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{userComments.length}件 ▾</span>
          </summary>
          <div className="grid gap-3 border-t border-slate-100 p-5 md:grid-cols-2">
            {userComments.map((c) => {
              const name = c.friendName ?? `友だち ${c.friendId.slice(0, 6)}`
              return (
                <Link key={c.id} href={`/chats?friend=${c.friendId}`} className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50/60 p-3 hover:border-blue-200 hover:bg-blue-50/40">
                  <ParticipantAvatar name={name} pictureUrl={c.pictureUrl} />
                  <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-slate-800">{name}</span><span className="text-[10px] text-slate-400">{fmtSec(c.atSeconds)}</span></div><p className="mt-1 text-sm leading-6 text-slate-700">{c.body}</p></div>
                </Link>
              )
            })}
          </div>
        </details>
      )}
    </div>
  )
}

function fmtMinSec(sec: number): string {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
}

function parseMinSec(v: string): number | null {
  const m = /^(\d+):([0-5]?\d)$/.exec(v.trim())
  if (m) return Number(m[1]) * 60 + Number(m[2])
  const n = Number(v.trim())
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null
}

function CtasTab({ webinarId }: { webinarId: string }) {
  const [ctas, setCtas] = useState<WebinarCtaCard[]>([])
  const [forms, setForms] = useState<Array<{ id: string; name: string }>>([])
  const [times, setTimes] = useState<string[]>([])
  const [message, setMessage] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    // ロード失敗時に空の状態で保存すると all-or-nothing 置換で既存 CTA を消して
    // しまうため、初回 GET が成功するまで保存を無効化する
    webinarApi
      .ctas(webinarId)
      .then((res) => {
        setCtas(res.data)
        setTimes(res.data.map((c) => fmtMinSec(c.atSeconds)))
        setLoaded(true)
      })
      .catch(() => setMessage('CTAカードの読み込みに失敗しました。リロードしてください。'))
    fetchApi<{ success: boolean; data: Array<{ id: string; name: string }> }>('/api/forms')
      .then((res) => setForms(res.data.map((f) => ({ id: f.id, name: f.name }))))
      .catch(() => undefined)
  }, [webinarId])

  const update = (i: number, patch: Partial<WebinarCtaCard>) =>
    setCtas((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)))

  const save = async () => {
    setMessage(null)
    const merged: WebinarCtaCard[] = []
    for (let i = 0; i < ctas.length; i++) {
      const at = parseMinSec(times[i] ?? '')
      if (at === null) {
        setMessage(`${i + 1}行目の表示時間が不正です（例: 45:00 または秒数）`)
        return
      }
      merged.push({ ...ctas[i], atSeconds: at })
    }
    setSaving(true)
    try {
      const sorted = [...merged].sort((a, b) => a.atSeconds - b.atSeconds)
      await webinarApi.saveCtas(webinarId, sorted)
      setCtas(sorted)
      setTimes(sorted.map((c) => fmtMinSec(c.atSeconds)))
      setMessage(`${sorted.length}件保存しました`)
    } catch (err) {
      setMessage(`保存に失敗しました: ${(err as Error).message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        指定時間にチャット欄へ CTA カードが流れます。「フォーム」はウェビナー内でそのまま回答でき、
        フォーム機能のタグ付与・シナリオ発火が自動で動きます。「URL」は外部ページを開きます。
      </p>
      {message && <p className="rounded bg-blue-50 p-2 text-sm">{message}</p>}
      {ctas.map((c, i) => (
        <div key={i} className="space-y-2 rounded border border-gray-200 p-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              表示時間
              <input
                value={times[i] ?? ''}
                onChange={(e) =>
                  setTimes((prev) => prev.map((t, j) => (j === i ? e.target.value : t)))
                }
                placeholder="45:00"
                className="w-20 rounded border px-2 py-1"
              />
            </label>
            <select
              value={c.kind}
              onChange={(e) => update(i, { kind: e.target.value as 'form' | 'url' })}
              className="rounded border px-2 py-1"
            >
              <option value="form">フォーム</option>
              <option value="url">URL</option>
            </select>
            {c.kind === 'form' ? (
              <select
                value={c.formId ?? ''}
                onChange={(e) => update(i, { formId: e.target.value || null })}
                className="min-w-40 rounded border px-2 py-1"
              >
                <option value="">フォームを選択...</option>
                {forms.map((f) => (
                  <option key={f.id} value={f.id}>{f.name}</option>
                ))}
              </select>
            ) : (
              <input
                value={c.url ?? ''}
                onChange={(e) => update(i, { url: e.target.value || null })}
                placeholder="https://..."
                className="min-w-60 flex-1 rounded border px-2 py-1"
              />
            )}
            {c.kind === 'form' && (
              <label className="flex items-center gap-1">
                <input
                  type="checkbox"
                  checked={c.autoOpen}
                  onChange={(e) => update(i, { autoOpen: e.target.checked })}
                />
                自動でフォームを開く
              </label>
            )}
            <button
              onClick={() => {
                setCtas((prev) => prev.filter((_, j) => j !== i))
                setTimes((prev) => prev.filter((_, j) => j !== i))
              }}
              className="ml-auto text-red-500"
            >
              削除
            </button>
          </div>
          <input
            value={c.title}
            onChange={(e) => update(i, { title: e.target.value })}
            placeholder="カード見出し（例: 🎁 個別導入診断、受付中です）"
            className="w-full rounded border px-2 py-1 text-sm font-bold"
          />
          <input
            value={c.body ?? ''}
            onChange={(e) => update(i, { body: e.target.value || null })}
            placeholder="補足文（任意。例: この配信を見ている方限定・枠が少なめです）"
            className="w-full rounded border px-2 py-1 text-sm"
          />
          <input
            value={c.buttonLabel}
            onChange={(e) => update(i, { buttonLabel: e.target.value })}
            placeholder="ボタン文言（例: 無料で診断を受ける）"
            className="w-full rounded border px-2 py-1 text-sm"
          />
        </div>
      ))}
      <div className="flex gap-2">
        <button
          onClick={() => {
            setCtas((prev) => [...prev, {
              atSeconds: 0, kind: 'form', title: '', body: null,
              buttonLabel: '', autoOpen: false, formId: null, url: null,
            }])
            setTimes((prev) => [...prev, '0:00'])
          }}
          className="rounded border px-3 py-1 text-sm"
        >
          + CTAカード追加
        </button>
        <button
          onClick={() => void save()}
          disabled={saving || !loaded}
          className="rounded bg-blue-600 px-4 py-1 text-sm text-white disabled:opacity-50"
        >
          {saving ? '保存中...' : '保存'}
        </button>
      </div>
    </div>
  )
}

const TABS = [
  ['analytics', '概要・分析'],
  ['settings', '配信設定'],
  ['ctas', 'CTA・フォーム'],
  ['comments', 'コメント演出'],
] as const

type TabKey = (typeof TABS)[number][0]

function EditWebinarInner() {
  const id = useSearchParams().get('id')
  const [webinar, setWebinar] = useState<Webinar | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [tab, setTab] = useState<TabKey>('analytics')

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
      <Header
        title={webinar.title}
        description="参加ペースと相談フォームへの到達を、友だち単位で確認できます"
        action={
          <Link href="/webinars" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
            ← 一覧へ
          </Link>
        }
      />
      <div className="mx-auto max-w-[1400px] px-3 pb-10 sm:px-6">
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${webinar.status === 'active' ? 'bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]' : webinar.status === 'draft' ? 'bg-slate-400' : 'bg-amber-500'}`} />
            <div className="min-w-0">
              <div className="text-xs font-semibold text-slate-700">{webinar.status === 'active' ? '24時間 配信中' : webinar.status === 'draft' ? '下書き' : 'アーカイブ'}</div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-slate-400">/webinar/{webinar.slug}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="rounded-full bg-slate-100 px-2.5 py-1">動画 {fmtSec(webinar.durationSeconds)}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-1">開催ルール {webinar.schedule.length}件</span>
          </div>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="grid grid-cols-2 gap-1 border-b border-slate-200 bg-slate-50/70 p-2 sm:flex sm:gap-0 sm:overflow-x-auto sm:px-4 sm:pb-0 sm:pt-2">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`shrink-0 rounded-lg border px-2 py-2.5 text-xs font-semibold transition-colors sm:rounded-b-none sm:rounded-t-xl sm:border-x-0 sm:border-t-0 sm:border-b-2 sm:px-5 sm:py-3 sm:text-sm ${
                  tab === key
                    ? 'border-blue-200 bg-blue-50 text-blue-700 sm:border-b-blue-600 sm:bg-white sm:shadow-[0_-1px_0_0_rgba(226,232,240,1)]'
                    : 'border-transparent text-slate-500 hover:bg-white/70 hover:text-slate-800'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="bg-slate-50/40 p-4 sm:p-6 xl:p-8">
            {tab === 'settings' && <WebinarForm initial={webinar} />}
            {tab === 'comments' && <CommentsTab webinarId={webinar.id} />}
            {tab === 'ctas' && <CtasTab webinarId={webinar.id} />}
            {tab === 'analytics' && <AnalyticsTab webinarId={webinar.id} durationSeconds={webinar.durationSeconds} />}
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
