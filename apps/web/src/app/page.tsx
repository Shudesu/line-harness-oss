'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import CcPromptButton from '@/components/cc-prompt-button'
import { useAccount } from '@/contexts/account-context'
import { PRODUCT_NAME } from '@/lib/branding'

const ccPrompts = [
  {
    title: 'ダッシュボードのKPI分析',
    prompt: `LINE CRM ダッシュボードのデータを分析してください。
1. 友だち数の推移を確認
2. アクティブシナリオの効果を評価
3. 配信の開封率・クリック率を分析
改善提案を含めてレポートしてください。`,
  },
  {
    title: '新しいシナリオを提案',
    prompt: `現在の友だちデータとタグ情報を元に、効果的なシナリオ配信を提案してください。
1. ターゲットセグメントの特定
2. メッセージ内容の提案
3. 配信タイミングの最適化
具体的なステップ配信の構成を含めてください。`,
  },
]

interface DashboardStats {
  friendCount: number | null
  activeScenarioCount: number | null
  broadcastCount: number | null
  templateCount: number | null
  automationCount: number | null
  scoringRuleCount: number | null
}

interface StatCardProps {
  title: string
  value: number | null
  loading: boolean
  iconPath: string
  href: string
  helper: string
}

interface QuickActionProps {
  title: string
  description: string
  href: string
  iconPath: string
}

const numberFormatter = new Intl.NumberFormat('ja-JP')

function PathIcon({ d, className = 'h-5 w-5' }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
  )
}

