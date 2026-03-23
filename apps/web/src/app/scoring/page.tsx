'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import CcPromptButton from '@/components/cc-prompt-button'

interface ScoringRule {
  id: string
  name: string
  eventType: string
  scoreValue: number
  isActive: boolean
  createdAt: string
  updatedAt: string
}

interface CreateFormState {
  name: string
  eventType: string
  scoreValue: string
}

const ccPrompts = [
  {
    title: 'スコアリングルール設計',
    prompt: `スコアリングルールの設計をサポートしてください。
1. 主要なイベントタイプ別の推奨スコア値を提案
2. 正のスコア（エンゲージメント）と負のスコア（離脱兆候）のバランス設計
3. スコア閾値に基づくセグメント分類の推奨設定
手順を示してください。`,
  },
  {
    title: 'スコア分析レポート',
    prompt: `現在のスコアリングデータを分析してください。
1. ルール別のスコア付与回数と合計値を集計
2. 有効・無効ルールの見直しと最適化提案
3. スコア分布に基づく友だちのセグメント分析
結果をレポートしてください。`,
  },
]

export default function ScoringPage() {
  const [rules, setRules] = useState<ScoringRule[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<CreateFormState>({
    name: '',
    eventType: '',
    scoreValue: '',
  })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const loadRules = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.scoring.rules()
      if (res.success) {
        setRules(res.data)
      } else {
        setError(res.error)
      }
    } catch {
      setError('スコアリングルールの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadRules()
  }, [loadRules])

  const handleCreate = async () => {
    if (!form.name.trim()) {
      setFormError('ルール名を入力してください')
      return
    }
    if (!form.eventType.trim()) {
      setFormError('イベントタイプを入力してください')
      return
    }
    if (!form.scoreValue || isNaN(Number(form.scoreValue))) {
      setFormError('スコア値を数値で入力してください')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const res = await api.scoring.createRule({
        name: form.name,
        eventType: form.eventType,
        scoreValue: Number(form.scoreValue),
      })
      if (res.success) {
        setShowCreate(false)
        setForm({ name: '', eventType: '', scoreValue: '' })
        loadRules()
      } else {
        setFormError(res.error)
      }
    } catch {
      setFormError('作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const handleToggleActive = async (id: string, current: boolean) => {
    try {
      await api.scoring.updateRule(id, { isActive: !current })
      loadRules()
    } catch {
      setError('ステータスの変更に失敗しました')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このスコアリングルールを削除しますか？')) return
    try {
      await api.scoring.deleteRule(id)
      loadRules()
    } catch {
      setError('削除に失敗しました')
    }
  }

  const totalRules = rules.length
  const activeRules = rules.filter((r) => r.isActive).length

  return (
    <div>
      <Header
        title="スコアリングルール"
        action={
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規ルール
          </button>
        }
      />

      {/* Summary stats */}
      {!loading && (
        <div className="grid grid-cols-2 gap-4 mb-6">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500">ルール総数</p>
            <p className="text-2xl font-bold text-gray-900">{totalRules}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-500">有効なルール</p>
            <p className="text-2xl font-bold" style={{ color: '#06C755' }}>{activeRules}</p>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">新規スコアリングルールを作成</h2>
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">ルール名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: メッセージ開封"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">イベントタイプ <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: message_open, url_click, friend_add"
                value={form.eventType}
                onChange={(e) => setForm({ ...form, eventType: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">スコア値 <span className="text-red-500">*</span></label>
              <input
                type="number"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: 10 (正の値で加算、負の値で減算)"
                value={form.scoreValue}
                onChange={(e) => setForm({ ...form, scoreValue: e.target.value })}
              />
            </div>

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: '#06C755' }}
              >
                {saving ? '作成中...' : '作成'}
              </button>
              <button
                onClick={() => { setShowCreate(false); setFormError('') }}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">読み込み中...</div>
      ) : rules.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">スコアリングルールがまだありません</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ルール名</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">イベントタイプ</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">スコア値</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">ステータス</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {rules.map((rule) => (
                <tr key={rule.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">{rule.name}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">{rule.eventType}</span>
                  </td>
                  <td className="px-4 py-3 text-sm font-semibold">
                    <span style={{ color: rule.scoreValue >= 0 ? '#06C755' : '#EF4444' }}>
                      {rule.scoreValue >= 0 ? `+${rule.scoreValue}` : rule.scoreValue}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => handleToggleActive(rule.id, rule.isActive)}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                        rule.isActive ? 'bg-green-500' : 'bg-gray-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                          rule.isActive ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button
                      onClick={() => handleDelete(rule.id)}
                      className="text-red-500 hover:text-red-700 text-sm"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
