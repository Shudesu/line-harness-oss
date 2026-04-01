'use client'
import { useState, useEffect } from 'react'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'
import type { ApiResponse } from '@line-crm/shared'
import type { StaffMember } from '@line-crm/shared'

type NewApiKey = { apiKey: string; staffId: string }

// Fixx Scheduler integration
const SCHEDULER_SUPABASE_URL = 'https://uilthhwvatyrbwbhxbbu.supabase.co'
const SCHEDULER_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVpbHRoaHd2YXR5cmJ3Ymh4YmJ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE2MDkzODcsImV4cCI6MjA4NzE4NTM4N30.IOHvxn7VA3fUiEn6mPyYh_yUaNcpkQyirA9S6khMMNA'

interface SchedulerStaff {
  id: string
  name: string
  calendar_id: string
  is_active: boolean
  is_fallback: boolean
}

async function fetchSchedulerStaff(): Promise<SchedulerStaff[]> {
  const res = await fetch(
    `${SCHEDULER_SUPABASE_URL}/rest/v1/staff_members?select=id,name,calendar_id,is_active,is_fallback`,
    { headers: { apikey: SCHEDULER_SUPABASE_KEY, Authorization: `Bearer ${SCHEDULER_SUPABASE_KEY}` } }
  )
  if (!res.ok) return []
  return res.json()
}

async function toggleSchedulerStaff(id: string, isActive: boolean): Promise<boolean> {
  const res = await fetch(
    `${SCHEDULER_SUPABASE_URL}/rest/v1/staff_members?id=eq.${id}`,
    {
      method: 'PATCH',
      headers: {
        apikey: SCHEDULER_SUPABASE_KEY,
        Authorization: `Bearer ${SCHEDULER_SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ is_active: isActive }),
    }
  )
  return res.ok
}

function RoleBadge({ role }: { role: string }) {
  const styles =
    role === 'owner'
      ? 'bg-yellow-100 text-yellow-800'
      : role === 'admin'
        ? 'bg-blue-100 text-blue-800'
        : 'bg-gray-100 text-gray-600'
  const label =
    role === 'owner' ? 'オーナー' : role === 'admin' ? '管理者' : 'スタッフ'
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${styles}`}>
      {label}
    </span>
  )
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

  // Scheduler staff
  const [schedulerStaff, setSchedulerStaff] = useState<SchedulerStaff[]>([])
  const [schedulerLoading, setSchedulerLoading] = useState<string | null>(null)

  const loadSchedulerStaff = async () => {
    const data = await fetchSchedulerStaff()
    setSchedulerStaff(data)
  }

  useEffect(() => {
    loadSchedulerStaff()
  }, [])

  const getSchedulerMatch = (memberEmail: string | null): SchedulerStaff | undefined => {
    if (!memberEmail) return undefined
    return schedulerStaff.find(s => s.calendar_id === memberEmail)
  }

  const handleToggleScheduler = async (schedulerId: string, currentActive: boolean) => {
    setSchedulerLoading(schedulerId)
    const ok = await toggleSchedulerStaff(schedulerId, !currentActive)
    if (ok) await loadSchedulerStaff()
    setSchedulerLoading(null)
  }

  // Create form
  const [showForm, setShowForm] = useState(false)
  const [formName, setFormName] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [formRole, setFormRole] = useState<'admin' | 'staff'>('staff')
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
      const body: { name: string; role: 'admin' | 'staff'; email?: string } = {
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
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm font-medium text-green-800 mb-2">
            APIキーが発行されました。このキーは一度しか表示されません。
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs bg-white border border-green-200 rounded px-3 py-2 font-mono break-all">
              {newKey.apiKey}
            </code>
            <button
              onClick={handleCopy}
              className="shrink-0 px-3 py-2 text-xs font-medium text-green-700 bg-white border border-green-300 rounded-lg hover:bg-green-50 transition-colors"
            >
              {copied ? 'コピー済み' : 'コピー'}
            </button>
            <button
              onClick={() => setNewKey(null)}
              className="shrink-0 px-3 py-2 text-xs font-medium text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
            >
              閉じる
            </button>
          </div>
        </div>
      )}

      {/* Create form */}
      {showForm && (
        <div className="mb-6 p-5 bg-white border border-gray-200 rounded-lg shadow-sm">
          <h2 className="text-sm font-semibold text-gray-900 mb-4">新しいスタッフを追加</h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">名前 *</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  placeholder="田中 太郎"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">メールアドレス</label>
                <input
                  type="email"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  placeholder="taro@example.com"
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">ロール *</label>
                <select
                  value={formRole}
                  onChange={(e) => setFormRole(e.target.value as 'admin' | 'staff')}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
                >
                  <option value="staff">スタッフ</option>
                  <option value="admin">管理者</option>
                </select>
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
              <button
                type="button"
                onClick={() => { setShowForm(false); setFormError('') }}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
              >
                キャンセル
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Staff list */}
      {loading ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
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
        </div>
      ) : members.length === 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center">
          <p className="text-gray-500 text-sm">スタッフがいません。「+ スタッフを追加」から追加してください。</p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">名前</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider hidden sm:table-cell">メール</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">ロール</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">状態</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">面談対応</th>
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
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-xs ${member.isActive ? 'text-green-700' : 'text-gray-400'}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${member.isActive ? 'bg-green-500' : 'bg-gray-300'}`} />
                      {member.isActive ? '有効' : '無効'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {(() => {
                      const match = getSchedulerMatch(member.email ?? null)
                      if (!match) return <span className="text-xs text-gray-300">—</span>
                      const isLoading = schedulerLoading === match.id
                      return (
                        <button
                          onClick={() => handleToggleScheduler(match.id, match.is_active)}
                          disabled={isLoading}
                          className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${match.is_active ? 'bg-green-500' : 'bg-gray-300'} ${isLoading ? 'opacity-50' : ''}`}
                        >
                          <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${match.is_active ? 'translate-x-4' : 'translate-x-0.5'}`} />
                        </button>
                      )
                    })()}
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
