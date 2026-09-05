'use client'

import { useEffect, useState } from 'react'
import { api, type QuotaUsage } from '@/lib/api'

/**
 * Best-effort usage banner (same design stance as UpdateBanner): renders
 * nothing while loading, on fetch failure, when no limits are configured
 * (both max = 0), or while comfortably under the limits. Shows an amber
 * warning at >=90% of any limit and a red notice once a limit is exceeded
 * (bulk sends are paused server-side at that point).
 */
export function QuotaBanner() {
  const [quota, setQuota] = useState<QuotaUsage | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await api.usage()
        if (!cancelled && res.success && res.data) setQuota(res.data)
      } catch {
        // Best-effort: never break the dashboard over a usage lookup.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!quota) return null
  const limits = [quota.friends, quota.monthlyMessages].filter((l) => l.max > 0)
  if (limits.length === 0) return null

  const nearLimit = limits.some((l) => l.used >= l.max * 0.9)
  if (!quota.exceeded && !nearLimit) return null

  const numbers = [
    quota.friends.max > 0 ? `友だち ${quota.friends.used}/${quota.friends.max}` : null,
    quota.monthlyMessages.max > 0
      ? `今月の配信 ${quota.monthlyMessages.used}/${quota.monthlyMessages.max}`
      : null,
  ]
    .filter((s): s is string => s !== null)
    .join('・')

  if (quota.exceeded) {
    return (
      <div className="bg-red-50 text-red-900 border-b border-red-200 px-4 py-2 text-sm">
        設定された上限に達したため、一斉配信を一時停止しています（{numbers}）。
        {quota.noticeUrl ? (
          <>
            {' '}
            <a className="underline" href={quota.noticeUrl} target="_blank" rel="noreferrer">
              詳しく見る
            </a>
          </>
        ) : null}
      </div>
    )
  }

  return (
    <div className="bg-amber-50 text-amber-900 border-b border-amber-200 px-4 py-2 text-sm">
      上限が近づいています（{numbers}）。
      {quota.noticeUrl ? (
        <>
          {' '}
          <a className="underline" href={quota.noticeUrl} target="_blank" rel="noreferrer">
            詳しく見る
          </a>
        </>
      ) : null}
    </div>
  )
}
