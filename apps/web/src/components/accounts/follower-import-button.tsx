'use client'

import { useCallback, useEffect, useState } from 'react'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Loader } from '@cloudflare/kumo/components/loader'
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

  if (!state) return <span className="mt-3 inline-flex items-center gap-2 text-xs text-kumo-subtle"><Loader size="sm" /> 既存友だち移行を確認中</span>

  const reflected = state.imported + state.reactivated + state.claimedUnassigned
  const inProgress = state.phase === 'importing_ids' || state.phase === 'hydrating_profiles'

  return (
    <div className="mt-3 border-t border-kumo-line pt-3">
      <p className="text-xs font-medium text-kumo-default">既存友だちのワンタイム移行</p>

      {state.capability === 'unavailable' ? (
        <div className="mt-1">
          <p className="text-xs text-kumo-subtle">
            現在のLINEアカウントでは利用できません。通常運用への負荷や定期処理はありません。
          </p>
          <Button type="button" size="xs" variant="ghost" className="mt-1" onClick={() => detect().catch((reason) => setError(String(reason)))}>
            認証後に利用可否を再確認
          </Button>
        </div>
      ) : null}

      {state.capability === 'unknown' ? (
        <Button type="button" size="xs" variant="ghost" className="mt-1" onClick={() => detect().catch((reason) => setError(String(reason)))}>
          利用可否を確認
        </Button>
      ) : null}

      {state.capability === 'available' && state.phase !== 'completed' ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="mt-2"
          loading={running}
          onClick={() => void startOrResume()}
        >
          {inProgress ? '移行を再開' : '一度だけ移行を開始'}
        </Button>
      ) : null}

      {inProgress ? (
        <p className="mt-1 text-xs text-kumo-success">
          {state.phase === 'importing_ids'
            ? `友だちID ${state.received.toLocaleString()}件を確認済み`
            : `プロフィール ${state.profilesProcessed.toLocaleString()}件を処理済み`}
        </p>
      ) : null}

      {state.phase === 'completed' ? (
        <p className="mt-1 text-xs text-kumo-success">
          完了: {state.received.toLocaleString()}件確認、{reflected.toLocaleString()}件反映
          {state.conflicts > 0 ? `、${state.conflicts.toLocaleString()}件保留` : ''}
        </p>
      ) : null}

      {error ? <Banner className="mt-2" variant="error" title="移行できません" description={error} /> : null}
    </div>
  )
}
