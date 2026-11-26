'use client'
import { usePathname } from 'next/navigation'
import Sidebar from './layout/sidebar'
import { UpdateBanner } from './update/update-banner'
import { QuotaBanner } from './quota-banner'
import { AuthProvider, useAuthState } from '@/contexts/auth-context'
import { AccountProvider } from '@/contexts/account-context'

// 認証チェック中もシェル（バナー・サイドバー）を保持し、コンテンツ領域だけを
// 部分スケルトンへ差し替える。旧実装は全画面スピナーでレイアウトごと消していた。
function ContentGate({ children, fullBleed }: { children: React.ReactNode; fullBleed: boolean }) {
  const { status, error, retry } = useAuthState()
  if (status === 'ok') {
    if (fullBleed) return <>{children}</>
    return <div className="px-4 pb-6 sm:px-6 lg:pt-8 lg:px-8 lg:pb-8">{children}</div>
  }
  if (status === 'error') {
    // 一時的な失敗ではログアウトさせず、シェルを保ったまま再試行を出す。
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-8" role="alert">
        <p>{error ?? 'セッション確認に失敗しました'}。時間をおいて再試行してください。</p>
        <button type="button" className="rounded border px-4 py-2" onClick={retry}>再試行</button>
      </div>
    )
  }
  if (fullBleed) {
    return (
      <div className="flex-1 flex flex-col min-h-0" aria-hidden="true">
        <div className="flex-1 p-4 space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className={`flex ${i % 2 ? 'justify-end' : 'justify-start'}`}>
              <div
                className="h-8 rounded-2xl bg-gray-100 animate-pulse"
                style={{ width: `${38 + ((i * 13) % 28)}%` }}
              />
            </div>
          ))}
        </div>
        <div className="p-3 border-t border-gray-200">
          <div className="h-14 rounded-2xl bg-gray-100 animate-pulse" />
        </div>
      </div>
    )
  }
  return (
    <div className="animate-pulse space-y-4 max-w-2xl" aria-hidden="true">
      <div className="h-8 w-1/3 rounded bg-gray-200" />
      <div className="h-28 rounded-xl bg-gray-100" />
      <div className="h-28 rounded-xl bg-gray-100" />
      <div className="h-28 rounded-xl bg-gray-100" />
    </div>
  )
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  const bypassPath = (pathname ?? '').replace(/\/+$/, '')
  if (bypassPath === '/login' || bypassPath === '/login/magic' || bypassPath === '/ui-preview') {
    return <>{children}</>
  }

  // チャット画面はフルブリード: 余白ラッパーを外し、シェルの残り高さを
  // ぴったり子に渡す。以前はページ側で負マージン + h-[calc(100vh-72px)] で
  // シェルの余白を打ち消していたが、100vh はバナー表示時やモバイルの URL バー
  // 表示時に実際の可視領域より大きくなり、コンポーザー（入力欄・送信ボタン）が
  // 画面外にはみ出して「ボタンが数 px しか押せない」状態を生んでいた。
  // 判定は末尾スラッシュを剥がした上で startsWith — 完全一致だと trailingSlash
  // 設定や将来の /chats/[id] で padded レイアウトに落ち、flex-1 が解決できず
  // チャット UI 全体が高さ 0 に潰れる (sidebar のアクティブ判定と同じ流儀)。
  const normalizedPath = (pathname ?? '').replace(/\/+$/, '')
  const isFullBleed = normalizedPath === '/chats' || normalizedPath.startsWith('/chats/')

  return (
    <AuthProvider>
      <AccountProvider>
        <div className={`flex flex-col ${isFullBleed ? 'h-dvh' : 'min-h-screen'}`}>
          {/* Phase 6: banner above sidebar+header so it pins to the top of the
              admin shell. Renders nothing while loading; one of latest/fork/
              upgrade once /admin/version + manifest resolve. */}
          <UpdateBanner />
          <QuotaBanner />
          <div className="flex flex-1 min-h-0">
            <Sidebar />
            <main
              className={`flex-1 pt-[72px] lg:pt-0 ${
                isFullBleed ? 'min-w-0 min-h-0 flex flex-col overflow-hidden' : 'overflow-auto'
              }`}
            >
              {isFullBleed ? (
                <ContentGate fullBleed>{children}</ContentGate>
              ) : (
                <div className="px-4 pb-6 sm:px-6 lg:pt-8 lg:px-8 lg:pb-8">
                  <ContentGate fullBleed={false}>{children}</ContentGate>
                </div>
              )}
            </main>
          </div>
        </div>
      </AccountProvider>
    </AuthProvider>
  )
}
