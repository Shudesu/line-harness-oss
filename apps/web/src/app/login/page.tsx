'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { PRODUCT_INITIAL, PRODUCT_NAME, PRODUCT_TAGLINE } from '@/lib/branding'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL
      if (!apiUrl) {
        setError('NEXT_PUBLIC_API_URL is not set in build env')
        setLoading(false)
        return
      }
      // Exchange admin credentials for an HttpOnly session cookie. API keys
      // are for SDK/MCP/server-to-server access and should not be pasted into
      // the human-facing dashboard.
      const res = await fetch(`${apiUrl}/api/auth/login`, {
        method: 'POST',
        credentials: 'include',
        // Keep the login POST a CORS-simple request in local dev. The Worker
        // still parses this JSON body, and avoiding an OPTIONS preflight works
        // around Cloudflare/Vite dev's incomplete credentialed CORS response.
        headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
        body: JSON.stringify({ email, password }),
      })

      if (res.ok) {
        localStorage.removeItem('lh_api_key')
        try {
          const loginData = await res.json()
          if (loginData.success && loginData.data) {
            localStorage.setItem('lh_staff_name', loginData.data.name)
            localStorage.setItem('lh_staff_role', loginData.data.role)
          }
          // Cache the CSRF token for mutating requests (double-submit).
          if (loginData.csrfToken) {
            localStorage.setItem('lh_csrf', loginData.csrfToken)
          }
        } catch {
          // Profile / CSRF caching is best-effort.
        }
        router.push('/')
      } else if (res.status === 401) {
        setError('メールアドレスまたはパスワードが正しくありません')
      } else {
        // Surface topology / configuration errors (e.g. cross-site cookie guard).
        let message = 'ログインに失敗しました'
        try {
          const data = await res.json()
          if (data?.error) message = data.error
        } catch {
          // keep default message
        }
        setError(message)
      }
    } catch {
      setError('接続に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f3fbf6] text-gray-900 lg:grid lg:grid-cols-[minmax(0,1.05fr)_minmax(420px,0.95fr)]">
      <section className="relative hidden overflow-hidden bg-[#06170d] px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -left-24 top-16 h-72 w-72 rounded-full bg-[#06C755]/25 blur-3xl" />
        <div className="absolute bottom-0 right-0 h-[420px] w-[420px] translate-x-1/4 translate-y-1/4 rounded-full bg-emerald-300/10 blur-3xl" />

        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#06C755] text-lg font-black shadow-lg shadow-green-950/30">
            {PRODUCT_INITIAL}
          </div>
          <div>
            <p className="text-sm font-bold tracking-wide">{PRODUCT_NAME}</p>
            <p className="text-xs text-emerald-100/70">管理コンソール</p>
          </div>
        </div>

        <div className="relative max-w-xl">
          <p className="mb-4 inline-flex rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-emerald-100">
            LINE公式アカウント運用をひとつに
          </p>
          <h1 className="text-5xl font-black leading-[1.05] tracking-tight xl:text-6xl">
            {PRODUCT_TAGLINE}
          </h1>
          <p className="mt-6 max-w-md text-base leading-7 text-emerald-50/75">
            配信、チャット、フォーム、分析を同じ作業台で確認。次に触るべき場所がすぐ分かる管理画面です。
          </p>
        </div>

        <div className="relative grid max-w-2xl grid-cols-3 gap-px overflow-hidden rounded-3xl border border-white/10 bg-white/10 text-sm">
          {['友だち管理', 'シナリオ配信', '未返信確認'].map((label) => (
            <div key={label} className="bg-white/[0.04] px-4 py-4 text-emerald-50/85">
              <span className="block text-xs text-emerald-100/50">Ready</span>
              <span className="mt-1 block font-semibold">{label}</span>
            </div>
          ))}
        </div>
      </section>

      <main className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[430px]">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#06C755] text-lg font-black text-white">
              {PRODUCT_INITIAL}
            </div>
            <div>
              <p className="font-bold text-gray-950">{PRODUCT_NAME}</p>
              <p className="text-xs text-gray-500">{PRODUCT_TAGLINE}</p>
            </div>
          </div>

          <div className="rounded-[28px] bg-white p-7 shadow-[0_24px_80px_rgba(15,23,42,0.12)] ring-1 ring-gray-950/5 sm:p-8">
            <div className="mb-7">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[#06C755]">Admin login</p>
              <h2 className="mt-3 text-2xl font-bold tracking-tight text-gray-950">管理画面にログイン</h2>
              <p className="mt-2 text-sm leading-6 text-gray-500">
                メールアドレスとパスワードで安全にログインします。
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <div>
                <label htmlFor="admin-email" className="mb-2 block text-sm font-semibold text-gray-700">
                  メールアドレス
                </label>
                <input
                  id="admin-email"
                  name="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="owner@example.com"
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3 text-sm transition focus:border-[#06C755] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#06C755]/10"
                  autoComplete="username"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'login-error' : undefined}
                  autoFocus
                  required
                />
              </div>

              <div>
                <label htmlFor="admin-password" className="mb-2 block text-sm font-semibold text-gray-700">
                  パスワード
                </label>
                <input
                  id="admin-password"
                  name="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="パスワードを入力"
                  className="w-full rounded-2xl border border-gray-200 bg-gray-50/80 px-4 py-3 text-sm transition focus:border-[#06C755] focus:bg-white focus:outline-none focus:ring-4 focus:ring-[#06C755]/10"
                  autoComplete="current-password"
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'login-error' : undefined}
                  required
                />
              </div>

              {error && (
                <p id="login-error" className="rounded-2xl bg-red-50 px-4 py-3 text-sm text-red-700 ring-1 ring-red-100">
                  {error}
                </p>
              )}

              <button
                type="submit"
                disabled={loading || !email || !password}
                className="flex w-full items-center justify-center rounded-2xl bg-[#06C755] px-4 py-3.5 text-sm font-bold text-white shadow-lg shadow-green-600/20 transition hover:-translate-y-0.5 hover:bg-[#05A847] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? 'ログイン中...' : 'ログインして開始'}
              </button>
            </form>
          </div>
        </div>
      </main>
    </div>
  )
}
