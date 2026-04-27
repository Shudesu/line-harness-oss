'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checked, setChecked] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    if (pathname === '/login') {
      setChecked(true)
      return
    }

    const key = localStorage.getItem('lh_api_key')
    if (!key) {
      router.replace('/login')
      return
    }

    const validate = async () => {
      try {
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'
        const res = await fetch(`${apiUrl}/api/staff/me`, {
          headers: { Authorization: `Bearer ${key}` },
        })
        if (cancelled) return
        if (res.status === 401) {
          localStorage.removeItem('lh_api_key')
          localStorage.removeItem('lh_staff_name')
          localStorage.removeItem('lh_staff_role')
          router.replace('/login?expired=1')
          return
        }
        if (!res.ok) {
          setError(`管理APIに接続できません (${res.status})`)
          setChecked(true)
          return
        }
        setChecked(true)
      } catch {
        if (!cancelled) {
          setError('管理APIに接続できません')
          setChecked(true)
        }
      }
    }

    validate()
    return () => {
      cancelled = true
    }
  }, [pathname, router])

  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-[3px] border-gray-200 border-t-green-500 rounded-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-base font-semibold text-gray-900">管理画面に接続できません</h1>
          <p className="mt-2 text-sm text-red-700">{error}</p>
          <button
            type="button"
            onClick={() => router.replace('/login')}
            className="mt-4 rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            ログインし直す
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
