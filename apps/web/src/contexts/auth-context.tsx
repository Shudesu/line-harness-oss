'use client'
// 認証状態を「枠の外」で管理する。
// 旧AuthGuardはチェック中にレイアウトごと全画面スピナーへ差し替えていたため、
// リロードのたびに画面全体が再マウントして見えた。加えて pathname 依存で
// 遷移のたびに再チェックしていたため、ページ移動のたびにスピナーが点滅した。
// - チェックはマウント時の1回だけ。チェック中もシェル（サイドバー等）を保持する
// - 前回セッションの証跡（localStorage の lh_csrf）があれば楽観的にシェルを
//   表示し、裏で /api/auth/session を検証する (stale-while-revalidate)
// - 確定した 401 のときだけ /login へ誘導する。一時的な失敗（5xx・通信断など）は
//   ログアウトさせず、確認前ならコンテンツ領域に再試行ボタンを出す
// - strict staff は「/」に来たら /chats へ送る（遷移のたびに判定、再検証はしない）
import React, { createContext, useContext, useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { getApiBase } from '@/lib/api-base'
import { cacheAdminSession, readAdminSession, SessionCheckError } from '@/lib/admin-session'
import type { AdminSession } from '@/lib/admin-session'

export type AuthStatus = 'checking' | 'ok' | 'error'

type AuthState = { status: AuthStatus; error: string | null; retry: () => void }

const AuthContext = createContext<AuthState>({ status: 'checking', error: null, retry: () => {} })

export function useAuthStatus(): AuthStatus {
  return useContext(AuthContext).status
}

export function useAuthState(): AuthState {
  return useContext(AuthContext)
}

function hasPreviousSession(pathname: string | null): boolean {
  try {
    const storage = window.localStorage
    if (!storage.getItem('lh_csrf')) return false
    // strict staff は「/」を見られない。検証が終わって /chats へ送るまで
    // ダッシュボードを楽観表示しない（ダッシュボードのAPIも呼ばせない）。
    if (pathname === '/' && storage.getItem('lh_staff_role') === 'staff' && storage.getItem('lh_staff_policy') === 'strict') return false
    return true
  } catch {
    return false // localStorage unavailable
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [status, setStatus] = useState<AuthStatus>('checking')
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<AdminSession | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    const controller = new AbortController()
    setError(null)
    // 前回ログインの証跡があれば、チェック完了を待たずにシェルを表示する。
    // セッションが切れていれば検証後に /login へ移る。
    if (hasPreviousSession(pathname)) setStatus('ok')

    // Verify the session via the HttpOnly cookie. /api/auth/session returns the
    // staff identity and refreshes the CSRF token if it was lost (e.g. reload).
    const checkSession = async () => {
      try {
        const data = await readAdminSession(getApiBase(), controller.signal)
        if (cancelled) return
        if (!data) {
          router.replace('/login')
          return
        }
        cacheAdminSession(data, () => window.localStorage)
        window.dispatchEvent(new Event('lh-auth-updated'))
        setSession(data)
        setStatus('ok')
      } catch (err) {
        if (cancelled) return
        setError(err instanceof SessionCheckError ? err.message : 'セッション確認に失敗しました')
        // 楽観表示中ならシェルとコンテンツを保ったまま（各画面のAPIが個別に失敗を出す）。
        setStatus(current => (current === 'ok' ? 'ok' : 'error'))
      }
    }

    checkSession()
    return () => { cancelled = true; controller.abort() }
    // pathname is read only for the first optimistic decision; navigation must
    // not re-run the session check.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router, attempt])

  // 使用中にセッションが切れた場合: どこかのAPIが 401 を返したら1回だけ再確認する。
  // 確認中の重複イベントは無視する。
  useEffect(() => {
    let checking = false
    const controller = new AbortController()
    const onExpired = async () => {
      if (checking) return
      checking = true
      try {
        const data = await readAdminSession(getApiBase(), controller.signal)
        if (!data) router.replace('/login')
      } catch {
        // 一時エラーではログアウトさせない
      } finally {
        checking = false
      }
    }
    window.addEventListener('lh-auth-expired', onExpired)
    return () => { window.removeEventListener('lh-auth-expired', onExpired); controller.abort() }
  }, [router])

  useEffect(() => {
    if (!session) return
    if (session.data.role === 'staff' && session.data.staffRolePolicy === 'strict' && pathname === '/') {
      router.replace('/chats')
    }
  }, [session, pathname, router])

  const retry = () => {
    setStatus('checking')
    setAttempt(value => value + 1)
  }

  return <AuthContext.Provider value={{ status, error, retry }}>{children}</AuthContext.Provider>
}