function StatCard({ title, value, loading, iconPath, href, helper }: StatCardProps) {
  return (
    <Link
      href={href}
      className="group flex min-h-[142px] flex-col justify-between rounded-3xl border border-gray-200/80 bg-white p-5 shadow-sm transition hover:-translate-y-0.5 hover:border-[#06C755]/35 hover:shadow-lg hover:shadow-gray-900/5"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-gray-500">{title}</p>
          <p className="mt-1 text-xs text-gray-400">{helper}</p>
        </div>
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-[#E9FBEF] text-[#057A35] transition group-hover:bg-[#06C755] group-hover:text-white">
          <PathIcon d={iconPath} />
        </div>
      </div>
      <div className="mt-5 flex items-end justify-between gap-3">
        {loading ? (
          <div className="h-9 w-24 animate-pulse rounded-xl bg-gray-100" />
        ) : (
          <p className="text-3xl font-black tracking-tight text-gray-950">
            {value !== null ? numberFormatter.format(value) : '—'}
          </p>
        )}
        <span className="text-xs font-bold text-[#06C755] opacity-0 transition group-hover:opacity-100">
          開く →
        </span>
      </div>
    </Link>
  )
}

function QuickAction({ title, description, href, iconPath }: QuickActionProps) {
  return (
    <Link
      href={href}
      className="group flex items-center gap-3 rounded-2xl px-3 py-3 transition hover:bg-[#E9FBEF]"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-gray-100 text-gray-600 transition group-hover:bg-[#06C755] group-hover:text-white">
        <PathIcon d={iconPath} className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-gray-950">{title}</p>
        <p className="truncate text-xs text-gray-500">{description}</p>
      </div>
      <span className="text-sm text-gray-300 transition group-hover:translate-x-0.5 group-hover:text-[#06C755]">→</span>
    </Link>
  )
}

const metricItems: Array<Omit<StatCardProps, 'value' | 'loading'>> = [
  {
    title: '友だち数',
    href: '/friends',
    helper: '登録済みの友だち',
    iconPath: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  },
  {
    title: 'アクティブシナリオ',
    href: '/scenarios',
    helper: '稼働中の自動配信',
    iconPath: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  },
  {
    title: '配信数',
    href: '/broadcasts',
    helper: '一斉配信の合計',
    iconPath: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z',
  },
  {
    title: 'テンプレート',
    href: '/templates',
    helper: '再利用できる文面',
    iconPath: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z',
  },
  {
    title: '自動化ルール',
    href: '/automations',
    helper: '有効なIF-THEN',
    iconPath: 'M13 10V3L4 14h7v7l9-11h-7z',
  },
  {
    title: 'スコアリング',
    href: '/scoring',
    helper: '評価ルール数',
    iconPath: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z',
  },
]

const quickActions: QuickActionProps[] = [
  {
    href: '/friends',
    title: '友だちを確認',
    description: 'タグ・メタデータ・流入元を見る',
    iconPath: metricItems[0].iconPath,
  },
  {
    href: '/chats',
    title: '未返信を処理',
    description: '個別チャットで対応漏れを減らす',
    iconPath: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  },
  {
    href: '/broadcasts',
    title: '配信を作成',
    description: '一斉配信・予約配信を準備する',
    iconPath: metricItems[2].iconPath,
  },
  {
    href: '/health',
    title: 'アカウント健康度',
    description: 'BANリスクと運用状態を確認',
    iconPath: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
  },
]

export default function DashboardPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [stats, setStats] = useState<DashboardStats>({
    friendCount: null,
    activeScenarioCount: null,
    broadcastCount: null,
    templateCount: null,
    automationCount: null,
    scoringRuleCount: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [friendCountRes, scenariosRes, broadcastsRes, templatesRes, automationsRes, scoringRes] = await Promise.allSettled([
          api.friends.count({ accountId: selectedAccountId ?? undefined }),
          api.scenarios.list(),
          api.broadcasts.list(),
          api.templates.list(),
          api.automations.list(),
          api.scoring.rules(),
        ])

        setStats({
          friendCount:
            friendCountRes.status === 'fulfilled' && friendCountRes.value.success
              ? friendCountRes.value.data.count
              : null,
          activeScenarioCount:
            scenariosRes.status === 'fulfilled' && scenariosRes.value.success
              ? scenariosRes.value.data.filter((s) => s.isActive).length
              : null,
          broadcastCount:
            broadcastsRes.status === 'fulfilled' && broadcastsRes.value.success
              ? broadcastsRes.value.data.length
              : null,
          templateCount:
            templatesRes.status === 'fulfilled' && templatesRes.value.success
              ? templatesRes.value.data.length
              : null,
          automationCount:
            automationsRes.status === 'fulfilled' && automationsRes.value.success
              ? automationsRes.value.data.filter((a) => a.isActive).length
              : null,
          scoringRuleCount:
            scoringRes.status === 'fulfilled' && scoringRes.value.success
              ? scoringRes.value.data.length
              : null,
        })
      } catch {
        setError('データの読み込みに失敗しました')
      } finally {
        setLoading(false)
      }
    }

    load()
  }, [selectedAccountId])

  const selectedAccountName = selectedAccount
    ? selectedAccount.displayName || selectedAccount.name
    : 'すべてのLINE公式アカウント'

  const statValues: Record<keyof DashboardStats, number | null> = stats
  const statKeys: Array<keyof DashboardStats> = [
    'friendCount',
    'activeScenarioCount',
    'broadcastCount',
    'templateCount',
    'automationCount',
    'scoringRuleCount',
  ]

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <section className="relative overflow-hidden rounded-[32px] border border-gray-200/80 bg-white px-5 py-6 shadow-sm sm:px-7 lg:px-8">
        <div className="absolute right-0 top-0 h-40 w-40 -translate-y-1/2 translate-x-1/3 rounded-full bg-[#06C755]/10 blur-3xl" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#06C755]">{PRODUCT_NAME}</p>
            <h1 className="mt-2 text-2xl font-black tracking-tight text-gray-950 sm:text-3xl">今日の運用状況</h1>
            <p className="mt-2 text-sm leading-6 text-gray-500">
              {selectedAccountName} の主要指標と次の操作をまとめています。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/broadcasts"
              className="rounded-2xl bg-[#06C755] px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-green-600/20 transition hover:-translate-y-0.5 hover:bg-[#05A847]"
            >
              配信を作成
            </Link>
            <Link
              href="/chats"
              className="rounded-2xl border border-gray-200 bg-white px-4 py-2.5 text-sm font-bold text-gray-700 transition hover:border-green-200 hover:text-[#057A35]"
            >
              チャットを見る
            </Link>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-3xl border border-red-100 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      <section>
        <div className="mb-3 flex items-end justify-between gap-4 px-1">
          <div>
            <h2 className="text-sm font-black text-gray-950">主要指標</h2>
            <p className="mt-1 text-xs text-gray-500">各カードをクリックすると詳細画面へ移動します。</p>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {metricItems.map((item, index) => (
            <StatCard
              key={item.href}
              {...item}
              value={statValues[statKeys[index]]}
              loading={loading}
            />
          ))}
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
        <div className="rounded-[28px] border border-gray-200/80 bg-white p-5 shadow-sm">
          <div className="mb-3 px-1">
            <h2 className="text-sm font-black text-gray-950">次の操作</h2>
            <p className="mt-1 text-xs text-gray-500">日常運用でよく使う導線をまとめました。</p>
          </div>
          <div className="grid gap-1 sm:grid-cols-2">
            {quickActions.map((action) => (
              <QuickAction key={action.href} {...action} />
            ))}
          </div>
        </div>

        <aside className="rounded-[28px] border border-[#06C755]/20 bg-[#E9FBEF] p-5 shadow-sm">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-[#057A35]">AI assist</p>
          <h2 className="mt-3 text-lg font-black text-gray-950">迷ったら分析を依頼</h2>
          <p className="mt-2 text-sm leading-6 text-gray-600">
            KPIやシナリオ案は右下のAIボタンから下書きできます。送信や変更は必ず確認してから実行されます。
          </p>
          <div className="mt-5 rounded-2xl bg-white/70 px-4 py-3 text-xs font-medium text-gray-600 ring-1 ring-white/70">
            おすすめ: ダッシュボードのKPI分析 → 改善提案
          </div>
        </aside>
      </section>

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
