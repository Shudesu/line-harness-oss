import Link from 'next/link'
import { useMemo, useState } from 'react'
import { fetchApi } from '@/lib/api'
import type { ConsoleForm, ConsoleTag, FormDraft } from '../types'
import { formatDateTime } from '../utils'

type ManagedField = {
  name: string
  label: string
  type: string
  required?: boolean
  options?: string[]
  imageUrl?: string
}

type FormWithFields = ConsoleForm & {
  description?: string | null
  fields?: ManagedField[] | string
  isActive?: boolean
}

type FormSubmission = {
  id: string
  formId: string
  friendId: string | null
  friendName?: string | null
  data: Record<string, unknown> | string
  createdAt: string
}

export function FormsTab({
  forms,
  onOpenFriendChat,
}: {
  forms: ConsoleForm[]
  tags: ConsoleTag[]
  draft: FormDraft
  setDraft: (draft: FormDraft) => void
  creating: boolean
  onCreateForm: () => void
  onOpenFriendChat: (friendId: string) => void
}) {
  const [selectedForm, setSelectedForm] = useState<FormWithFields | null>(null)
  const [submissions, setSubmissions] = useState<FormSubmission[]>([])
  const [loadingSubmissions, setLoadingSubmissions] = useState(false)
  const [error, setError] = useState('')

  const normalizedForms = forms as FormWithFields[]
  const totalSubmissions = normalizedForms.reduce((sum, form) => sum + (form.submitCount || 0), 0)

  async function openSubmissions(form: FormWithFields) {
    setSelectedForm(form)
    setLoadingSubmissions(true)
    setError('')
    try {
      const res = await fetchApi<{ success: boolean; data: FormSubmission[]; error?: string }>(`/api/forms/${encodeURIComponent(form.id)}/submissions`)
      if (!res.success) throw new Error(res.error || '回答を取得できませんでした。')
      setSubmissions(res.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : '回答を取得できませんでした。')
    } finally {
      setLoadingSubmissions(false)
    }
  }

  return (
    <section className="space-y-4">
      <div className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-emerald-600">Forms</p>
            <h2 className="text-xl font-black text-gray-950">フォーム</h2>
            <p className="mt-1 text-sm text-gray-500">プレビューを見て、編集・回答確認・顧客チャットへ進みます。</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-2xl bg-emerald-50 px-4 py-2 text-right">
              <p className="text-xs font-bold text-emerald-700">回答</p>
              <p className="text-xl font-black text-emerald-950">{totalSubmissions}件</p>
            </div>
            <Link href="/form-submissions" className="rounded-xl bg-gray-950 px-4 py-2 text-sm font-bold text-white">
              新規・詳細設定
            </Link>
          </div>
        </div>
      </div>

      {error && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}</div>}

      {normalizedForms.length === 0 ? (
        <div className="rounded-3xl border border-gray-200 bg-white p-8 text-center text-sm text-gray-500 shadow-sm">
          フォームはまだありません。新規・詳細設定から作成してください。
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {normalizedForms.map((form) => (
            <FormCard key={form.id} form={form} onOpenSubmissions={() => void openSubmissions(form)} />
          ))}
        </div>
      )}

      {selectedForm && (
        <SubmissionsModal
          form={selectedForm}
          submissions={submissions}
          loading={loadingSubmissions}
          onClose={() => setSelectedForm(null)}
          onOpenFriendChat={onOpenFriendChat}
        />
      )}
    </section>
  )
}

