'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import SegmentBuilder from '@/components/segments/segment-builder'
import type { SegmentCondition } from '@/components/segments/segment-builder'

interface Segment {
  id: string
  name: string
  description: string | null
  conditions_json: string
  line_account_id: string | null
  created_at: string
  updated_at: string
}

const defaultCondition: SegmentCondition = {
  operator: 'AND',
  rules: [{ type: 'is_following', value: true }],
}

export default function SegmentsPage() {
  const { selectedAccount } = useAccount()
  const [segments, setSegments] = useState<Segment[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formCondition, setFormCondition] = useState<SegmentCondition>(defaultCondition)
  const [saving, setSaving] = useState(false)

  const loadSegments = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: Segment[] }>('/api/segments?' + new URLSearchParams(selectedAccount?.id ? { lineAccountId: selectedAccount.id } : {}))
      setSegments(res.data || [])
    } catch (err) {
      console.error('Failed to load segments:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedAccount?.id])

  useEffect(() => { loadSegments() }, [loadSegments])

  const resetForm = () => {
    setFormName('')
    setFormDescription('')
    setFormCondition(defaultCondition)
    setEditingId(null)
    setShowForm(false)
  }

  const startCreate = () => {
    resetForm()
    setShowForm(true)
  }

  const startEdit = (seg: Segment) => {
    setEditingId(seg.id)
    setFormName(seg.name)
    setFormDescription(seg.description || '')
    try {
      setFormCondition(JSON.parse(seg.conditions_json))
    } catch {
      setFormCondition(defaultCondition)
    }
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!formName.trim()) return
    setSaving(true)
    try {
      const payload = {
        name: formName,
        description: formDescription || undefined,
        conditionsJson: JSON.stringify(formCondition),
        lineAccountId: selectedAccount?.id || undefined,
      }
      if (editingId) {
        await fetchApi(`/api/segments/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) })
      } else {
        await fetchApi('/api/segments', { method: 'POST', body: JSON.stringify(payload) })
      }
      await loadSegments()
      resetForm()
    } catch (err) {
      console.error('Failed to save segment:', err)
      alert('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このセグメントを削除しますか？')) return
    try {
      await fetchApi(`/api/segments/${id}`, { method: 'DELETE' })
      await loadSegments()
    } catch (err) {
      console.error('Failed to delete segment:', err)
    }
  }

  const formatDate = (d: string) => {
    try {
      return new Date(d).toLocaleDateString('ja-JP', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    } catch { return d }
  }

  const describeCondition = (json: string): string => {
    try {
      const cond = JSON.parse(json) as SegmentCondition
      return `${cond.rules.length}条件 (${cond.operator})`
    } catch { return '--' }
  }

  return (
    <div className="flex-1 overflow-auto">
      <Header title="セグメント" description="友だちを条件で絞り込む保存済みセグメント" />

      <div className="p-4 sm:p-6 max-w-4xl">
        {/* Actions */}
        <div className="flex justify-end mb-4">
          <button
            onClick={startCreate}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-colors"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規セグメント
          </button>
        </div>

        {/* Create/Edit form */}
        {showForm && (
          <div className="mb-6 bg-white border border-gray-200 rounded-xl p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">
              {editingId ? 'セグメント編集' : '新規セグメント'}
            </h3>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">名前</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="VIPユーザー、アクティブユーザー等..."
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">説明（任意）</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="セグメントの説明..."
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">条件</label>
                <SegmentBuilder condition={formCondition} onChange={setFormCondition} />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving || !formName.trim()}
                  className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-colors"
                  style={{ backgroundColor: '#06C755' }}
                >
                  {saving ? '保存中...' : editingId ? '更新' : '作成'}
                </button>
                <button
                  onClick={resetForm}
                  className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 transition-colors"
                >
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Segments list */}
        {loading ? (
          <p className="text-sm text-gray-400 text-center py-8">読み込み中...</p>
        ) : segments.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-gray-400 text-sm">セグメントがまだありません</p>
            <p className="text-gray-300 text-xs mt-1">「新規セグメント」で友だちの絞り込み条件を保存できます</p>
          </div>
        ) : (
          <div className="space-y-3">
            {segments.map((seg) => (
              <div key={seg.id} className="bg-white border border-gray-200 rounded-xl p-4 hover:shadow-sm transition-shadow">
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-gray-900">{seg.name}</h4>
                    {seg.description && (
                      <p className="text-xs text-gray-500 mt-0.5">{seg.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                        {describeCondition(seg.conditions_json)}
                      </span>
                      <span className="text-xs text-gray-400">{formatDate(seg.updated_at)}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-3">
                    <button
                      onClick={() => startEdit(seg)}
                      className="px-2 py-1 min-h-[36px] text-xs text-blue-600 hover:bg-blue-50 rounded transition-colors"
                    >
                      編集
                    </button>
                    <button
                      onClick={() => handleDelete(seg.id)}
                      className="px-2 py-1 min-h-[36px] text-xs text-red-500 hover:bg-red-50 rounded transition-colors"
                    >
                      削除
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
