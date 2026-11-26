'use client'
// 認証状態を「枠の外」で管理する。
// 旧AuthGuardはチェック中にレイアウトごと全画面スピナーへ差し替えていたため、
// リロードのたびに画面全体が再マウントして見えた。加えて pathname 依存で
// 遷移のたびに再チェックしていたため、ページ移動のたびにスピナーが点滅した。
// - チェックはマウント時の1回だけ。チェック中もシェル（サイドバー等）を保持する
// - 前回セッションの証跡（localStorage の lh_csrf）があれば楽観的にシェルを
//   表示し、裏で /api/auth/session を検証する (stale-while-revalidate)
// - 検証に失敗したら /login へ誘導（従来どおり）
import { createContext, useContext, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { getApiBase } from '@/lib/api-base'

export type AuthStatus = 'checking' | 'ok'

const AuthContext = createContext<AuthStatus>('checking')

export function useAuthStatus(): AuthStatus {
  return useContext(AuthContext)
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [status, setStatus] = useState<AuthStatus>('checking')

  useEffect(() => {
    let cancelled = false

    // Verify the session via the HttpOnly cookie. /api/auth/session returns the
    // staff identity and refreshes the CSRF token if it was lost (e.g. reload).
    const checkSession = async () => {
      try {
        localStorage.removeItem('lh_api_key')
        const apiUrl = getApiBase()
        const res = await fetch(`${apiUrl}/api/auth/session`, { credentials: 'include' })
        if (!res.ok) throw new Error('unauthenticated')
        const data = await res.json()
        if (!data?.success || !data?.data) throw new Error('unauthenticated')
        if (data.data.name) localStorage.setItem('lh_staff_name', data.data.name)
        if (data.data.role) localStorage.setItem('lh_staff_role', data.data.role)
        if (data.csrfToken) localStorage.setItem('lh_csrf', data.csrfToken)
        if (!cancelled) setStatus('ok')
      } catch {
        if (!cancelled) router.replace('/login')
      }
    }

    // 前回ログインの証跡があれば、チェック完了を待たずにシェルを表示する。
    // セッションが切れていれば検証後に /login へ移る。
    try {
      if (localStorage.getItem('lh_csrf')) setStatus('ok')
    } catch {
      // localStorage unavailable
    }
    checkSession()
    return () => { cancelled = true }
  }, [router])

  return <AuthContext.Provider value={status}>{children}</AuthContext.Provider>
}
