'use client'
import { usePathname } from 'next/navigation'
import Sidebar from './layout/sidebar'
import { UpdateBanner } from './update/update-banner'
import { QuotaBanner } from './quota-banner'
import AuthGuard from './auth-guard'
import { AccountProvider } from '@/contexts/account-context'

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()

  if (pathname === '/login' || pathname === '/ui-preview') {
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
    <AuthGuard>
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
                children
              ) : (
                <div className="px-4 pb-6 sm:px-6 lg:pt-8 lg:px-8 lg:pb-8">
                  {children}
                </div>
              )}
            </main>
          </div>
        </div>
      </AccountProvider>
    </AuthGuard>
  )
}
