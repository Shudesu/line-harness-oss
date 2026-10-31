'use client'

import { usePathname } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { accountTone, pageScope } from '@/lib/account-look'

// 画面のいちばん上に「いまどのアカウントを操作しているか」を出す帯。
// アカウント別の画面ではアカウントの色で、全アカウント共通の画面では灰色で出す。
export default function AccountBanner() {
  const pathname = usePathname()
  const { selectedAccount, accounts, loading } = useAccount()
  const scope = pageScope(pathname)

  if (loading || !selectedAccount || scope === 'none') return null

  const name = selectedAccount.displayName || selectedAccount.name

  if (scope === 'shared') {
    return (
      <div className="mb-6 flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-100 px-4 py-2.5 text-sm text-gray-600">
        <svg className="h-4 w-4 shrink-0 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>
          この画面は<strong className="font-semibold text-gray-800">全アカウント共通</strong>です。
          {accounts.length > 1 && 'ほかのアカウントの分もまとめて表示されます。'}
        </span>
      </div>
    )
  }

  const tone = accountTone(selectedAccount.id, accounts)
  return (
    <div
      className="mb-6 flex items-center gap-3 rounded-lg px-4 py-2.5 text-sm"
      style={{ backgroundColor: tone.soft, borderLeft: `6px solid ${tone.solid}` }}
    >
      <span className="text-gray-600">操作中のアカウント</span>
      <span className="font-bold" style={{ color: tone.text }}>{name}</span>
      {typeof selectedAccount.stats?.friendCount === 'number' && (
        <span className="text-xs text-gray-500">友だち {selectedAccount.stats.friendCount.toLocaleString('ja-JP')} 人</span>
      )}
      {accounts.length > 1 && (
        <span className="ml-auto hidden text-xs text-gray-500 sm:inline">切り替えは左上から</span>
      )}
    </div>
  )
}
