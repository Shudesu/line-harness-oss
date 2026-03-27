'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { api, type Job } from '@/lib/api'
import StatusBadge from '@/components/status-badge'

const statusOptions = [
  { value: '', label: 'すべて' },
  { value: 'open', label: '公開中' },
  { value: 'filled', label: '充足' },
  { value: 'completed', label: '完了' },
  { value: 'cancelled', label: 'キャンセル' },
]

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [dateFilter, setDateFilter] = useState('')

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    try {
      const params: { status?: string; fromDate?: string } = {}
      if (statusFilter) params.status = statusFilter
      if (dateFilter) params.fromDate = dateFilter
      const res = await api.jobs.list(params)
      if (res.success) setJobs(res.data)
    } catch {
      setError('データの取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, dateFilter])

  useEffect(() => { fetchJobs() }, [fetchJobs])

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    const weekdays = ['日', '月', '火', '水', '木', '金', '土']
    return `${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()]})`
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">求人管理</h1>
          <p className="text-sm text-gray-500 mt-1">{jobs.length}件の求人</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/jobs/import"
            className="px-4 py-2 text-sm font-medium rounded-lg border-2 transition-colors hover:bg-orange-50"
            style={{ borderColor: '#FF6B35', color: '#FF6B35' }}
          >
            一括取込
          </Link>
          <Link
            href="/jobs/new"
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#FF6B35' }}
          >
            + 新規作成
          </Link>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4">
        <div className="flex gap-1 bg-white border border-gray-200 rounded-lg p-1">
          {statusOptions.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                statusFilter === opt.value ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <input
          type="date"
          value={dateFilter}
          onChange={(e) => setDateFilter(e.target.value)}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-orange-500"
        />
        {dateFilter && (
          <button onClick={() => setDateFilter('')} className="text-xs text-gray-500 hover:text-gray-700">
            日付クリア
          </button>
        )}
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="px-6 py-4 border-b border-gray-100 animate-pulse">
              <div className="h-5 w-48 bg-gray-100 rounded mb-2" />
              <div className="h-4 w-32 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      ) : jobs.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <p className="text-gray-500">求人が見つかりません</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">園名</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">日付</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">時間</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">時給</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">応募/定員</th>
                  <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">ステータス</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {jobs.map((job) => (
                  <tr key={job.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4">
                      <p className="text-sm font-medium text-gray-900">{job.nurseryName}</p>
                      {job.station && <p className="text-xs text-gray-500">{job.station}</p>}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-700">{formatDate(job.workDate)}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{job.startTime}〜{job.endTime}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">{job.hourlyRate ? `¥${job.hourlyRate.toLocaleString()}` : '-'}</td>
                    <td className="px-6 py-4 text-sm text-gray-700">
                      {job.remainingSlots !== undefined
                        ? `${job.capacity - job.remainingSlots}/${job.capacity}`
                        : `- /${job.capacity}`
                      }
                    </td>
                    <td className="px-6 py-4"><StatusBadge status={job.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
