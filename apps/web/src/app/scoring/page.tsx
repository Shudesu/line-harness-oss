'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { api, type MileageAdminOverview, type MileageRule } from '@/lib/api'

const PAGE_SIZE = 50

const EVENT_LABELS: Record<string, string> = {
  message_received: 'メッセージ',
  link_clicked: 'リンククリック',
  form_submitted: 'フォーム',
  booking_created: '予約',
  affiliate_conversion_approved: '紹介成果',
  webinar_watch_5m: 'ウェビナー',
  webinar_watch_15m: 'ウェビナー',
  webinar_completed: 'ウェビナー完了',
  webinar_cta_clicked: 'ウェビナーCTA',
  instagram_dm_received: 'Instagram DM',
  instagram_comment_created: 'Instagramコメント',
  instagram_story_mentioned: 'ストーリーズ',
  instagram_line_returned: 'LINE帰還',
  friend_registered: '友だち登録',
  friend_following_7d: '継続7日',
  friend_following_30d: '継続30日',
  friend_following_90d: '継続90日',
  friend_following_180d: '継続180日',
  friend_following_365d: '継続1年',
  purchase_completed: '購入完了',
}

const EVENT_COLORS: Record<string, string> = {
  message_received: 'bg-blue-50 text-blue-700 border-blue-100',
  link_clicked: 'bg-violet-50 text-violet-700 border-violet-100',
  form_submitted: 'bg-amber-50 text-amber-700 border-amber-100',
  booking_created: 'bg-emerald-50 text-emerald-700 border-emerald-100',
  webinar_watch_5m: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  webinar_watch_15m: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  webinar_completed: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  webinar_cta_clicked: 'bg-cyan-50 text-cyan-700 border-cyan-100',
  instagram_dm_received: 'bg-pink-50 text-pink-700 border-pink-100',
  instagram_comment_created: 'bg-pink-50 text-pink-700 border-pink-100',
  instagram_story_mentioned: 'bg-pink-50 text-pink-700 border-pink-100',
  instagram_line_returned: 'bg-pink-50 text-pink-700 border-pink-100',
  friend_registered: 'bg-lime-50 text-lime-700 border-lime-100',
  friend_following_7d: 'bg-lime-50 text-lime-700 border-lime-100',
  friend_following_30d: 'bg-lime-50 text-lime-700 border-lime-100',
  friend_following_90d: 'bg-lime-50 text-lime-700 border-lime-100',
  friend_following_180d: 'bg-lime-50 text-lime-700 border-lime-100',
  friend_following_365d: 'bg-lime-50 text-lime-700 border-lime-100',
  purchase_completed: 'bg-yellow-50 text-yellow-800 border-yellow-100',
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('ja-JP').format(value)
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value.slice(0, 16).replace('T', ' ')
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(date)
}

function ruleLimit(rule: MileageRule) {
  if (rule.conditions.uniquePerReferredFriendPerSubject) return '紹介された人・対象ごとに1回'
  if (rule.conditions.uniquePerReferredFriend) return '紹介された人1人につき1回'
  if (rule.conditions.uniquePerSubject) return '対象ごとに1回'
  if (rule.conditions.uniquePerSubjectPerDay && rule.conditions.dailyCapActions) {
    return `同じリンクは1日1回・1日${rule.conditions.dailyCapActions}件まで`
  }
  if (rule.conditions.dailyCapActions) return `1日${rule.conditions.dailyCapActions}回まで`
  return '行動ごとに付与'
}

function commitmentLabel(actions: number, miles: number) {
  if (actions >= 30 || miles >= 200) return { text: 'コミット強', style: 'bg-rose-50 text-rose-700' }
  if (actions >= 10 || miles >= 80) return { text: '高アクション', style: 'bg-orange-50 text-orange-700' }
  if (actions > 0) return { text: 'アクティブ', style: 'bg-green-50 text-green-700' }
  return { text: 'これから', style: 'bg-gray-100 text-gray-500' }
}

