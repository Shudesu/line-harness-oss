'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { webinarApi, type Webinar, type WebinarInput, type WebinarScheduleRule } from '@/lib/api'

const DAYS = ['日', '月', '火', '水', '木', '金', '土']

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const labelClass = 'block text-sm font-medium text-gray-700 mb-1.5'

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
    <div className="max-w-2xl space-y-6">
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-4">
        <h2 className="font-semibold text-gray-900">基本情報</h2>
        <div>
          <label className={labelClass}>タイトル</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>slug（URL 用・半角英数とハイフン）</label>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="my-seminar"
            className={`${inputClass} font-mono text-xs`}
          />
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
        <div>
          <label className={labelClass}>
            動画 R2 プレフィックス（encode-webinar.sh の出力。例: webinars/my-seminar）
          </label>
          <input
            value={videoPrefix}
            onChange={(e) => setVideoPrefix(e.target.value)}
            className={`${inputClass} font-mono text-xs`}
          />
        </div>
      </section>

      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-3">
        <h2 className="font-semibold text-gray-900">開催スケジュール（日本時間）</h2>
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
        <button
          onClick={() => setRules((prev) => [...prev, { type: 'daily', time: '20:00' }])}
          className="px-3 py-1.5 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50"
        >
          ＋ ルール追加
        </button>
      </section>

      <section className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 space-y-3">
        <h2 className="font-semibold text-gray-900">CTA（決済ページ誘導）</h2>
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

      <button
        onClick={() => void save()}
        disabled={saving}
        className="px-6 py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? '保存中...' : '保存'}
      </button>
    </div>
  )
}
