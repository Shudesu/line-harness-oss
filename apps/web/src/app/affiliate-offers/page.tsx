'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * 旧「案件・承認」ページ。機能は /affiliates?tab=offers に統合された。
 * ブックマーク互換のため、このページは即リダイレクトする薄いページとして残す。
 * output: 'export'（静的エクスポート）構成では next/navigation の redirect() が
 * 使えないため、chats ページ同様クライアント側で router.replace する。
 */
export default function AffiliateOffersRedirectPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/affiliates?tab=offers')
  }, [router])

  return (
    <div className="p-8 text-center text-gray-400 text-sm">
      移動中...
    </div>
  )
}
