import Link from 'next/link'
import type { ReactNode } from 'react'

export function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string
  value: string | number
  tone: 'red' | 'amber' | 'green' | 'blue'
}) {
  const colors = {
    red: 'bg-red-50 text-red-700 border-red-100',
    amber: 'bg-amber-50 text-amber-700 border-amber-100',
    green: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    blue: 'bg-blue-50 text-blue-700 border-blue-100',
  }[tone]

  return (
    <div className={`rounded-2xl border p-4 ${colors}`}>
      <p className="text-xs font-semibold">{label}</p>
      <p className="mt-2 text-3xl font-black tracking-tight">{value}</p>
    </div>
  )
}

export function StepCard({ index, title, body, href }: { index: string; title: string; body: string; href?: string }) {
  const content = (
    <div className="h-full rounded-2xl border border-gray-100 bg-gray-50 p-4 hover:bg-gray-100">
      <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-500 text-xs font-black text-white">{index}</span>
      <p className="mt-3 text-sm font-bold text-gray-950">{title}</p>
      <p className="mt-1 text-sm leading-6 text-gray-600">{body}</p>
    </div>
  )
  if (!href) return content
  return <Link href={href}>{content}</Link>
}

export function MiniList({ title, href, empty, children }: { title: string; href: string; empty: string; children: ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-gray-950">{title}</p>
        <Link href={href} className="text-xs font-semibold text-emerald-600 hover:text-emerald-700">
          開く
        </Link>
      </div>
      <div className="mt-3 divide-y divide-gray-100">
        {hasChildren ? children : <p className="py-3 text-sm text-gray-500">{empty}</p>}
      </div>
    </section>
  )
}

export function MiniListItem({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="py-2">
      <p className="truncate text-sm font-semibold text-gray-900">{title}</p>
      <p className="mt-0.5 truncate text-xs text-gray-400">{sub}</p>
    </div>
  )
}
