'use client'
import { useEffect, useState, useCallback } from 'react'
import { api, type Booking } from '@/lib/api'
import StatusBadge from '@/components/status-badge'

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [processing, setProcessing] = useState<string | null>(null)

  const fetchBookings = useCallback(async () => {
    try {
      setError('')
      const res = await api.bookings.pending()
      if (res.success) setBookings(res.data)
    } catch {
      setError('データの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchBookings() }, [fetchBookings])

  const handleApprove = async (id: string) => {
    setProcessing(id)
    try {
      await api.bookings.approve(id)
      await fetchBookings()
    } catch {
      setError('承認に失敗しました')
    } finally {
      setProcessing(null)
    }
  }

  const handleDeny = async (id: string) => {
    if (!confirm('この応募を否認しますか？')) return
    setProcessing(id)
    try {
      await api.bookings.deny(id)
      await fetchBookings()
    } catch {
      setError('否認に失敗しました')
    } finally {
      setProcessing(null)
    }
  }

  const formatDate = (dateStr?: string | null) => {
    if (!dateStr) return '-'
    const d = new Date(dateStr)
    const weekdays = ['日', '月', '火', '水', '木', '金', '土']
    return `${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()]})`
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">応募管理</h1>
          <p className="text-sm text-gray-500 mt-1">承認待ちの応募一覧</p>
        </div>
        <button
          onClick={() => { setLoading(true); fetchBookings() }}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          更新
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>
      )}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse">
              <div className="h-5 w-48 bg-gray-100 rounded mb-3" />
              <div className="h-4 w-32 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <svg className="w-12 h-12 text-gray-300 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
          </svg>
          <p className="text-gray-500">承認待ちの応募はありません</p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((booking) => (
            <div key={booking.id} className="bg-white rounded-lg border border-gray-200 p-5 hover:shadow-sm transition-shadow">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-3 min-w-0">
                  {booking.friendPictureUrl ? (
                    <img src={booking.friendPictureUrl} alt="" className="w-10 h-10 rounded-full shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 font-medium shrink-0">
                      {(booking.friendDisplayName || '?').charAt(0)}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-gray-900">{booking.friendDisplayName || '名前不明'}</p>
                      <StatusBadge status={booking.approvalStatus} />
                      {booking.qualificationType && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                          {booking.qualificationType}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-600 mt-1">
                      {booking.nurseryName || booking.title || '-'} ・ {formatDate(booking.workDate || booking.startAt)}
                      {booking.startTime && booking.endTime && ` ${booking.startTime}〜${booking.endTime}`}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => handleApprove(booking.id)}
                    disabled={processing === booking.id}
                    className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
                    style={{ backgroundColor: '#22C55E' }}
                  >
                    {processing === booking.id ? '...' : '承認'}
                  </button>
                  <button
                    onClick={() => handleDeny(booking.id)}
                    disabled={processing === booking.id}
                    className="px-4 py-2 text-sm font-medium text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                  >
                    否認
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
