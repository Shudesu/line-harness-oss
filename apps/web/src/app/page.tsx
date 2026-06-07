'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import CcPromptButton from '@/components/cc-prompt-button'
import { useAccount } from '@/contexts/account-context'
import {
  Badge,
  Banner,
  Button,
  Card,
  CardContent,
} from '@/components/ui/primitives'
import { TrendCard, BarChart, type SeriesPoint } from '@/components/ui/charts'
import { fetchApi } from '@/lib/api'

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
  icon: React.ReactNode
  href: string
  accentColor?: string
}

function StatCard({ title, value, loading, icon, href, accentColor = '#06C755' }: StatCardProps) {
  // V4 修正: 値 0 のときは数字色を薄く + ヒント追加 (「使ったことがない」が直感的に分かる)
  const isZero = value === 0
  return (
    <Link href={href} className="group block">
      <Card className="transition-shadow hover:shadow-md">
        <CardContent className="pt-5">
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <p className="mb-2 text-sm font-medium text-gray-500">{title}</p>
              {loading ? (
                <div className="h-9 w-24 animate-pulse rounded bg-gray-100" />
              ) : (
                <p className={`text-3xl font-bold tabular-nums ${isZero ? 'text-gray-300' : 'text-gray-900'}`}>
                  {value !== null ? value.toLocaleString('ja-JP') : '-'}
                </p>
              )}
            </div>
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white"
              style={{ backgroundColor: accentColor, opacity: isZero ? 0.5 : 1 }}
            >
              {icon}
            </div>
          </div>
          <p className="mt-3 text-xs text-gray-400 transition-colors group-hover:text-green-600">
            {isZero ? '作成する →' : '詳細を見る →'}
          </p>
        </CardContent>
      </Card>
    </Link>
  )
}

interface QuickLinkProps {
  href: string
  title: string
  description: string
  icon: React.ReactNode
  accentColor?: string
  hoverBorder: string
  hoverBg: string
  hoverText: string
  iconBgClass?: string
}

