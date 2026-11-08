'use client'

// KIDOUインターンの数字。友だちの増減・ブロック・アンケートの進み具合・メニューのボタンの押された回数
import { useEffect, useState } from 'react'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'

interface FunnelRow {
  key: string
  label: string
  count: number
  blocked: number
}

interface DailyRow {
  date: string
  newFriends: number
  blocks: number
  surveyDone: number
}

interface MenuButtonRow {
  menu: 'locked' | 'unlocked'
  menuName: string
  label: string
  kind: 'postback' | 'uri' | 'other'
  count: number | null
  countInPeriod: number | null
  countFrom: string | null
}

interface InternStats {
  days: number
  excludedMembers: number
  since: string
  totals: { friends: number; following: number; blocked: number; surveyDone: number }
  funnel: FunnelRow[]
  daily: DailyRow[]
  blockAfter: { label: string; count: number }[]
  blockLogStartedAt: string | null
  blocksWithoutTime: number
  menuButtons: MenuButtonRow[]
}

const PERIODS = [7, 14, 30, 90]

function percent(n: number, base: number) {
  if (!base) return '—'
  return `${Math.round((n / base) * 1000) / 10}%`
}

function formatDay(date: string) {
  const w = new Date(`${date}T12:00:00+09:00`).toLocaleDateString('ja-JP', { weekday: 'short', timeZone: 'Asia/Tokyo' })
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}（${w}）`
}

function formatDateTime(value: string | null) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
}

function Bar({ value, max, color }: { value: number; max: number; color: string }) {
  const width = max > 0 ? Math.max(value > 0 ? 4 : 0, Math.round((value / max) * 100)) : 0
  return (
    <div className="h-2 w-full rounded bg-gray-100">
      <div className="h-2 rounded" style={{ width: `${width}%`, backgroundColor: color }} />
    </div>
  )
}

function StatTile({ label, value, sub }: { label: string; value: number; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums text-gray-900">{value.toLocaleString()}</p>
      {sub && <p className="mt-1 text-xs text-gray-500">{sub}</p>}
    </div>
  )
}

export default function InternStatsPage() {
  const [days, setDays] = useState(30)
  const [data, setData] = useState<InternStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await fetchApi<{ success: boolean; data?: InternStats; error?: string }>(`/api/intern/stats?days=${days}`)
        if (cancelled) return
        if (res.success && res.data) setData(res.data)
        else setError(res.error ?? '読み込めませんでした')
      } catch {
        if (!cancelled) setError('読み込めませんでした。時間をおいてもう一度お試しください')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [days])

  const daily = data ? [...data.daily].reverse() : []
  const dailyMax = data ? Math.max(1, ...data.daily.map((d) => Math.max(d.newFriends, d.blocks, d.surveyDone))) : 1
  const periodSum = data
    ? data.daily.reduce(
        (acc, d) => ({ newFriends: acc.newFriends + d.newFriends, blocks: acc.blocks + d.blocks, surveyDone: acc.surveyDone + d.surveyDone }),
        { newFriends: 0, blocks: 0, surveyDone: 0 },
      )
    : null
  const funnelBase = data?.funnel[0]?.count ?? 0
  const blockAfterTotal = data ? data.blockAfter.reduce((n, b) => n + b.count, 0) : 0

  return (
    <div>
      <Header
        title="数字"
        description="KIDOUインターンの友だちの増え方・ブロック・アンケートの進み具合・メニューのボタンの押された回数です。経路ごとの数字は「友だち追加リンク」にあります。"
      />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <span className="text-sm text-gray-600">期間</span>
        {PERIODS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setDays(p)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
              days === p ? 'border-green-600 bg-green-600 text-white' : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
            }`}
          >
            直近{p}日
          </button>
        ))}
      </div>

      {loading && !data && <p className="text-sm text-gray-500">読み込んでいます…</p>}
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {data && periodSum && (
        <div className={`space-y-6 ${loading ? 'opacity-60' : ''}`}>
          {/* 合計 */}
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="友だちになった人（これまで）" value={data.totals.friends} sub={`直近${data.days}日：${periodSum.newFriends}人`} />
            <StatTile label="いまも友だち" value={data.totals.following} sub={percent(data.totals.following, data.totals.friends)} />
            <StatTile label="ブロック中" value={data.totals.blocked} sub={`直近${data.days}日のブロック：${periodSum.blocks}件`} />
            <StatTile label="アンケート回答完了" value={data.totals.surveyDone} sub={`友だちの ${percent(data.totals.surveyDone, data.totals.friends)}`} />
          </section>

          {/* アンケートの進み具合 */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-1 text-base font-bold text-gray-900">アンケートの進み具合</h2>
            <p className="mb-4 text-sm text-gray-500">これまでに友だちになった人が、どこまで進んだかです（期間に関係なく全員）。前の段より大きく減っているところで人が抜けています。{data.excludedMembers > 0 && `事業メンバー${data.excludedMembers}人は数えていません。`}</p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                    <th className="py-2 pr-4 font-medium">段階</th>
                    <th className="py-2 pr-4 text-right font-medium">人数</th>
                    <th className="py-2 pr-4 text-right font-medium">友だちのうち</th>
                    <th className="py-2 pr-4 text-right font-medium">前の段から</th>
                    <th className="py-2 pr-4 text-right font-medium">うちブロック中</th>
                    <th className="w-1/4 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {data.funnel.map((f, i) => (
                    <tr key={f.key} className="border-b border-gray-100">
                      <td className="py-3 pr-4 text-gray-900">{f.label}</td>
                      <td className="py-3 pr-4 text-right font-bold tabular-nums text-gray-900">{f.count}</td>
                      <td className="py-3 pr-4 text-right tabular-nums text-gray-600">{percent(f.count, funnelBase)}</td>
                      <td className="py-3 pr-4 text-right tabular-nums text-gray-600">{i === 0 ? '—' : percent(f.count, data.funnel[i - 1].count)}</td>
                      <td className="py-3 pr-4 text-right tabular-nums text-gray-600">{f.blocked}</td>
                      <td className="py-3">
                        <Bar value={f.count} max={funnelBase} color="#06C755" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 日ごと */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-1 text-base font-bold text-gray-900">日ごとの推移</h2>
            <p className="mb-4 text-sm text-gray-500">
              日本時間の日付ごとです。「友だち追加」は初めて友だちになった人（ブロック解除で戻った人は入りません）。
              ブロックは {data.blockLogStartedAt ? `${formatDateTime(data.blockLogStartedAt)} から` : 'この画面を入れた日から'}記録しています。
              {data.excludedMembers > 0 && `事業メンバー${data.excludedMembers}人は数えていません。`}
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                    <th className="py-2 pr-4 font-medium">日付</th>
                    <th className="py-2 pr-2 text-right font-medium">友だち追加</th>
                    <th className="w-1/6 py-2 pr-4 font-medium"></th>
                    <th className="py-2 pr-2 text-right font-medium">ブロック</th>
                    <th className="w-1/6 py-2 pr-4 font-medium"></th>
                    <th className="py-2 pr-2 text-right font-medium">回答完了</th>
                    <th className="w-1/6 py-2 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-gray-200 bg-gray-50 font-bold">
                    <td className="py-2 pr-4 text-gray-900">直近{data.days}日の合計</td>
                    <td className="py-2 pr-2 text-right tabular-nums">{periodSum.newFriends}</td>
                    <td className="py-2 pr-4"></td>
                    <td className="py-2 pr-2 text-right tabular-nums">{periodSum.blocks}</td>
                    <td className="py-2 pr-4"></td>
                    <td className="py-2 pr-2 text-right tabular-nums">{periodSum.surveyDone}</td>
                    <td className="py-2"></td>
                  </tr>
                  {daily.map((d) => (
                    <tr key={d.date} className="border-b border-gray-100">
                      <td className="py-2 pr-4 text-gray-700">{formatDay(d.date)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-gray-900">{d.newFriends}</td>
                      <td className="py-2 pr-4"><Bar value={d.newFriends} max={dailyMax} color="#06C755" /></td>
                      <td className="py-2 pr-2 text-right tabular-nums text-gray-900">{d.blocks}</td>
                      <td className="py-2 pr-4"><Bar value={d.blocks} max={dailyMax} color="#DC2626" /></td>
                      <td className="py-2 pr-2 text-right tabular-nums text-gray-900">{d.surveyDone}</td>
                      <td className="py-2"><Bar value={d.surveyDone} max={dailyMax} color="#2563EB" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* ブロックまでの日数 */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-1 text-base font-bold text-gray-900">友だち追加から何日目にブロックしたか</h2>
            <p className="mb-4 text-sm text-gray-500">
              友だちになった日を1日目と数えます（期間に関係なく、記録のあるブロック全部）。ブロック解除して戻った人がまたブロックしたときは、戻った日から数えます。
              {data.blocksWithoutTime > 0 && ` 記録を始める前にブロックした ${data.blocksWithoutTime} 人は日時が分からないため入っていません。`}
            </p>
            {blockAfterTotal === 0 ? (
              <p className="text-sm text-gray-500">まだ記録のあるブロックはありません。</p>
            ) : (
              <table className="w-full max-w-xl text-sm">
                <tbody>
                  {data.blockAfter.map((b) => (
                    <tr key={b.label} className="border-b border-gray-100">
                      <td className="w-32 py-2 pr-4 text-gray-700">{b.label}</td>
                      <td className="w-16 py-2 pr-4 text-right tabular-nums font-bold text-gray-900">{b.count}</td>
                      <td className="w-16 py-2 pr-4 text-right tabular-nums text-gray-600">{percent(b.count, blockAfterTotal)}</td>
                      <td className="py-2"><Bar value={b.count} max={blockAfterTotal} color="#DC2626" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>

          {/* メニューのボタン */}
          <section className="rounded-lg border border-gray-200 bg-white p-6">
            <h2 className="mb-1 text-base font-bold text-gray-900">メニューのボタンが押された回数</h2>
            <p className="mb-4 text-sm text-gray-500">
              リッチメニュー画面で「答える前」「答えた後」に選んでいるメニューのボタンです。同じ人が何度押しても1回ずつ数えます。
              ページを開くボタン（マイページなど）は、押した記録が LINE から届かないため数えられません。
            </p>
            {data.menuButtons.length === 0 ? (
              <p className="text-sm text-gray-500">リッチメニュー画面で、答える前・答えた後のメニューがまだ選ばれていません。</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                      <th className="py-2 pr-4 font-medium">メニュー</th>
                      <th className="py-2 pr-4 font-medium">ボタン</th>
                      <th className="py-2 pr-4 text-right font-medium">直近{data.days}日</th>
                      <th className="py-2 text-right font-medium">これまで</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.menuButtons.map((b, i) => (
                      <tr key={`${b.menu}-${i}`} className="border-b border-gray-100">
                        <td className="py-2 pr-4 text-gray-600">
                          {b.menu === 'locked' ? '答える前' : '答えた後'}
                          <span className="ml-1 text-xs text-gray-400">（{b.menuName}）</span>
                        </td>
                        <td className="py-2 pr-4 text-gray-900">
                          {b.label}
                          {b.countFrom && (
                            <span className="mt-0.5 block text-xs text-gray-400">
                              {formatDateTime(b.countFrom)} から数えています（それより前は回答カードの［ほかの質問を見る］と見分けられないため）
                            </span>
                          )}
                        </td>
                        {b.count === null ? (
                          <td colSpan={2} className="py-2 text-right text-xs text-gray-400">
                            {b.kind === 'uri' ? 'ページを開くボタンのため数えられません' : '数えていません'}
                          </td>
                        ) : (
                          <>
                            <td className="py-2 pr-4 text-right font-bold tabular-nums text-gray-900">{b.countInPeriod}</td>
                            <td className="py-2 text-right tabular-nums text-gray-600">{b.count}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
