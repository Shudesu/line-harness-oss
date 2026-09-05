'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { api } from '@/lib/api'
import type { AccountDeliveryHealth } from '@/lib/api'
import { getApiBase } from '@/lib/api-base'
import CcPromptButton from '@/components/cc-prompt-button'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import { formatCount, HarnessStatCard, HarnessStatCell } from '@/components/ui/harness-ui'
import type { HarnessStatCellTone } from '@/components/ui/harness-ui'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'

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

// 友だち追加リンクの即時取得カード。/r/dashboard は OS 対応ランディング経由で
// LINE アプリを直接開く流入口（モバイル: LIFF Universal Link / PC: QR）。
// UUID 付与・アカウント解決は LIFF 側 /api/liff/link が担い、ref=dashboard が
// friends.ref_code に流入元として記録される。/auth/line?account= を配らないのは
// モバイルブラウザで Web 版 LINE ログインが挟まり離脱を生むため
// (公式の lin.ee 直リンクだと計測も UUID 紐づけも失われるのは従来どおり)。
function FriendAddLinkCard() {
  const { selectedAccount } = useAccount()
  const [copied, setCopied] = useState(false)
  const base = (getApiBase() ?? '').replace(/\/$/, '')
  const link = selectedAccount
    ? `${base}/r/dashboard?account=${encodeURIComponent(selectedAccount.channelId)}`
    : `${base}/r/dashboard`

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // clipboard requires a secure context; the input below allows manual copy
    }
  }

  return (
    <LayerCard className="mb-6 p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-sm font-semibold text-gray-800">友だち追加リンク</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {selectedAccount
              ? `${selectedAccount.displayName || selectedAccount.name} への追加リンク (UUID計測つき)`
              : 'デフォルトアカウントへの追加リンク (UUID計測つき)'}
          </p>
        </div>
      </div>
      <div className="flex items-stretch gap-2">
        <Input
          aria-label="友だち追加リンク"
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="flex-1 font-mono text-xs"
        />
        <Button
          type="button"
          onClick={onCopy}
          variant="primary"
          size="sm"
          className="shrink-0"
        >
          {copied ? 'コピーしました ✓' : 'コピー'}
        </Button>
      </div>
    </LayerCard>
  )
}

/** "+5" / "−3" / "±0"; null (insight not ready) renders as em dash. */
function formatDelta(value: number | null): string {
  if (value === null) return '—'
  if (value > 0) return `+${value.toLocaleString('ja-JP')}`
  if (value < 0) return `−${Math.abs(value).toLocaleString('ja-JP')}`
  return '±0'
}

/** "20260901" → "9/1" for the compact as-of label. */
function formatInsightDate(yyyyMmDd: string | null): string | null {
  if (!yyyyMmDd || !/^\d{8}$/.test(yyyyMmDd)) return null
  return `${Number(yyyyMmDd.slice(4, 6))}/${Number(yyyyMmDd.slice(6, 8))}`
}

/** Success/danger tone for a day-over-day delta; ±0 and unknown stay muted. */
function deltaTone(delta: number | null, upIsGood: boolean): HarnessStatCellTone | undefined {
  if (delta === null || delta === 0) return undefined
  return (upIsGood ? delta > 0 : delta < 0) ? 'positive' : 'negative'
}

/**
 * Quota cell contents. Precedence, most-specific first: unlimited plan →
 * remaining computable → fetch failed. A limited plan whose consumption call
 * failed lands in the last branch (value —, alert) so a broken quota fetch is
 * as loud as a real shortage — the 2026-09-01 incident was invisible data.
 */
