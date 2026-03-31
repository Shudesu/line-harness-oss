'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'

interface FunnelStep {
  name: string
  type: 'scenario_enrolled' | 'scenario_completed' | 'tag_added' | 'conversion' | 'custom_event'
  value: string
}

interface Funnel {
  id: string
  name: string
  description: string | null
  steps_json: string
  line_account_id: string | null
  created_at: string
  updated_at: string
}

interface FunnelStats {
  steps: FunnelStep[]
  counts: number[]
}

const stepTypeOptions: { value: FunnelStep['type']; label: string }[] = [
  { value: 'scenario_enrolled', label: 'シナリオ登録' },
  { value: 'scenario_completed', label: 'シナリオ完了' },
  { value: 'tag_added', label: 'タグ追加' },
  { value: 'conversion', label: 'コンバージョン' },
  { value: 'custom_event', label: 'カスタムイベント' },
]

const defaultStep: FunnelStep = { name: '', type: 'tag_added', value: '' }

// ─── Funnel bar chart ────────────────────────────────────────────────────────

function FunnelChart({ steps, counts }: { steps: FunnelStep[]; counts: number[] }) {
  const maxCount = Math.max(...counts, 1)

  return (
    <div className="space-y-2">
      {steps.map((step, i) => {
        const pct = (counts[i] / maxCount) * 100
        const dropRate = i > 0 && counts[i - 1] > 0
          ? ((1 - counts[i] / counts[i - 1]) * 100).toFixed(1)
          : null

        return (
          <div key={i} className="flex items-center gap-3">
            <div className="w-28 text-right text-xs text-gray-500 truncate shrink-0" title={step.name || `ステップ${i + 1}`}>
              {step.name || `ステップ${i + 1}`}
            </div>
            <div className="flex-1 h-8 bg-gray-100 rounded relative overflow-hidden">
              <div
                className="h-full rounded transition-all duration-500"
                style={{
                  width: `${pct}%`,
                  backgroundColor: `hsl(${145 - i * 20}, 60%, ${45 + i * 5}%)`,
                }}
              />
              <span className="absolute inset-0 flex items-center px-2 text-xs font-medium text-gray-700">
                {counts[i].toLocaleString()}人
              </span>
            </div>
            {dropRate !== null && (
              <span className="w-16 text-xs text-red-500 shrink-0">-{dropRate}%</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─── Step editor rows ─────────────────────────────────────────────────────────

function StepEditor({
  steps,
  onChange,
  scenarios,
  tags,
  conversionPoints,
}: {
  steps: FunnelStep[]
  onChange: (steps: FunnelStep[]) => void
  scenarios: { id: string; name: string }[]
  tags: { id: string; name: string }[]
  conversionPoints: { id: string; name: string }[]
}) {
  const updateStep = (index: number, patch: Partial<FunnelStep>) => {
    const next = [...steps]
    next[index] = { ...next[index], ...patch }
    onChange(next)
  }

  const addStep = () => onChange([...steps, { ...defaultStep }])
  const removeStep = (index: number) => onChange(steps.filter((_, i) => i !== index))

  const getValueOptions = (type: FunnelStep['type']) => {
    switch (type) {
      case 'scenario_enrolled':
      case 'scenario_completed':
        return scenarios.map((s) => ({ value: s.id, label: s.name }))
      case 'tag_added':
        return tags.map((t) => ({ value: t.id, label: t.name }))
      case 'conversion':
        return conversionPoints.map((c) => ({ value: c.id, label: c.name }))
      default:
        return []
    }
  }

  return (
    <div className="space-y-2">
      {steps.map((step, i) => {
        const valueOpts = getValueOptions(step.type)

        return (
          <div key={i} className="flex items-center gap-2 bg-gray-50 rounded p-2">
            <span className="text-xs text-gray-400 w-6 text-center shrink-0">{i + 1}</span>
            <input
              type="text"
              className="border border-gray-300 rounded px-2 py-1 text-sm w-28 focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="ステップ名"
              value={step.name}
              onChange={(e) => updateStep(i, { name: e.target.value })}
            />
            <select
              className="border border-gray-300 rounded px-2 py-1 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
              value={step.type}
              onChange={(e) => updateStep(i, { type: e.target.value as FunnelStep['type'], value: '' })}
            >
              {stepTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            {valueOpts.length > 0 ? (
              <select
                className="border border-gray-300 rounded px-2 py-1 text-sm bg-white flex-1 focus:outline-none focus:ring-2 focus:ring-green-500"
                value={step.value}
                onChange={(e) => updateStep(i, { value: e.target.value })}
              >
                <option value="">選択...</option>
                {valueOpts.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                className="border border-gray-300 rounded px-2 py-1 text-sm flex-1 focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="イベント名"
                value={step.value}
                onChange={(e) => updateStep(i, { value: e.target.value })}
              />
            )}
            <button
              type="button"
              onClick={() => removeStep(i)}
              disabled={steps.length <= 1}
              className="text-red-400 hover:text-red-600 disabled:opacity-30 text-sm px-1"
            >
              ✕
            </button>
          </div>
        )
      })}
      <button
        type="button"
        onClick={addStep}
        className="text-sm text-green-600 hover:text-green-700 px-2 py-1"
      >
        + ステップ追加
      </button>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function FunnelsPage() {
  const { selectedAccount } = useAccount()
  const [funnels, setFunnels] = useState<Funnel[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formSteps, setFormSteps] = useState<FunnelStep[]>([{ ...defaultStep }])
  const [saving, setSaving] = useState(false)

  // Stats state
  const [statsMap, setStatsMap] = useState<Record<string, FunnelStats>>({})
  const [loadingStats, setLoadingStats] = useState<Record<string, boolean>>({})

  // Lookup data for step value selectors
  const [scenarios, setScenarios] = useState<{ id: string; name: string }[]>([])
  const [tags, setTags] = useState<{ id: string; name: string }[]>([])
  const [conversionPoints, setConversionPoints] = useState<{ id: string; name: string }[]>([])

  const accountQuery = selectedAccount?.id ? `lineAccountId=${selectedAccount.id}` : ''

  const loadFunnels = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: Funnel[] }>(`/api/funnels?${accountQuery}`)
      setFunnels(res.data || [])
    } catch (err) {
      console.error('Failed to load funnels:', err)
    } finally {
      setLoading(false)
    }
  }, [accountQuery])

  // Load lookup data for step editors
  const loadLookups = useCallback(async () => {
    try {
      const [scenariosRes, tagsRes, cvRes] = await Promise.all([
        fetchApi<{ success: boolean; data: { id: string; name: string }[] }>(`/api/scenarios?${accountQuery}`),
        fetchApi<{ success: boolean; data: { id: string; name: string }[] }>(`/api/tags?${accountQuery}`),
        fetchApi<{ success: boolean; data: { id: string; name: string }[] }>(`/api/conversion-points?${accountQuery}`),
      ])
      setScenarios(scenariosRes.data || [])
      setTags(tagsRes.data || [])
      setConversionPoints(cvRes.data || [])
    } catch {
      // Non-critical
    }
  }, [accountQuery])

  useEffect(() => { loadFunnels() }, [loadFunnels])
  useEffect(() => { loadLookups() }, [loadLookups])

  const resetForm = () => {
    setFormName('')
    setFormDescription('')
    setFormSteps([{ ...defaultStep }])
    setEditingId(null)
    setShowForm(false)
  }

  const startCreate = () => {
    resetForm()
    setShowForm(true)
  }

  const startEdit = (funnel: Funnel) => {
    setEditingId(funnel.id)
    setFormName(funnel.name)
    setFormDescription(funnel.description || '')
    try {
      setFormSteps(JSON.parse(funnel.steps_json))
    } catch {
      setFormSteps([{ ...defaultStep }])
    }
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!formName.trim() || formSteps.length === 0) return
    setSaving(true)
    try {
      const payload = {
        name: formName,
        description: formDescription || undefined,
        stepsJson: JSON.stringify(formSteps),
        lineAccountId: selectedAccount?.id || undefined,
      }
      if (editingId) {
        await fetchApi(`/api/funnels/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) })
      } else {
        await fetchApi('/api/funnels', { method: 'POST', body: JSON.stringify(payload) })
      }
      resetForm()
      loadFunnels()
    } catch (err) {
      console.error('Failed to save funnel:', err)
      alert('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このファネルを削除しますか？')) return
    try {
      await fetchApi(`/api/funnels/${id}`, { method: 'DELETE' })
      setStatsMap((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      loadFunnels()
    } catch (err) {
      console.error('Failed to delete funnel:', err)
    }
  }

  const loadStats = async (funnel: Funnel) => {
    setLoadingStats((prev) => ({ ...prev, [funnel.id]: true }))
    try {
      const res = await fetchApi<{ success: boolean; data: FunnelStats }>(
        `/api/funnels/${funnel.id}/stats?${accountQuery}`,
        { method: 'POST' },
      )
      setStatsMap((prev) => ({ ...prev, [funnel.id]: res.data }))
    } catch (err) {
      console.error('Failed to load stats:', err)
    } finally {
      setLoadingStats((prev) => ({ ...prev, [funnel.id]: false }))
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Header title="ファネル分析" description="シナリオ・CV間のステップ別通過率・離脱率を可視化" />

      <div className="flex-1 overflow-y-auto p-6">
        {/* Create / Edit form */}
        {showForm && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6 shadow-sm">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              {editingId ? 'ファネルを編集' : '新規ファネル作成'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">ファネル名</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="例: 新規登録→購入ファネル"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">説明（任意）</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="ファネルの目的や対象者"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">ステップ</label>
                <StepEditor
                  steps={formSteps}
                  onChange={setFormSteps}
                  scenarios={scenarios}
                  tags={tags}
                  conversionPoints={conversionPoints}
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleSave}
                  disabled={saving || !formName.trim()}
                  className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {saving ? '保存中...' : editingId ? '更新' : '作成'}
                </button>
                <button
                  onClick={resetForm}
                  className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200"
                >
                  キャンセル
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Action bar */}
        {!showForm && (
          <div className="flex justify-end mb-4">
            <button
              onClick={startCreate}
              className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
            >
              + 新規ファネル
            </button>
          </div>
        )}

        {/* Funnel list */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">読み込み中...</div>
        ) : funnels.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-lg mb-2">ファネルがありません</p>
            <p className="text-sm">ステップ別の通過率を分析するファネルを作成してください</p>
          </div>
        ) : (
          <div className="space-y-4">
            {funnels.map((funnel) => {
              const stats = statsMap[funnel.id]
              const isLoadingStats = loadingStats[funnel.id]
              let steps: FunnelStep[] = []
              try { steps = JSON.parse(funnel.steps_json) } catch { /* ignore */ }

              return (
                <div key={funnel.id} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-base font-bold text-gray-900">{funnel.name}</h3>
                      {funnel.description && (
                        <p className="text-sm text-gray-500 mt-0.5">{funnel.description}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {steps.length}ステップ・作成: {new Date(funnel.created_at).toLocaleDateString('ja-JP')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => loadStats(funnel)}
                        disabled={isLoadingStats}
                        className="px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 disabled:opacity-50"
                      >
                        {isLoadingStats ? '集計中...' : '集計'}
                      </button>
                      <button
                        onClick={() => startEdit(funnel)}
                        className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => handleDelete(funnel.id)}
                        className="px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 rounded-lg"
                      >
                        削除
                      </button>
                    </div>
                  </div>

                  {/* Steps summary or chart */}
                  {stats ? (
                    <FunnelChart steps={stats.steps} counts={stats.counts} />
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {steps.map((s, i) => (
                        <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 rounded text-xs text-gray-600">
                          <span className="text-gray-400">{i + 1}.</span>
                          {s.name || stepTypeOptions.find((o) => o.value === s.type)?.label || s.type}
                          {i < steps.length - 1 && <span className="text-gray-300 ml-1">→</span>}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
