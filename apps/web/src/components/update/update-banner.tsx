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

const updateBannerEnabled = process.env.NEXT_PUBLIC_UPDATE_BANNER_ENABLED !== 'false'

// inject-version を通さないビルド (自前 CI/CD やローカル dev) のバージョン placeholder。
// この場合「manifest に無い」のは当たり前なので fork 警告バナーは出さない。
const DEV_VERSION = '0.0.0-dev'

export const MANUAL_UPDATE_GUIDE_URL =
  'https://github.com/Shudesu/line-harness-oss/blob/main/docs/wiki/26-Manual-Update.md'

export function UpdateBanner() {
  const [status, setStatus] = useState<Status>({ kind: 'loading' })

  useEffect(() => {
    if (!updateBannerEnabled) return

    let cancelled = false
    ;(async () => {
      try {
        const current = await getCurrentVersion()
        if (cancelled) return
        // バージョン未埋め込みビルドでは manifest 照合自体が無意味なので
        // バナーを出さない (自前デプロイ運用では正常な状態)。
        if (current.version === DEV_VERSION) return
        const manifest = await getManifest()
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
    // 「改造検知」のような警告調は使わない: カスタマイズ運用は正当な使い方で、
    // ここで伝えるべきは「自動更新の対象外」という事実だけ (詳細 reason は title に)。
    return (
      <div
        className="bg-amber-50 text-amber-900 px-4 py-2 border-b text-sm"
        title={status.reason}
      >
        カスタマイズ版で動作中です（v{status.version}）。そのままお使いいただけます。
        更新したい場合は{' '}
        <a
          className="underline"
          href={MANUAL_UPDATE_GUIDE_URL}
          target="_blank"
          rel="noreferrer"
        >
          手動アップデートガイド
        </a>{' '}
        をご覧ください。
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
