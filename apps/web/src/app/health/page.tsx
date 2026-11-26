'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import CcPromptButton from '@/components/cc-prompt-button'
import { Badge } from '@cloudflare/kumo/components/badge'
import type { BadgeVariant } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Empty } from '@cloudflare/kumo/components/empty'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Select } from '@cloudflare/kumo/components/select'
import { Table } from '@cloudflare/kumo/components/table'

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

const riskConfig = {
  normal: { label: '正常', color: 'bg-green-500', textColor: 'text-green-700', bgColor: 'bg-green-100' },
  warning: { label: '警告', color: 'bg-yellow-500', textColor: 'text-yellow-700', bgColor: 'bg-yellow-100' },
  danger: { label: '危険', color: 'bg-red-500', textColor: 'text-red-700', bgColor: 'bg-red-100' },
}

const statusConfig: Record<AccountMigration['status'], { label: string; textColor: string; bgColor: string }> = {
  pending: { label: '待機中', textColor: 'text-gray-700', bgColor: 'bg-gray-100' },
  in_progress: { label: '移行中', textColor: 'text-blue-700', bgColor: 'bg-blue-100' },
  completed: { label: '完了', textColor: 'text-green-700', bgColor: 'bg-green-100' },
  failed: { label: '失敗', textColor: 'text-red-700', bgColor: 'bg-red-100' },
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
        <Banner className="mb-4" variant="error" title="読み込めませんでした" description={error} />
      )}

      {/* Loading */}
      {loading ? (
        <LayerCard className="p-8"><Loader className="mx-auto" /></LayerCard>
      ) : accounts.length === 0 ? (
        <Empty title="LINEアカウントが登録されていません" description="先にアカウント管理から登録してください。" />
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
                <div key={account.id} className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleExpand(account.id)}
                    className="h-auto w-full justify-start p-4 text-left"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className="w-10 h-10 rounded-lg flex items-center justify-center bg-kumo-brand text-kumo-inverse font-bold text-sm"
                        >
                          L
                        </div>
                        <div>
                          <h3 className="text-sm font-bold text-gray-900">{account.name}</h3>
                          <p className="text-xs text-gray-400 font-mono">Channel: {account.channelId}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${config.bgColor} ${config.textColor}`}>
                          <span className={`w-2 h-2 rounded-full ${config.color} ${risk === 'danger' ? 'animate-pulse' : ''}`} />
                          {config.label}
                        </span>
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
                  </Button>

                  {/* Expanded: Health Logs */}
                  {isExpanded && (
                    <div className="border-t border-gray-200 p-4">
                      {risk === 'danger' && (
                        <div className="mb-3">
                          <Button type="button" size="sm" variant="destructive"
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
                          <Table>
                            <Table.Header><Table.Row><Table.Head>エラーコード</Table.Head><Table.Head>エラー数</Table.Head><Table.Head>チェック期間</Table.Head><Table.Head>リスク</Table.Head><Table.Head>日時</Table.Head></Table.Row></Table.Header>
                            <Table.Body>
                              {logs.map((log) => {
                                const logConfig = riskConfig[log.riskLevel]
                                return (
                                  <Table.Row key={log.id}>
                                    <Table.Cell className="font-mono">
                                      {log.errorCode !== null ? log.errorCode : '-'}
                                    </Table.Cell>
                                    <Table.Cell>{log.errorCount}</Table.Cell>
                                    <Table.Cell className="text-kumo-subtle">{log.checkPeriod}</Table.Cell>
                                    <Table.Cell><Badge variant={({ normal: 'success', warning: 'warning', danger: 'error' } as Record<string, BadgeVariant>)[log.riskLevel]}>{logConfig.label}</Badge></Table.Cell>
                                    <Table.Cell className="text-kumo-subtle text-xs">
                                      {new Date(log.createdAt).toLocaleString('ja-JP')}
                                    </Table.Cell>
                                  </Table.Row>
                                )
                              })}
                            </Table.Body>
                          </Table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Migration Form Modal */}
          {migrateFrom && (
            <div className="mb-8 bg-white rounded-lg border border-red-200 p-6">
              <h2 className="text-sm font-bold text-gray-900 mb-4">
                友だち移行: {getAccountName(migrateFrom)}
              </h2>
              <form onSubmit={handleMigrate}>
                <div className="mb-4">
                  <label className="block text-sm font-medium text-gray-700 mb-1">移行先アカウント</label>
                  <Select
                    label="移行先アカウント"
                    value={migrateToId}
                    onValueChange={(value) => setMigrateToId(value ?? '')}
                    placeholder="選択してください"
                    items={Object.fromEntries(accounts.filter((account) => account.id !== migrateFrom && account.isActive).map((account) => [account.id, `${account.name} (${account.channelId})`]))}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Button type="submit" variant="primary" loading={migrating}
                    disabled={migrating || !migrateToId}
                  >
                    移行を開始
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setMigrateFrom(null)
                      setMigrateToId('')
                    }}
                    variant="secondary"
                  >
                    キャンセル
                  </Button>
                </div>
              </form>
            </div>
          )}

          {/* Migrations Table */}
          <div>
            <h2 className="text-lg font-bold text-gray-900 mb-4">移行履歴</h2>
            {migrations.length === 0 ? (
              <Empty title="移行履歴はありません" description="移行を開始すると進捗がここに表示されます。" />
            ) : (
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <Table className="min-w-[640px]">
                    <Table.Header><Table.Row><Table.Head>移行元</Table.Head><Table.Head>移行先</Table.Head><Table.Head>ステータス</Table.Head><Table.Head>進捗</Table.Head><Table.Head>開始日時</Table.Head><Table.Head>完了日時</Table.Head></Table.Row></Table.Header>
                    <Table.Body>
                      {migrations.map((migration) => {
                        const status = statusConfig[migration.status]
                        const progress = migration.totalCount > 0
                          ? Math.round((migration.migratedCount / migration.totalCount) * 100)
                          : 0
                        return (
                          <Table.Row key={migration.id}>
                            <Table.Cell className="font-medium text-kumo-strong">
                              {getAccountName(migration.fromAccountId)}
                            </Table.Cell>
                            <Table.Cell className="font-medium text-kumo-strong">
                              {getAccountName(migration.toAccountId)}
                            </Table.Cell>
                            <Table.Cell>
                              <span className={`inline-flex text-xs font-medium px-2.5 py-1 rounded-full ${status.bgColor} ${status.textColor}`}>
                                {status.label}
                              </span>
                            </Table.Cell>
                            <Table.Cell>
                              <div className="flex items-center gap-2">
                                <div className="w-24 h-2 bg-gray-200 rounded-full overflow-hidden">
                                  <div
                                    className="h-full rounded-full bg-kumo-brand transition-all"
                                    style={{ width: `${progress}%` }}
                                  />
                                </div>
                                <span className="text-xs text-gray-500">
                                  {migration.migratedCount}/{migration.totalCount}
                                </span>
                              </div>
                            </Table.Cell>
                            <Table.Cell className="text-kumo-subtle text-xs">
                              {new Date(migration.createdAt).toLocaleString('ja-JP')}
                            </Table.Cell>
                            <Table.Cell className="text-kumo-subtle text-xs">
                              {migration.completedAt
                                ? new Date(migration.completedAt).toLocaleString('ja-JP')
                                : '-'}
                            </Table.Cell>
                          </Table.Row>
                        )
                      })}
                    </Table.Body>
                  </Table>
                </div>
              </div>
            )}
          </div>
        </>
      )}
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
