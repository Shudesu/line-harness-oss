'use client'

import { useState, useEffect, useCallback } from 'react'
import { api, fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'

interface Form {
  id: string
  name: string
}

interface Submission {
  id: string
  formId: string
  friendId: string
  friendName?: string
  data: Record<string, unknown>
  createdAt: string
}

export default function FormSubmissionsPage() {
  const { selectedAccountId } = useAccount()
  const [forms, setForms] = useState<Form[]>([])
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [loading, setLoading] = useState(true)
  const [subLoading, setSubLoading] = useState(false)

  const loadForms = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: Form[] }>('/api/forms')
      if (res.success) {
        setForms(res.data)
      }
    } catch { /* silent */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadForms() }, [loadForms])

  const loadSubmissions = useCallback(async (formId: string) => {
    setSubLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: Submission[] }>(
        `/api/forms/${formId}/submissions`
      )
      if (res.success) {
        // Enrich with friend names
        const friendRes = await api.friends.list({ accountId: selectedAccountId || undefined, limit: '200' })
        const friendMap = new Map<string, string>()
        if (friendRes.success) {
          for (const f of (friendRes.data as unknown as { items: { id: string; displayName: string }[] }).items) {
            friendMap.set(f.id, f.displayName)
          }
        }
        setSubmissions(res.data.map((s) => ({
          ...s,
          data: typeof s.data === 'string' ? JSON.parse(s.data) : s.data,
          friendName: s.friendId ? friendMap.get(s.friendId) || '不明' : '不明',
        })))
      }
    } catch { /* silent */ }
    setSubLoading(false)
  }, [selectedAccountId])

  const handleSelectForm = (formId: string) => {
    setSelectedFormId(formId)
    loadSubmissions(formId)
  }

  return (
    <div>
      <Header title="フォーム回答" description="フォーム送信データの一覧" />

      {/* Form selector */}
      <div className="mb-6">
        <div className="flex flex-wrap gap-2">
          {loading ? (
            <div className="text-sm text-gray-400">読み込み中...</div>
          ) : forms.length === 0 ? (
            <div className="text-sm text-gray-400">フォームがありません</div>
          ) : (
            forms.map((form) => (
              <button
                key={form.id}
                onClick={() => handleSelectForm(form.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  selectedFormId === form.id
                    ? 'text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
                style={selectedFormId === form.id ? { backgroundColor: '#06C755' } : {}}
              >
                {form.name}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Submissions */}
      {selectedFormId && (
        subLoading ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
            読み込み中...
          </div>
        ) : submissions.length === 0 ? (
          <div className="bg-white rounded-lg border border-gray-200 p-8 text-center text-gray-400">
            回答がありません
          </div>
        ) : (
          <div className="space-y-4">
            {submissions.map((sub) => (
              <div key={sub.id} className="bg-white rounded-lg border border-gray-200 p-5">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-gray-900">{sub.friendName}</span>
                    <span className="text-xs text-gray-400">
                      {new Date(sub.createdAt).toLocaleString('ja-JP', {
                        year: 'numeric', month: '2-digit', day: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })}
                    </span>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {Object.entries(sub.data).map(([key, value]) => (
                    <div key={key} className="bg-gray-50 rounded-lg p-3">
                      <p className="text-xs text-gray-500 mb-0.5">{key}</p>
                      <p className="text-sm font-medium text-gray-900">
                        {Array.isArray(value) ? value.join(', ') : String(value || '-')}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  )
}
