'use client'

// 軌道（朝活）の「二次審査」タブ：一次を通した人を、いまどの段階にいるかで分けて並べる。
// 段階は印（軌_1次通過 など）で決まり、残り時間は印が付いた日時から数える。
// 見るだけの画面。印を付ける操作は今までどおり友だち管理・個別チャットから。
import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { isAsakatsuAccount } from '@/lib/account-look'
import Header from '@/components/layout/header'

// 入会審査フォーム（一次審査の応募フォーム）
const APPLY_FORM_ID = '1908512a-d899-44ca-a250-782de16bf49c'
// 予約の受付は一次通過から72時間、支払いは支払いの案内から48時間（審査後の流れの配信と同じ）
const BOOKING_HOURS = 72
const PAY_HOURS = 48

const TAG_NAMES = {
  passed1: '軌_1次通過',
  booked: '軌_面談予約済み',
  passed: '軌_合格',
  payNotice: '軌_決済案内済み',
  paid: '軌_決済済み',
  failed: '軌_不合格',
  expired: '軌_審査終了_予約期限切れ',
} as const
type TagKey = keyof typeof TAG_NAMES

interface Tag { id: string; name: string }
interface ScreeningRow {
  id: string
  displayName: string | null
  pictureUrl: string | null
  isFollowing: boolean
  tags: Record<string, string>
}
interface Submission {
  id: string
  friendId: string | null
  data: Record<string, unknown>
  createdAt: string
}
interface FormField { name: string; label: string }

type Stage = 'waiting' | 'booked' | 'paying' | 'joined' | 'ended'

interface Person {
  id: string
  name: string
  pictureUrl: string | null
  isFollowing: boolean
  stage: Stage
  at: Partial<Record<TagKey, Date>>
}

const STAGES: { key: Stage; label: string; note: string }[] = [
  { key: 'waiting', label: '予約待ち', note: '一次通過の印があり、まだ面談を予約していない人' },
  { key: 'booked', label: '予約済み', note: '面談の予約を済ませた人（日時は TimeRex で確認）' },
  { key: 'paying', label: '合格・支払い待ち', note: '合格の印を付けて、まだ支払っていない人' },
  { key: 'joined', label: '入会済み', note: '支払いまで終わった人' },
  { key: 'ended', label: '終了', note: '不合格の人と、予約期限が切れた人' },
]

/** 印の日時は「+09:00 付き」と「時差なし（日本時間）」の2通りがあるので、どちらも日本時間として読む */
function parseJst(s: string): Date {
  return new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : `${s}+09:00`)
}