export default function MileagePage() {
  const { accounts } = useAccount()
  const [overview, setOverview] = useState<MileageAdminOverview | null>(null)
  const [rules, setRules] = useState<MileageRule[]>([])
  const [amounts, setAmounts] = useState<Record<string, string>>({})
  const [accountId, setAccountId] = useState('all')
  const [searchInput, setSearchInput] = useState('')
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingRuleId, setSavingRuleId] = useState<string | null>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setOffset(0)
      setSearch(searchInput.trim())
    }, 300)
    return () => window.clearTimeout(timer)
  }, [searchInput])

  const loadRules = useCallback(async () => {
    const res = await api.mileage.rules()
    if (!res.success) throw new Error(res.error)
    setRules(res.data)
    setAmounts(Object.fromEntries(res.data.map((rule) => [rule.id, String(rule.amount)])))
  }, [])

  const loadOverview = useCallback(async () => {
    const res = await api.mileage.overview({
      accountId: accountId === 'all' ? undefined : accountId,
      search: search || undefined,
      limit: PAGE_SIZE,
      offset,
    })
    if (!res.success) throw new Error(res.error)
    setOverview(res.data)
  }, [accountId, offset, search])

  const reloadAll = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      await Promise.all([loadOverview(), loadRules()])
    } catch {
      setError('マイルデータの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [loadOverview, loadRules])

  useEffect(() => { void reloadAll() }, [reloadAll])

  const updateRule = async (rule: MileageRule, updates: Partial<MileageRule>) => {
    setSavingRuleId(rule.id)
    setError('')
    try {
      const res = await api.mileage.updateRule(rule.id, updates)
      if (!res.success) throw new Error(res.error)
      await Promise.all([loadRules(), loadOverview()])
    } catch {
      setError('マイルルールの更新に失敗しました。')
    } finally {
      setSavingRuleId(null)
    }
  }

  const saveAmount = async (rule: MileageRule) => {
    const amount = Number(amounts[rule.id])
    if (!Number.isInteger(amount) || amount <= 0) {
      setError('付与マイルは1以上の整数で入力してください。')
      return
    }
    if (amount === rule.amount) return
    await updateRule(rule, { amount })
  }

  const totalPages = Math.max(1, Math.ceil((overview?.pagination.total ?? 0) / PAGE_SIZE))
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1
  const summary = overview?.summary
  const members = overview?.members ?? []
  const accountLabel = useMemo(() => {
    if (accountId === 'all') return `${accounts.length}アカウント横断`
    return accounts.find((account) => account.id === accountId)?.displayName
      || accounts.find((account) => account.id === accountId)?.name
      || '選択アカウント'
  }, [accountId, accounts])

  return (
    <div>
      <Header
        title="マイル"
        action={
          <button
            onClick={() => void reloadAll()}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            再読み込み
          </button>
        }
      />

      <div className="mb-5 rounded-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-indigo-950 p-5 text-white shadow-sm">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-xs font-medium tracking-wider text-indigo-200">HARNESS MILEAGE</p>
            <h2 className="mt-1 text-xl font-bold">行動が、そのまま顧客との資産になる</h2>
            <p className="mt-1 text-sm text-slate-300">{accountLabel}で同一ユーザーをまとめ、マイルと行動量を表示しています。</p>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              value={accountId}
              onChange={(event) => { setAccountId(event.target.value); setOffset(0) }}
              className="min-w-48 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-white outline-none [&>option]:text-gray-900"
            >
              <option value="all">全アカウント横断</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.displayName || account.name}</option>
              ))}
            </select>
            <input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="名前で検索"
              className="rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-400 outline-none"
            />
          </div>
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ['マイル対象者', summary?.totalMembers, '人'],
          ['保有マイル合計', summary?.totalAvailable, 'mile'],
          ['30日アクティブ', summary?.activeMembers30d, '人'],
          ['記録済みアクション', summary?.totalActions, '件'],
          ['反映待ち', summary?.queuedEvents, '件'],
        ].map(([label, value, unit]) => (
          <div key={String(label)} className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-xs text-gray-500">{label}</p>
            <p className="mt-1 text-2xl font-bold text-gray-900">
              {loading || value === undefined ? '—' : formatNumber(Number(value))}
              <span className="ml-1 text-xs font-medium text-gray-400">{unit}</span>
            </p>
          </div>
        ))}
      </div>

      <section className="mb-6 rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">マイル付与ルール</h2>
          <p className="mt-1 text-xs text-gray-500">付与数を変更すると、変更後に発生した行動から新しい値が使われます。</p>
        </div>
        <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
          {rules.map((rule) => (
            <div key={rule.id} className={`rounded-xl border p-4 ${rule.isActive ? 'border-gray-200' : 'border-gray-100 bg-gray-50 opacity-70'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${EVENT_COLORS[rule.eventType] || 'bg-gray-50 text-gray-600 border-gray-100'}`}>
                    {EVENT_LABELS[rule.eventType] || rule.eventType}
                  </span>
                  <p className="mt-2 text-sm font-semibold text-gray-900">{rule.name}</p>
                </div>
                <button
                  type="button"
                  disabled={savingRuleId === rule.id}
                  onClick={() => void updateRule(rule, { isActive: !rule.isActive })}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${rule.isActive ? 'bg-indigo-600' : 'bg-gray-300'}`}
                  aria-label={`${rule.name}を${rule.isActive ? '無効' : '有効'}にする`}
                >
                  <span className={`mt-1 h-4 w-4 rounded-full bg-white transition-transform ${rule.isActive ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>
              <div className="mt-4 flex items-end gap-2">
                <input
                  type="number"
                  min={1}
                  value={amounts[rule.id] ?? rule.amount}
                  onChange={(event) => setAmounts((current) => ({ ...current, [rule.id]: event.target.value }))}
                  onBlur={() => void saveAmount(rule)}
                  onKeyDown={(event) => { if (event.key === 'Enter') void saveAmount(rule) }}
                  className="w-24 rounded-lg border border-gray-200 px-3 py-2 text-right text-lg font-bold text-gray-900 outline-none focus:border-indigo-400"
                />
                <span className="pb-2 text-xs text-gray-500">mile</span>
              </div>
              <p className="mt-2 text-[11px] text-gray-400">{ruleLimit(rule)}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">マイル・コミットランキング</h2>
            <p className="mt-1 text-xs text-gray-500">同じ人が複数アカウントにいる場合は1人にまとめています。</p>
          </div>
          <span className="text-xs text-gray-400">{formatNumber(overview?.pagination.total ?? 0)}人</span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-sm text-gray-400">集計中...</div>
        ) : members.length === 0 ? (
          <div className="p-12 text-center text-sm text-gray-400">該当するユーザーがいません</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px]">
              <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-3">順位</th>
                  <th className="px-4 py-3">ユーザー</th>
                  <th className="px-4 py-3">接続アカウント</th>
                  <th className="px-4 py-3 text-right">保有マイル</th>
                  <th className="px-4 py-3">コミット</th>
                  <th className="px-4 py-3">行動内訳</th>
                  <th className="px-4 py-3">最終行動</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {members.map((member, index) => {
                  const rank = offset + index + 1
                  const commitment = commitmentLabel(member.actionCount, member.available)
                  return (
                    <tr key={member.identityKey} className="hover:bg-gray-50/70">
                      <td className="px-4 py-4 text-center text-sm font-bold text-gray-500">
                        {rank <= 3 ? ['🥇', '🥈', '🥉'][rank - 1] : rank}
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex items-center gap-3">
                          {member.pictureUrl ? (
                            <img src={member.pictureUrl} alt="" className="h-9 w-9 rounded-full object-cover" />
                          ) : (
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-indigo-100 text-sm font-bold text-indigo-700">
                              {member.displayName.slice(0, 1)}
                            </div>
                          )}
                          <div>
                            <p className="max-w-48 truncate text-sm font-medium text-gray-900">{member.displayName}</p>
                            <p className="text-[11px] text-gray-400">アクション {formatNumber(member.actionCount)}件</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex max-w-60 flex-wrap gap-1">
                          {member.accountNames.slice(0, 3).map((name) => (
                            <span key={name} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-600">{name}</span>
                          ))}
                          {member.accountCount > 3 && <span className="text-[10px] text-gray-400">+{member.accountCount - 3}</span>}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-right">
                        <p className="text-lg font-bold text-indigo-700">{formatNumber(member.available)}</p>
                        {member.pending > 0 && <p className="text-[10px] text-amber-600">保留 {formatNumber(member.pending)}</p>}
                      </td>
                      <td className="px-4 py-4">
                        <span className={`rounded-full px-2 py-1 text-[11px] font-medium ${commitment.style}`}>{commitment.text}</span>
                      </td>
                      <td className="px-4 py-4">
                        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-gray-600">
                          <span>💬 {formatNumber(member.messageCount)}</span>
                          <span>🔗 {formatNumber(member.linkClickCount)}</span>
                          <span>📝 {formatNumber(member.formCount)}</span>
                          <span>📅 {formatNumber(member.bookingCount)}</span>
                          <span>🎬 {formatNumber(member.webinarCount)}</span>
                          <span>📸 {formatNumber(member.instagramCount)}</span>
                          <span>🌱 継続{formatNumber(member.followingDays)}日</span>
                          {member.unfollowCount > 0 && <span>↩ 再フォロー{formatNumber(member.unfollowCount)}回</span>}
                          {member.qualityReferralCount > 0 && (
                            <span>🤝 良質紹介{formatNumber(member.qualityReferralCount)}人・{formatNumber(member.referralMiles)}mile</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-4 text-xs text-gray-500">{formatDate(member.lastActivityAt)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
            <span className="text-xs text-gray-500">{currentPage} / {totalPages}ページ</span>
            <div className="flex gap-2">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 disabled:opacity-40"
              >前へ</button>
              <button
                disabled={offset + PAGE_SIZE >= (overview?.pagination.total ?? 0)}
                onClick={() => setOffset(offset + PAGE_SIZE)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs text-gray-600 disabled:opacity-40"
              >次へ</button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
