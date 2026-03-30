'use client'

import { useState, useEffect, useCallback } from 'react'
import { api } from '@/lib/api'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'
import MultiMessageEditor, {
  type MessageItem,
  parseMessages,
  serializeMessages,
} from '@/components/multi-message-editor'

interface Template {
  id: string
  name: string
  category: string
  messageType: string
  messageContent: string
  createdAt: string
  updatedAt: string
}

const messageTypeLabels: Record<string, string> = {
  text: 'テキスト',
  image: '画像',
  image_link: '画像+リンク',
  flex: 'Flex',
  carousel: 'カルーセル',
  multi: '複数吹き出し',
}

interface CreateFormState {
  name: string
  category: string
  messages: MessageItem[]
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const ccPrompts = [
  {
    title: 'テンプレート作成',
    prompt: `新しいメッセージテンプレートの作成をサポートしてください。
1. 用途別（挨拶、キャンペーン、通知、フォローアップ）のテンプレート文例を提案
2. テキスト・画像・Flexメッセージそれぞれの効果的な使い方
3. カテゴリ分類と命名規則のベストプラクティス
手順を示してください。`,
  },
  {
    title: 'テンプレート整理',
    prompt: `既存のテンプレートを整理・最適化してください。
1. カテゴリ別のテンプレート数と使用頻度を分析
2. 重複・類似テンプレートの統合提案
3. 不足しているカテゴリやテンプレートの追加推奨
結果をレポートしてください。`,
  },
]

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [selectedCategory, setSelectedCategory] = useState<string>('all')
  const [form, setForm] = useState<CreateFormState>({
    name: '',
    category: '',
    messages: [{ type: 'text', content: '' }],
  })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<CreateFormState>({
    name: '',
    category: '',
    messages: [{ type: 'text', content: '' }],
  })
  const [editSaving, setEditSaving] = useState(false)
  const [editFormError, setEditFormError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.templates.list(
        selectedCategory !== 'all' ? selectedCategory : undefined
      )
      if (res.success) {
        setTemplates(res.data)
      } else {
        setError(res.error)
      }
    } catch {
      setError('テンプレートの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedCategory])

  useEffect(() => {
    load()
  }, [load])

  const categories = Array.from(
    new Set(templates.map((t) => t.category).filter(Boolean))
  )

  const handleCreate = async () => {
    if (!form.name.trim()) {
      setFormError('テンプレート名を入力してください')
      return
    }
    if (!form.category.trim()) {
      setFormError('カテゴリを入力してください')
      return
    }
    const hasContent = form.messages.some((m) => m.content.trim())
    if (!hasContent) {
      setFormError('メッセージ内容を入力してください')
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const { messageType, messageContent } = serializeMessages(form.messages)
      const res = await api.templates.create({
        name: form.name,
        category: form.category,
        messageType,
        messageContent,
      })
      if (res.success) {
        setShowCreate(false)
        setForm({ name: '', category: '', messages: [{ type: 'text', content: '' }] })
        load()
      } else {
        setFormError(res.error)
      }
    } catch {
      setFormError('作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const startEdit = (template: Template) => {
    setEditingId(template.id)
    setEditForm({
      name: template.name,
      category: template.category,
      messages: parseMessages(template.messageType, template.messageContent),
    })
    setEditFormError('')
  }

  const handleEdit = async () => {
    if (!editingId) return
    if (!editForm.name.trim()) {
      setEditFormError('テンプレート名を入力してください')
      return
    }
    if (!editForm.category.trim()) {
      setEditFormError('カテゴリを入力してください')
      return
    }
    const hasContent = editForm.messages.some((m) => m.content.trim())
    if (!hasContent) {
      setEditFormError('メッセージ内容を入力してください')
      return
    }
    setEditSaving(true)
    setEditFormError('')
    try {
      const { messageType, messageContent } = serializeMessages(editForm.messages)
      const res = await api.templates.update(editingId, {
        name: editForm.name,
        category: editForm.category,
        messageType,
        messageContent,
      })
      if (res.success) {
        setEditingId(null)
        load()
      } else {
        setEditFormError(res.error)
      }
    } catch {
      setEditFormError('更新に失敗しました')
    } finally {
      setEditSaving(false)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このテンプレートを削除してもよいですか？')) return
    try {
      await api.templates.delete(id)
      load()
    } catch {
      setError('削除に失敗しました')
    }
  }

  return (
    <div>
      <Header
        title="テンプレート管理"
        action={
          <button
            onClick={() => setShowCreate(true)}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規テンプレート
          </button>
        }
      />

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Category filter */}
      {!loading && categories.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={() => setSelectedCategory('all')}
            className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-full transition-colors ${
              selectedCategory === 'all'
                ? 'text-white'
                : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
            }`}
            style={selectedCategory === 'all' ? { backgroundColor: '#06C755' } : undefined}
          >
            全て
          </button>
          {categories.map((cat) => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3 py-1.5 min-h-[44px] text-xs font-medium rounded-full transition-colors ${
                selectedCategory === cat
                  ? 'text-white'
                  : 'text-gray-600 bg-gray-100 hover:bg-gray-200'
              }`}
              style={selectedCategory === cat ? { backgroundColor: '#06C755' } : undefined}
            >
              {cat}
            </button>
          ))}
        </div>
      )}

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 bg-white rounded-lg shadow-sm border border-gray-200 p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">新規テンプレートを作成</h2>
          <div className="space-y-4 max-w-lg">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">テンプレート名 <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: ウェルカムメッセージ"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">カテゴリ <span className="text-red-500">*</span></label>
              <input
                type="text"
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: 挨拶、キャンペーン、通知"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">メッセージ内容 <span className="text-red-500">*</span></label>
              <MultiMessageEditor
                messages={form.messages}
                onChange={(messages) => setForm({ ...form, messages })}
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
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-gray-100 flex items-center gap-4 animate-pulse">
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-48" />
                <div className="h-2 bg-gray-100 rounded w-32" />
              </div>
              <div className="h-5 bg-gray-100 rounded-full w-16" />
              <div className="h-3 bg-gray-100 rounded w-24" />
            </div>
          ))}
        </div>
      ) : templates.length === 0 && !showCreate ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500">テンプレートがありません。「新規テンプレート」から作成してください。</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  テンプレート名
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  カテゴリ
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  メッセージタイプ
                </th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  作成日時
                </th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {templates.map((template) => (
                <tr key={template.id} className="hover:bg-gray-50 transition-colors">
                  {editingId === template.id ? (
                    <td colSpan={5} className="px-4 py-4">
                      <div className="space-y-3 max-w-lg">
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">テンプレート名</label>
                          <input
                            type="text"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                            value={editForm.name}
                            onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">カテゴリ</label>
                          <input
                            type="text"
                            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                            value={editForm.category}
                            onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-600 mb-1">メッセージ内容</label>
                          <MultiMessageEditor
                            messages={editForm.messages}
                            onChange={(messages) => setEditForm({ ...editForm, messages })}
                          />
                        </div>
                        {editFormError && <p className="text-xs text-red-600">{editFormError}</p>}
                        <div className="flex gap-2">
                          <button
                            onClick={handleEdit}
                            disabled={editSaving}
                            className="px-4 py-2 min-h-[44px] text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity"
                            style={{ backgroundColor: '#06C755' }}
                          >
                            {editSaving ? '保存中...' : '保存'}
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-4 py-2 min-h-[44px] text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors"
                          >
                            キャンセル
                          </button>
                        </div>
                      </div>
                    </td>
                  ) : (
                    <>
                      {/* Name */}
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-gray-900">{template.name}</p>
                          <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">
                            {template.messageContent.slice(0, 50)}
                            {template.messageContent.length > 50 ? '...' : ''}
                          </p>
                        </div>
                      </td>

                      {/* Category */}
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                          {template.category}
                        </span>
                      </td>

                      {/* Message Type */}
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {messageTypeLabels[template.messageType] || template.messageType}
                      </td>

                      {/* Created At */}
                      <td className="px-4 py-3 text-sm text-gray-500">
                        {formatDate(template.createdAt)}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => startEdit(template)}
                            className="px-3 py-1 min-h-[44px] text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors"
                          >
                            編集
                          </button>
                          <button
                            onClick={() => handleDelete(template.id)}
                            className="px-3 py-1 min-h-[44px] text-xs font-medium text-red-500 hover:text-red-700 bg-red-50 hover:bg-red-100 rounded-md transition-colors"
                          >
                            削除
                          </button>
                        </div>
                      </td>
                    </>
                  )}
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
