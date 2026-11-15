'use client'

// KIDOUインターン専用の画面の入口。ほかのアカウントを開いているときは中身を出さない（取り違え防止）
import type { ReactNode } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { isInternAccount } from '@/lib/account-look'

export default function InternOnly({ title, children }: { title: string; children: ReactNode }) {
  const { selectedAccount, loading } = useAccount()
  if (loading) return <p className="text-sm text-gray-500">読み込んでいます…</p>
  if (selectedAccount && !isInternAccount(selectedAccount)) {
    const name = selectedAccount.displayName || selectedAccount.name
    return (
      <div>
        <Header title={title} />
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-sm text-gray-600">
          <p>この画面は KIDOUインターン専用です。いま開いているアカウント（{name}）では使いません。</p>
          <p className="mt-2">
            見るときは、左上の「操作中のアカウント」を KIDOUインターンに切り替えてください。
            <Link href="/" className="ml-2 text-green-700 underline">ダッシュボードへ戻る</Link>
          </p>
        </div>
      </div>
    )
  }
  return <>{children}</>
}
