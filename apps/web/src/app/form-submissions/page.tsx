'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Header from '@/components/layout/header'
import { fetchApi } from '@/lib/api'
import {
  buildDirectFormUrl,
  buildFormUrl,
  normalizeFormFields,
  parseFormOptions,
  slugFieldName,
  type ManagedFormField,
} from '@/lib/form-manager-utils'

type FormFieldType = 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date' | 'image'

type FormField = ManagedFormField & { type: FormFieldType }

type ManagedForm = {
  id: string
  name: string
  description: string | null
  fields: FormField[] | string
  onSubmitTagId?: string | null
  onSubmitScenarioId?: string | null
  onSubmitMessageType?: 'text' | 'flex' | null
  onSubmitMessageContent?: string | null
  onSubmitWebhookUrl?: string | null
  onSubmitWebhookHeaders?: string | null
  onSubmitWebhookFailMessage?: string | null
  saveToMetadata?: boolean
  isActive: boolean
  submitCount?: number
  createdAt?: string
  updatedAt?: string
}

type Submission = {
  id: string
  formId: string
  friendId: string | null
  friendName?: string
  data: Record<string, unknown> | string
  createdAt: string
}

type ImageUploadResult = {
  success: boolean
  data: { id: string; key: string; url: string; mimeType: string; size: number }
}

const PAGE_SIZE = 20
const STORAGE_LIFF_URL = 'line_harness_form_liff_url'
const STORAGE_WORKER_URL = 'line_harness_form_worker_url'

const emptyField = (index: number): FormField => ({
  name: `field_${index}`,
  label: `項目${index}`,
  type: 'text',
  required: false,
  options: [],
})

function fieldOptionsText(field: FormField) {
  return (field.options || []).join('\n')
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('File read failed'))
    reader.readAsDataURL(file)
  })
}

