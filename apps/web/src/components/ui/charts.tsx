/**
 * Phase: Dashboard 可視化
 *
 * 軽量な inline SVG チャートコンポーネント。
 * 外部依存 (Recharts 等) を入れずに、Linear / Stripe 級の見た目を目指す。
 *
 * 全コンポーネントは prefers-reduced-motion 対応、レスポンシブ。
 */

import React from 'react'

export interface SeriesPoint {
  date: string // YYYY-MM-DD
  count: number
}

// ─── Sparkline (mini line chart) ───────────────────────
export function Sparkline({
  data,
  width = 120,
  height = 40,
  stroke = '#06C755',
  fill = 'rgba(6, 199, 85, 0.15)',
  showArea = true,
  className,
}: {
  data: SeriesPoint[]
  width?: number
  height?: number
  stroke?: string
  fill?: string
  showArea?: boolean
  className?: string
}) {
  if (!data || data.length < 2) {
    return <div className={className} style={{ width, height }} />
  }
  const max = Math.max(1, ...data.map((d) => d.count))
  const min = 0
  const stepX = width / (data.length - 1)
  const path = data
    .map((p, i) => {
      const x = i * stepX
      const y = height - ((p.count - min) / (max - min || 1)) * (height - 4) - 2
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  const areaPath = `${path} L${width},${height} L0,${height} Z`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label="trend"
      preserveAspectRatio="none"
    >
      {showArea && <path d={areaPath} fill={fill} stroke="none" />}
      <path d={path} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

// ─── BarChart (vertical small) ────────────────────────
export function BarChart({
  data,
  width = 400,
  height = 100,
  barColor = '#06C755',
  className,
}: {
  data: SeriesPoint[]
  width?: number
  height?: number
  barColor?: string
  className?: string
}) {
  if (!data || data.length === 0) {
    return <div className={className} style={{ width, height }} />
  }
  const max = Math.max(1, ...data.map((d) => d.count))
  const barGap = 2
  const barWidth = Math.max(2, (width - barGap * (data.length - 1)) / data.length)

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      preserveAspectRatio="none"
    >
      {data.map((d, i) => {
        const x = i * (barWidth + barGap)
        const barHeight = (d.count / max) * (height - 4)
        const y = height - barHeight
        return (
          <rect
            key={d.date}
            x={x}
            y={y}
            width={barWidth}
            height={barHeight}
            fill={barColor}
            opacity={0.8}
            rx={1.5}
          >
            <title>{`${d.date}: ${d.count}`}</title>
          </rect>
        )
      })}
    </svg>
  )
}

// ─── Delta / TrendCard ────────────────────────────────
function formatDelta(current: number, prev: number): {
  pct: number | null
  abs: number
  direction: 'up' | 'down' | 'flat'
} {
  const abs = current - prev
  if (prev === 0 && current === 0) return { pct: null, abs: 0, direction: 'flat' }
  if (prev === 0) return { pct: null, abs, direction: abs > 0 ? 'up' : 'flat' }
  const pct = ((current - prev) / prev) * 100
  return {
    pct,
    abs,
    direction: Math.abs(pct) < 0.5 ? 'flat' : pct > 0 ? 'up' : 'down',
  }
}

const directionColor = {
  up: 'text-emerald-600',
  down: 'text-red-600',
  flat: 'text-gray-500',
}

const directionGlyph = {
  up: '▲',
  down: '▼',
  flat: '–',
}

export function TrendCard({
  label,
  current,
  prev,
  series,
  href,
  accentColor = '#06C755',
  fillColor = 'rgba(6, 199, 85, 0.15)',
  invertColor = false, // ブロックなど「増えると悪い」指標は true
}: {
  label: string
  current: number
  prev: number
  series: SeriesPoint[]
  href?: string
  accentColor?: string
  fillColor?: string
  invertColor?: boolean
}) {
  const delta = formatDelta(current, prev)
  const effectiveDir = invertColor
    ? (delta.direction === 'up' ? 'down' : delta.direction === 'down' ? 'up' : 'flat')
    : delta.direction

  const inner = (
    <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-gray-500">{label}</span>
        {delta.pct !== null && (
          <span className={`text-xs tabular-nums ${directionColor[effectiveDir]}`}>
            {directionGlyph[delta.direction]} {Math.abs(delta.pct).toFixed(1)}%
          </span>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-2">
        <span className="text-3xl font-bold tabular-nums text-gray-900">
          {current.toLocaleString('ja-JP')}
        </span>
        {delta.pct !== null && (
          <span className="text-xs text-gray-400 tabular-nums">
            前期: {prev.toLocaleString('ja-JP')}
          </span>
        )}
      </div>
      <div className="mt-3">
        <Sparkline
          data={series}
          stroke={accentColor}
          fill={fillColor}
          width={280}
          height={42}
        />
      </div>
    </div>
  )

  if (href) {
    return <a href={href} className="group block">{inner}</a>
  }
  return inner
}
