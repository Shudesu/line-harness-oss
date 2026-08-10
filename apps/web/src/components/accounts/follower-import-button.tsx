'use client'

import { useCallback, useEffect, useState } from 'react'
import { api, type FollowerImportState } from '@/lib/api'

interface Props {
  accountId: string
  onImported: () => void
}

export default function FollowerImportButton({ accountId, onImported }: Props) {
  const [state, setState] = useState<FollowerImportState | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')

  const detect = useCallback(async () => {
    const res = await api.lineAccounts.detectFollowerImport(accountId)
    if (!res.success) throw new Error(res.error || '利用可否を確認できませんでした')
    setState(res.data)
    return res.data
  }, [accountId])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.lineAccounts.followerImportState(accountId)
        if (!res.success || cancelled) return
        let next = res.data
        // Legacy accounts have no saved capability. Probe once, persist it in
        // D1, and never repeat on ordinary page loads after that.
        if (next.capability === 'unknown' && !next.eligibilityCheckedAt) {
          next = await detect()
        }
        if (!cancelled) setState(next)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : '状態確認に失敗しました')
      }
    })()
    return () => { cancelled = true }
  }, [accountId, detect])

  const runSteps = async () => {
    while (true) {
      const res = await api.lineAccounts.stepFollowerImport(accountId)
      if (!res.success) throw new Error(res.error || '移行処理に失敗しました')
      setState(res.data.state)
      if (res.data.state.lastError) throw new Error(res.data.state.lastError)
      if (res.data.state.phase === 'completed') return
      if (res.data.busy) await new Promise((resolve) => setTimeout(resolve, 1000))
    }
  }

  const startOrResume = async () => {
    setRunning(true)
    setError('')
    try {
      const started = await api.lineAccounts.startFollowerImport(accountId)
      if (!started.success) throw new Error(started.error || '移行を開始できませんでした')
      setState(started.data)
      await runSteps()
      onImported()
    } catch (err) {
      setError(err instanceof Error ? err.message : '既存友だちの移行に失敗しました')
    } finally {
      setRunning(false)
    }
  }

  if (!state) return <p className="mt-3 text-[11px] text-gray-400">既存友だち移行を確認中…</p>

  const reflected = state.imported + state.reactivated + state.claimedUnassigned
  const inProgress = state.phase === 'importing_ids' || state.phase === 'hydrating_profiles'

  return (
    <div className="mt-3 pt-3 border-t border-gray-100">
      <p className="text-xs font-medium text-gray-600">既存友だちのワンタイム移行</p>

      {state.capability === 'unavailable' && (
        <div className="mt-1">
          <p className="text-[11px] text-gray-400">
            現在のLINEアカウントでは利用できません。通常運用への負荷や定期処理はありません。
          </p>
          <button type="button" onClick={() => detect().catch((e) => setError(String(e)))}
            className="mt-1 text-[11px] text-blue-600 hover:underline">
            認証後に利用可否を再確認
          </button>
        </div>
      )}

      {state.capability === 'unknown' && (
        <button type="button" onClick={() => detect().catch((e) => setError(String(e)))}
          className="mt-1 text-[11px] text-blue-600 hover:underline">
          利用可否を確認
        </button>
      )}

      {state.capability === 'available' && state.phase !== 'completed' && (
        <button
          type="button"
          onClick={startOrResume}
          disabled={running}
          className="mt-2 px-3 py-1.5 rounded-lg bg-green-50 text-green-700 hover:bg-green-100 text-xs font-medium disabled:opacity-50"
        >
          {running ? '移行中…' : inProgress ? '移行を再開' : '一度だけ移行を開始'}
        </button>
      )}

      {inProgress && (
        <p className="mt-1 text-xs text-green-700">
          {state.phase === 'importing_ids'
            ? `友だちID ${state.received.toLocaleString()}件を確認済み`
            : `プロフィール ${state.profilesProcessed.toLocaleString()}件を処理済み`}
        </p>
      )}

      {state.phase === 'completed' && (
        <p className="mt-1 text-xs text-green-700">
          完了: {state.received.toLocaleString()}件確認、{reflected.toLocaleString()}件反映
          {state.conflicts > 0 ? `、${state.conflicts.toLocaleString()}件保留` : ''}
        </p>
      )}

      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}
