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

interface DashboardStats {
  friendCount: number | null
  activeScenarioCount: number | null
  broadcastCount: number | null
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
  return (
    <Link href={href} className="block bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow group">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500 mb-2">{title}</p>
          {loading ? (
            <div className="h-8 w-20 bg-gray-100 rounded animate-pulse" />
          ) : (
            <p className="text-3xl font-bold text-gray-900">
              {value !== null ? value.toLocaleString('ja-JP') : '-'}
            </p>
          )}
        </div>
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-white shrink-0"
          style={{ backgroundColor: accentColor }}
        >
          {icon}
        </div>
      </div>
      <p className="text-xs text-gray-400 mt-3 group-hover:text-green-600 transition-colors">
        詳細を見る →
      </p>
    </Link>
  )
}

export default function DashboardPage() {
  const { selectedAccountId, selectedAccount } = useAccount()
  const [stats, setStats] = useState<DashboardStats>({
    friendCount: null,
    activeScenarioCount: null,
    broadcastCount: null,
  })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      setError('')
      try {
        const [friendCountRes, scenariosRes, broadcastsRes] = await Promise.allSettled([
          api.friends.count({ accountId: selectedAccountId ?? undefined }),
          api.scenarios.list({ accountId: selectedAccountId ?? undefined }),
          api.broadcasts.list({ accountId: selectedAccountId ?? undefined }),
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
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">ダッシュボード</h1>
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

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
        <StatCard
          title="友だち数"
          value={stats.friendCount}
          loading={loading}
          href="/friends"
          icon={
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          }
        />
        <StatCard
          title="動いているシナリオ"
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
        <StatCard
          title="一斉配信（これまで）"
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

      {/* Quick links */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-4">よく使う画面</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Link
            href="/friends"
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-green-300 hover:bg-green-50 transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={{ backgroundColor: '#06C755' }}>
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
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0" style={{ backgroundColor: '#06C755' }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 group-hover:text-green-700 transition-colors">個別チャット</p>
              <p className="text-xs text-gray-400">友だちと1対1でやりとり</p>
            </div>
          </Link>

          <Link
            href="/rich-menus"
            className="flex items-center gap-3 p-3 rounded-lg border border-gray-200 hover:border-orange-300 hover:bg-orange-50 transition-colors group"
          >
            <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white shrink-0 bg-orange-500">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h6v6H4V4zm0 10h6v6H4v-6zm10-10h6v6h-6V4zm0 10h6v6h-6v-6z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900 group-hover:text-orange-700 transition-colors">リッチメニュー</p>
              <p className="text-xs text-gray-400">トーク画面の下に出るメニュー</p>
            </div>
          </Link>
        </div>
      </div>

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