function formatDateTime(d: Date): string {
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

/** 期限までの残り時間。過ぎていれば「期限切れ」 */
function remaining(from: Date, hours: number, now: number): { text: string; urgent: boolean; over: boolean } {
  const left = from.getTime() + hours * 3600e3 - now
  if (left <= 0) return { text: '期限切れ', urgent: true, over: true }
  const h = Math.floor(left / 3600e3)
  const m = Math.floor((left % 3600e3) / 60000)
  return { text: h > 0 ? `残り${h}時間${m}分` : `残り${m}分`, urgent: h < 24, over: false }
}

function stageOf(has: (k: TagKey) => boolean): Stage | null {
  if (has('failed') || has('expired')) return 'ended'
  if (has('passed') && has('paid')) return 'joined'
  if (has('passed')) return 'paying'
  if (has('booked')) return 'booked'
  if (has('passed1')) return 'waiting'
  return null
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export default function ScreeningPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [people, setPeople] = useState<Person[]>([])
  const [answers, setAnswers] = useState<Map<string, Submission>>(new Map())
  const [fieldLabels, setFieldLabels] = useState<FormField[]>([])
  const [missingTags, setMissingTags] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stage, setStage] = useState<Stage>('waiting')
  const [detail, setDetail] = useState<Person | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // 残り時間を1分ごとに数え直す
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000)
    return () => clearInterval(t)
  }, [])

  const load = useCallback(async (accountId: string) => {
    setLoading(true)
    setError(null)
    try {
      const tagRes = await fetchApi<{ success: boolean; data: Tag[] }>('/api/tags')
      const idOf = {} as Partial<Record<TagKey, string>>
      const missing: string[] = []
      for (const [key, name] of Object.entries(TAG_NAMES) as [TagKey, string][]) {
        const tag = tagRes.data.find((t) => t.name === name)
        if (tag) idOf[key] = tag.id
        else missing.push(name)
      }
      setMissingTags(missing)
      const ids = Object.values(idOf)
      const [rowsRes, formRes, subRes] = await Promise.all([
        fetchApi<{ success: boolean; data: ScreeningRow[] }>(
          `/api/screening?lineAccountId=${encodeURIComponent(accountId)}&tagIds=${ids.map(encodeURIComponent).join(',')}`,
        ),
        fetchApi<{ success: boolean; data: { fields: string | FormField[] } }>(`/api/forms/${APPLY_FORM_ID}`).catch(() => null),
        fetchApi<{ success: boolean; data: Submission[] }>(`/api/forms/${APPLY_FORM_ID}/submissions`).catch(() => null),
      ])
      if (!rowsRes.success) throw new Error('読み込みに失敗しました')

      const list: Person[] = []
      for (const r of rowsRes.data) {
        const at: Partial<Record<TagKey, Date>> = {}
        for (const key of Object.keys(TAG_NAMES) as TagKey[]) {
          const id = idOf[key]
          if (id && r.tags[id]) at[key] = parseJst(r.tags[id])
        }
        const s = stageOf((k) => !!at[k])
        if (!s) continue
        list.push({ id: r.id, name: r.displayName || '名前なし', pictureUrl: r.pictureUrl, isFollowing: r.isFollowing, stage: s, at })
      }
      setPeople(list)

      if (formRes?.success) {
        const raw = formRes.data.fields
        setFieldLabels(typeof raw === 'string' ? (JSON.parse(raw) as FormField[]) : raw ?? [])
      }
      const map = new Map<string, Submission>()
      if (subRes?.success) {
        // 同じ人が何度か送っていれば、いちばん新しい回答を見せる
        const subs = subRes.data
          .map((s) => ({ ...s, data: typeof s.data === 'string' ? JSON.parse(s.data as unknown as string) : s.data }))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        for (const s of subs) if (s.friendId) map.set(s.friendId, s)
      }
      setAnswers(map)
    } catch (e) {
      setError(e instanceof Error ? e.message : '読み込みに失敗しました')
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    if (selectedAccountId) load(selectedAccountId)
  }, [selectedAccountId, load])

  const counts = useMemo(() => {
    const c: Record<Stage, number> = { waiting: 0, booked: 0, paying: 0, joined: 0, ended: 0 }
    for (const p of people) c[p.stage]++
    return c
  }, [people])

  // 新しく動いた人を上に（その段階に入った日時の新しい順）
  const shown = useMemo(() => {
    const keyDate = (p: Person): number => {
      const d =
        p.stage === 'waiting' ? p.at.passed1
        : p.stage === 'booked' ? p.at.booked
        : p.stage === 'paying' ? (p.at.payNotice ?? p.at.passed)
        : p.stage === 'joined' ? (p.at.paid ?? p.at.passed)
        : (p.at.failed ?? p.at.expired)
      return d?.getTime() ?? 0
    }
    const list = people.filter((p) => p.stage === stage)
    // 期限のある段階は、期限が近い人を上に
    if (stage === 'waiting' || stage === 'paying') return list.sort((a, b) => keyDate(a) - keyDate(b))
    return list.sort((a, b) => keyDate(b) - keyDate(a))
  }, [people, stage])

  if (selectedAccount && !isAsakatsuAccount(selectedAccount)) {
    return (
      <div>
        <Header title="二次審査" />
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">
          この画面は軌道（朝活）の LINE 専用です。左上で軌道の LINE を選んでください。
        </div>
      </div>
    )
  }

  return (
    <div>
      <Header title="二次審査" description="一次を通した人を、いまの段階ごとに確認（面談の日時は TimeRex で確認）" />

      {missingTags.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          見つからない印があります：{missingTags.join('、')}（名前が変わっていないか確認してください）
        </div>
      )}

      {/* 段階の切り替え */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-5">
        {STAGES.map((s) => {
          const active = stage === s.key
          return (
            <button
              key={s.key}
              onClick={() => setStage(s.key)}
              className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                active ? 'border-[#06C755] bg-[#F1FBF5]' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className={`text-xs font-semibold ${active ? 'text-[#06C755]' : 'text-gray-600'}`}>{s.label}</div>
              <div className="text-2xl font-bold text-gray-900 tabular-nums">{loading ? '–' : counts[s.key]}</div>
            </button>
          )
        })}
      </div>

      <p className="text-xs text-gray-400 mb-3">{STAGES.find((s) => s.key === stage)?.note}</p>

      {error ? (
        <div className="bg-white rounded-lg border border-red-200 p-8 text-center text-red-500 text-sm">{error}</div>
      ) : loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">読み込み中...</div>
      ) : shown.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400 text-sm">該当する人はいません</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">名前</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">日時</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap">期限・状態</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 whitespace-nowrap"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {shown.map((p) => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      {p.pictureUrl ? (
                        <img src={p.pictureUrl} alt="" className="w-7 h-7 rounded-full object-cover" />
                      ) : (
                        <div className="w-7 h-7 rounded-full bg-gray-200" />
                      )}
                      <span>{p.name}</span>
                      {!p.isFollowing && <span className="text-[11px] text-red-500">ブロック中</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                    <StageDates p={p} />
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    <StageStatus p={p} now={now} />
                  </td>
                  <td className="px-4 py-3 text-xs whitespace-nowrap text-right">
                    <button onClick={() => setDetail(p)} className="text-gray-600 hover:text-gray-900 hover:underline mr-4">
                      一次の回答を見る
                    </button>
                    <Link href={`/chats?friend=${encodeURIComponent(p.id)}`} className="text-[#06C755] hover:underline">
                      LINE でやりとりする
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 一次の回答 */}
      {detail && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div className="absolute inset-0 bg-black/30" onClick={() => setDetail(null)} aria-hidden />
          <aside className="relative h-full w-full max-w-md bg-white shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">{detail.name} さんの一次の回答</h3>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none" aria-label="閉じる">
                ×
              </button>
            </div>
            <div className="p-5 space-y-5">
              <Link href={`/chats?friend=${encodeURIComponent(detail.id)}`} className="inline-block text-sm text-[#06C755] hover:underline">
                LINE でやりとりする →
              </Link>
              {(() => {
                const sub = answers.get(detail.id)
                if (!sub) return <div className="text-sm text-gray-400">応募フォームの回答が見つかりません</div>
                const keys = fieldLabels.length > 0 ? fieldLabels.map((f) => f.name) : Object.keys(sub.data)
                return (
                  <>
                    <div>
                      <div className="text-[11px] text-gray-400 mb-1">送信日時</div>
                      <div className="text-sm text-gray-700">{formatDateTime(parseJst(sub.createdAt))}</div>
                    </div>
                    <dl className="space-y-3">
                      {keys.map((k) => (
                        <div key={k} className="grid grid-cols-1 gap-1">
                          <dt className="text-[11px] text-gray-500">{fieldLabels.find((f) => f.name === k)?.label || k}</dt>
                          <dd className="text-sm text-gray-900 break-words whitespace-pre-wrap">{formatValue(sub.data[k])}</dd>
                        </div>
                      ))}
                    </dl>
                  </>
                )
              })()}
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}

