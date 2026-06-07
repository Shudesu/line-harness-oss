'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import CcPromptButton from '@/components/cc-prompt-button'
import {
  Button,
  Card,
  CardContent,
  Badge,
  Banner,
  Label,
  Select,
  EmptyState,
} from '@/components/ui/primitives'

interface LineAccount {
  id: string
  channelId: string
  name: string
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface AccountHealthLog {
  id: string
  lineAccountId: string
  errorCode: number | null
  errorCount: number
  checkPeriod: string
  riskLevel: 'normal' | 'warning' | 'danger'
  createdAt: string
}

interface AccountMigration {
  id: string
  fromAccountId: string
  toAccountId: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed'
  migratedCount: number
  totalCount: number
  createdAt: string
  completedAt: string | null
}

type BadgeTone = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'neutral'

const riskConfig: Record<
  AccountHealthLog['riskLevel'],
  { label: string; tone: BadgeTone; dotColor: string }
> = {
  normal: { label: '正常', tone: 'success', dotColor: 'bg-emerald-500' },
  warning: { label: '警告', tone: 'warning', dotColor: 'bg-amber-500' },
  danger: { label: '危険', tone: 'danger', dotColor: 'bg-red-500' },
}

const statusConfig: Record<
  AccountMigration['status'],
  { label: string; tone: BadgeTone }
> = {
  pending: { label: '待機中', tone: 'neutral' },
  in_progress: { label: '移行中', tone: 'info' },
  completed: { label: '完了', tone: 'success' },
  failed: { label: '失敗', tone: 'danger' },
}

const ccPrompts = [
  {
    title: 'BAN リスク診断',
    prompt: `各LINEアカウントのBANリスクを診断してください。
1. アカウントごとのエラーログとリスクレベルを確認
2. エラーコード別の発生頻度と傾向を分析
3. リスク軽減のための具体的なアクションプランを提案
結果をレポートしてください。`,
  },
  {
    title: 'アカウント移行手順',
    prompt: `BANリスクの高いアカウントから友だちを移行する手順を説明してください。
1. 移行元・移行先アカウントの選定基準
2. 友だちデータの移行プロセスと注意事項
3. 移行後の動作確認とフォローアップ手順
手順を示してください。`,
  },
]

export default function HealthPage() {
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [healthLogs, setHealthLogs] = useState<Record<string, AccountHealthLog[]>>({})
  const [latestRisk, setLatestRisk] = useState<Record<string, AccountHealthLog['riskLevel']>>({})
  const [migrations, setMigrations] = useState<AccountMigration[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [migrateFrom, setMigrateFrom] = useState<string | null>(null)
  const [migrateToId, setMigrateToId] = useState('')
  const [migrating, setMigrating] = useState(false)

  const loadAccounts = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.health.accounts()
      if (res.success) {
        const data = res.data as unknown as LineAccount[]
        setAccounts(data)
        // Load health for each account
        const risks: Record<string, AccountHealthLog['riskLevel']> = {}
        for (const account of data) {
          try {
            const healthRes = await api.health.getHealth(account.id)
            if (healthRes.success) {
              const payload = healthRes.data as unknown as { lineAccountId: string; riskLevel: string; logs: AccountHealthLog[] }
              const logs = payload.logs ?? []
              setHealthLogs((prev) => ({ ...prev, [account.id]: logs }))
              if (payload.riskLevel) {
                risks[account.id] = payload.riskLevel as AccountHealthLog['riskLevel']
              } else if (logs.length > 0) {
                risks[account.id] = logs[0].riskLevel
              } else {
                risks[account.id] = 'normal'
              }
            }
          } catch {
            risks[account.id] = 'normal'
          }
        }
        setLatestRisk(risks)
      } else {
        setError('アカウント情報の取得に失敗しました')
      }
    } catch {
      setError('アカウント情報の読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadMigrations = useCallback(async () => {
    try {
      const res = await api.health.migrations()
      if (res.success) {
        setMigrations(res.data as unknown as AccountMigration[])
      }
    } catch {
      // Non-blocking
    }
  }, [])

  useEffect(() => {
    loadAccounts()
    loadMigrations()
  }, [loadAccounts, loadMigrations])

  const handleExpand = (accountId: string) => {
    setExpandedId(expandedId === accountId ? null : accountId)
  }

  const handleMigrate = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!migrateFrom || !migrateToId) return
    setMigrating(true)
    try {
      await api.health.migrate(migrateFrom, { toAccountId: migrateToId })
      setMigrateFrom(null)
      setMigrateToId('')
      loadMigrations()
    } catch {
      setError('移行リクエストに失敗しました')
    } finally {
      setMigrating(false)
    }
  }

  const getAccountName = (id: string): string => {
    const account = accounts.find((a) => a.id === id)
    return account?.name || id
  }

  return (
    <div>
      <Header title="BAN検知ダッシュボード" />

      {/* Error */}
      {error && (
        <div className="mb-4">
          <Banner tone="danger">{error}</Banner>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <Card>
          <CardContent className="py-8 text-center text-gray-400">
            読み込み中...
          </CardContent>
        </Card>
      ) : accounts.length === 0 ? (
        <EmptyState
          title="LINEアカウントが登録されていません"
          description="先にアカウント管理からLINEアカウントを登録してください"
        />
      ) : (
        <>
          {/* Account Health Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {accounts.map((account) => {
              const risk = latestRisk[account.id] || 'normal'
              const config = riskConfig[risk]
              const isExpanded = expandedId === account.id
              const logs = healthLogs[account.id] || []

              return (
                <Card key={account.id} className="overflow-hidden">
                  <button
                    onClick={() => handleExpand(account.id)}
                    className="w-full p-4 text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                          style={{ backgroundColor: '#06C755' }}
                        >
                          L
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-gray-900">{account.name}</h3>
                          <p className="text-xs text-gray-400 font-mono">Channel: {account.channelId}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge tone={config.tone}>
                          <span
                            className={`w-2 h-2 rounded-full ${config.dotColor} ${risk === 'danger' ? 'animate-pulse' : ''}`}
                          />
                          {config.label}
                        </Badge>
                        <svg
                          className={`w-4 h-4 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </div>
                    </div>
                  </button>

                  {/* Expanded: Health Logs */}
                  {isExpanded && (
                    <div className="border-t border-gray-200 p-4">
                      {risk === 'danger' && (
                        <div className="mb-3 space-y-3">
                          <Banner tone="danger" title="BANリスクが高い状態です">
                            早急に友だちの移行を検討してください。
                          </Banner>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={() => {
                              setMigrateFrom(account.id)
                              setMigrateToId('')
                            }}
                          >
                            友だちを移行する
                          </Button>
                        </div>
                      )}

                      {logs.length === 0 ? (
                        <p className="text-sm text-gray-400 text-center py-4">ヘルスログがありません</p>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                                <th className="pb-2 pr-3 font-medium">エラーコード</th>
                                <th className="pb-2 pr-3 font-medium">エラー数</th>
                                <th className="pb-2 pr-3 font-medium">チェック期間</th>
                                <th className="pb-2 pr-3 font-medium">リスク</th>
                                <th className="pb-2 font-medium">日時</th>
                              </tr>
                            </thead>
                            <tbody>
                              {logs.map((log) => {
                                const logConfig = riskConfig[log.riskLevel]
                                return (
                                  <tr key={log.id} className="border-b border-gray-50">
                                    <td className="py-2 pr-3 font-mono text-gray-700">
                                      {log.errorCode !== null ? log.errorCode : '-'}
                                    </td>
                                    <td className="py-2 pr-3 text-gray-700">{log.errorCount}</td>
                                    <td className="py-2 pr-3 text-gray-500">{log.checkPeriod}</td>
                                    <td className="py-2 pr-3">
                                      <Badge tone={logConfig.tone}>
                                        <span
                                          className={`w-1.5 h-1.5 rounded-full ${logConfig.dotColor} ${log.riskLevel === 'danger' ? 'animate-pulse' : ''}`}
                                        />
                                        {logConfig.label}
                                      </Badge>
                                    </td>
                                    <td className="py-2 text-gray-400 text-xs">
                                      {new Date(log.createdAt).toLocaleString('ja-JP')}
                                    </td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              )
            })}
          </div>

          {/* Migration Form Modal */}
          {migrateFrom && (
            <Card className="mb-8 border-red-200">
              <CardContent className="pt-5">
                <h2 className="text-sm font-bold text-gray-900 mb-4">
                  友だち移行: {getAccountName(migrateFrom)}
                </h2>
                <form onSubmit={handleMigrate}>
                  <div className="mb-4">
                    <Label htmlFor="migrate-to">移行先アカウント</Label>
                    <Select
                      id="migrate-to"
                      value={migrateToId}
                      onChange={(e) => setMigrateToId(e.target.value)}
                      required
                    >
                      <option value="">選択してください</option>
                      {accounts
                        .filter((a) => a.id !== migrateFrom && a.isActive)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name} ({a.channelId})
                          </option>
                        ))}
                    </Select>
                  </div>
                  <div className="flex items-center gap-3">
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={migrating || !migrateToId}
                    >
                      {migrating ? '移行中...' : '移行を開始'}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => {
                        setMigrateFrom(null)
                        setMigrateToId('')
                      }}
                    >
                      キャンセル
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Migrations Table */}
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-4">移行履歴</h2>
            {migrations.length === 0 ? (
              <EmptyState title="移行履歴はありません" />
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm min-w-[640px]">
                    <thead>
                      <tr className="text-left text-xs text-gray-500 bg-gray-50 border-b border-gray-200">
                        <th className="px-4 py-3 font-medium">移行元</th>
                        <th className="px-4 py-3 font-medium">移行先</th>
                        <th className="px-4 py-3 font-medium">ステータス</th>
                        <th className="px-4 py-3 font-medium">進捗</th>
                        <th className="px-4 py-3 font-medium">開始日時</th>
                        <th className="px-4 py-3 font-medium">完了日時</th>
                      </tr>
                    </thead>
                    <tbody>
                      {migrations.map((migration) => {
                        const status = statusConfig[migration.status]
                        const progress = migration.totalCount > 0
                          ? Math.round((migration.migratedCount / migration.totalCount) * 100)
                          : 0
                        return (
                          <tr key={migration.id} className="border-b border-gray-100 hover:bg-gray-50">
                            <td className="px-4 py-3 text-gray-900 font-medium">
                              {getAccountName(migration.fromAccountId)}
                            </td>
                            <td className="px-4 py-3 text-gray-900 font-medium">
                              {getAccountName(migration.toAccountId)}
                            </td>
                            <td className="px-4 py-3">
                              <Badge tone={status.tone}>{status.label}</Badge>
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full transition-all"
                                    style={{ width: `${progress}%`, backgroundColor: '#06C755' }}
                                  />
                                </div>
                                <span className="text-xs text-gray-500">
                                  {migration.migratedCount}/{migration.totalCount}
                                </span>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-gray-400 text-xs">
                              {new Date(migration.createdAt).toLocaleString('ja-JP')}
                            </td>
                            <td className="px-4 py-3 text-gray-400 text-xs">
                              {migration.completedAt
                                ? new Date(migration.completedAt).toLocaleString('ja-JP')
                                : '-'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>
        </>
      )}
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
