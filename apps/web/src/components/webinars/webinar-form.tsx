'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { webinarApi, type Webinar, type WebinarInput, type WebinarScheduleRule } from '@/lib/api'

const DAYS = ['日', '月', '火', '水', '木', '金', '土']

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const labelClass = 'block text-sm font-medium text-gray-700 mb-1.5'

function timeToMinutes(value: string): number {
  const [hours, minutes] = value.split(':').map(Number)
  return (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0)
}

function minutesToTime(value: number): string {
  const normalized = ((value % 1440) + 1440) % 1440
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')}`
}

function inferDailySchedule(rules: WebinarScheduleRule[]): { start: string; end: string; interval: number } {
  const times = rules
    .filter((rule) => rule.type === 'daily' && rule.time)
    .map((rule) => rule.time as string)
    .sort((a, b) => timeToMinutes(a) - timeToMinutes(b))
  const intervals = times.slice(1).map((time, index) => timeToMinutes(time) - timeToMinutes(times[index]))
  const interval = intervals.length > 0 && intervals.every((value) => value === intervals[0]) ? intervals[0] : 30
  return { start: times[0] ?? '00:00', end: times[times.length - 1] ?? '23:30', interval: interval > 0 ? interval : 30 }
}

export interface WebinarFormProps {
  initial?: Webinar
}

