'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { api, type Booking } from '@/lib/api'
import StatusBadge from '@/components/status-badge'

const BRAND_COLOR = '#FF6B35'

type Stats = {
  openJobs: number
  pendingBookings: number
  weekJobs: number
  nurseries: number
}

function StatCard({ title, value, loading, href, icon, color }: {
  title: string; value: number; loading: boolean; href: string; icon: string; color: string
}) {
  return (
    <Link href={href} className="block bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-gray-500 mb-2">{title}</p>
          {loading
            ? <div className="h-8 w-20 bg-gray-100 rounded animate-pulse" />
            : <p className="text-3xl font-bold">{value.toLocaleString('ja-JP')}</p>
          }
        </div>
        <div className="w-10 h-10 rounded-lg flex items-center justify-center text-white" style={{ backgroundColor: color }}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={icon} />
          </svg>
        </div>
      </div>
    </Link>
  )
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats>({ openJobs: 0, pendingBookings: 0, weekJobs: 0, nurseries: 0 })
  const [pendingList, setPendingList] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [processing, setProcessing] = useState<string | null>(null)

  const getMonday = () => {
    const now = new Date()
    const day = now.getDay()
    const diff = now.getDate() - day + (day === 0 ? -6 : 1)
    const monday = new Date(now.setDate(diff))
    return monday.toISOString().split('T')[0]
  }

  const fetchData = useCallback(async () => {
    try {
      const [openRes, pendingRes, weekRes, nurseryRes] = await Promise.allSettled([
        api.jobs.list({ status: 'open' }),
        api.bookings.pending(),
        api.jobs.list({ fromDate: getMonday() }),
        api.nurseries.list(),
      ])

      setStats({
        openJobs: openRes.status === 'fulfilled' ? openRes.value.data.length : 0,
        pendingBookings: pendingRes.status === 'fulfilled' ? pendingRes.value.data.length : 0,
        weekJobs: weekRes.status === 'fulfilled' ? weekRes.value.data.length : 0,
        nurseries: nurseryRes.status === 'fulfilled' ? nurseryRes.value.data.length : 0,
      })

      if (pendingRes.status === 'fulfilled') {
        setPendingList(pendingRes.value.data.slice(0, 5))
      }
    } catch { /* handled by individual settles */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const handleApprove = async (id: string) => {
    setProcessing(id)
    try {
      await api.bookings.approve(id)
      await fetchData()
    } catch { /* ignore */ }
    setProcessing(null)
  }

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return '-'
    const d = new Date(dateStr)
    const weekdays = ['日', '月', '火', '水', '木', '金', '土']
    return `${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()]})`
  }

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">ダッシュボード</h1>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
        <StatCard title="公開中の求人" value={stats.openJobs} loading={loading} href="/jobs" color={BRAND_COLOR}
          icon="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2" />
        <StatCard title="承認待ち" value={stats.pendingBookings} loading={loading} href="/bookings" color="#EAB308"
          icon="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        <StatCard title="今週の求人" value={stats.weekJobs} loading={loading} href="/jobs" color="#3B82F6"
          icon="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        <StatCard title="登録園数" value={stats.nurseries} loading={loading} href="/nurseries" color="#8B5CF6"
          icon="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5" />
      </div>

      {/* Pending bookings inline */}
      <div className="bg-white rounded-lg border border-gray-200">
        <div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
          <h2 className="font-semibold text-gray-900">承認待ちの応募</h2>
          <Link href="/bookings" className="text-sm font-medium hover:underline" style={{ color: BRAND_COLOR }}>
            すべて見る →
          </Link>
        </div>

        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-12 bg-gray-50 rounded animate-pulse" />
            ))}
          </div>
        ) : pendingList.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm">承認待ちの応募はありません</div>
        ) : (
          <div className="divide-y divide-gray-100">
            {pendingList.map((booking) => (
              <div key={booking.id} className="px-6 py-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0">
                  {booking.friendPictureUrl ? (
                    <img src={booking.friendPictureUrl} alt="" className="w-8 h-8 rounded-full shrink-0" />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm font-medium shrink-0">
                      {(booking.friendDisplayName || '?').charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{booking.friendDisplayName || '名前不明'}</p>
                    <p className="text-xs text-gray-500 truncate">
                      {booking.nurseryName || '-'} ・ {formatDate(booking.workDate || booking.startAt)}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleApprove(booking.id)}
                  disabled={processing === booking.id}
                  className="px-3 py-1.5 text-xs font-medium text-white rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50 shrink-0"
                  style={{ backgroundColor: '#22C55E' }}
                >
                  {processing === booking.id ? '...' : '承認'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
