'use client'

import { Badge } from '@cloudflare/kumo/components/badge'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'

const fmt = new Intl.NumberFormat('ja-JP')

function formatOldest(min: number | null): string {
  if (min == null) return '—'
  if (min < 60) return `${min}分`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}時間`
  const day = Math.floor(hr / 24)
  return `${day}日`
}

interface Props {
  total: number
  byAccount: Array<{ accountId: string; accountName: string; count: number }>
  oldestWaitMinutes: number | null
}

export default function InboxSummaryBar({ total, byAccount, oldestWaitMinutes }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card label="未対応" value={fmt.format(total)} hint="人間の返事待ち" />
      <Card label="最古の待ち時間" value={formatOldest(oldestWaitMinutes)} hint="最も古い incoming" />
      <LayerCard className="p-4">
        <div className="text-xs font-medium text-kumo-subtle">アカウント別</div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {byAccount.length === 0 ? (
            <span className="text-xs text-kumo-subtle">—</span>
          ) : (
            byAccount.map((a) => (
              <Badge key={a.accountId} variant="success">
                {a.accountName} {a.count}
              </Badge>
            ))
          )}
        </div>
      </LayerCard>
    </div>
  )
}

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <LayerCard className="p-4">
      <div className="text-xs font-medium text-kumo-subtle">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-kumo-strong">{value}</div>
      {hint ? <div className="mt-1 text-xs text-kumo-subtle">{hint}</div> : null}
    </LayerCard>
  )
}
