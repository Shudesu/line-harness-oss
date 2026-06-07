'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { fetchApi } from '@/lib/api'
import { countryFlag } from '@/lib/country-flag'
import Header from '@/components/layout/header'
import {
  Button,
  Card,
  CardContent,
  EmptyState,
} from '@/components/ui/primitives'

interface UsedByAccount {
  id: string
  name: string
  country: string | null
  displayOrder: number
  count: number
}

interface Form {
  id: string
  name: string
  description: string | null
  submitCount?: number
  lastSubmittedAt: string | null
  usedByAccounts: UsedByAccount[]
}

interface FormDetail extends Form {
  fields: Array<{ name: string; label: string; type?: string }>
}

interface Submission {
  id: string
  formId: string
  friendId: string | null
  friendName?: string | null
  data: Record<string, unknown>
  createdAt: string
}

const PAGE_SIZE = 20

function formatRelative(iso: string | null): string {
  if (!iso) return '未回答'
  const d = new Date(iso)
  const now = Date.now()
  const diffMin = Math.floor((now - d.getTime()) / 60000)
  if (diffMin < 1) return 'たった今'
  if (diffMin < 60) return `${diffMin}分前`
  if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)}時間前`
  if (diffMin < 60 * 24 * 7) return `${Math.floor(diffMin / (60 * 24))}日前`
  return d.toLocaleDateString('ja-JP', { month: '2-digit', day: '2-digit' })
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—'
  if (Array.isArray(v)) return v.length === 0 ? '—' : v.join(', ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

export default function FormSubmissionsPage() {
  const [forms, setForms] = useState<Form[]>([])
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null)
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [subLoading, setSubLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [detailSubmission, setDetailSubmission] = useState<Submission | null>(null)

  const loadForms = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: Form[] }>('/api/forms')
      if (res.success) setForms(res.data)
    } catch { /* silent */ }
    setLoading(false)
  }, [])

  useEffect(() => { loadForms() }, [loadForms])

  const loadSubmissions = useCallback(async (formId: string) => {
    setSubLoading(true)
    setPage(1)
    setDetailSubmission(null)
    try {
      const formRes = await fetchApi<{ success: boolean; data: FormDetail | { fields: string | FormDetail['fields'] } }>(`/api/forms/${formId}`)
      const subRes = await fetchApi<{ success: boolean; data: Submission[] }>(`/api/forms/${formId}/submissions`)

      // Race-guard: only apply if user hasn't switched away
      setSelectedFormId((current) => {
        if (current !== formId) return current
        if (formRes.success) {
          const rawFields = (formRes.data as { fields: unknown }).fields
          const fields = typeof rawFields === 'string'
            ? (JSON.parse(rawFields) as Array<{ name: string; label: string }>)
            : (rawFields as Array<{ name: string; label: string }>)
          const labels: Record<string, string> = {}
          for (const f of fields ?? []) labels[f.name] = f.label
          setFieldLabels(labels)
        }
        if (subRes.success) {
          setSubmissions(
            subRes.data.map((s) => ({
              ...s,
              data: typeof s.data === 'string' ? JSON.parse(s.data) : s.data,
              friendName: s.friendName ?? null,
            })),
          )
        }
        return current
      })
    } catch { /* silent */ }
    setSelectedFormId((current) => {
      if (current === formId) setSubLoading(false)
      return current
    })
  }, [])

  const handleSelectForm = (formId: string) => {
    setSelectedFormId(formId)
    loadSubmissions(formId)
  }

  const selectedForm = useMemo(
    () => forms.find((f) => f.id === selectedFormId) ?? null,
    [forms, selectedFormId],
  )

  const totalPages = Math.max(1, Math.ceil(submissions.length / PAGE_SIZE))
  const paged = submissions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const fieldKeys = useMemo(
    () =>
      submissions.length > 0
        ? [...new Set(submissions.flatMap((s) => Object.keys(s.data)))]
        : [],
    [submissions],
  )

  return (
    <div>
      <Header title="フォーム回答" description="送信されたフォームを件数・配信アカウント・回答内容まで一覧で確認" />

      {/* Form cards */}
      <section className="mb-6">
        {loading ? (
          <div className="text-sm text-gray-400">読み込み中...</div>
        ) : forms.length === 0 ? (
          <EmptyState title="フォームがまだありません" />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
            {forms.map((form) => {
              const isSelected = selectedFormId === form.id
              const totalCount = form.usedByAccounts.reduce((sum, a) => sum + a.count, 0)
              const displayCount = form.submitCount ?? totalCount
              return (
                <button
                  key={form.id}
                  onClick={() => handleSelectForm(form.id)}
                  className={`group text-left rounded-xl border p-4 transition-all ${
                    isSelected
                      ? 'border-[#06C755] bg-[#F1FBF5] shadow-sm'
                      : 'border-gray-200 bg-white hover:border-gray-300 hover:shadow-sm'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className={`text-sm font-semibold leading-snug ${isSelected ? 'text-[#06C755]' : 'text-gray-900'}`}>
                      {form.name}
                    </h3>
                    <span className="text-[11px] text-gray-400 whitespace-nowrap">
                      {formatRelative(form.lastSubmittedAt)}
                    </span>
                  </div>

                  <div className="flex items-baseline gap-1 mb-3">
                    <span className="text-2xl font-bold text-gray-900 tabular-nums">{displayCount}</span>
                    <span className="text-xs text-gray-400">件の回答</span>
                  </div>

                  {form.usedByAccounts.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {form.usedByAccounts.map((acc) => {
                        const flag = countryFlag(acc.country)
                        return (
                          <span
                            key={acc.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gray-50 border border-gray-100 text-[11px] text-gray-700"
                            title={`${acc.name}: ${acc.count}件`}
                          >
                            {flag && <span>{flag}</span>}
                            <span className="font-medium">{acc.name}</span>
                            <span className="text-gray-400 tabular-nums">{acc.count}</span>
                          </span>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="text-[11px] text-gray-300">配信中アカウントなし</div>
                  )}
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* Submissions table */}
      {selectedForm && (
        <section>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-baseline gap-2">
              <h2 className="text-base font-semibold text-gray-900">{selectedForm.name}</h2>
              <span className="text-xs text-gray-400">
                {subLoading ? '読み込み中...' : `${submissions.length}件`}
              </span>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedFormId(null)
                setSubmissions([])
                setDetailSubmission(null)
              }}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              閉じる ✕
            </Button>
          </div>

          {subLoading ? (
            <Card>
              <CardContent className="p-8 text-center text-gray-400 text-sm">読み込み中...</CardContent>
            </Card>
          ) : submissions.length === 0 ? (
            <EmptyState title="回答がありません" />
          ) : (
            <>
              <Card className="overflow-x-auto">
                <table className="w-full min-w-[700px]">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">名前</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">日時</th>
                      {fieldKeys.slice(0, 4).map((key) => (
                        <th key={key} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">
                          {fieldLabels[key] || key}
                        </th>
                      ))}
                      {fieldKeys.length > 4 && (
                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase whitespace-nowrap">…</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paged.map((sub) => (
                      <tr
                        key={sub.id}
                        onClick={() => setDetailSubmission(sub)}
                        className="hover:bg-gray-50 cursor-pointer"
                      >
                        <td className="px-4 py-3 text-sm font-medium text-gray-900 whitespace-nowrap">
                          {sub.friendId ? (
                            <Link
                              href={`/chats?friend=${encodeURIComponent(sub.friendId)}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-[#06C755] hover:underline"
                            >
                              {sub.friendName || '不明'}
                            </Link>
                          ) : (
                            <span>{sub.friendName || '不明'}</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                          {new Date(sub.createdAt).toLocaleString('ja-JP', {
                            month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
                          })}
                        </td>
                        {fieldKeys.slice(0, 4).map((key) => (
                          <td key={key} className="px-4 py-3 text-sm text-gray-700 max-w-[200px] truncate">
                            {formatValue(sub.data[key])}
                          </td>
                        ))}
                        {fieldKeys.length > 4 && (
                          <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">他 {fieldKeys.length - 4} 項目</td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              {totalPages > 1 && (
                <div className="flex items-center justify-between mt-4">
                  <p className="text-xs text-gray-400">
                    {(page - 1) * PAGE_SIZE + 1}〜{Math.min(page * PAGE_SIZE, submissions.length)} 件 / 全{submissions.length}件
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page === 1}
                    >
                      前へ
                    </Button>
                    <span className="px-3 py-1.5 text-sm text-gray-500">{page} / {totalPages}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page === totalPages}
                    >
                      次へ
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* Detail panel */}
      {detailSubmission && (
        <div className="fixed inset-0 z-40 flex justify-end">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setDetailSubmission(null)}
            aria-hidden
          />
          <aside className="relative h-full w-full max-w-md bg-white shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-5 py-4 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">回答詳細</h3>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDetailSubmission(null)}
                className="text-gray-400 hover:text-gray-600 text-lg leading-none"
                aria-label="閉じる"
              >
                ×
              </Button>
            </div>

            <div className="p-5 space-y-5">
              <div>
                <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">回答者</div>
                {detailSubmission.friendId ? (
                  <Link
                    href={`/chats?friend=${encodeURIComponent(detailSubmission.friendId)}`}
                    className="inline-flex items-center gap-2 text-sm text-[#06C755] hover:underline"
                  >
                    <span className="font-medium">{detailSubmission.friendName || '不明'}</span>
                    <span className="text-[11px] text-gray-400">→ チャットを開く</span>
                  </Link>
                ) : (
                  <span className="text-sm text-gray-700">{detailSubmission.friendName || '不明'}</span>
                )}
              </div>

              <div>
                <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-1">送信日時</div>
                <div className="text-sm text-gray-700">{formatDateTime(detailSubmission.createdAt)}</div>
              </div>

              <div>
                <div className="text-[11px] text-gray-400 uppercase tracking-wide mb-2">回答内容</div>
                <dl className="space-y-3">
                  {fieldKeys.length === 0 ? (
                    <div className="text-sm text-gray-400">項目なし</div>
                  ) : (
                    fieldKeys.map((key) => (
                      <div key={key} className="grid grid-cols-1 gap-1">
                        <dt className="text-[11px] text-gray-500">{fieldLabels[key] || key}</dt>
                        <dd className="text-sm text-gray-900 break-words whitespace-pre-wrap">
                          {formatValue(detailSubmission.data[key])}
                        </dd>
                      </div>
                    ))
                  )}
                </dl>
              </div>
            </div>
          </aside>
        </div>
      )}
    </div>
  )
}