function quotaCell(account: AccountDeliveryHealth): { value: string; sub?: string; alert: boolean } {
  const { quota, quotaAlert, errors } = account
  if (quota.type === 'none') {
    return { value: '∞', sub: '上限なしプラン', alert: false }
  }
  if (quota.remaining !== null) {
    return {
      value: formatCount(quota.remaining),
      sub: `上限 ${formatCount(quota.limit)} ・消費 ${formatCount(quota.consumption)}`,
      alert: quotaAlert,
    }
  }
  const fetchFailed = errors.includes('quota') || errors.includes('consumption')
  return { value: '—', sub: fetchFailed ? '取得失敗（要確認）' : undefined, alert: fetchFailed }
}

/** Sub line for the insight cells: delta when ready, otherwise why not. */
function insightSub(account: AccountDeliveryHealth, delta: number | null): string {
  if (account.insight.status === 'ready') return `前日比 ${formatDelta(delta)}`
  return account.insight.status === 'unready' ? 'LINE集計待ち' : '取得失敗'
}

// 2026-09-01 の一斉配信事故（2アカウントがクォータ不足で全滅、UI 上どこにも
// 出ていなかった）を受けたセクション。クォータはリアルタイム、友だち/ブロックの
// インサイトは LINE 側の集計が前日分までなので as-of がずれる点をラベルで明示する。
function DeliveryHealthSection() {
  const [health, setHealth] = useState<AccountDeliveryHealth[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await api.lineAccounts.deliveryHealth()
        if (cancelled) return
        if (res.success) {
          setHealth(res.data.accounts)
        } else {
          setError('配信健全性の取得に失敗しました')
        }
      } catch {
        if (!cancelled) setError('配信健全性の取得に失敗しました')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  if (!loading && !error && (health?.length ?? 0) === 0) return null

  return (
    <section className="mb-6" aria-label="配信健全性">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold text-kumo-strong">アカウント別 配信健全性</h2>
        <p className="text-[11px] text-kumo-subtle">クォータ=リアルタイム / 友だち・ブロック=前日時点</p>
      </div>

      {error ? (
        <Banner variant="alert" title="配信健全性を読み込めませんでした" description={error} />
      ) : null}

      {loading ? (
        <LayerCard className="p-4">
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-lg bg-gray-100" />
            ))}
          </div>
        </LayerCard>
      ) : (
        <div className="space-y-3">
          {health?.map((account) => {
            const asOf = formatInsightDate(account.insight.date)
            const quota = quotaCell(account)
            return (
              <LayerCard key={account.lineAccountId} className="p-4">
                <div className="mb-3 flex items-center gap-2">
                  <p className="text-sm font-semibold text-kumo-strong">{account.name}</p>
                  {account.quotaAlert ? (
                    <Badge variant="error">クォータ不足: 全員配信不可</Badge>
                  ) : account.errors.length > 0 ? (
                    <Badge variant="neutral">一部データ取得失敗</Badge>
                  ) : account.insight.status === 'unready' ? (
                    <Badge variant="neutral">インサイト集計待ち</Badge>
                  ) : (
                    <Badge variant="success">正常</Badge>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                  <HarnessStatCell
                    title="配信クォータ 残り"
                    value={quota.value}
                    sub={quota.sub}
                    alert={quota.alert}
                  />
                  <HarnessStatCell
                    title={asOf ? `友だち数 (${asOf})` : '友だち数'}
                    value={formatCount(account.insight.followers)}
                    sub={insightSub(account, account.insight.followersDelta)}
                    subTone={deltaTone(account.insight.followersDelta, true)}
                  />
                  <HarnessStatCell
                    title={asOf ? `ブロック数 (${asOf})` : 'ブロック数'}
                    value={formatCount(account.insight.blocks)}
                    sub={insightSub(account, account.insight.blocksDelta)}
                    subTone={deltaTone(account.insight.blocksDelta, false)}
                  />
                  <HarnessStatCell
                    title="今月の配信済み通数"
                    value={formatCount(account.messagesThisMonth)}
                    sub="push配信のみ・月初から"
                  />
                </div>
              </LayerCard>
            )
          })}
        </div>
      )}
    </section>
  )
}

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
          api.mileage.rules(),
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
      <Header
        title="ダッシュボード"
        product="LINE"
        description={selectedAccount
          ? `${selectedAccount.displayName || selectedAccount.name} の管理画面`
          : 'LINE公式アカウント CRM 管理画面'}
      />

      {error && <Banner className="mb-6" variant="error" title="データを読み込めませんでした" description={error} />}

      <DeliveryHealthSection />

      <FriendAddLinkCard />

      {/* Demo banner */}
      <a
        href="https://your-worker.your-subdomain.workers.dev/auth/line?ref=dashboard"
        target="_blank"
        rel="noopener noreferrer"
        className="block mb-6 p-4 rounded-xl border border-green-200 bg-gradient-to-r from-green-50 to-emerald-50 hover:from-green-100 hover:to-emerald-100 transition-colors"
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-gray-900">LINE で体験する</p>
            <p className="text-xs text-gray-500 mt-0.5">友だち追加でステップ配信・フォーム・自動返信を体験</p>
          </div>
          <Badge variant="success">友だち追加</Badge>
        </div>
      </a>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
        <HarnessStatCard
          title="友だち数"
          value={stats.friendCount}
          loading={loading}
          href="/friends"
          accentColor="var(--color-kumo-brand)"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
        />
        <HarnessStatCard
          title="アクティブシナリオ数"
          value={stats.activeScenarioCount}
          loading={loading}
          href="/scenarios"
          accentColor="#3B82F6"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
          }
        />
        <HarnessStatCard
          title="配信数 (合計)"
          value={stats.broadcastCount}
          loading={loading}
          href="/broadcasts"
          accentColor="#8B5CF6"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
            </svg>
          }
        />
      </div>

      {/* Round 3 summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
        <HarnessStatCard
          title="テンプレート数"
          value={stats.templateCount}
          loading={loading}
          href="/templates"
          accentColor="#F59E0B"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6z" />
            </svg>
          }
        />
        <HarnessStatCard
          title="アクティブルール数"
          value={stats.automationCount}
          loading={loading}
          href="/automations"
          accentColor="#EF4444"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          }
        />
        <HarnessStatCard
          title="マイル付与ルール数"
          value={stats.scoringRuleCount}
          loading={loading}
          href="/scoring"
          accentColor="#10B981"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
          }
        />
      </div>

      {/* Quick links */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">クイックアクション</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href="/friends"
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-green-300 hover:bg-green-50 transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-kumo-inverse shrink-0 bg-kumo-brand">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 group-hover:text-green-700 transition-colors">友だち管理</p>
              <p className="text-xs text-gray-400">友だちの一覧・タグ管理</p>
            </div>
          </Link>

          <Link
            href="/scenarios"
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-blue-300 hover:bg-blue-50 transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 bg-blue-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 group-hover:text-blue-700 transition-colors">シナリオ配信</p>
              <p className="text-xs text-gray-400">自動配信シナリオの作成・編集</p>
            </div>
          </Link>

          <Link
            href="/broadcasts"
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-purple-300 hover:bg-purple-50 transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 bg-purple-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 group-hover:text-purple-700 transition-colors">一斉配信</p>
              <p className="text-xs text-gray-400">メッセージの一斉送信・予約</p>
            </div>
          </Link>

          <Link
            href="/chats"
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-green-300 hover:bg-green-50 transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-kumo-inverse shrink-0 bg-kumo-brand">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 group-hover:text-green-700 transition-colors">チャット</p>
              <p className="text-xs text-gray-400">オペレーターチャット管理</p>
            </div>
          </Link>

          <Link
            href="/health"
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-red-300 hover:bg-red-50 transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 bg-red-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 group-hover:text-red-700 transition-colors">BAN検知</p>
              <p className="text-xs text-gray-400">アカウント健康度ダッシュボード</p>
            </div>
          </Link>
        </div>
      </div>

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
