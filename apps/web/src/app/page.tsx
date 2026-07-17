'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import CcPromptButton from '@/components/cc-prompt-button'
import { useAccount } from '@/contexts/account-context'

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

// ブランドカラー（LINE グリーン）。アイコンチップ・アクセントはこの1色に統一する。
const BRAND = '#06C755'
const BRAND_DARK = '#059212'

interface DashboardStats {
  friendCount: number | null
  activeScenarioCount: number | null
  broadcastCount: number | null
  templateCount: number | null
  automationCount: number | null
  scoringRuleCount: number | null
}

// ─── アイコン（SVG パス定義） ───

const iconPaths = {
  friends:
    'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z',
  scenario:
    'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2',
  broadcast:
    'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z',
  template:
    'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z',
  automation: 'M13 10V3L4 14h7v7l9-11h-7z',
  scoring:
    'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z',
  chat: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z',
  health:
    'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z',
}

function Icon({ d, className = 'w-5 h-5' }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
  )
}

// ─── 統計カード ───
// 値が 0 のときは「次の一歩」を促すヒントを表示する（空状態ガイダンス）

interface StatCardProps {
  title: string
  value: number | null
  loading: boolean
  iconD: string
  href: string
  emptyHint?: string
}

function StatCard({ title, value, loading, iconD, href, emptyHint }: StatCardProps) {
  const showHint = !loading && value === 0 && !!emptyHint
  return (
    <Link
      href={href}
      className="group block bg-white rounded-2xl border border-gray-100 shadow-sm p-6 transition-all duration-200 hover:border-green-200 hover:shadow-md hover:-translate-y-0.5"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-gray-500">{title}</p>
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ backgroundColor: 'rgba(6, 199, 85, 0.1)', color: BRAND_DARK }}
        >
          <Icon d={iconD} />
        </div>
      </div>
      {loading ? (
        <div className="h-10 w-24 bg-gray-100 rounded-lg animate-pulse mt-1" />
      ) : (
        <p className="text-4xl font-bold tracking-tight text-gray-900 tabular-nums mt-1">
          {value !== null ? value.toLocaleString('ja-JP') : '–'}
        </p>
      )}
      <p
        className={`text-xs mt-3 transition-colors ${
          showHint ? 'font-medium' : 'text-gray-400'
        }`}
        style={showHint ? { color: BRAND_DARK } : undefined}
      >
        <span className={showHint ? '' : 'group-hover:text-green-700 transition-colors'}>
          {showHint ? `${emptyHint} →` : '詳細を見る →'}
        </span>
      </p>
    </Link>
  )
}

// ─── クイックアクション ───

