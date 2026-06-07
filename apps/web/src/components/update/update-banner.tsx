'use client'

import { useEffect, useState } from 'react'
import {
  getCurrentVersion,
  getManifest,
  detectFork,
  findLatestUpgrade,
  type ReleaseEntry,
} from '@/lib/update-client'
import { UpdateButton } from './update-button'

type Status =
  | { kind: 'loading' }
  | { kind: 'latest'; version: string }
  | { kind: 'fork'; reason: string; version: string }
  | { kind: 'upgrade'; current: string; target: ReleaseEntry }

export function UpdateBanner() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [current, manifest] = await Promise.all([
          getCurrentVersion(),
          getManifest(),
        ])
        if (cancelled) return
        const fork = detectFork(current, manifest)
        if (fork.kind === 'fork') {
          setStatus({
            kind: 'fork',
            reason: fork.reason,
            version: current.version,
          })
          return
        }
        const upgrade = findLatestUpgrade(manifest, current.version)
        if (!upgrade) {
          setStatus({ kind: 'latest', version: current.version })
        } else {
          setStatus({
            kind: 'upgrade',
            current: current.version,
            target: upgrade,
          })
        }
      } catch (e) {
        // Banner is best-effort: do not break the dashboard if /admin/version
        // or the Worker-hosted manifest proxy is unreachable. Phase 9 will add a
        // visible error chip; for Phase 6 we just stay in `loading` (null).
        console.error('update banner failed', e)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (status.kind === 'loading') return null

  if (status.kind === 'latest') {
    return (
      <div className="text-xs text-gray-500 px-4 py-2 border-b bg-gray-50">
        v{status.version} (最新)
      </div>
    )
  }

  if (status.kind === 'fork') {
    return (
      <div className="bg-amber-100 text-amber-900 px-4 py-2 border-b text-sm">
        改造を検知しました (v{status.version}, {status.reason}).{' '}
        <a
          className="underline"
          href="https://theharness.com/wiki/updates/manual"
          target="_blank"
          rel="noreferrer"
        >
          手動更新ガイド →
        </a>
      </div>
    )
  }

  return (
    <div className="bg-blue-50 text-blue-900 px-4 py-2 border-b flex items-center gap-3 text-sm">
      <div>
        <strong>v{status.target.version}</strong> が利用可能（現 v
        {status.current}）
      </div>
      {status.target.changelog_url ? (
        <a
          className="text-xs underline"
          href={status.target.changelog_url}
          target="_blank"
          rel="noreferrer"
        >
          変更内容
        </a>
      ) : null}
      <div className="ml-auto">
        <UpdateButton targetVersion={status.target.version} />
      </div>
    </div>
  )
}
