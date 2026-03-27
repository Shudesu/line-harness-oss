'use client'
import { useEffect, useState, useCallback } from 'react'
import { api, type Job, type AttendanceRecord } from '@/lib/api'

export default function AttendancePage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [selectedJobId, setSelectedJobId] = useState('')
  const [records, setRecords] = useState<AttendanceRecord[]>([])
  const [qrToken, setQrToken] = useState('')
  const [loadingJobs, setLoadingJobs] = useState(true)
  const [loadingRecords, setLoadingRecords] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    api.jobs.list().then((res) => {
      if (res.success) {
        const sorted = res.data.sort((a, b) => b.workDate.localeCompare(a.workDate))
        setJobs(sorted)
      }
      setLoadingJobs(false)
    })
  }, [])

  const fetchAttendance = useCallback(async (jobId: string) => {
    if (!jobId) return
    setLoadingRecords(true)
    setError('')
    try {
      const [attendanceRes, qrRes] = await Promise.allSettled([
        api.attendance.byJob(jobId),
        api.attendance.qrToken(jobId),
      ])
      if (attendanceRes.status === 'fulfilled' && attendanceRes.value.success) {
        setRecords(attendanceRes.value.data)
      }
      if (qrRes.status === 'fulfilled' && qrRes.value.success) {
        setQrToken(qrRes.value.data.token)
      }
    } catch {
      setError('データの取得に失敗しました')
    } finally {
      setLoadingRecords(false)
    }
  }, [])

  useEffect(() => {
    if (selectedJobId) fetchAttendance(selectedJobId)
  }, [selectedJobId, fetchAttendance])

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    const weekdays = ['日', '月', '火', '水', '木', '金', '土']
    return `${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()]})`
  }

  const formatTime = (dateStr?: string | null) => {
    if (!dateStr) return '-'
    const d = new Date(dateStr)
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`
  }

  const selectedJob = jobs.find((j) => j.id === selectedJobId)

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-6">勤怠確認</h1>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      {/* Job selector */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">求人を選択</label>
        {loadingJobs ? (
          <div className="h-10 w-full bg-gray-100 rounded-lg animate-pulse" />
        ) : (
          <select
            value={selectedJobId}
            onChange={(e) => setSelectedJobId(e.target.value)}
            className="w-full max-w-lg px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
          >
            <option value="">求人を選択してください</option>
            {jobs.map((job) => (
              <option key={job.id} value={job.id}>
                {formatDate(job.workDate)} {job.nurseryName} {job.startTime}〜{job.endTime}
              </option>
            ))}
          </select>
        )}
      </div>

      {selectedJobId && (
        <>
          {/* Job info + QR token */}
          {selectedJob && (
            <div className="bg-white rounded-lg border border-gray-200 p-5 mb-6">
              <div className="flex flex-wrap gap-6">
                <div>
                  <p className="text-xs text-gray-500">園名</p>
                  <p className="text-sm font-medium text-gray-900">{selectedJob.nurseryName}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">日時</p>
                  <p className="text-sm text-gray-700">{formatDate(selectedJob.workDate)} {selectedJob.startTime}〜{selectedJob.endTime}</p>
                </div>
                {qrToken && (
                  <div>
                    <p className="text-xs text-gray-500">QRトークン</p>
                    <p className="text-sm font-mono text-gray-700 bg-gray-50 px-2 py-1 rounded">{qrToken}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Attendance table */}
          {loadingRecords ? (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              {[1, 2].map((i) => (
                <div key={i} className="h-10 bg-gray-50 rounded mb-2 animate-pulse" />
              ))}
            </div>
          ) : records.length === 0 ? (
            <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-500 text-sm">
              勤怠記録はまだありません
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="min-w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">名前</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">承認</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">チェックイン</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">チェックアウト</th>
                    <th className="px-6 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">実働時間</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {records.map((rec) => (
                    <tr key={rec.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 text-sm font-medium text-gray-900">{rec.friendDisplayName || rec.friendId}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          rec.approvalStatus === 'approved' ? 'bg-green-100 text-green-700' :
                          rec.approvalStatus === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {rec.approvalStatus === 'approved' ? '承認済' : rec.approvalStatus === 'pending' ? '待ち' : '否認'}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-700">{formatTime(rec.checkInAt)}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">{formatTime(rec.checkOutAt)}</td>
                      <td className="px-6 py-4 text-sm text-gray-700">
                        {rec.actualHours ? `${rec.actualHours.toFixed(1)}h` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
