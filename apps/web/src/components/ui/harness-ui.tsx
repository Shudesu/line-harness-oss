import type { ReactNode } from 'react'
import Link from 'next/link'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Surface } from '@cloudflare/kumo/components/surface'

export interface HarnessPageHeaderProps {
  title: string
  description?: string
  product?: string
  action?: ReactNode
}

const PRODUCT_BRANDS: Record<string, { label: string; color: string }> = {
  LINE: { label: 'LINE HARNESS', color: '#06c755' },
  X: { label: 'X HARNESS', color: '#0f1419' },
  INSTAGRAM: { label: 'INSTAGRAM HARNESS', color: '#e1306c' },
}

export function HarnessPageHeader({
  title,
  description,
  product,
  action,
}: HarnessPageHeaderProps) {
  const brand = PRODUCT_BRANDS[product?.toUpperCase() ?? '']

  return (
    <div className="mb-6">
      <div className="mb-2 flex items-center gap-2">
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: brand?.color ?? '#667085' }}
          aria-hidden="true"
        />
        <span className="text-[10px] font-bold tracking-[0.18em]" style={{ color: brand?.color ?? '#667085' }}>
          {brand?.label ?? 'HARNESS'}
        </span>
        {product ? <Badge variant="neutral">{product}</Badge> : null}
      </div>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight text-gray-900 sm:text-2xl">{title}</h1>
          {description ? <p className="mt-1 text-sm text-gray-500">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    </div>
  )
}

/** Shared count formatting for stat cards/cells: null renders as an em dash. */
export function formatCount(value: number | null): string {
  return value !== null ? value.toLocaleString('ja-JP') : '—'
}

export type HarnessStatCellTone = 'positive' | 'negative'

export interface HarnessStatCellProps {
  title: string
  value: string
  sub?: string
  /** Alert state paints the whole cell in danger tokens and wins over subTone. */
  alert?: boolean
  subTone?: HarnessStatCellTone
}

/**
 * Compact stat tile for dense per-entity grids (e.g. the dashboard's
 * delivery-health cards) — the small sibling of HarnessStatCard, which is a
 * full-size linked card.
 */
export function HarnessStatCell({ title, value, sub, alert = false, subTone }: HarnessStatCellProps) {
  const subClass = alert
    ? 'text-kumo-danger'
    : subTone === 'positive'
      ? 'text-kumo-success'
      : subTone === 'negative'
        ? 'text-kumo-danger'
        : 'text-kumo-subtle'
  return (
    <div
      className={`rounded-lg border p-3 ${
        alert ? 'border-kumo-danger bg-kumo-danger-tint' : 'border-kumo-line bg-kumo-tint'
      }`}
    >
      <p className={`text-xs font-medium ${alert ? 'text-kumo-danger' : 'text-kumo-subtle'}`}>{title}</p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${alert ? 'text-kumo-danger' : 'text-kumo-strong'}`}>
        {value}
      </p>
      {sub ? <p className={`mt-0.5 text-[11px] ${subClass}`}>{sub}</p> : null}
    </div>
  )
}

export interface HarnessStatCardProps {
  title: string
  value: number | null
  loading: boolean
  icon: ReactNode
  href: string
  accentColor: string
  subtitle?: string
  detailLabel?: string
}

export function HarnessStatCard({
  title,
  value,
  loading,
  icon,
  href,
  accentColor,
  subtitle,
  detailLabel = '詳細を見る',
}: HarnessStatCardProps) {
  return (
    <Link
      href={href}
      aria-label={`${title}の詳細を見る`}
      className="group block rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-harness-accent focus-visible:ring-offset-2"
    >
      <Surface className="h-full rounded-xl p-5 transition duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="mb-2 text-sm font-medium text-gray-500">{title}</p>
            {loading ? (
              <div className="h-8 w-20 animate-pulse rounded bg-gray-100" />
            ) : (
              <p className="text-3xl font-bold tabular-nums text-gray-900">
                {formatCount(value)}
              </p>
            )}
            {subtitle && !loading ? <p className="mt-1 text-xs text-gray-400">{subtitle}</p> : null}
          </div>
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white shadow-sm"
            style={{ backgroundColor: accentColor }}
            aria-hidden="true"
          >
            {icon}
          </span>
        </div>
        <p className="mt-4 text-xs font-medium text-gray-400 transition-colors group-hover:text-emerald-700">
          {detailLabel} <span aria-hidden="true">→</span>
        </p>
      </Surface>
    </Link>
  )
}
