'use client'
import { useEffect, useState, useCallback } from 'react'
import { fetchApi, type ApiResponse } from '@/lib/api'
import StatusBadge from '@/components/status-badge'

type PayrollRecord = {
  id: string
  friendId: string
  friendDisplayName?: string
  workDate: string
  nurseryName: string
  startTime: string
  endTime: string
  actualHours: number | null
  hourlyRate: number
  grossAmount: number
  transportFee: number
  withholdingTax: number
  netAmount: number
  paymentMethod: 'spot' | 'monthly'
  paymentStatus: 'pending' | 'processing' | 'paid'
  paidAt: string | null
}

export default function PayrollPage() {
  const [records, setRecords] = useState<PayrollRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<'all' | 'pending' | 'paid'>('all')

  const fetchRecords = useCallback(async () => {
    try {
      setError('')
      // 全ワーカーの報酬レコードを取得（管理者API）
      const params = filter !== 'all' ? `?status=${filter}` : ''
      const res = await fetchApi<ApiResponse<PayrollRecord[]>>(`/api/payroll/admin/list${params}`)
      if (res.success) setRecords(res.data)
    } catch {
      // 管理者用APIがまだない場合はフォールバック
      setRecords([])
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { fetchRecords() }, [fetchRecords])

  const handleMarkPaid = async (id: string) => {
    try {
      await fetchApi<ApiResponse<void>>(`/api/payroll/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status: 'paid' }),
      })
      await fetchRecords()
    } catch {
      setError('ステータス更新に失敗しました')
    }
  }

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00')
    const weekdays = ['日', '月', '火', '水', '木', '金', '土']
    return `${d.getMonth() + 1}/${d.getDate()}(${weekdays[d.getDay()]})`
  }

  const totalPending = records.filter(r => r.paymentStatus === 'pending').reduce((s, r) => s + r.netAmount, 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">報酬管理</h1>
          <p className="text-sm text-gray-500 mt-1">
            未払い合計: <span className="font-bold text-orange-600">¥{totalPending.toLocaleString()}</span>
          </p>
        </div>
        <div className="flex gap-2">
          {(['all', 'pending', 'paid'] as const).map((f) => (
            <button
              key={f}
              onClick={() => { setFilter(f); setLoading(true) }}
              className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                filter === f
                  ? 'bg-orange-50 border-orange-300 text-orange-700 font-medium'
                  : 'bg-white border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {{ all: 'すべて', pending: '未払い', paid: '振込済' }[f]}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse">
              <div className="h-5 w-48 bg-gray-100 rounded mb-3" />
              <div className="h-4 w-32 bg-gray-100 rounded" />
            </div>
          ))}
        </div>
      ) : records.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <p className="text-gray-500">報酬レコードはまだありません</p>
          <p className="text-sm text-gray-400 mt-2">ワーカーがチェックアウトすると自動で作成されます</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">日付</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">園</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ワーカー</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">報酬</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">源泉</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">手取り</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">方法</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">状態</th>
                <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {records.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm">{formatDate(r.workDate)}</td>
                  <td className="px-4 py-3 text-sm font-medium">{r.nurseryName}</td>
                  <td className="px-4 py-3 text-sm">{r.friendDisplayName || r.friendId.slice(0, 8)}</td>
                  <td className="px-4 py-3 text-sm text-right">¥{r.grossAmount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-sm text-right text-red-600">
                    {r.withholdingTax > 0 ? `-¥${r.withholdingTax.toLocaleString()}` : '-'}
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-bold">¥{r.netAmount.toLocaleString()}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      r.paymentMethod === 'spot' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'
                    }`}>
                      {r.paymentMethod === 'spot' ? 'スポット' : '月末'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={r.paymentStatus === 'paid' ? 'completed' : r.paymentStatus} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    {r.paymentStatus === 'pending' && (
                      <button
                        onClick={() => handleMarkPaid(r.id)}
                        className="text-xs px-3 py-1 bg-green-500 text-white rounded-lg hover:bg-green-600 transition-colors"
                      >
                        振込済にする
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
