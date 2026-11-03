'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import type { AdminExtension } from '@line-crm/shared'

export function ExtensionMenu({ extensions, onNavigate }: {
  extensions: AdminExtension[]
  onNavigate: () => void
}) {
  const pathname = usePathname(), params = useSearchParams()
  if (!extensions.length) return null
  return (
    <div>
      <div className="pt-5 pb-2 px-3">
        <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">拡張機能</p>
      </div>
      {extensions.map(extension => {
        const active = pathname === '/extensions' && params.get('id') === extension.id
        return <Link key={extension.id} href={'/extensions?id=' + encodeURIComponent(extension.id)}
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          className={'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ' +
            (active ? 'bg-kumo-brand text-kumo-inverse' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900')}>
          <svg aria-hidden="true" className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z" />
          </svg>
          {extension.label}
        </Link>
      })}
    </div>
  )
}