export default function WebinarForm({ initial }: WebinarFormProps) {
  const router = useRouter()
  const [title, setTitle] = useState(initial?.title ?? '')
  const [slug, setSlug] = useState(initial?.slug ?? '')
  const [status, setStatus] = useState<Webinar['status']>(initial?.status ?? 'draft')
  const [videoPrefix, setVideoPrefix] = useState(initial?.videoPrefix ?? '')
  const [durationMinutes, setDurationMinutes] = useState(
    initial ? Math.round(initial.durationSeconds / 60) : 120,
  )
  const [rules, setRules] = useState<WebinarScheduleRule[]>(initial?.schedule ?? [])
  const initialDaily = inferDailySchedule(initial?.schedule ?? [])
  const [bulkStart, setBulkStart] = useState(initialDaily.start)
  const [bulkEnd, setBulkEnd] = useState(initialDaily.end)
  const [bulkInterval, setBulkInterval] = useState(initialDaily.interval)
  const [ctaEnabled, setCtaEnabled] = useState(Boolean(initial?.cta))
  const [ctaLabel, setCtaLabel] = useState(initial?.cta?.label ?? '今すぐ申し込む')
  const [ctaUrl, setCtaUrl] = useState(initial?.cta?.url ?? '')
  const [ctaShowMinutes, setCtaShowMinutes] = useState(
    initial?.cta ? Math.round(initial.cta.showAtSeconds / 60) : 90,
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateRule = (i: number, patch: Partial<WebinarScheduleRule>) =>
    setRules((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))

  const applyDailySchedule = () => {
    const start = timeToMinutes(bulkStart)
    const end = timeToMinutes(bulkEnd)
    if (end < start || bulkInterval <= 0) {
      setError('一括設定の開始・終了時間を確認してください')
      return
    }
    const generated: WebinarScheduleRule[] = []
    for (let minute = start; minute <= end; minute += bulkInterval) {
      generated.push({ type: 'daily', time: minutesToTime(minute) })
    }
    setRules((prev) => [...prev.filter((rule) => rule.type !== 'daily'), ...generated])
    setError(null)
  }

  const dailyRules = rules.filter((rule) => rule.type === 'daily' && rule.time)
  const dailyOverview = inferDailySchedule(rules)
  const nonDailyCount = rules.length - dailyRules.length

  const save = async () => {
    setSaving(true)
    setError(null)
    const input: WebinarInput = {
      title,
      slug,
      status,
      videoPrefix: videoPrefix.trim() || null,
      durationSeconds: durationMinutes * 60,
      schedule: rules,
      cta: ctaEnabled
        ? { label: ctaLabel, url: ctaUrl, showAtSeconds: ctaShowMinutes * 60 }
        : null,
    }
    try {
      if (initial) {
        await webinarApi.update(initial.id, input)
        router.push('/webinars')
      } else {
        const created = await webinarApi.create(input)
        router.push(`/webinars/edit?id=${created.data.id}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setSaving(false)
    }
  }

  return (
    <div className="max-w-4xl space-y-5">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div><h2 className="font-bold text-slate-900">基本情報</h2><p className="mt-1 text-xs text-slate-500">普段変更する項目だけを表示しています</p></div>
        <div>
          <label className={labelClass}>タイトル</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>状態</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as Webinar['status'])}
            className={`${inputClass} w-auto`}
          >
            <option value="draft">下書き</option>
            <option value="active">公開中</option>
            <option value="archived">アーカイブ</option>
          </select>
        </div>
        <div>
          <label className={labelClass}>動画の長さ（分）</label>
          <input
            type="number"
            value={durationMinutes}
            min={1}
            onChange={(e) => setDurationMinutes(Number(e.target.value))}
            className={`${inputClass} w-32`}
          />
        </div>
        <details className="group rounded-xl border border-slate-200 bg-slate-50/60">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-slate-700">
            URL・動画ファイルの詳細設定
            <span className="text-xs text-slate-400 group-open:rotate-180">▾</span>
          </summary>
          <div className="space-y-4 border-t border-slate-200 p-4">
            <div>
              <label className={labelClass}>slug（URL 用・半角英数とハイフン）</label>
              <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="my-seminar" className={`${inputClass} font-mono text-xs`} />
            </div>
            <div>
              <label className={labelClass}>動画 R2 プレフィックス</label>
              <input value={videoPrefix} onChange={(e) => setVideoPrefix(e.target.value)} className={`${inputClass} font-mono text-xs`} />
            </div>
          </div>
        </details>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div><h2 className="font-bold text-slate-900">開催スケジュール</h2><p className="mt-1 text-xs text-slate-500">日本時間・参加画面には直近の候補だけを表示します</p></div>
            <span className="w-fit rounded-full bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">{rules.length}枠</span>
          </div>
          {dailyRules.length > 0 ? (
            <div className="mt-4 flex flex-col gap-1 rounded-xl border border-blue-100 bg-gradient-to-r from-blue-50 to-cyan-50 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm font-bold text-slate-900">毎日 {dailyOverview.start}〜{dailyOverview.end}</div>
              <div className="text-xs font-medium text-slate-600">{dailyOverview.interval}分間隔 · {dailyRules.length}枠{nonDailyCount > 0 ? ` ＋ 個別${nonDailyCount}枠` : ''}</div>
            </div>
          ) : (
            <div className="mt-4 rounded-xl bg-amber-50 p-4 text-sm text-amber-700">毎日の配信枠は未設定です</div>
          )}
        </div>

        <details className="group border-t border-slate-200">
          <summary className="flex cursor-pointer list-none items-center justify-between px-5 py-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 sm:px-6">
            枠を一括設定・個別編集する
            <span className="text-xs text-slate-400 group-open:rotate-180">▾</span>
          </summary>
          <div className="space-y-4 border-t border-slate-100 bg-slate-50/50 p-4 sm:p-6">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="mb-3 text-xs font-bold text-slate-700">毎日の枠をまとめて作成</div>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-xs text-slate-500">開始<input type="time" value={bulkStart} onChange={(e) => setBulkStart(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-2 py-2 text-sm" /></label>
                <label className="text-xs text-slate-500">終了<input type="time" value={bulkEnd} onChange={(e) => setBulkEnd(e.target.value)} className="mt-1 block rounded-lg border border-slate-300 px-2 py-2 text-sm" /></label>
                <label className="text-xs text-slate-500">間隔<select value={bulkInterval} onChange={(e) => setBulkInterval(Number(e.target.value))} className="mt-1 block rounded-lg border border-slate-300 px-2 py-2 text-sm"><option value={30}>30分</option><option value={60}>60分</option><option value={120}>120分</option></select></label>
                <button type="button" onClick={applyDailySchedule} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800">毎日の枠を置き換える</button>
              </div>
              <p className="mt-2 text-[11px] text-slate-400">下の保存ボタンを押すまでは本番へ反映されません。</p>
            </div>
            <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
        {rules.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 p-2 text-sm">
            <select
              value={r.type}
              onChange={(e) => {
                const type = e.target.value as WebinarScheduleRule['type']
                updateRule(
                  i,
                  type === 'once'
                    ? { type, time: undefined, days: undefined, at: '' }
                    : { type, time: r.time ?? '20:00', days: type === 'weekly' ? [] : undefined, at: undefined },
                )
              }}
              className="rounded-lg border border-gray-300 px-2 py-1"
            >
              <option value="daily">毎日</option>
              <option value="weekly">毎週</option>
              <option value="once">単発</option>
            </select>
            {r.type === 'weekly' &&
              DAYS.map((d, di) => (
                <label key={di} className="flex items-center gap-0.5">
                  <input
                    type="checkbox"
                    checked={r.days?.includes(di) ?? false}
                    onChange={(e) =>
                      updateRule(i, {
                        days: e.target.checked
                          ? [...(r.days ?? []), di]
                          : (r.days ?? []).filter((x) => x !== di),
                      })
                    }
                  />
                  {d}
                </label>
              ))}
            {r.type === 'once' ? (
              <input
                type="datetime-local"
                value={(r.at ?? '').slice(0, 16)}
                onChange={(e) => updateRule(i, { at: `${e.target.value}:00+09:00` })}
                className="rounded-lg border border-gray-300 px-2 py-1"
              />
            ) : (
              <input
                type="time"
                value={r.time ?? '20:00'}
                onChange={(e) => updateRule(i, { time: e.target.value })}
                className="rounded-lg border border-gray-300 px-2 py-1"
              />
            )}
            <button
              onClick={() => setRules((prev) => prev.filter((_, j) => j !== i))}
              className="ml-auto text-red-500 hover:text-red-600"
            >
              削除
            </button>
          </div>
        ))}
            </div>
        <button
          onClick={() => setRules((prev) => [...prev, { type: 'daily', time: '20:00' }])}
          className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          ＋ ルール追加
        </button>
          </div>
        </details>
      </section>

      <details className="group overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <summary className="flex cursor-pointer list-none items-center justify-between p-5 text-sm font-bold text-slate-900 sm:p-6">従来CTAボタンの設定<span className="text-xs text-slate-400 group-open:rotate-180">▾</span></summary>
        <section className="space-y-3 border-t border-slate-200 p-5 sm:p-6">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" checked={ctaEnabled} onChange={(e) => setCtaEnabled(e.target.checked)} />
          CTA ボタンを表示する
        </label>
        {ctaEnabled && (
          <>
            <div>
              <label className={labelClass}>ボタン文言</label>
              <input value={ctaLabel} onChange={(e) => setCtaLabel(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>決済ページ URL</label>
              <input
                value={ctaUrl}
                onChange={(e) => setCtaUrl(e.target.value)}
                placeholder="https://..."
                className={inputClass}
              />
            </div>
            <div>
              <label className={labelClass}>表示開始（開始から何分後）</label>
              <input
                type="number"
                value={ctaShowMinutes}
                min={0}
                onChange={(e) => setCtaShowMinutes(Number(e.target.value))}
                className={`${inputClass} w-32`}
              />
            </div>
          </>
        )}
        </section>
      </details>

      <div className="sticky bottom-3 z-10 flex items-center justify-between rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur">
        <span className="hidden text-xs text-slate-500 sm:block">変更内容を確認して本番へ反映します</span>
        <button onClick={() => void save()} disabled={saving} className="ml-auto rounded-xl bg-blue-600 px-6 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-blue-700 disabled:opacity-50">{saving ? '保存中...' : '変更を保存'}</button>
      </div>
    </div>
  )
}
