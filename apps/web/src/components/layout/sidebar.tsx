'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { CheckIcon, CaretDownIcon, ListIcon, SignOutIcon, XIcon } from '@phosphor-icons/react'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Button } from '@cloudflare/kumo/components/button'
import { DropdownMenu } from '@cloudflare/kumo/components/dropdown'
import { useAccount } from '@/contexts/account-context'
import type { AccountWithStats } from '@/contexts/account-context'
import { countryFlag } from '@/lib/country-flag'
import { UNANSWERED_REFRESH_EVENT } from '@/lib/events'
import { getApiBase } from '@/lib/api-base'
import { withBasePath } from '@/lib/base-path'

const appVersion = process.env.APP_VERSION || '0.0.0'
const appCommitSha = process.env.APP_COMMIT_SHA || 'local'
const appBuildTime = process.env.APP_BUILD_TIME || ''
const appBuildDate = appBuildTime ? appBuildTime.replace('T', ' ').replace(/\.\d{3}Z$/, 'Z') : ''

// ─── メニュー定義（ユーザー目線のカテゴリ） ───

const menuSections = [
  {
    label: null, // セクションラベルなし（メイン）
    items: [
      { href: '/', label: 'ダッシュボード', icon: 'M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6' },
      { href: '/friends', label: '友だち管理', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
      { href: '/tags', label: 'タグ管理', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z' },
      { href: '/chats', label: '個別チャット', icon: 'M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z' },
    ],
  },
  {
    label: '配信',
    items: [
      { href: '/friend-add-settings', label: '友だち追加時設定', icon: 'M12 6v6m0 0v6m0-6h6m-6 0H6' },
      { href: '/scenarios', label: 'シナリオ配信', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
      { href: '/broadcasts', label: '一斉配信', icon: 'M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z' },
      { href: '/templates', label: 'テンプレート', icon: 'M4 5a1 1 0 011-1h14a1 1 0 011 1v2a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM4 13a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H5a1 1 0 01-1-1v-6zM16 13a1 1 0 011-1h2a1 1 0 011 1v6a1 1 0 01-1 1h-2a1 1 0 01-1-1v-6z' },
      { href: '/rich-menus', label: 'リッチメニュー', icon: 'M4 4h6v6H4V4zm0 10h6v6H4v-6zm10-10h6v6h-6V4zm0 10h6v6h-6v-6z' },
      { href: '/reminders', label: 'リマインダ', icon: 'M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z' },
      { href: '/webinars', label: 'ウェビナー', icon: 'M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z' },
    ],
  },
  {
    label: '分析',
    items: [
      { href: '/inflow-links', label: 'リファラルリンク', icon: 'M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1' },
      { href: '/affiliates', label: 'アフィリエイト', icon: 'M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 12.632a3 3 0 105.367 2.684 3 3 0 00-5.367-2.684z' },
      { href: '/conversions', label: 'CV計測', icon: 'M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z' },
      { href: '/scoring', label: 'マイル', icon: 'M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z' },
      { href: '/form-submissions', label: 'フォーム回答', icon: 'M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z' },
      { href: '/duplicates', label: '重複検出', icon: 'M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z' },
    ],
  },
  {
    label: '自動化',
    items: [
      { href: '/automations', label: 'オートメーション', icon: 'M13 10V3L4 14h7v7l9-11h-7z' },
      { href: '/auto-replies', label: '自動返信ルール', icon: 'M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6' },
      { href: '/webhooks', label: 'Webhook', icon: 'M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
      { href: '/notifications', label: '未対応', icon: 'M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9' },
    ],
  },
  {
    label: '予約',
    items: [
      { href: '/booking/bookings', label: '予約管理', icon: 'M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z' },
      { href: '/booking/menus', label: 'メニュー', icon: 'M4 6h16M4 10h16M4 14h16M4 18h16' },
      { href: '/booking/staff', label: 'スタッフ', icon: 'M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z' },
      { href: '/events', label: 'イベント予約', icon: 'M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2H7a2 2 0 00-2 2v2m5-7v3m4-3v3' },
    ],
  },
  {
    label: '設定',
    items: [
      { href: '/staff', label: 'スタッフ管理', icon: 'M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z' },
      { href: '/accounts', label: 'LINEアカウント', icon: 'M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4' },
      { href: '/pools', label: 'プール管理', icon: 'M3 7h18M3 12h18M3 17h18' },
      { href: '/users', label: 'ユーザー一覧', icon: 'M10 6H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V8a2 2 0 00-2-2h-5m-4 0V5a2 2 0 114 0v1m-4 0a2 2 0 104 0m-5 8a2 2 0 100-4 2 2 0 000 4zm0 0c1.306 0 2.417.835 2.83 2M9 14a3.001 3.001 0 00-2.83 2M15 11h3m-3 4h2' },
      { href: '/health', label: 'BAN検知', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
      { href: '/updates', label: 'アップデート履歴', icon: 'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15' },
      { href: '/emergency', label: '緊急コントロール', icon: 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.072 16.5c-.77.833.192 2.5 1.732 2.5z', danger: true },
    ],
  },
]

function AccountAvatar({ account, size = 32 }: { account: AccountWithStats; size?: number }) {
  const displayName = account.displayName || account.name
  if (account.pictureUrl) {
    return (
      <img
        src={account.pictureUrl}
        alt={displayName}
        className="rounded-full object-cover shrink-0"
        style={{ width: size, height: size }}
      />
    )
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-full bg-kumo-brand font-bold text-kumo-inverse"
      style={{ width: size, height: size, fontSize: size * 0.4 }}
    >
      {displayName.charAt(0)}
    </div>
  )
}

function AccountSwitcher() {
  const { accounts, selectedAccount, setSelectedAccountId, loading } = useAccount()
  const [open, setOpen] = useState(false)

  if (loading || accounts.length === 0) return null

  const displayName = selectedAccount?.displayName || selectedAccount?.name || ''

  return (
    <div className="border-b border-kumo-line px-3 py-3">
      <p className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-kumo-subtle">
        操作中のLINEアカウント
      </p>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenu.Trigger
          render={<Button type="button" variant="secondary" className="h-auto min-h-12 w-full justify-start px-2.5 py-2 text-left" />}
        >
          {selectedAccount ? <AccountAvatar account={selectedAccount} size={28} /> : null}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {countryFlag(selectedAccount?.country) ? <span className="leading-none">{countryFlag(selectedAccount?.country)}</span> : null}
              <span className="truncate text-sm font-semibold text-kumo-strong">{displayName}</span>
            </div>
            <Badge className="mt-1" variant="success" appearance="dot">操作中</Badge>
          </div>
          <CaretDownIcon className={`ml-auto shrink-0 text-kumo-subtle transition-transform ${open ? 'rotate-180' : ''}`} size={16} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Content align="start" className="min-w-56">
          <DropdownMenu.Group>
            <DropdownMenu.Label>切り替えるLINEアカウント</DropdownMenu.Label>
            {accounts.map((account) => {
              const isSelected = account.id === selectedAccount?.id
              const name = account.displayName || account.name
              return (
                <DropdownMenu.Item
                  key={account.id}
                  selected={isSelected}
                  icon={<AccountAvatar account={account} size={24} />}
                  onClick={() => setSelectedAccountId(account.id)}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate">
                      {countryFlag(account.country) ? <span className="leading-none">{countryFlag(account.country)}</span> : null}
                      <span className="truncate">{name}</span>
                    </span>
                    {account.basicId ? <span className="block truncate text-xs text-kumo-subtle">{account.basicId}</span> : null}
                  </span>
                  {isSelected ? <CheckIcon className="shrink-0 text-kumo-success" size={16} weight="bold" /> : null}
                </DropdownMenu.Item>
              )
            })}
          </DropdownMenu.Group>
        </DropdownMenu.Content>
      </DropdownMenu>
    </div>
  )
}

function NavIcon({ d }: { d: string }) {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={d} />
    </svg>
  )
}

export default function Sidebar() {
  const pathname = usePathname()
  const [isOpen, setIsOpen] = useState(false)
  const [staffName, setStaffName] = useState<string | null>(null)
  const [staffRole, setStaffRole] = useState<string | null>(null)

  useEffect(() => {
    setStaffName(localStorage.getItem('lh_staff_name'))
    setStaffRole(localStorage.getItem('lh_staff_role'))
  }, [])

  // 未対応件数 polling — メニュー項目にバッジを出す。5 分間隔。
  // (裏の countUnanswered は messages_log 全走査を含む重い集計なので間隔は詰めない。)
  // チャット画面での status 変更・手動返信直後は UNANSWERED_REFRESH_EVENT で
  // 即時再取得する (ポーリング待ちだと操作してもバッジが減らないと感じるため)。
  const [unansweredCount, setUnansweredCount] = useState<number>(0)
  useEffect(() => {
    let cancelled = false
    // 連続操作で fetch が並走した際、遅い古いレスポンスが新しい値を上書きしない
    // ように発行順 seq でガードする。
    let seq = 0
    const fetchCount = async () => {
      const mySeq = ++seq
      try {
        const { api } = await import('@/lib/api')
        const res = await api.inbox.unanswered.count()
        if (!cancelled && mySeq === seq && res.success) setUnansweredCount(res.data.total)
      } catch {
        // サイレント失敗
      }
    }
    fetchCount()
    const id = setInterval(fetchCount, 5 * 60_000)
    const onRefresh = () => { void fetchCount() }
    window.addEventListener(UNANSWERED_REFRESH_EVENT, onRefresh)
    return () => {
      cancelled = true
      clearInterval(id)
      window.removeEventListener(UNANSWERED_REFRESH_EVENT, onRefresh)
    }
  }, [])

  useEffect(() => { setIsOpen(false) }, [pathname])
  useEffect(() => {
    document.body.style.overflow = isOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [isOpen])

  const isActive = (href: string) => href === '/' ? pathname === '/' : pathname.startsWith(href)

  const sidebarContent = (
    <>
      {/* ロゴ */}
      <div className="px-6 py-5 border-b border-gray-200">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-kumo-brand text-sm font-bold text-kumo-inverse">
            H
          </div>
          <div>
            <p className="text-sm font-bold text-gray-900 leading-tight">L Harness</p>
            <p className="text-xs text-gray-400">管理画面</p>
          </div>
        </div>
      </div>

      {/* アカウント切替 */}
      <AccountSwitcher />

      {/* ナビゲーション */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {menuSections.map((section, si) => (
          <div key={si}>
            {section.label && (
              <div className="pt-5 pb-2 px-3">
                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">{section.label}</p>
              </div>
            )}
            {section.items.filter((item) => {
              if (item.href === '/staff' && staffRole !== 'owner') return false
              if (item.href === '/accounts' && staffRole === 'staff') return false
              return true
            }).map((item) => {
              const active = isActive(item.href)
              const isDanger = 'danger' in item && item.danger
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                    active
                      ? isDanger ? 'bg-kumo-danger text-kumo-inverse' : 'bg-kumo-brand text-kumo-inverse'
                      : isDanger
                        ? 'text-red-500 hover:bg-red-50'
                        : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                  }`}
                >
                  <NavIcon d={item.icon} />
                  <span className="flex-1">{item.label}</span>
                  {item.href === '/notifications' && unansweredCount > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                        active ? 'bg-white text-rose-600' : 'bg-rose-500 text-white'
                      }`}
                    >
                      {unansweredCount > 99 ? '99+' : unansweredCount}
                    </span>
                  )}
                </Link>
              )
            })}
          </div>
        ))}
      </nav>

      {/* フッター */}
      <div className="border-t border-gray-200">
        {staffName && (
          <div className="px-3 py-2 text-xs text-gray-500 border-t border-gray-100">
            <div className="font-medium text-gray-700">{staffName}</div>
            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-medium mt-0.5 ${
              staffRole === 'owner' ? 'bg-yellow-100 text-yellow-800' :
              staffRole === 'admin' ? 'bg-blue-100 text-blue-800' :
              'bg-gray-100 text-gray-600'
            }`}>
              {staffRole === 'owner' ? 'オーナー' : staffRole === 'admin' ? '管理者' : 'スタッフ'}
            </span>
          </div>
        )}
        <div className="px-6 py-4 space-y-3">
        <div className="space-y-0.5">
          <p className="text-xs text-gray-400">L Harness v{appVersion}</p>
          <p className="text-[10px] text-gray-400 font-mono break-all">
            build {appCommitSha}{appBuildDate ? ` · ${appBuildDate}` : ''}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          icon={SignOutIcon}
          onClick={async () => {
            try {
              const apiUrl = getApiBase()
              if (apiUrl) {
                await fetch(`${apiUrl}/api/auth/logout`, {
                  method: 'POST',
                  credentials: 'include',
                })
              }
            } catch {
              // Local cleanup still logs the browser out if the network call fails.
            }
            localStorage.removeItem('lh_api_key')
            localStorage.removeItem('lh_csrf')
            localStorage.removeItem('lh_staff_name')
            localStorage.removeItem('lh_staff_role')
            window.location.href = withBasePath('/login')
          }}
          className="justify-start px-0 text-kumo-subtle hover:text-kumo-danger"
        >
          ログアウト
        </Button>
        </div>
      </div>
    </>
  )

  return (
    <>
      {/* モバイル: ハンバーガーヘッダー */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3">
        <Button
          type="button"
          shape="square"
          size="lg"
          variant="ghost"
          icon={isOpen ? XIcon : ListIcon}
          onClick={() => setIsOpen(!isOpen)}
          aria-label="メニュー"
        />
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-kumo-brand text-xs font-bold text-kumo-inverse">H</div>
          <p className="text-sm font-bold text-gray-900">L Harness</p>
        </div>
      </div>

      {/* モバイル: オーバーレイ */}
      {isOpen && <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setIsOpen(false)} />}

      {/* モバイル: スライドインサイドバー */}
      {/* h-dvh: 100vh だとモバイルの URL バー表示時に下端のログアウトボタンが
          可視領域の外に落ちてタップ不能になる */}
      <aside className={`lg:hidden fixed top-0 left-0 z-50 w-72 bg-white flex flex-col h-dvh transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="absolute top-4 right-4">
          <Button type="button" shape="square" size="lg" variant="ghost" icon={XIcon} onClick={() => setIsOpen(false)} aria-label="閉じる" />
        </div>
        {sidebarContent}
      </aside>

      {/* デスクトップ: 常時表示。max-h-full — バナー表示時に h-screen が行の高さ
          (viewport - バナー) を超えて行を押し広げないための上限。フルブリード画面
          (チャット) でコンポーザーが画面外へ押し出されるのを防ぐのが主目的で、
          通常ページでも行が definite height を持つ場合は同様に効く (無害)。 */}
      <aside className="hidden lg:flex w-64 bg-white border-r border-gray-200 flex-col h-screen max-h-full sticky top-0">
        {sidebarContent}
      </aside>
    </>
  )
}
