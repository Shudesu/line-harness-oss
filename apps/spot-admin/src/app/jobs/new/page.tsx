'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { api, type Nursery } from '@/lib/api'

export default function NewJobPage() {
  const router = useRouter()
  const [nurseries, setNurseries] = useState<Nursery[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const [form, setForm] = useState({
    nurseryId: '',
    workDate: '',
    startTime: '09:00',
    endTime: '17:00',
    hourlyRate: 1200,
    capacity: 1,
    description: '',
    requirements: '',
  })

  useEffect(() => {
    api.nurseries.list().then((res) => {
      if (res.success) setNurseries(res.data)
    })
  }, [])

  const selectedNursery = nurseries.find((n) => n.id === form.nurseryId)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.nurseryId || !form.workDate) {
      setError('園と日付は必須です')
      return
    }

    setLoading(true)
    setError('')

    try {
      const nursery = nurseries.find((n) => n.id === form.nurseryId)!
      await api.jobs.create({
        connectionId: 'default',
        nurseryName: nursery.name,
        nurseryId: nursery.id,
        address: nursery.address || undefined,
        station: nursery.station || undefined,
        hourlyRate: form.hourlyRate,
        description: form.description || undefined,
        requirements: form.requirements || undefined,
        capacity: form.capacity,
        workDate: form.workDate,
        startTime: form.startTime,
        endTime: form.endTime,
      })
      router.push('/jobs')
    } catch {
      setError('求人の作成に失敗しました')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold text-gray-900 mb-6">求人作成</h1>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-lg">{error}</div>}

      <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-6 space-y-5">
        {/* 園選択 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">園 *</label>
          <select
            value={form.nurseryId}
            onChange={(e) => setForm({ ...form, nurseryId: e.target.value })}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            required
          >
            <option value="">園を選択</option>
            {nurseries.map((n) => (
              <option key={n.id} value={n.id}>{n.name}{n.station ? ` (${n.station})` : ''}</option>
            ))}
          </select>
          {selectedNursery?.address && (
            <p className="text-xs text-gray-500 mt-1">{selectedNursery.address}</p>
          )}
        </div>

        {/* 日付 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">勤務日 *</label>
          <input
            type="date"
            value={form.workDate}
            onChange={(e) => setForm({ ...form, workDate: e.target.value })}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            required
          />
        </div>

        {/* 時間 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">開始時間</label>
            <input
              type="time"
              value={form.startTime}
              onChange={(e) => setForm({ ...form, startTime: e.target.value })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">終了時間</label>
            <input
              type="time"
              value={form.endTime}
              onChange={(e) => setForm({ ...form, endTime: e.target.value })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
            />
          </div>
        </div>

        {/* 時給・定員 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">時給（円）</label>
            <input
              type="number"
              value={form.hourlyRate}
              onChange={(e) => setForm({ ...form, hourlyRate: Number(e.target.value) })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              min={0}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">定員</label>
            <input
              type="number"
              value={form.capacity}
              onChange={(e) => setForm({ ...form, capacity: Number(e.target.value) })}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500"
              min={1}
            />
          </div>
        </div>

        {/* 備考 */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">業務内容</label>
          <textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            rows={3}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
            placeholder="例: 0〜2歳児クラスの保育補助"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">必要資格・条件</label>
          <textarea
            value={form.requirements}
            onChange={(e) => setForm({ ...form, requirements: e.target.value })}
            rows={2}
            className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 resize-none"
            placeholder="例: 保育士資格必須"
          />
        </div>

        {/* Submit */}
        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="px-6 py-2.5 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{ backgroundColor: '#FF6B35' }}
          >
            {loading ? '作成中...' : '求人を作成'}
          </button>
          <button
            type="button"
            onClick={() => router.back()}
            className="px-6 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            キャンセル
          </button>
        </div>
      </form>
    </div>
  )
}