const quickActions = [
  { href: '/friends', label: '友だち管理', desc: '友だちの一覧・タグ管理', iconD: iconPaths.friends },
  { href: '/scenarios', label: 'シナリオ配信', desc: '自動配信シナリオの作成・編集', iconD: iconPaths.scenario },
  { href: '/broadcasts', label: '一斉配信', desc: 'メッセージの一斉送信・予約', iconD: iconPaths.broadcast },
  { href: '/chats', label: 'チャット', desc: 'オペレーターチャット管理', iconD: iconPaths.chat },
  { href: '/templates', label: 'テンプレート', desc: 'よく使う文面の管理', iconD: iconPaths.template },
  { href: '/health', label: 'BAN検知', desc: 'アカウント健康度ダッシュボード', iconD: iconPaths.health },
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

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900 tracking-tight">ダッシュボード</h1>
        <p className="text-sm text-gray-500 mt-1">
          {selectedAccount
            ? `${selectedAccount.displayName || selectedAccount.name} の管理画面`
            : 'LINE公式アカウント CRM 管理画面'}
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* ヒーロー: 友だち数（主役 KPI）+ LINE 体験 CTA */}
      <div
        className="relative overflow-hidden rounded-2xl mb-6 text-white"
        style={{ background: `linear-gradient(135deg, ${BRAND} 0%, #04a94a 55%, #059669 100%)` }}
      >
        {/* 装飾円 */}
        <div className="absolute -top-20 -right-16 w-72 h-72 rounded-full bg-white/10 pointer-events-none" />
        <div className="absolute -bottom-28 -left-12 w-80 h-80 rounded-full bg-white/5 pointer-events-none" />

        <div className="relative p-6 sm:p-8 flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-white/15 flex items-center justify-center">
                <Icon d={iconPaths.friends} className="w-4 h-4" />
              </div>
              <p className="text-sm font-medium text-white/85">友だち数</p>
            </div>
            {loading ? (
              <div className="h-12 w-32 bg-white/20 rounded-lg animate-pulse mt-3" />
            ) : (
              <p className="text-5xl font-bold tracking-tight tabular-nums mt-2">
                {stats.friendCount !== null ? stats.friendCount.toLocaleString('ja-JP') : '–'}
              </p>
            )}
            <Link
              href="/friends"
              className="inline-flex items-center gap-1 mt-3 text-sm font-medium text-white/85 hover:text-white transition-colors"
            >
              {!loading && stats.friendCount === 0 ? '友だち追加リンクを共有してみましょう →' : '友だち管理へ →'}
            </Link>
          </div>

          <a
            href="https://your-worker.your-subdomain.workers.dev/auth/line?ref=dashboard"
            target="_blank"
            rel="noopener noreferrer"
            className="sm:w-72 rounded-xl bg-white/10 border border-white/20 p-4 hover:bg-white/[0.16] transition-colors backdrop-blur-sm"
          >
            <p className="text-sm font-bold">LINE で体験する</p>
            <p className="text-xs text-white/75 mt-1 leading-relaxed">
              友だち追加でステップ配信・フォーム・自動返信を体験
            </p>
            <span
              className="inline-block mt-3 text-xs font-bold bg-white px-3.5 py-1.5 rounded-full"
              style={{ color: BRAND_DARK }}
            >
              友だち追加
            </span>
          </a>
        </div>
      </div>

      {/* 統計カード */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
        <StatCard
          title="アクティブシナリオ数"
          value={stats.activeScenarioCount}
          loading={loading}
          href="/scenarios"
          iconD={iconPaths.scenario}
          emptyHint="最初のシナリオを作成しましょう"
        />
        <StatCard
          title="配信数 (合計)"
          value={stats.broadcastCount}
          loading={loading}
          href="/broadcasts"
          iconD={iconPaths.broadcast}
          emptyHint="最初の一斉配信を作成しましょう"
        />
        <StatCard
          title="テンプレート数"
          value={stats.templateCount}
          loading={loading}
          href="/templates"
          iconD={iconPaths.template}
          emptyHint="よく使う文面を登録しましょう"
        />
        <StatCard
          title="アクティブルール数"
          value={stats.automationCount}
          loading={loading}
          href="/automations"
          iconD={iconPaths.automation}
          emptyHint="オートメーションを設定しましょう"
        />
        <StatCard
          title="スコアリングルール数"
          value={stats.scoringRuleCount}
          loading={loading}
          href="/scoring"
          iconD={iconPaths.scoring}
          emptyHint="見込み度を可視化しましょう"
        />
      </div>

      {/* クイックアクション */}
      <div>
        <h2 className="text-sm font-semibold text-gray-800 mb-3">クイックアクション</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {quickActions.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              className="group flex items-center gap-3 p-4 bg-white rounded-2xl border border-gray-100 shadow-sm transition-all duration-200 hover:border-green-200 hover:shadow-md hover:-translate-y-0.5"
            >
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                style={{ backgroundColor: 'rgba(6, 199, 85, 0.1)', color: BRAND_DARK }}
              >
                <Icon d={action.iconD} className="w-5 h-5" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900">{action.label}</p>
                <p className="text-xs text-gray-400 mt-0.5 truncate">{action.desc}</p>
              </div>
              <svg
                className="w-4 h-4 text-gray-300 shrink-0 transition-all duration-200 group-hover:text-green-600 group-hover:translate-x-0.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Link>
          ))}
        </div>
      </div>

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
