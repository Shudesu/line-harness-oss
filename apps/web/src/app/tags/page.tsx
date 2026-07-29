'use client'

import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import type { Tag } from '@line-crm/shared'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'

const DEFAULT_COLOR = '#06C755'

export default function TagsPage() {
  const [tags, setTags] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [name, setName] = useState('')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [error, setError] = useState('')
  const [formError, setFormError] = useState('')
  const [creating, setCreating] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const loadTags = useCallback(async () => {
    setLoading(true)
    setError('')

    try {
      const res = await api.tags.list()
      if (res.success) {
        setTags(res.data)
      } else {
        setError('タグ一覧の取得に失敗しました。もう一度お試しください。')
      }
    } catch {
      setError('タグ一覧の取得に失敗しました。通信環境を確認して、もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadTags()
  }, [loadTags])

  const closeCreateForm = () => {
    setShowCreate(false)
    setName('')
    setColor(DEFAULT_COLOR)
    setFormError('')
  }

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const trimmedName = name.trim()

    if (!trimmedName) {
      setFormError('タグ名を入力してください。')
      return
    }

    setCreating(true)
    setFormError('')

    try {
      const res = await api.tags.create({ name: trimmedName, color })
      if (!res.success) {
        setFormError('タグの作成に失敗しました。入力内容を確認して、もう一度お試しください。')
        return
      }

      closeCreateForm()
      await loadTags()
    } catch {
      setFormError('タグの作成に失敗しました。もう一度お試しください。')
    } finally {
      setCreating(false)
    }
  }

  const handleDelete = async (tag: Tag) => {
    if (!window.confirm(`タグ「${tag.name}」を削除しますか？\nこの操作は元に戻せません。`)) return

    setDeletingId(tag.id)
    setError('')

    try {
      const res = await api.tags.delete(tag.id)
      if (!res.success) {
        setError('タグの削除に失敗しました。もう一度お試しください。')
        return
      }

      await loadTags()
    } catch {
      setError('タグの削除に失敗しました。もう一度お試しください。')
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div>
      <Header
        title="タグ管理"
        description="友だちの分類に使用するタグを作成・削除できます"
        action={
          <button
            type="button"
            onClick={() => {
              if (showCreate) {
                closeCreateForm()
              } else {
                setShowCreate(true)
                setFormError('')
              }
            }}
            className="px-4 py-2 min-h-[44px] rounded-lg text-white text-sm font-medium transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            {showCreate ? 'キャンセル' : '新しいタグを作成'}
          </button>
        }
      />

      {error && (
        <div role="alert" className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {showCreate && (
        <form onSubmit={handleCreate} className="mb-6 bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="mb-4 text-sm font-semibold text-gray-900">新しいタグを作成</h2>
          <div className="max-w-lg space-y-4">
            <div>
              <label htmlFor="tag-name" className="block mb-1 text-xs font-medium text-gray-700">
                タグ名 <span className="text-red-500">*</span>
              </label>
              <input
                id="tag-name"
                type="text"
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="例: VIP顧客"
                required
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="tag-color" className="block mb-1 text-xs font-medium text-gray-700">
                タグカラー
              </label>
              <div className="flex items-center gap-3">
                <input
                  id="tag-color"
                  type="color"
                  value={color}
                  onChange={(event) => setColor(event.target.value.toUpperCase())}
                  className="h-10 w-14 cursor-pointer rounded-lg border border-gray-300 bg-white p-1"
                />
                <span className="text-sm font-mono text-gray-600">{color}</span>
              </div>
            </div>

            {formError && (
              <div role="alert" className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs">
                {formError}
              </div>
            )}

            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 min-h-[44px] rounded-lg text-white text-sm font-medium transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              style={{ backgroundColor: '#06C755' }}
            >
              {creating ? '作成中...' : '作成'}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-sm text-gray-400">
          読み込み中...
        </div>
      ) : tags.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-500">タグがまだありません</p>
          <p className="mt-1 text-xs text-gray-400">「新しいタグを作成」から最初のタグを追加してください。</p>
        </div>
      ) : (
        <div className="overflow-x-auto bg-white rounded-lg border border-gray-200">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500">タグ名</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500">タグカラー</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tags.map((tag) => (
                <tr key={tag.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4 font-medium text-gray-900">{tag.name}</td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="h-4 w-4 shrink-0 rounded-full border border-black/10"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="font-mono text-xs text-gray-500">{tag.color}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      type="button"
                      onClick={() => void handleDelete(tag)}
                      disabled={deletingId !== null}
                      className="min-h-[44px] px-3 text-xs font-medium text-red-500 transition-colors hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {deletingId === tag.id ? '削除中...' : '削除'}
                    </button>
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