function FormCard({ form, onOpenSubmissions }: { form: FormWithFields; onOpenSubmissions: () => void }) {
  const fields = useMemo(() => normalizeFields(form.fields), [form.fields])
  return (
    <article className="rounded-3xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-black text-gray-950">{form.name}</p>
          <p className="mt-1 text-xs text-gray-500">{form.description || '説明なし'}</p>
          <p className="mt-2 text-xs font-bold text-gray-400">{form.submitCount || 0}件 / {form.isActive === false ? '停止中' : '受付中'}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Link href={`/form-submissions`} className="rounded-xl border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 hover:bg-gray-50">
            編集
          </Link>
          <button onClick={onOpenSubmissions} className="rounded-xl bg-emerald-500 px-3 py-2 text-xs font-bold text-white">
            回答
          </button>
        </div>
      </div>
      <div className="mt-4 rounded-2xl border border-gray-100 bg-gray-50 p-4">
        <p className="mb-3 text-xs font-bold text-gray-400">プレビュー</p>
        <div className="space-y-3">
          {fields.length === 0 ? (
            <p className="text-sm text-gray-400">項目がありません。</p>
          ) : fields.slice(0, 5).map((field) => <PreviewField key={field.name || field.label} field={field} />)}
          {fields.length > 5 && <p className="text-xs font-bold text-gray-400">他 {fields.length - 5} 項目</p>}
        </div>
      </div>
    </article>
  )
}

function PreviewField({ field }: { field: ManagedField }) {
  if (field.type === 'image') {
    return field.imageUrl ? <img src={field.imageUrl} alt={field.label} className="max-h-40 rounded-xl object-cover" /> : null
  }
  return (
    <div>
      <p className="mb-1 text-xs font-bold text-gray-600">{field.label || field.name}{field.required && <span className="ml-1 text-red-500">*</span>}</p>
      <div className="rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-400">
        {field.type === 'select' || field.type === 'radio' || field.type === 'checkbox'
          ? (field.options?.[0] || '選択してください')
          : '入力欄'}
      </div>
    </div>
  )
}

function SubmissionsModal({
  form,
  submissions,
  loading,
  onClose,
  onOpenFriendChat,
}: {
  form: FormWithFields
  submissions: FormSubmission[]
  loading: boolean
  onClose: () => void
  onOpenFriendChat: (friendId: string) => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-0 sm:items-center sm:p-4">
      <section className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:mx-auto sm:max-w-4xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-black text-gray-950">{form.name} の回答</p>
            <p className="mt-1 text-sm text-gray-500">回答者をタップするとチャットを開始できます。</p>
          </div>
          <button onClick={onClose} className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-bold text-gray-700">閉じる</button>
        </div>
        <div className="mt-4 space-y-3">
          {loading ? (
            <p className="rounded-2xl bg-gray-50 p-5 text-center text-sm text-gray-400">読み込み中...</p>
          ) : submissions.length === 0 ? (
            <p className="rounded-2xl bg-gray-50 p-5 text-center text-sm text-gray-400">回答はありません。</p>
          ) : submissions.map((submission) => (
            <button
              key={submission.id}
              type="button"
              onClick={() => submission.friendId && onOpenFriendChat(submission.friendId)}
              disabled={!submission.friendId}
              className="w-full rounded-2xl border border-gray-100 bg-gray-50 p-4 text-left hover:bg-emerald-50 disabled:hover:bg-gray-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black text-gray-950">{submission.friendName || '名前未取得'}</p>
                  <p className="mt-1 text-xs text-gray-400">{formatDateTime(submission.createdAt)}</p>
                </div>
                <span className="rounded-full bg-white px-2 py-1 text-xs font-bold text-gray-500">{submission.friendId ? 'チャット' : '未連携'}</span>
              </div>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {Object.entries(normalizeSubmissionData(submission.data)).slice(0, 6).map(([key, value]) => (
                  <div key={key} className="rounded-xl bg-white px-3 py-2">
                    <p className="text-[11px] font-bold text-gray-400">{key}</p>
                    <p className="mt-1 whitespace-pre-wrap text-sm font-semibold text-gray-800">{formatValue(value)}</p>
                  </div>
                ))}
              </div>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

function normalizeFields(value: FormWithFields['fields']): ManagedField[] {
  if (Array.isArray(value)) return value
  if (typeof value !== 'string') return []
  try {
    const parsed = JSON.parse(value) as unknown
    return Array.isArray(parsed) ? parsed as ManagedField[] : []
  } catch {
    return []
  }
}

function normalizeSubmissionData(value: FormSubmission['data']): Record<string, unknown> {
  if (typeof value !== 'string') return value || {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ')
  if (value === null || value === undefined || value === '') return '-'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}
