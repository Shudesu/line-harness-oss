'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'

export default function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checked, setChecked] = useState(false)

  useEffect(() => {
    // Auto-auth: if env key is set and localStorage is empty, auto-login
    const autoKey = process.env.NEXT_PUBLIC_AUTO_AUTH_KEY
    if (autoKey && !localStorage.getItem('lh_api_key')) {
      localStorage.setItem('lh_api_key', autoKey)
    }

    if (pathname === '/login') {
      // If auto-auth is configured, skip login page
      if (autoKey && localStorage.getItem('lh_api_key')) {
        router.replace('/')
        return
      }
      setChecked(true)
      return
    }

    const key = localStorage.getItem('lh_api_key')
    if (!key) {
      router.replace('/login')
    } else {
      setChecked(true)
    }
  }, [pathname, router])

  if (!checked) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin w-8 h-8 border-[3px] border-gray-200 border-t-green-500 rounded-full" />
      </div>
    )
  }

  return <>{children}</>
}