function QuickLink({
  href,
  title,
  description,
  icon,
  accentColor,
  hoverBorder,
  hoverBg,
  hoverText,
  iconBgClass,
}: QuickLinkProps) {
  return (
    <Link
      href={href}
      className={`group flex items-center gap-3 rounded-lg border border-gray-200 p-3 transition-colors ${hoverBorder} ${hoverBg}`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white ${iconBgClass ?? ''}`}
        style={accentColor ? { backgroundColor: accentColor } : undefined}
      >
        {icon}
      </div>
      <div>
        <p className={`text-sm font-medium text-gray-900 transition-colors ${hoverText}`}>{title}</p>
        <p className="text-xs text-gray-400">{description}</p>
      </div>
    </Link>
  )
}

interface TrendSeries {
  series: SeriesPoint[]
  total: number
  prevTotal: number
}

interface DashboardTrendsData {
  days: number
  friendAdds: TrendSeries
  blocks: TrendSeries
  forms: TrendSeries
  outgoing: TrendSeries
  incoming: TrendSeries
}

const RANGE_OPTIONS: Array<{ days: number; label: string }> = [
  { days: 7, label: '7 日' },
  { days: 30, label: '30 日' },
  { days: 90, label: '90 日' },
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
  const [trends, setTrends] = useState<DashboardTrendsData | null>(null)
  const [trendsLoading, setTrendsLoading] = useState(true)
  const [days, setDays] = useState(30)
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

  useEffect(() => {
    const loadTrends = async () => {
      setTrendsLoading(true)
      const qs = new URLSearchParams()
      qs.set('days', String(days))
      if (selectedAccountId) qs.set('lineAccountId', selectedAccountId)
      const r = await fetchApi<{ success: boolean; data: DashboardTrendsData; error?: string }>(
        `/api/dashboard/stats?${qs.toString()}`,
      )
      if (r.success) setTrends(r.data)
      else setTrends(null)
      setTrendsLoading(false)
    }
    loadTrends()
  }, [selectedAccountId, days])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900 sm:text-2xl">ダッシュボード</h1>
        <p className="mt-1 text-sm text-gray-500">
          {selectedAccount
            ? `${selectedAccount.displayName || selectedAccount.name} の管理画面`
            : 'LINE公式アカウント CRM 管理画面'}
        </p>
      </div>

      {error && (
        <Banner tone="danger">{error}</Banner>
      )}

      {/* V1 修正: ダミー URL の demo banner を削除 (本番では 404 になる placeholder だった) */}

      {/* Trends (新): 過去 N 日の主要指標 */}
      <Card>
        <CardContent className="pt-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-800">トレンド (直近 {days} 日)</h2>
              <p className="mt-0.5 text-xs text-gray-500">前期比 + 日次グラフ</p>
            </div>
            <div className="flex gap-1">
              {RANGE_OPTIONS.map((opt) => (
                <Button
                  key={opt.days}
                  size="sm"
                  variant={days === opt.days ? 'primary' : 'outline'}
                  onClick={() => setDays(opt.days)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>
          </div>

          {trendsLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100" />
              ))}
            </div>
          ) : trends ? (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                <TrendCard
                  label="友だち追加"
                  current={trends.friendAdds.total}
                  prev={trends.friendAdds.prevTotal}
                  series={trends.friendAdds.series}
                  href="/friends"
                  accentColor="#06C755"
                  fillColor="rgba(6, 199, 85, 0.15)"
                />
                <TrendCard
                  label="ブロック"
                  current={trends.blocks.total}
                  prev={trends.blocks.prevTotal}
                  series={trends.blocks.series}
                  accentColor="#EF4444"
                  fillColor="rgba(239, 68, 68, 0.12)"
                  invertColor
                />
                <TrendCard
                  label="フォーム回答"
                  current={trends.forms.total}
                  prev={trends.forms.prevTotal}
                  series={trends.forms.series}
                  href="/form-submissions"
                  accentColor="#3B82F6"
                  fillColor="rgba(59, 130, 246, 0.15)"
                />
                <TrendCard
                  label="送信数"
                  current={trends.outgoing.total}
                  prev={trends.outgoing.prevTotal}
                  series={trends.outgoing.series}
                  accentColor="#8B5CF6"
                  fillColor="rgba(139, 92, 246, 0.15)"
                />
              </div>

              {/* V3/V5 修正: BarChart を独立カード化、空のとき empty state */}
              <div className="mt-5 rounded-lg border border-gray-100 bg-gray-50/40 p-4">
                <div className="mb-2 flex items-baseline justify-between">
                  <span className="text-xs font-medium text-gray-600">受信メッセージ (日次)</span>
                  <span className="text-xs text-gray-400 tabular-nums">
                    合計: {trends.incoming.total.toLocaleString('ja-JP')}
                  </span>
                </div>
                {trends.incoming.total === 0 ? (
                  <div className="flex h-20 items-center justify-center rounded bg-white/60 text-xs text-gray-400">
                    この期間に受信メッセージはありません
                  </div>
                ) : (
                  <BarChart
                    data={trends.incoming.series}
                    barColor="#0EA5E9"
                    height={80}
                    aria-label={`受信メッセージ日次グラフ (${days} 日, 合計 ${trends.incoming.total} 件)`}
                  />
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-gray-500">トレンドデータを取得できませんでした。</p>
          )}
        </CardContent>
      </Card>

      {/* Summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          title="友だち数"
          value={stats.friendCount}
          loading={loading}
          href="/friends"
          icon={
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
        />
        <StatCard
          title="アクティブシナリオ数"
          value={stats.activeScenarioCount}
          loading={loading}
          href="/scenarios"
          accentColor="#3B82F6"
          icon={
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
        />
        <StatCard
          title="配信数 (合計)"
          value={stats.broadcastCount}
          loading={loading}
          href="/broadcasts"
          accentColor="#8B5CF6"
          icon={
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
            </svg>
          }
        />
      </div>

      {/* Round 3 summary cards */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          title="テンプレート数"
          value={stats.templateCount}
          loading={loading}
          href="/templates"
          accentColor="#F59E0B"
          icon={
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z" />
            </svg>
          }
        />
        <StatCard
          title="アクティブルール数"
          value={stats.automationCount}
          loading={loading}
          href="/automations"
          accentColor="#EF4444"
          icon={
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
        <StatCard
          title="スコアリングルール数"
          value={stats.scoringRuleCount}
          loading={loading}
          href="/scoring"
          accentColor="#10B981"
          icon={
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          }
        />
      </div>

      {/* Quick links */}
      <Card>
        <CardContent className="pt-5">
          <h2 className="mb-4 text-sm font-semibold text-gray-800">クイックアクション</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <QuickLink
              href="/friends"
              title="友だち管理"
              description="友だちの一覧・タグ管理"
              accentColor="#06C755"
              hoverBorder="hover:border-green-300"
              hoverBg="hover:bg-green-50"
              hoverText="group-hover:text-green-700"
              icon={
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              }
            />
            <QuickLink
              href="/scenarios"
              title="シナリオ配信"
              description="自動配信シナリオの作成・編集"
              iconBgClass="bg-blue-500"
              hoverBorder="hover:border-blue-300"
              hoverBg="hover:bg-blue-50"
              hoverText="group-hover:text-blue-700"
              icon={
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
              }
            />
            <QuickLink
              href="/broadcasts"
              title="一斉配信"
              description="メッセージの一斉送信・予約"
              iconBgClass="bg-purple-500"
              hoverBorder="hover:border-purple-300"
              hoverBg="hover:bg-purple-50"
              hoverText="group-hover:text-purple-700"
              icon={
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
                </svg>
              }
            />
            <QuickLink
              href="/chats"
              title="チャット"
              description="オペレーターチャット管理"
              accentColor="#06C755"
              hoverBorder="hover:border-green-300"
              hoverBg="hover:bg-green-50"
              hoverText="group-hover:text-green-700"
              icon={
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                </svg>
              }
            />
            <QuickLink
              href="/health"
              title="BAN検知"
              description="アカウント健康度ダッシュボード"
              iconBgClass="bg-red-500"
              hoverBorder="hover:border-red-300"
              hoverBg="hover:bg-red-50"
              hoverText="group-hover:text-red-700"
              icon={
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              }
            />
          </div>
        </CardContent>
      </Card>

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
