'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { useAccount } from '@/contexts/account-context'
import { extensionFrameUrl } from '@/lib/admin-extensions'
import { useAdminExtensions } from '@/components/extensions/use-admin-extensions'

function ExtensionPage() {
  const params = useSearchParams()
  const { selectedAccountId } = useAccount()
  const { extensions, loading, error } = useAdminExtensions()
  const [adminOrigin, setAdminOrigin] = useState('')
  const frame = useRef<HTMLIFrameElement>(null)
  useEffect(() => { setAdminOrigin(window.location.origin) }, [])
  const extension = extensions.find(item => item.id === params.get('id'))
  const src = extension && adminOrigin
    ? extensionFrameUrl(extension, params.get('path'), selectedAccountId, adminOrigin) : null
  useEffect(() => {
    if (src) frame.current?.contentWindow?.postMessage(
      { type: 'lh:account-changed', accountId: selectedAccountId }, new URL(src).origin)
  }, [src, selectedAccountId])

  if (loading || !adminOrigin) return <p role="status">拡張機能を読み込んでいます…</p>
  if (error) return <p role="alert">拡張機能を読み込めませんでした。ページを再読み込みしてください。</p>
  if (!extension) return <p role="status">指定された拡張機能は利用できません。</p>
  if (!src) return <p role="alert">この拡張機能のURLまたはパスは表示できません。</p>
  return (
    <section className="flex flex-col gap-4">
      <h1 className="text-xl font-bold text-gray-900">{extension.label}</h1>
      <p className="text-sm text-gray-500">外部の拡張機能です。ログインと操作権限は拡張機能側で管理されます。</p>
      <iframe ref={frame} title={extension.label} src={src}
        onLoad={() => frame.current?.contentWindow?.postMessage(
          { type: 'lh:account-changed', accountId: selectedAccountId }, new URL(src).origin)}
        className="w-full min-h-[70vh] rounded-lg border border-gray-200 bg-white"
        sandbox="allow-scripts allow-forms allow-same-origin allow-downloads allow-popups"
        referrerPolicy="no-referrer" allow="" />
    </section>
  )
}

export default function Page() {
  return <Suspense fallback={<p role="status">拡張機能を読み込んでいます…</p>}><ExtensionPage /></Suspense>
}
