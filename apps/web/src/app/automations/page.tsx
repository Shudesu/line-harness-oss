'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'

type AutomationEventType = "friend_add" | "tag_change" | "score_threshold" | "cv_fire" | "message_received" | "calendar_booked"

interface AutomationAction {
  type: "add_tag" | "remove_tag" | "start_scenario" | "send_message" | "send_webhook" | "switch_rich_menu"
  params: Record<string, unknown>
}

interface Automation {
  id: string
  name: string
  description: string | null
  eventType: AutomationEventType
  conditions: Record<string, unknown>
  actions: AutomationAction[]
  isActive: boolean
  priority: number
  createdAt: string
  updatedAt: string
}

const eventTypeOptions: { value: AutomationEventType; label: string }[] = [
  { value: 'friend_add', label: '友だち追加' },
  { value: 'tag_change', label: 'タグ変更' },
  { value: 'score_threshold', label: 'スコア閾値' },
  { value: 'cv_fire', label: 'CV発火' },
  { value: 'message_received', label: 'メッセージ受信' },
  { value: 'calendar_booked', label: 'カレンダー予約' },
]

const eventTypeLabelMap: Record<AutomationEventType, string> = {
  friend_add: '友だち追加',
  tag_change: 'タグ変更',
  score_threshold: 'スコア閾値',
  cv_fire: 'CV発火',
  message_received: 'メッセージ受信',
  calendar_booked: 'カレンダー予約',
}

const eventTypeBadgeColor: Record<AutomationEventType, string> = {
  friend_add: 'bg-green-100 text-green-700',
  tag_change: 'bg-blue-100 text-blue-700',
  score_threshold: 'bg-yellow-100 text-yellow-700',
  cv_fire: 'bg-red-100 text-red-700',
  message_received: 'bg-purple-100 text-purple-700',
  calendar_booked: 'bg-indigo-100 text-indigo-700',
}

interface CreateFormState {
  name: string
  description: string
  eventType: AutomationEventType
  actionsJson: string
  conditionsJson: string
  priority: number
}

const initialForm: CreateFormState = {
  name: '',
  description: '',
  eventType: 'friend_add',
  actionsJson: '[\n  {\n    "type": "add_tag",\n    "params": {}\n  }\n]',
  conditionsJson: '{}',
  priority: 0,
}

const ccPrompts = [
  {
    title: 'オートメーションルール作成',
    prompt: `新しいオートメーションルールを作成するサポートをしてください。
1. 利用可能なイベントタイプ（友だち追加、タグ変更、スコア閾値等）の説明
2. アクション設定のJSON形式テンプレートを提供
3. 条件設定と優先度の推奨値を提案
手順を示してください。`,
  },
  {
    title: 'オートメーション効果分析',
    prompt: `現在のオートメーションルールの効果を分析してください。
1. 各ルールの発火回数と成功率を確認
2. イベントタイプ別の自動化カバレッジを評価
3. 効果の低いルールの改善提案と新規ルールの推奨
結果をレポートしてください。`,
  },
]

