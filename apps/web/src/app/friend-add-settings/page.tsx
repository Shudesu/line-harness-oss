'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { Scenario, LineAccount } from '@line-crm/shared'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'

type ScenarioWithCount = Scenario & {
  stepCount?: number
  /** Set when this scenario applies to all accounts (line_account_id = NULL in DB). */
  isGlobal?: boolean
}

interface AccountRow {
  account: LineAccount
  scenarios: ScenarioWithCount[]
  loadError: string | null
}

export default function FriendAddSettingsPage() {
  const router = useRouter()
  const { setSelectedAccountId } = useAccount()
  const [rows, setRows] = useState<AccountRow[]>([])
  const [orphanScenarios, setOrphanScenarios] = useState<ScenarioWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      // Use Promise.allSettled so a single failing account fetch doesn't blank the whole page.
      // Distinguish global scenarios (lineAccountId === null) from orphans (lineAccountId points
      // to a deleted account); orphans are dropped instead of being shown under every account.
      const accountsRes = await api.lineAccounts.list()
      if (!accountsRes.success) {
        setError('LINEアカウントの取得に失敗しました')
        setLoading(false)
        return
      }
      const accounts = accountsRes.data
      const knownAccountIds = new Set(accounts.map(a => a.id))

      const settled = await Promise.allSettled([
        api.scenarios.list(),
        ...accounts.map(a => api.scenarios.list({ accountId: a.id })),
      ])

      const allSettled = settled[0]
      const allRes = allSettled.status === 'fulfilled' ? allSettled.value : null
      if (allSettled.status === 'rejected' || (allRes && !allRes.success)) {
        // Surface this as a banner — silent failure here would hide globals/orphans and
        // make per-account active counts under-report.
        setError(
          'シナリオの全件取得に失敗しました。「全アカ共通」シナリオと孤児シナリオの検出が反映されていない可能性があります。',
        )
      }

      const accountScopedByAccount = new Map<string, ScenarioWithCount[]>()
      const accountErrors = new Map<string, string>()
      accounts.forEach((account, i) => {
        const slot = settled[i + 1]
        if (slot.status === 'rejected') {
          accountErrors.set(account.id, '読み込みに失敗しました')
          return
        }
        const res = slot.value
        if (!res.success) {
          accountErrors.set(account.id, res.error)
          return
        }
        accountScopedByAccount.set(
          account.id,
          res.data.filter(s => s.triggerType === 'friend_add'),
        )
      })

      const globalFriendAdd: ScenarioWithCount[] = allRes?.success
        ? allRes.data
            .filter(s => s.triggerType === 'friend_add' && s.lineAccountId === null)
            .map(s => ({ ...s, isGlobal: true }))
        : []

      // Orphans: account-bound scenarios whose owner account no longer exists.
      // Surface them at the bottom under a synthetic group so operators can clean them up.
      const orphans: ScenarioWithCount[] = allRes?.success
        ? allRes.data.filter(
            s =>
              s.triggerType === 'friend_add' &&
              s.lineAccountId !== null &&
              !knownAccountIds.has(s.lineAccountId),
          )
        : []

      const results: AccountRow[] = accounts.map(account => ({
        account,
        scenarios: [...(accountScopedByAccount.get(account.id) ?? []), ...globalFriendAdd],
        loadError: accountErrors.get(account.id) ?? null,
      }))
      setRows(results)
      setOrphanScenarios(orphans)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateForAccount = async (accountId: string, accountName: string) => {
    const name = window.prompt(
      `${accountName} の friend_add シナリオの名前を入力してください`,
      `${accountName} ウェルカム`,
    )
    if (!name || !name.trim()) return

    setError('')
    try {
      const res = await api.scenarios.create({
        name: name.trim(),
        description: null,
        triggerType: 'friend_add',
        triggerTagId: null,
        isActive: false,
        lineAccountId: accountId,
      })
      if (!res.success) {
        setError(`シナリオ作成に失敗しました: ${res.error}`)
        return
      }
      // Pre-select the account so the editor stays in the right context, then jump to the new scenario's editor.
      setSelectedAccountId(accountId)
      router.push(`/scenarios/detail?id=${res.data.id}`)
    } catch {
      setError('シナリオ作成に失敗しました')
    }
  }

  useEffect(() => {
    load()
  }, [])

  const toggleActive = async (scenarioId: string, current: boolean) => {
    if (togglingId) return
    setTogglingId(scenarioId)

    // Optimistic update — patch the scenario in BOTH rows (per-account list) and
    // orphanScenarios so the toggle reflects state regardless of which section it lives in.
    const patch = (target: boolean) => {
      setRows(prev =>
        prev.map(row => ({
          ...row,
          scenarios: row.scenarios.map(s => (s.id === scenarioId ? { ...s, isActive: target } : s)),
        })),
      )
      setOrphanScenarios(prev =>
        prev.map(s => (s.id === scenarioId ? { ...s, isActive: target } : s)),
      )
    }

    patch(!current)
    try {
      const res = await api.scenarios.update(scenarioId, { isActive: !current })
      if (!res.success) {
        patch(current)
        setError(`シナリオの更新に失敗しました: ${res.error}`)
      }
    } catch {
      patch(current)
      setError('シナリオの更新に失敗しました')
    } finally {
      setTogglingId(null)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        title="友だち追加時設定"
        description="各 LINE アカウントに友だち追加した瞬間に何が配信されるかを管理します。アクティブなシナリオが0件のアカウントは新規友だちに何も届きません。"
      />

      <div className="max-w-5xl mx-auto px-4 py-6 space-y-4">
        {error && (
          <div className="p-3 rounded bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
        )}

        {loading ? (
          <div className="text-gray-500 text-center py-12">読み込み中…</div>
        ) : rows.length === 0 && orphanScenarios.length === 0 ? (
          <div className="text-gray-500 text-center py-12">LINE アカウントが登録されていません</div>
        ) : (
          <>
            {rows.length === 0 ? (
              <div className="text-gray-500 text-center py-6 text-sm">
                LINE アカウントは登録されていませんが、孤児シナリオが残っています。下の一覧からクリーンアップしてください。
              </div>
            ) : (
              rows.map(row => (
                <AccountSection
                  key={row.account.id}
                  row={row}
                  togglingId={togglingId}
                  onToggle={toggleActive}
                  onCreate={() => handleCreateForAccount(row.account.id, row.account.name)}
                />
              ))
            )}
            {orphanScenarios.length > 0 && (
              <OrphanSection
                scenarios={orphanScenarios}
                togglingId={togglingId}
                onToggle={toggleActive}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}

function OrphanSection({
  scenarios,
  togglingId,
  onToggle,
}: {
  scenarios: ScenarioWithCount[]
  togglingId: string | null
  onToggle: (id: string, current: boolean) => void
}) {
  return (
    <div className="bg-white border border-amber-200 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-amber-200 bg-amber-50">
        <h2 className="font-semibold text-amber-900">⚠ 孤児シナリオ (削除済みアカウント所属)</h2>
        <p className="text-xs text-amber-700 mt-1">
          所属していた LINE アカウントが削除されたシナリオです。webhook は元の line_account_id でしか発火しないため実質配信されません。残しておく理由がなければ削除推奨。
        </p>
      </div>
      <ul className="divide-y divide-gray-100">
        {scenarios.map(scenario => (
          <li key={scenario.id} className="px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1">
              <Link href={`/scenarios/detail?id=${scenario.id}`} className="block">
                <div className="font-medium text-gray-900 truncate">{scenario.name}</div>
                <div className="text-xs text-gray-400 mt-1">
                  元 line_account_id: {scenario.lineAccountId} ・ 更新 {scenario.updatedAt.slice(0, 10)}
                </div>
              </Link>
            </div>
            <Toggle
              value={scenario.isActive}
              disabled={togglingId === scenario.id}
              onClick={() => onToggle(scenario.id, scenario.isActive)}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

function AccountSection({
  row,
  togglingId,
  onToggle,
  onCreate,
}: {
  row: AccountRow
  togglingId: string | null
  onToggle: (id: string, current: boolean) => void
  onCreate: () => void
}) {
  const activeCount = row.scenarios.filter(s => s.isActive).length
  const isHealthy = activeCount > 0
  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className={`px-4 py-3 flex items-center justify-between border-b ${isHealthy ? 'border-gray-200' : 'border-red-200 bg-red-50'}`}>
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-gray-900">{row.account.name}</h2>
          <span className="text-xs text-gray-400">{row.account.channelId}</span>
        </div>
        {isHealthy ? (
          <span className="text-xs px-2 py-1 rounded-full bg-green-100 text-green-700 font-medium">
            アクティブ {activeCount} 件
          </span>
        ) : (
          <span className="text-xs px-2 py-1 rounded-full bg-red-100 text-red-700 font-medium">
            ⚠ アクティブ 0 件 — 新規友だちに何も届きません
          </span>
        )}
      </div>

      {row.loadError && (
        <div className="px-4 py-3 text-sm text-red-600">読み込みエラー: {row.loadError}</div>
      )}

      {row.scenarios.length === 0 && !row.loadError ? (
        <div className="px-4 py-6 text-center text-sm text-gray-500">
          このアカウントには friend_add トリガーのシナリオがありません。
          <button
            type="button"
            onClick={onCreate}
            className="ml-2 text-green-700 underline hover:text-green-800"
          >
            このアカウントでシナリオを作成
          </button>
        </div>
      ) : (
        <ul className="divide-y divide-gray-100">
          {row.scenarios.map(scenario => (
            <li key={scenario.id} className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Link href={`/scenarios/detail?id=${scenario.id}`} className="block">
                  <div className="font-medium text-gray-900 truncate flex items-center gap-2">
                    {scenario.name}
                    {scenario.isGlobal && (
                      <span
                        title="このシナリオは line_account_id=NULL のため全アカウント共通で発火します"
                        className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 font-medium"
                      >
                        全アカ共通
                      </span>
                    )}
                  </div>
                  {scenario.description && (
                    <div className="text-xs text-gray-500 truncate">{scenario.description}</div>
                  )}
                  <div className="text-xs text-gray-400 mt-1">
                    {(scenario.stepCount ?? 0)} ステップ ・ 更新 {scenario.updatedAt.slice(0, 10)}
                  </div>
                </Link>
              </div>
              <Toggle
                value={scenario.isActive}
                disabled={togglingId === scenario.id}
                onClick={() => onToggle(scenario.id, scenario.isActive)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function Toggle({
  value,
  disabled,
  onClick,
}: {
  value: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        value ? 'bg-green-500' : 'bg-gray-300'
      } ${disabled ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
      aria-label={value ? '無効化' : '有効化'}
    >
      <span
        className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
          value ? 'translate-x-5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}