function formatDateTime(iso: string | null | undefined) {
  if (!iso) return '-'
  return new Date(iso).toLocaleString('ja-JP', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function PreviewField({ field }: { field: FormField }) {
  const label = field.label.trim() || '未設定項目'
  const required = field.required && field.type !== 'image'
  const options = field.options?.length ? field.options : ['選択肢1', '選択肢2']

  if (field.type === 'image') {
    return (
      <div className="overflow-hidden rounded-xl border border-gray-100 bg-gray-50">
        {field.imageUrl ? (
          <img src={field.imageUrl} alt={field.imageAlt || label} className="max-h-64 w-full object-cover" />
        ) : (
          <div className="flex h-28 items-center justify-center text-xs text-gray-400">画像未設定</div>
        )}
        {label && <p className="bg-white px-3 py-2 text-xs text-gray-500">{label}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-bold text-gray-700">
        {label}{required && <span className="ml-1 text-red-500">*</span>}
      </p>
      {field.type === 'textarea' ? (
        <div className="h-20 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-400">{field.placeholder || '入力してください'}</div>
      ) : field.type === 'select' ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-400">{options[0] || '選択してください'}</div>
      ) : field.type === 'radio' || field.type === 'checkbox' ? (
        <div className={field.columns === 2 ? 'grid grid-cols-2 gap-2' : 'space-y-2'}>
          {options.map((option) => (
            <div key={option} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
              <span className={`h-4 w-4 border border-gray-300 bg-white ${field.type === 'radio' ? 'rounded-full' : 'rounded'}`} />
              <span>{option}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-400">{field.placeholder || '入力してください'}</div>
      )}
    </div>
  )
}

function FormPreview({
  name,
  description,
  fields,
}: {
  name: string
  description: string
  fields: FormField[]
}) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-sm font-bold text-gray-950">プレビュー</p>
        <span className="rounded-full bg-gray-100 px-2 py-1 text-[11px] font-semibold text-gray-500">LIFF想定</span>
      </div>
      <div className="mx-auto max-w-[360px] overflow-hidden rounded-[24px] border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 bg-emerald-50 px-4 py-5 text-center">
          <h3 className="text-base font-bold text-gray-950">{name.trim() || 'フォーム名未設定'}</h3>
          {description.trim() && <p className="mt-2 whitespace-pre-line text-xs leading-5 text-gray-500">{description.trim()}</p>}
        </div>
        <div className="space-y-4 p-4">
          {fields.length === 0 ? (
            <p className="text-center text-sm text-gray-400">項目がありません</p>
          ) : (
            fields.map((field, index) => <PreviewField key={`${field.name}-${index}`} field={field} />)
          )}
          <button type="button" className="w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-white">
            送信する
          </button>
        </div>
      </div>
      <p className="mt-3 text-xs leading-5 text-gray-500">
        実際のLIFF画面ではLINEログイン・友だち情報取得後に表示されます。画像はR2の公開URLを使用します。
      </p>
    </div>
  )
}

export default function FormSubmissionsPage() {
  const [activeTab, setActiveTab] = useState<'builder' | 'submissions'>('builder')
  const [forms, setForms] = useState<ManagedForm[]>([])
  const [selectedFormId, setSelectedFormId] = useState<string | null>(null)
  const [editingFormId, setEditingFormId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState<FormField[]>([emptyField(1)])
  const [saveToMetadata, setSaveToMetadata] = useState(true)
  const [isActive, setIsActive] = useState(true)
  const [liffBaseUrl, setLiffBaseUrl] = useState('')
  const [workerBaseUrl, setWorkerBaseUrl] = useState('')
  const [submissions, setSubmissions] = useState<Submission[]>([])
  const [fieldLabels, setFieldLabels] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [subLoading, setSubLoading] = useState(false)
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null)
  const [page, setPage] = useState(1)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  const selectedForm = forms.find((form) => form.id === selectedFormId) || null
  const editingQueryUrl = editingFormId ? buildFormUrl(liffBaseUrl, editingFormId) : ''
  const editingDirectUrl = editingFormId ? buildDirectFormUrl(workerBaseUrl, editingFormId) : ''

  const loadForms = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await fetchApi<{ success: boolean; data: ManagedForm[] }>('/api/forms')
      if (res.success) {
        setForms(res.data)
        setSelectedFormId((current) => current || res.data[0]?.id || null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'フォーム一覧の取得に失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadForms()
    try {
      setLiffBaseUrl(localStorage.getItem(STORAGE_LIFF_URL) || '')
      setWorkerBaseUrl(localStorage.getItem(STORAGE_WORKER_URL) || '')
    } catch {
      // ignore
    }
  }, [loadForms])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_LIFF_URL, liffBaseUrl)
    } catch {
      // ignore
    }
  }, [liffBaseUrl])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_WORKER_URL, workerBaseUrl)
    } catch {
      // ignore
    }
  }, [workerBaseUrl])

  const resetBuilder = () => {
    setEditingFormId(null)
    setName('')
    setDescription('')
    setFields([emptyField(1)])
    setSaveToMetadata(true)
    setIsActive(true)
    setNotice('')
    setError('')
  }

  const loadFormForEdit = async (formId: string) => {
    setError('')
    try {
      const res = await fetchApi<{ success: boolean; data: ManagedForm }>(`/api/forms/${formId}`)
      if (!res.success) return
      const form = res.data
      setEditingFormId(form.id)
      setName(form.name)
      setDescription(form.description || '')
      const loadedFields = normalizeFormFields(form.fields) as FormField[]
      setFields(loadedFields.length ? loadedFields : [emptyField(1)])
      setSaveToMetadata(form.saveToMetadata !== false)
      setIsActive(Boolean(form.isActive))
      setActiveTab('builder')
      setNotice('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'フォーム詳細の取得に失敗しました')
    }
  }

  const loadSubmissions = useCallback(async (formId: string) => {
    setSubLoading(true)
    setPage(1)
    setError('')
    try {
      const [formRes, subRes] = await Promise.all([
        fetchApi<{ success: boolean; data: ManagedForm }>(`/api/forms/${formId}`),
        fetchApi<{ success: boolean; data: Submission[] }>(`/api/forms/${formId}/submissions`),
      ])
      if (formRes.success) {
        const labels: Record<string, string> = {}
        for (const field of normalizeFormFields(formRes.data.fields)) {
          if (field.type !== 'image') labels[field.name] = field.label
        }
        setFieldLabels(labels)
      }
      if (subRes.success) {
        setSubmissions(subRes.data.map((submission) => ({
          ...submission,
          data: typeof submission.data === 'string' ? JSON.parse(submission.data || '{}') : submission.data,
          friendName: submission.friendName || '不明',
        })))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '回答一覧の取得に失敗しました')
    } finally {
      setSubLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'submissions' && selectedFormId) {
      void loadSubmissions(selectedFormId)
    }
  }, [activeTab, selectedFormId, loadSubmissions])

  const updateField = (index: number, patch: Partial<FormField>) => {
    setFields((current) => current.map((field, i) => (i === index ? { ...field, ...patch } : field)))
  }

  const addField = (type: FormFieldType = 'text') => {
    setFields((current) => [
      ...current,
      {
        ...emptyField(current.length + 1),
        type,
        label: type === 'image' ? '画像' : `項目${current.length + 1}`,
        name: type === 'image' ? `image_${current.length + 1}` : `field_${current.length + 1}`,
      },
    ])
  }

  const removeField = (index: number) => {
    setFields((current) => current.length <= 1 ? current : current.filter((_, i) => i !== index))
  }

  const handleUploadImage = async (index: number, file: File | undefined) => {
    if (!file) return
    if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
      setError('画像は PNG / JPEG / GIF / WebP を選択してください')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('画像は5MB以下にしてください')
      return
    }
    setUploadingIndex(index)
    setError('')
    try {
      const dataUrl = await fileToDataUrl(file)
      const res = await fetchApi<ImageUploadResult>('/api/images', {
        method: 'POST',
        body: JSON.stringify({ data: dataUrl, mimeType: file.type, filename: file.name }),
      })
      if (res.success) {
        updateField(index, {
          type: 'image',
          imageUrl: res.data.url,
          imageAlt: fields[index]?.label || file.name,
          label: fields[index]?.label || '画像',
        })
        setNotice('画像をR2に保存しました。フォーム内で表示されます。')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '画像アップロードに失敗しました')
    } finally {
      setUploadingIndex(null)
    }
  }

  const buildPayloadFields = () => fields.map((field, index) => {
    const fallback = field.type === 'image' ? `image_${index + 1}` : `field_${index + 1}`
    const normalized: FormField = {
      ...field,
      name: slugFieldName(field.name || field.label, fallback),
      label: field.label.trim() || (field.type === 'image' ? '画像' : `項目${index + 1}`),
      required: field.type === 'image' ? false : Boolean(field.required),
    }
    if (!['select', 'radio', 'checkbox'].includes(normalized.type)) {
      delete normalized.options
      delete normalized.columns
    }
    if (normalized.type !== 'image') {
      delete normalized.imageUrl
      delete normalized.imageAlt
    }
    return normalized
  })

  const saveForm = async () => {
    if (!name.trim()) {
      setError('フォーム名を入力してください')
      return
    }
    const payloadFields = buildPayloadFields()
    const invalid = payloadFields.find((field) => field.type !== 'image' && !field.name)
    if (invalid) {
      setError('入力項目の識別名を確認してください')
      return
    }
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const body = {
        name: name.trim(),
        description: description.trim() || null,
        fields: payloadFields,
        saveToMetadata,
        isActive,
      }
      const res = editingFormId
        ? await fetchApi<{ success: boolean; data: ManagedForm }>(`/api/forms/${editingFormId}`, {
            method: 'PUT',
            body: JSON.stringify(body),
          })
        : await fetchApi<{ success: boolean; data: ManagedForm }>('/api/forms', {
            method: 'POST',
            body: JSON.stringify(body),
          })
      if (res.success) {
        setNotice(editingFormId ? 'フォームを更新しました。' : 'フォームを作成しました。')
        setEditingFormId(res.data.id)
        setSelectedFormId(res.data.id)
        await loadForms()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'フォーム保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const deleteForm = async (formId: string) => {
    if (!window.confirm('このフォームを削除します。回答も削除される可能性があります。続行しますか？')) return
    setError('')
    try {
      await fetchApi<{ success: boolean; data: null }>(`/api/forms/${formId}`, { method: 'DELETE' })
      setNotice('フォームを削除しました。')
      if (editingFormId === formId) resetBuilder()
      setSelectedFormId(null)
      setSubmissions([])
      await loadForms()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'フォーム削除に失敗しました')
    }
  }

  const copyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setNotice('フォームURLをコピーしました。')
    } catch {
      setError('コピーに失敗しました。URLを手動でコピーしてください。')
    }
  }

  const fieldKeys = useMemo(() => {
    if (submissions.length === 0) return []
    return [...new Set(submissions.flatMap((submission) => Object.keys(submission.data as Record<string, unknown>)))]
  }, [submissions])
  const totalPages = Math.ceil(submissions.length / PAGE_SIZE)
  const paged = submissions.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="space-y-5 pb-12">
      <Header title="フォーム管理" description="フォーム作成、LIFF公開URL、回答集計を管理します。" />

      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setActiveTab('builder')}
          className={`rounded-lg px-4 py-2 text-sm font-bold ${activeTab === 'builder' ? 'bg-emerald-500 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
        >
          フォーム作成・管理
        </button>
        <button
          onClick={() => setActiveTab('submissions')}
          className={`rounded-lg px-4 py-2 text-sm font-bold ${activeTab === 'submissions' ? 'bg-emerald-500 text-white' : 'bg-white text-gray-600 border border-gray-200'}`}
        >
          回答集計
        </button>
      </div>

      {notice && <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>}
      {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

      {activeTab === 'builder' && (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-bold text-gray-950">{editingFormId ? 'フォームを編集' : '新しいフォームを作成'}</p>
                <p className="mt-1 text-sm text-gray-500">項目を組み立てると、LIFFで開けるフォームURLを発行できます。</p>
              </div>
              <button onClick={resetBuilder} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50">
                新規作成
              </button>
            </div>

            <div className="mt-5 grid gap-4 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-gray-600">フォーム名</span>
                <input value={name} onChange={(event) => setName(event.target.value)} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="例: 初回体験申込フォーム" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-gray-600">受付状態</span>
                <select value={isActive ? 'active' : 'inactive'} onChange={(event) => setIsActive(event.target.value === 'active')} className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm">
                  <option value="active">受付中</option>
                  <option value="inactive">停止中</option>
                </select>
              </label>
              <label className="block md:col-span-2">
                <span className="mb-1 block text-xs font-bold text-gray-600">説明文</span>
                <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm" placeholder="フォーム上部に表示する説明文" />
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-700">
                <input type="checkbox" checked={saveToMetadata} onChange={(event) => setSaveToMetadata(event.target.checked)} className="h-4 w-4 accent-emerald-500" />
                回答を顧客メタデータにも保存する
              </label>
            </div>

            <div className="mt-6">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-bold text-gray-950">入力項目</p>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => addField('text')} className="rounded-lg bg-gray-100 px-3 py-2 text-xs font-semibold text-gray-700">項目追加</button>
                  <button onClick={() => addField('image')} className="rounded-lg bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">画像追加</button>
                </div>
              </div>
              <div className="space-y-3">
                {fields.map((field, index) => (
                  <div key={`${field.name}-${index}`} className="rounded-xl border border-gray-200 bg-gray-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-bold text-gray-500">#{index + 1}</p>
                      <button onClick={() => removeField(index)} disabled={fields.length <= 1} className="text-xs font-semibold text-red-500 disabled:opacity-30">削除</button>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-3">
                      <label className="block">
                        <span className="mb-1 block text-xs font-bold text-gray-600">種類</span>
                        <select value={field.type} onChange={(event) => updateField(index, { type: event.target.value as FormFieldType })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm">
                          <option value="text">テキスト</option>
                          <option value="textarea">長文</option>
                          <option value="tel">電話番号</option>
                          <option value="email">メール</option>
                          <option value="number">数字</option>
                          <option value="date">日付</option>
                          <option value="select">選択</option>
                          <option value="radio">ラジオ</option>
                          <option value="checkbox">チェック</option>
                          <option value="image">画像</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-bold text-gray-600">表示名</span>
                        <input value={field.label} onChange={(event) => updateField(index, { label: event.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" />
                      </label>
                      <label className="block">
                        <span className="mb-1 block text-xs font-bold text-gray-600">識別名</span>
                        <input value={field.name} onChange={(event) => updateField(index, { name: event.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" placeholder="name" />
                      </label>
                    </div>

                    {field.type === 'image' ? (
                      <div className="mt-3 rounded-lg border border-dashed border-gray-300 bg-white p-3">
                        {field.imageUrl && (
                          <div className="mb-3 overflow-hidden rounded-lg border border-gray-200">
                            <img src={field.imageUrl} alt={field.imageAlt || field.label} className="max-h-64 w-full object-contain" />
                          </div>
                        )}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/gif,image/webp"
                          disabled={uploadingIndex === index}
                          onChange={(event) => void handleUploadImage(index, event.target.files?.[0])}
                          className="block w-full text-xs text-gray-500 file:mr-3 file:rounded-md file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:text-xs file:font-medium file:text-emerald-700"
                        />
                        {uploadingIndex === index && <p className="mt-2 text-xs text-gray-400">アップロード中...</p>}
                      </div>
                    ) : (
                      <div className="mt-3 grid gap-3 md:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-xs font-bold text-gray-600">プレースホルダー</span>
                          <input value={field.placeholder || ''} onChange={(event) => updateField(index, { placeholder: event.target.value })} className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" />
                        </label>
                        <label className="mt-6 flex items-center gap-2 text-sm text-gray-700">
                          <input type="checkbox" checked={Boolean(field.required)} onChange={(event) => updateField(index, { required: event.target.checked })} className="h-4 w-4 accent-emerald-500" />
                          必須項目にする
                        </label>
                      </div>
                    )}

                    {['select', 'radio', 'checkbox'].includes(field.type) && (
                      <label className="mt-3 block">
                        <span className="mb-1 block text-xs font-bold text-gray-600">選択肢（改行またはカンマ区切り）</span>
                        <textarea value={fieldOptionsText(field)} onChange={(event) => updateField(index, { options: parseFormOptions(event.target.value) })} rows={3} className="w-full resize-none rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm" />
                      </label>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-6 flex flex-wrap gap-2">
              <button onClick={() => void saveForm()} disabled={saving} className="rounded-xl bg-emerald-500 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-50">
                {saving ? '保存中...' : editingFormId ? 'フォームを更新' : 'フォームを作成'}
              </button>
              {editingFormId && (
                <button onClick={() => void deleteForm(editingFormId)} className="rounded-xl border border-red-200 px-5 py-3 text-sm font-bold text-red-600 hover:bg-red-50">
                  削除
                </button>
              )}
            </div>

            {editingFormId && (
              <div className="mt-6 rounded-xl border border-emerald-100 bg-emerald-50 p-4">
                <p className="text-sm font-bold text-emerald-950">公開フォームURL</p>
                <p className="mt-1 text-xs text-emerald-800">直URLと、LIFF Endpoint URLにクエリを付けるURLの両方を生成します。</p>

                <div className="mt-4 space-y-3">
                  <div>
                    <p className="mb-1 text-xs font-bold text-emerald-950">直URL</p>
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                      <input value={workerBaseUrl} onChange={(event) => setWorkerBaseUrl(event.target.value)} className="rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm" placeholder="例: https://reservation.example.com" />
                      <button onClick={() => void copyUrl(editingDirectUrl)} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-bold text-white">直URLコピー</button>
                    </div>
                    <div className="mt-2 break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-emerald-900">{editingDirectUrl}</div>
                  </div>

                  <div>
                    <p className="mb-1 text-xs font-bold text-emerald-950">クエリパターンURL</p>
                    <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                      <input value={liffBaseUrl} onChange={(event) => setLiffBaseUrl(event.target.value)} className="rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm" placeholder="例: https://liff.line.me/xxxx または https://worker.dev/?liffId=xxxx" />
                      <button onClick={() => void copyUrl(editingQueryUrl)} className="rounded-lg bg-white px-4 py-2 text-sm font-bold text-emerald-700 ring-1 ring-emerald-200">クエリURLコピー</button>
                    </div>
                    <div className="mt-2 break-all rounded-lg bg-white px-3 py-2 font-mono text-xs text-emerald-900">{editingQueryUrl}</div>
                  </div>
                </div>
              </div>
            )}
          </section>

          <aside className="space-y-3">
            <FormPreview name={name} description={description} fields={fields} />

            <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
              <p className="text-sm font-bold text-gray-950">フォーム一覧</p>
              <div className="mt-3 space-y-2">
                {loading ? (
                  <p className="text-sm text-gray-400">読み込み中...</p>
                ) : forms.length === 0 ? (
                  <p className="text-sm text-gray-400">フォームはまだありません。</p>
                ) : forms.map((form) => {
                  const directUrl = buildDirectFormUrl(workerBaseUrl, form.id)
                  const queryUrl = buildFormUrl(liffBaseUrl, form.id)
                  return (
                    <div key={form.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-gray-950">{form.name}</p>
                          <p className="mt-1 text-xs text-gray-500">{form.submitCount ?? 0}件 / {form.isActive ? '受付中' : '停止中'}</p>
                        </div>
                        <button onClick={() => void loadFormForEdit(form.id)} className="rounded-lg bg-white px-3 py-1.5 text-xs font-bold text-gray-700">編集</button>
                      </div>
                      <div className="mt-2 flex gap-2">
                        <button onClick={() => void copyUrl(directUrl)} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600">直URL</button>
                        <button onClick={() => void copyUrl(queryUrl)} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600">クエリURL</button>
                        <button onClick={() => { setSelectedFormId(form.id); setActiveTab('submissions') }} className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-semibold text-gray-600">回答</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </aside>
        </div>
      )}

      {activeTab === 'submissions' && (
        <section className="space-y-4">
          <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-sm font-bold text-gray-950">回答を見るフォーム</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {forms.map((form) => (
                <button
                  key={form.id}
                  onClick={() => setSelectedFormId(form.id)}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${selectedFormId === form.id ? 'bg-emerald-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  {form.name}
                </button>
              ))}
            </div>
          </div>

          {selectedForm && !subLoading && (
            <div className="text-sm text-gray-500">
              {selectedForm.name}: 全 <span className="font-bold text-gray-900">{submissions.length}</span> 件の回答
            </div>
          )}

          {!selectedFormId ? (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-400">フォームを選択してください</div>
          ) : subLoading ? (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-400">読み込み中...</div>
          ) : submissions.length === 0 ? (
            <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-gray-400">回答がありません</div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
                <table className="w-full min-w-[800px]">
                  <thead className="border-b border-gray-200 bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">名前</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">日時</th>
                      {fieldKeys.map((key) => (
                        <th key={key} className="px-4 py-3 text-left text-xs font-semibold uppercase text-gray-500">{fieldLabels[key] || key}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paged.map((submission) => (
                      <tr key={submission.id} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">{submission.friendName || '不明'}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">{formatDateTime(submission.createdAt)}</td>
                        {fieldKeys.map((key) => {
                          const value = (submission.data as Record<string, unknown>)[key]
                          return (
                            <td key={key} className="max-w-[240px] truncate px-4 py-3 text-sm text-gray-700">
                              {Array.isArray(value) ? value.join(', ') : value !== null && value !== undefined && value !== '' ? String(value) : '-'}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xs text-gray-400">{(page - 1) * PAGE_SIZE + 1}〜{Math.min(page * PAGE_SIZE, submissions.length)} 件 / 全{submissions.length}件</p>
                  <div className="flex gap-2">
                    <button onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page === 1} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm disabled:opacity-30">前へ</button>
                    <span className="px-3 py-1.5 text-sm text-gray-500">{page} / {totalPages}</span>
                    <button onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page === totalPages} className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm disabled:opacity-30">次へ</button>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  )
}
