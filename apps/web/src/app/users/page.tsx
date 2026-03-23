'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import type { User } from '@line-crm/shared'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'

const ccPrompts = [
  {
    title: 'ユーザー紐付け確認',
    prompt: `ユーザーとLINEアカウントの紐付け状況を確認してください。
1. 各ユーザーの紐付きLINEアカウント数とフォロー状態を一覧表示
2. 紐付けのないユーザーや孤立アカウントを特定
3. クロスアカウントUUIDの整合性を検証
結果をレポートしてください。`,
  },
  {
    title: 'ユーザーデータ整理',
    prompt: `ユーザーデータのクリーンアップを行ってください。
1. 重複ユーザー（同一メール・電話番号）の検出
2. 不完全なプロフィール（表示名・メール・電話が未設定）の一覧
3. データ品質向上のための具体的なアクションプランを提案
手順を示してください。`,
  },
]

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ email: '', phone: '', displayName: '', externalId: '' })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [linkedAccounts, setLinkedAccounts] = useState<{ id: string; lineUserId: string; displayName: string | null; isFollowing: boolean }[]>([])

  const load = async () => {
    setLoading(true)
    try {
      const res = await api.users.list()
      if (res.success) setUsers(res.data)
    } catch {}
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.users.create({
        email: form.email || null,
        phone: form.phone || null,
        displayName: form.displayName || null,
        externalId: form.externalId || null,
      })
      setForm({ email: '', phone: '', displayName: '', externalId: '' })
      setShowCreate(false)
      load()
    } catch {}
  }

  const handleDelete = async (id: string) => {
    if (!confirm('このユーザーを削除しますか？')) return
    await api.users.delete(id)
    load()
  }

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    setExpandedId(id)
    try {
      const res = await api.users.accounts(id)
      if (res.success) setLinkedAccounts(res.data)
      else setLinkedAccounts([])
    } catch {
      setLinkedAccounts([])
    }
  }

  return (
    <div>
      <Header
        title="ユーザーUUID管理"
        description="クロスアカウントUUIDシステム"
        action={
          <button
            onClick={() => setShowCreate(!showCreate)}
            className="px-4 py-2 min-h-[44px] rounded-lg text-white text-sm font-medium"
            style={{ backgroundColor: '#06C755' }}
          >
            {showCreate ? 'キャンセル' : '+ ユーザー作成'}
          </button>
        }
      />

      {showCreate && (
        <form onSubmit={handleCreate} className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">表示名</label>
              <input
                value={form.displayName}
                onChange={(e) => setForm({ ...form, displayName: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="山田太郎"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">メール</label>
              <input
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="user@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">電話番号</label>
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="090-1234-5678"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">外部ID</label>
              <input
                value={form.externalId}
                onChange={(e) => setForm({ ...form, externalId: e.target.value })}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
                placeholder="ext-123"
              />
            </div>
          </div>
          <button
            type="submit"
            className="mt-4 px-4 py-2 min-h-[44px] rounded-lg text-white text-sm font-medium"
            style={{ backgroundColor: '#06C755' }}
          >
            作成
          </button>
        </form>
      )}

      {loading ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">読み込み中...</div>
      ) : users.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">ユーザーがまだありません</div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">UUID</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">表示名</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">メール</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">電話</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">作成日</th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {users.map((user) => (
                <>
                  <tr
                    key={user.id}
                    className="hover:bg-gray-50 cursor-pointer"
                    onClick={() => handleExpand(user.id)}
                  >
                    <td className="px-4 py-3 text-xs font-mono text-gray-500">{user.id.slice(0, 8)}...</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{user.displayName || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{user.email || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{user.phone || '-'}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">{new Date(user.createdAt).toLocaleDateString('ja-JP')}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDelete(user.id); }}
                        className="text-red-500 hover:text-red-700 text-sm"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                  {expandedId === user.id && (
                    <tr key={`${user.id}-detail`}>
                      <td colSpan={6} className="px-6 py-4 bg-gray-50">
                        <p className="text-xs font-medium text-gray-500 mb-2">紐付きLINEアカウント:</p>
                        {linkedAccounts.length === 0 ? (
                          <p className="text-sm text-gray-400">なし</p>
                        ) : (
                          <div className="space-y-1">
                            {linkedAccounts.map((a) => (
                              <div key={a.id} className="flex items-center gap-2 text-sm">
                                <span className={`w-2 h-2 rounded-full ${a.isFollowing ? 'bg-green-500' : 'bg-gray-300'}`} />
                                <span className="text-gray-700">{a.displayName || 'Unknown'}</span>
                                <span className="text-gray-400 font-mono text-xs">({a.lineUserId})</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="text-xs text-gray-400 mt-2 font-mono">Full UUID: {user.id}</p>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
