'use client'

import { useState, useEffect, useCallback } from 'react'
import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'

interface SurveyQuestion {
  id: string
  text: string
  type: 'text' | 'single_choice' | 'multi_choice' | 'rating'
  options?: string[]
  required?: boolean
}

interface Survey {
  id: string
  name: string
  description: string | null
  questions_json: string
  is_active: number
  line_account_id: string | null
  created_at: string
  updated_at: string
  response_count: number
}

interface SurveyStatItem {
  questionId: string
  answers: Record<string, number>
  total: number
}

const questionTypeOptions = [
  { value: 'text', label: '自由記述' },
  { value: 'single_choice', label: '単一選択' },
  { value: 'multi_choice', label: '複数選択' },
  { value: 'rating', label: '評価（1-5）' },
]

function makeId() {
  return Math.random().toString(36).slice(2, 10)
}

// ─── Question Editor ──────────────────────────────────────────────────────────

function QuestionEditor({
  questions,
  onChange,
}: {
  questions: SurveyQuestion[]
  onChange: (q: SurveyQuestion[]) => void
}) {
  const update = (index: number, patch: Partial<SurveyQuestion>) => {
    const next = [...questions]
    next[index] = { ...next[index], ...patch }
    onChange(next)
  }

  const addQuestion = () => {
    onChange([...questions, { id: makeId(), text: '', type: 'single_choice', options: [''], required: false }])
  }

  const removeQuestion = (index: number) => {
    onChange(questions.filter((_, i) => i !== index))
  }

  const addOption = (qi: number) => {
    const q = questions[qi]
    update(qi, { options: [...(q.options || []), ''] })
  }

  const updateOption = (qi: number, oi: number, value: string) => {
    const q = questions[qi]
    const opts = [...(q.options || [])]
    opts[oi] = value
    update(qi, { options: opts })
  }

  const removeOption = (qi: number, oi: number) => {
    const q = questions[qi]
    update(qi, { options: (q.options || []).filter((_, i) => i !== oi) })
  }

  return (
    <div className="space-y-4">
      {questions.map((q, qi) => (
        <div key={q.id} className="border border-gray-200 rounded-lg p-4 bg-gray-50">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-medium text-gray-400">Q{qi + 1}</span>
            <select
              className="border border-gray-300 rounded px-2 py-1 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
              value={q.type}
              onChange={(e) => update(qi, { type: e.target.value as SurveyQuestion['type'] })}
            >
              {questionTypeOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-xs text-gray-500 ml-auto">
              <input
                type="checkbox"
                checked={q.required || false}
                onChange={(e) => update(qi, { required: e.target.checked })}
                className="rounded border-gray-300"
              />
              必須
            </label>
            <button
              type="button"
              onClick={() => removeQuestion(qi)}
              className="text-red-400 hover:text-red-600 text-xs px-1"
            >
              削除
            </button>
          </div>

          <input
            type="text"
            className="w-full border border-gray-300 rounded px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="質問文を入力..."
            value={q.text}
            onChange={(e) => update(qi, { text: e.target.value })}
          />

          {(q.type === 'single_choice' || q.type === 'multi_choice') && (
            <div className="space-y-1 ml-4">
              {(q.options || []).map((opt, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <span className="w-4 h-4 rounded-full border border-gray-300 shrink-0" />
                  <input
                    type="text"
                    className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                    placeholder={`選択肢${oi + 1}`}
                    value={opt}
                    onChange={(e) => updateOption(qi, oi, e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => removeOption(qi, oi)}
                    className="text-red-400 hover:text-red-600 text-xs"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => addOption(qi)}
                className="text-xs text-green-600 hover:text-green-700 ml-6"
              >
                + 選択肢を追加
              </button>
            </div>
          )}

          {q.type === 'rating' && (
            <p className="text-xs text-gray-400 ml-4">1〜5の評価スケールが表示されます</p>
          )}
        </div>
      ))}

      <button
        type="button"
        onClick={addQuestion}
        className="w-full py-2 text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg hover:border-green-400 hover:text-green-600 transition-colors"
      >
        + 質問を追加
      </button>
    </div>
  )
}

// ─── Stats bar chart for a single question ───────────────────────────────────

function QuestionStats({
  question,
  stat,
}: {
  question: SurveyQuestion
  stat: SurveyStatItem
}) {
  const entries = Object.entries(stat.answers).sort((a, b) => b[1] - a[1])
  const maxCount = Math.max(...entries.map(([, v]) => v), 1)

  return (
    <div className="mb-4">
      <p className="text-sm font-medium text-gray-700 mb-1">{question.text}</p>
      <p className="text-xs text-gray-400 mb-2">{stat.total}件の回答</p>
      {entries.length === 0 ? (
        <p className="text-xs text-gray-400">まだ回答がありません</p>
      ) : (
        <div className="space-y-1">
          {entries.map(([label, count]) => (
            <div key={label} className="flex items-center gap-2">
              <div className="w-24 text-right text-xs text-gray-500 truncate shrink-0" title={label}>{label}</div>
              <div className="flex-1 h-6 bg-gray-100 rounded relative overflow-hidden">
                <div
                  className="h-full bg-green-400 rounded transition-all"
                  style={{ width: `${(count / maxCount) * 100}%` }}
                />
                <span className="absolute inset-0 flex items-center px-2 text-xs text-gray-700">
                  {count}件 ({stat.total > 0 ? ((count / stat.total) * 100).toFixed(0) : 0}%)
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function SurveysPage() {
  const { selectedAccount } = useAccount()
  const [surveys, setSurveys] = useState<Survey[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formName, setFormName] = useState('')
  const [formDescription, setFormDescription] = useState('')
  const [formQuestions, setFormQuestions] = useState<SurveyQuestion[]>([
    { id: makeId(), text: '', type: 'single_choice', options: [''], required: false },
  ])
  const [saving, setSaving] = useState(false)

  // Stats
  const [statsMap, setStatsMap] = useState<Record<string, SurveyStatItem[]>>({})
  const [loadingStats, setLoadingStats] = useState<Record<string, boolean>>({})

  const accountQuery = selectedAccount?.id ? `lineAccountId=${selectedAccount.id}` : ''

  const loadSurveys = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: Survey[] }>(`/api/surveys?${accountQuery}`)
      setSurveys(res.data || [])
    } catch (err) {
      console.error('Failed to load surveys:', err)
    } finally {
      setLoading(false)
    }
  }, [accountQuery])

  useEffect(() => { loadSurveys() }, [loadSurveys])

  const resetForm = () => {
    setFormName('')
    setFormDescription('')
    setFormQuestions([{ id: makeId(), text: '', type: 'single_choice', options: [''], required: false }])
    setEditingId(null)
    setShowForm(false)
  }

  const startCreate = () => { resetForm(); setShowForm(true) }

  const startEdit = (survey: Survey) => {
    setEditingId(survey.id)
    setFormName(survey.name)
    setFormDescription(survey.description || '')
    try {
      setFormQuestions(JSON.parse(survey.questions_json))
    } catch {
      setFormQuestions([{ id: makeId(), text: '', type: 'single_choice', options: [''], required: false }])
    }
    setShowForm(true)
  }

  const handleSave = async () => {
    if (!formName.trim() || formQuestions.length === 0) return
    setSaving(true)
    try {
      const payload = {
        name: formName,
        description: formDescription || undefined,
        questionsJson: JSON.stringify(formQuestions),
        lineAccountId: selectedAccount?.id || undefined,
      }
      if (editingId) {
        await fetchApi(`/api/surveys/${editingId}`, { method: 'PUT', body: JSON.stringify(payload) })
      } else {
        await fetchApi('/api/surveys', { method: 'POST', body: JSON.stringify(payload) })
      }
      resetForm()
      loadSurveys()
    } catch (err) {
      console.error('Failed to save survey:', err)
      alert('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このアンケートを削除しますか？回答データも全て削除されます。')) return
    try {
      await fetchApi(`/api/surveys/${id}`, { method: 'DELETE' })
      setStatsMap((prev) => { const n = { ...prev }; delete n[id]; return n })
      loadSurveys()
    } catch (err) {
      console.error('Failed to delete survey:', err)
    }
  }

  const handleToggleActive = async (survey: Survey) => {
    try {
      await fetchApi(`/api/surveys/${survey.id}`, {
        method: 'PUT',
        body: JSON.stringify({ isActive: !survey.is_active }),
      })
      loadSurveys()
    } catch (err) {
      console.error('Failed to toggle survey:', err)
    }
  }

  const loadStats = async (surveyId: string) => {
    setLoadingStats((prev) => ({ ...prev, [surveyId]: true }))
    try {
      const res = await fetchApi<{ success: boolean; data: SurveyStatItem[] }>(`/api/surveys/${surveyId}/stats`)
      setStatsMap((prev) => ({ ...prev, [surveyId]: res.data }))
    } catch (err) {
      console.error('Failed to load stats:', err)
    } finally {
      setLoadingStats((prev) => ({ ...prev, [surveyId]: false }))
    }
  }

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <Header title="アンケート" description="アンケートの作成・配布・回答分析" />

      <div className="flex-1 overflow-y-auto p-6">
        {/* Create / Edit form */}
        {showForm && (
          <div className="bg-white border border-gray-200 rounded-xl p-6 mb-6 shadow-sm">
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              {editingId ? 'アンケートを編集' : '新規アンケート作成'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">アンケート名</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="例: 顧客満足度調査"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">説明（任意）</label>
                <input
                  type="text"
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="アンケートの目的や対象"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">質問</label>
                <QuestionEditor questions={formQuestions} onChange={setFormQuestions} />
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
              + 新規アンケート
            </button>
          </div>
        )}

        {/* Survey list */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">読み込み中...</div>
        ) : surveys.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <p className="text-lg mb-2">アンケートがありません</p>
            <p className="text-sm">アンケートを作成して友だちから回答を収集しましょう</p>
          </div>
        ) : (
          <div className="space-y-4">
            {surveys.map((survey) => {
              let questions: SurveyQuestion[] = []
              try { questions = JSON.parse(survey.questions_json) } catch { /* ignore */ }
              const stats = statsMap[survey.id]
              const isLoadingStats = loadingStats[survey.id]

              return (
                <div key={survey.id} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-gray-900">{survey.name}</h3>
                        {!survey.is_active && (
                          <span className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded">無効</span>
                        )}
                      </div>
                      {survey.description && (
                        <p className="text-sm text-gray-500 mt-0.5">{survey.description}</p>
                      )}
                      <p className="text-xs text-gray-400 mt-1">
                        {questions.length}問・{survey.response_count}件の回答・作成: {new Date(survey.created_at).toLocaleDateString('ja-JP')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => stats ? setStatsMap((p) => { const n = { ...p }; delete n[survey.id]; return n }) : loadStats(survey.id)}
                        disabled={isLoadingStats}
                        className="px-3 py-1.5 text-xs font-medium bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 disabled:opacity-50"
                      >
                        {isLoadingStats ? '集計中...' : stats ? '閉じる' : '集計'}
                      </button>
                      <button
                        onClick={() => handleToggleActive(survey)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg ${
                          survey.is_active
                            ? 'bg-yellow-50 text-yellow-600 hover:bg-yellow-100'
                            : 'bg-green-50 text-green-600 hover:bg-green-100'
                        }`}
                      >
                        {survey.is_active ? '無効化' : '有効化'}
                      </button>
                      <button
                        onClick={() => startEdit(survey)}
                        className="px-3 py-1.5 text-xs font-medium bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200"
                      >
                        編集
                      </button>
                      <button
                        onClick={() => handleDelete(survey.id)}
                        className="px-3 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50 rounded-lg"
                      >
                        削除
                      </button>
                    </div>
                  </div>

                  {/* Questions summary */}
                  {!stats && (
                    <div className="space-y-1">
                      {questions.map((q, i) => (
                        <div key={q.id} className="flex items-center gap-2 text-sm text-gray-600">
                          <span className="text-xs text-gray-400 w-6 shrink-0">Q{i + 1}</span>
                          <span className="truncate">{q.text || '(未入力)'}</span>
                          <span className="text-xs text-gray-400 shrink-0">
                            ({questionTypeOptions.find((o) => o.value === q.type)?.label})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Stats */}
                  {stats && (
                    <div className="mt-3 border-t border-gray-100 pt-3">
                      {questions.map((q, qi) => {
                        const qStat = stats[qi]
                        if (!qStat) return null
                        return <QuestionStats key={q.id} question={q} stat={qStat} />
                      })}
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
