'use client'
import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import AuthGuard from './auth-guard'

const BRAND_COLOR = '#FF6B35'

const menuSections = [
  {
    label: null,
    items: [
      { href: '/', label: 'ダッシュボード', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
      { href: '/bookings', label: '応募管理', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4' },
    ],
  },
  {
    label: '管理',
    items: [
      { href: '/jobs', label: '求人管理', icon: 'M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2M3.6 9h16.8c.56 0 .84 0 1.054.109a1 1 0 01.437.437C22 9.76 22 10.04 22 10.6v1.8c0 .56 0 .84-.109 1.054a1 1 0 01-.437.437C21.24 14 20.96 14 20.4 14H3.6c-.56 0-.84 0-1.054-.109a1 1 0 01-.437-.437C2 13.24 2 12.96 2 12.4v-1.8c0-.56 0-.84.109-1.054a1 1 0 01.437-.437C2.76 9 3.04 9 3.6 9z' },
      { href: '/nurseries', label: '園マスター', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
      { href: '/attendance', label: '勤怠確認', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
      { href: '/payroll', label: '報酬管理', icon: 'M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z' },
    ],
  },
]

function NavIcon({ d }: { d: string }) {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
  )
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => { setIsOpen(false) }, [pathname])
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  if (pathname === '/login') {
    return <>{children}</>
  }

  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href)

  const sidebarContent = (
    <>
      <div className="px-6 py-5 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm" style={{ backgroundColor: BRAND_COLOR }}>
            S
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900 leading-tight">スポットほいく</p>
            <p className="text-xs text-gray-400">運営管理</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {menuSections.map((section, si) => (
          <div key={si}>
            {section.label && (
              <div className="pt-5 pb-2 px-3">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{section.label}</p>
              </div>
            )}
            {section.items.map((item) => {
              const active = isActive(item.href)
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    active ? 'text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                  style={active ? { backgroundColor: BRAND_COLOR } : {}}
                >
                  <NavIcon d={item.icon} />
                  {item.label}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      <div className="px-6 py-4 border-t border-gray-200 space-y-3">
        <p className="text-xs text-gray-400">spot-admin v{process.env.APP_VERSION || '0.0.0'}</p>
        <button
          onClick={() => {
            localStorage.removeItem('spot_admin_api_key')
            window.location.href = '/login'
          }}
          className="flex items-center gap-2 text-xs text-gray-400 hover:text-red-500 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          ログアウト
        </button>
      </div>
    </>
  )

  return (
    <AuthGuard>
      <div className="flex min-h-screen">
        {/* Mobile header */}
        <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => setIsOpen(!isOpen)}
            className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
            aria-label="メニュー"
          >
            <svg className="w-6 h-6 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {isOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              }
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-white font-bold text-xs" style={{ backgroundColor: BRAND_COLOR }}>S</div>
            <p className="text-sm font-bold text-gray-900">スポットほいく</p>
          </div>
        </div>

        {/* Mobile overlay */}
        {isOpen && <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setIsOpen(false)} />}

        {/* Mobile sidebar */}
        <aside className={`lg:hidden fixed top-0 left-0 z-50 w-72 bg-white flex flex-col h-screen transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
          <div className="absolute top-4 right-4">
            <button onClick={() => setIsOpen(false)} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="閉じる">
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          {sidebarContent}
        </aside>

        {/* Desktop sidebar */}
        <aside className="hidden lg:flex w-64 bg-white border-r border-gray-200 flex-col h-screen sticky top-0">
          {sidebarContent}
        </aside>

        <main className="flex-1 pt-[72px] px-4 pb-6 sm:px-6 lg:pt-8 lg:px-8 lg:pb-8 overflow-auto">
          {children}
        </main>
      </div>
    </AuthGuard>
  )
}