export default function AutomationsPage() {
  const { selectedAccountId } = useAccount()
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<CreateFormState>({ ...initialForm })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  const loadAutomations = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.automations.list({ accountId: selectedAccountId || undefined })
      if (res.success) {
        setAutomations(res.data)
      } else {
        setError(res.error)
      }
    } catch {
      setError('オートメーションの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    loadAutomations()
  }, [loadAutomations])

  const handleCreate = async () => {
    if (!form.name.trim()) {
      setFormError('ルール名を入力してください')
      return
    }

    let parsedActions: AutomationAction[]
    let parsedConditions: Record<string, unknown>
    try {
      parsedActions = JSON.parse(form.actionsJson)
    } catch {
      setFormError('アクションのJSON形式が正しくありません')
      return
    }
    try {
      parsedConditions = JSON.parse(form.conditionsJson)
    } catch {
      setFormError('条件のJSON形式が正しくありません')
      return
    }

    setSaving(true)
    setFormError('')
    try {
      const res = await api.automations.create({
        name: form.name,
        description: form.description || null,
        eventType: form.eventType,
        actions: parsedActions,
        conditions: parsedConditions,
        priority: form.priority,
      })
      if (res.success) {
        setShowCreate(false)
        setForm({ ...initialForm })
        loadAutomations()
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
      await api.automations.update(id, { isActive: !current })
      loadAutomations()
    } catch {
      setError('ステータスの変更に失敗しました')
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このオートメーションを削除してもよいですか？')) return
    try {
      await api.automations.delete(id)
      loadAutomations()
    } catch {
      setError('削除に失敗しました')
    }
  }

  return (
    <div>
      <Header
        title="オートメーション"
        action={
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規ルール
          </button>
        }
      />

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">新規オートメーションを作成</h2>
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">ルール名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: 友だち追加時にウェルカムタグ付与"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">説明</label>
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
                rows={2}
                placeholder="ルールの説明 (省略可)"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">イベントタイプ</label>
              <select
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 bg-white"
                value={form.eventType}
                onChange={(e) => setForm({ ...form, eventType: e.target.value as AutomationEventType })}
              >
                {eventTypeOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">アクション (JSON)</label>
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
                rows={6}
                placeholder='[{"type": "add_tag", "params": {"tagId": "..."}}]'
                value={form.actionsJson}
                onChange={(e) => setForm({ ...form, actionsJson: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">条件 (JSON)</label>
              <textarea
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-500 resize-y"
                rows={3}
                placeholder='{"tagId": "...", "operator": "equals"}'
                value={form.conditionsJson}
                onChange={(e) => setForm({ ...form, conditionsJson: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">優先度</label>
              <input
                type="number"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                value={form.priority}
                onChange={(e) => setForm({ ...form, priority: parseInt(e.target.value, 10) || 0 })}
              />
            </div>

            {formError && <p className="text-xs text-red-600">{formError}</p>}

            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={saving}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
                style={{ backgroundColor: '#06C755' }}
              >
                {saving ? '作成中...' : '作成'}
              </button>
              <button
                onClick={() => { setShowCreate(false); setFormError('') }}
                className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="bg-white rounded-lg border border-gray-200 p-5 animate-pulse space-y-3">
              <div className="h-4 bg-gray-200 rounded w-3/4" />
              <div className="h-3 bg-gray-100 rounded w-full" />
              <div className="flex gap-4">
                <div className="h-3 bg-gray-100 rounded w-24" />
                <div className="h-3 bg-gray-100 rounded w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : automations.length === 0 && !showCreate ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500">オートメーションがありません。「新規ルール」から作成してください。</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {automations.map((automation) => (
            <div
              key={automation.id}
              className="bg-white rounded-lg shadow-sm border border-gray-200 p-5 hover:shadow-md transition-shadow"
            >
              {/* Header row */}
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-900 leading-tight">{automation.name}</h3>
                <button
                  onClick={() => handleToggleActive(automation.id, automation.isActive)}
                  className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                    automation.isActive ? 'bg-green-500' : 'bg-gray-300'
                  }`}
                  title={automation.isActive ? '有効 - クリックで無効化' : '無効 - クリックで有効化'}
                >
                  <span
                    className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      automation.isActive ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Description */}
              {automation.description && (
                <p className="text-xs text-gray-500 mb-3 line-clamp-2">{automation.description}</p>
              )}

              {/* Event type badge */}
              <div className="flex items-center gap-2 mb-3">
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${eventTypeBadgeColor[automation.eventType]}`}>
                  {eventTypeLabelMap[automation.eventType]}
                </span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                  automation.isActive ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {automation.isActive ? '有効' : '無効'}
                </span>
              </div>

              {/* Meta info */}
              <div className="flex items-center gap-4 text-xs text-gray-400 mb-3">
                <span>アクション: {automation.actions.length}件</span>
                <span>優先度: {automation.priority}</span>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
                <button
                  onClick={() => handleDelete(automation.id)}
                  className="px-3 py-1 min-h-[44px] text-xs font-medium text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                >
                  削除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
