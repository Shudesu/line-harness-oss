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
      <section className="relative hidden overflow-hidden bg-[#06C755] px-12 py-10 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(255,255,255,0.30),transparent_28%),radial-gradient(circle_at_86%_12%,rgba(255,255,255,0.18),transparent_24%),linear-gradient(145deg,#06C755_0%,#06C755_48%,#02B84C_100%)]" />
        <div className="absolute -bottom-24 -left-16 h-72 w-72 rounded-full bg-white/15 blur-3xl" />
        <div className="absolute right-8 top-28 h-32 w-32 rounded-[2rem] border border-white/15 rotate-12" />
        <div className="absolute bottom-20 right-20 h-24 w-24 rounded-full border border-white/20" />

        <div className="relative flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-white text-lg font-black text-[#06C755] shadow-lg shadow-green-900/15">
            {PRODUCT_INITIAL}
          </div>
          <div>
            <p className="text-sm font-bold tracking-wide">{PRODUCT_NAME}</p>
            <p className="text-xs text-white/75">LINE公式アカウント運用</p>
          </div>
        </div>

        <div className="relative max-w-xl">
          <p className="mb-4 inline-flex rounded-full bg-white/18 px-3 py-1 text-xs font-bold text-white ring-1 ring-white/25">
            LINEっぽく、すぐ使える管理画面
          </p>
          <h1 className="text-5xl font-black leading-[1.04] tracking-tight text-white drop-shadow-sm xl:text-6xl">
            {PRODUCT_TAGLINE}
          </h1>
          <p className="mt-6 max-w-md text-base leading-7 text-white/82">
            友だちとの会話、配信、未返信チェックをひとつの流れで確認できます。
          </p>
        </div>

        <div className="relative max-w-[540px] rounded-[34px] bg-white/96 p-4 text-gray-950 shadow-[0_26px_80px_rgba(0,80,36,0.28)]">
          <div className="rounded-[26px] bg-[#f2f7f3] p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#06C755] text-sm font-black text-white">
                  ラ
                </div>
                <div>
                  <p className="text-sm font-black">今日のLINE対応</p>
                  <p className="text-xs text-gray-500">未返信・配信・タグをまとめて確認</p>
                </div>
              </div>
              <span className="rounded-full bg-[#06C755] px-3 py-1 text-xs font-bold text-white">
                Online
              </span>
            </div>

            <div className="space-y-3">
              <div className="flex items-end gap-2">
                <div className="h-8 w-8 rounded-full bg-white shadow-sm" />
                <div className="max-w-[72%] rounded-3xl rounded-bl-md bg-white px-4 py-3 text-sm font-medium shadow-sm">
                  明日の予約、まだ空いてますか？
                </div>
              </div>
              <div className="flex justify-end">
                <div className="max-w-[74%] rounded-3xl rounded-br-md bg-[#06C755] px-4 py-3 text-sm font-bold text-white shadow-sm">
                  空き枠を確認してご案内しますね。
                </div>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                {['未返信 3件', '予約見込み', '配信OK'].map((label) => (
                  <span key={label} className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-gray-600 shadow-sm">
                    {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
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