function StageDates({ p }: { p: Person }) {
  const line = (label: string, d?: Date) =>
    d ? (
      <div>
        <span className="text-gray-400">{label}</span> {formatDateTime(d)}
      </div>
    ) : null
  switch (p.stage) {
    case 'waiting':
      return line('一次通過', p.at.passed1)
    case 'booked':
      return <>{line('予約', p.at.booked)}{line('一次通過', p.at.passed1)}</>
    case 'paying':
      return line('合格', p.at.passed)
    case 'joined':
      return <>{line('支払い', p.at.paid)}{line('合格', p.at.passed)}</>
    case 'ended':
      return line(p.at.failed ? '不合格' : '期限切れ', p.at.failed ?? p.at.expired)
  }
}

function StageStatus({ p, now }: { p: Person; now: number }) {
  if (p.stage === 'waiting' && p.at.passed1) {
    const r = remaining(p.at.passed1, BOOKING_HOURS, now)
    return <span className={r.urgent ? 'text-red-600 font-semibold' : 'text-gray-700'}>予約期限 {r.text}</span>
  }
  if (p.stage === 'paying') {
    const from = p.at.payNotice
    if (!from) return <span className="text-amber-600">支払いの案内がまだ送られていません</span>
    const r = remaining(from, PAY_HOURS, now)
    return <span className={r.urgent ? 'text-red-600 font-semibold' : 'text-gray-700'}>支払い期限 {r.text}</span>
  }
  if (p.stage === 'ended') {
    if (p.at.failed) return <span className="text-gray-600">不合格（{p.at.passed1 ? '二次' : '一次'}）</span>
    return <span className="text-gray-600">予約期限切れ</span>
  }
  if (p.stage === 'booked') return <span className="text-gray-700">面談待ち</span>
  return <span className="text-gray-700">入会済み</span>
}
