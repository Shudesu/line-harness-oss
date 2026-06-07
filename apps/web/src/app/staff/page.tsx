'use client'
import { useState, useEffect } from 'react'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'
import type { ApiResponse } from '@line-crm/shared'
import type { StaffMember } from '@line-crm/shared'
import {
  Badge,
  Banner,
  Button,
  Card,
  CardContent,
  Input,
  Label,
  Select,
} from '@/components/ui/primitives'

type NewApiKey = { apiKey: string; staffId: string }

function RoleBadge({ role }: { role: string }) {
  const tone =
    role === 'owner'
      ? 'default'
      : role === 'admin'
        ? 'info'
        : role === 'viewer'
          ? 'success'
          : 'neutral'
  const label =
    role === 'owner'
      ? 'オーナー'
      : role === 'admin'
        ? '管理者'
        : role === 'viewer'
          ? '閲覧専用'
          : 'スタッフ'
  return <Badge tone={tone}>{label}</Badge>
}

function maskKey(key: string): string {
  if (!key || key.length <= 8) return '••••••••'
  return key.slice(0, 4) + '••••••••' + key.slice(-4)
}

export default function StaffPage() {
  const [members, setMembers] = useState<StaffMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // New API key banner
  const [newKey, setNewKey] = useState<NewApiKey | null>(null)
  const [copied, setCopied] = useState(false)

  // Create form
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formRole, setFormRole] = useState<'admin' | 'staff' | 'viewer'>('staff')
  const [formLoading, setFormLoading] = useState(false)
  const [formError, setFormError] = useState('')

  const loadMembers = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetchApi<ApiResponse<StaffMember[]>>('/api/staff')
      if (res.success) {
        setMembers(res.data)
      } else {
        setError(res.error ?? 'スタッフの読み込みに失敗しました')
      }
    } catch {
      setError('スタッフの読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadMembers()
  }, [])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormLoading(true)
    setFormError('')
    try {
      const body: { name: string; role: 'admin' | 'staff' | 'viewer'; email?: string } = {
        name: formName,
        role: formRole,
      }
      if (formEmail) body.email = formEmail

      const res = await fetchApi<ApiResponse<StaffMember & { apiKey?: string }>>('/api/staff', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      if (res.success) {
        if (res.data.apiKey) {
          setNewKey({ apiKey: res.data.apiKey, staffId: res.data.id })
        }
        setFormName('')
        setFormEmail('')
        setFormRole('staff')
        setShowForm(false)
        await loadMembers()
      } else {
        setFormError(res.error ?? '作成に失敗しました')
      }
    } catch {
      setFormError('作成に失敗しました')
    } finally {
      setFormLoading(false)
    }
  }

  const handleToggleActive = async (member: StaffMember) => {
    try {
      await fetchApi<ApiResponse<StaffMember>>(`/api/staff/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !member.isActive }),
      })
      await loadMembers()
    } catch {
      setError('更新に失敗しました')
    }
  }

  const handleRegenerateKey = async (member: StaffMember) => {
    if (!confirm(`${member.name} のAPIキーを再生成しますか？\n現在のキーは無効になります。`)) return
    try {
      const res = await fetchApi<ApiResponse<{ apiKey: string }>>(`/api/staff/${member.id}/regenerate-key`, {
        method: 'POST',
      })
      if (res.success) {
        setNewKey({ apiKey: res.data.apiKey, staffId: member.id })
      } else {
        setError(res.error ?? 'キー再生成に失敗しました')
      }
    } catch {
      setError('キー再生成に失敗しました')
    }
  }

  const handleDelete = async (member: StaffMember) => {
    if (!confirm(`${member.name} を削除しますか？\nこの操作は元に戻せません。`)) return
    try {
      await fetchApi<ApiResponse<null>>(`/api/staff/${member.id}`, { method: 'DELETE' })
      await loadMembers()
    } catch {
      setError('削除に失敗しました')
    }
  }

  const handleCopy = async () => {
    if (!newKey) return
    await navigator.clipboard.writeText(newKey.apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div>
      <Header
        title="スタッフ管理"
        action={
          <button
            onClick={() => setShowForm(!showForm)}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + スタッフを追加
          </button>
        }
      />

      {/* New API key banner */}
      {newKey && (
        <Banner
          tone="success"
          title="APIキーが発行されました。このキーは一度しか表示されません。"
          className="mb-6"
        >
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white border border-emerald-200 rounded px-3 py-2 font-mono break-all">
              {newKey.apiKey}
            </code>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopy}
              className="shrink-0"
            >
              {copied ? 'コピー済み' : 'コピー'}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setNewKey(null)}
              className="shrink-0"
            >
              閉じる
            </Button>
          </div>
        </Banner>
      )}

      {/* Create form */}
      {showForm && (
        <Card className="mb-6">
          <CardContent className="pt-5">
            <h2 className="text-sm font-semibold text-gray-900 mb-4">新しいスタッフを追加</h2>
            <form onSubmit={handleCreate} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <Label className="text-xs">名前 *</Label>
                  <Input
                    type="text"
                    value={formName}
                    onChange={(e) => setFormName(e.target.value)}
                    required
                    placeholder="田中 太郎"
                  />
                </div>
                <div>
                  <Label className="text-xs">メールアドレス</Label>
                  <Input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="taro@example.com"
                  />
                </div>
                <div>
                  <Label className="text-xs">ロール *</Label>
                  <Select
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value as 'admin' | 'staff' | 'viewer')}
                  >
                    <option value="staff">スタッフ</option>
                    <option value="admin">管理者</option>
                    <option value="viewer">閲覧専用 (顧問先・代理店向け)</option>
                  </Select>
                </div>
              </div>
              {formError && (
                <p className="text-sm text-red-600">{formError}</p>
              )}
              <div className="flex items-center gap-3">
                <button
                  type="submit"
                  disabled={formLoading || !formName}
                  className="px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-opacity hover:opacity-90"
                  style={{ backgroundColor: '#06C755' }}
                >
                  {formLoading ? '作成中...' : '作成'}
                </button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setShowForm(false); setFormError('') }}
                >
                  キャンセル
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Banner tone="danger" className="mb-4">
          {error}
        </Banner>
      )}

      {/* Staff list */}
      {loading ? (
        <Card className="overflow-hidden">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-gray-100 flex items-center gap-4 animate-pulse">
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-32" />
                <div className="h-2 bg-gray-100 rounded w-48" />
              </div>
              <div className="h-5 bg-gray-100 rounded-full w-16" />
              <div className="h-5 bg-gray-100 rounded w-24" />
              <div className="h-8 bg-gray-100 rounded w-20" />
            </div>
          ))}
        </Card>
      ) : members.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center">
            <p className="text-gray-500 text-sm">スタッフがいません。「+ スタッフを追加」から追加してください。</p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">名前</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">メール</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">ロール</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden md:table-cell">APIキー</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">状態</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wider">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {members.map((member) => (
                <tr key={member.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-medium text-gray-900">{member.name}</td>
                  <td className="px-4 py-3 text-gray-500 hidden sm:table-cell">{member.email ?? '—'}</td>
                  <td className="px-4 py-3">
                    <RoleBadge role={member.role} />
                  </td>
                  <td className="px-4 py-3 text-gray-400 font-mono text-xs hidden md:table-cell">
                    {maskKey(member.apiKey ?? '')}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs ${member.isActive ? 'text-green-700' : 'text-gray-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${member.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                      {member.isActive ? '有効' : '無効'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-2">
                      {member.role !== 'owner' && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleToggleActive(member)}
                          >
                            {member.isActive ? '無効化' : '有効化'}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRegenerateKey(member)}
                            className="text-blue-600 border-blue-200 hover:bg-blue-50"
                          >
                            キー再生成
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDelete(member)}
                            className="text-red-600 border-red-200 hover:bg-red-50"
                          >
                            削除
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
