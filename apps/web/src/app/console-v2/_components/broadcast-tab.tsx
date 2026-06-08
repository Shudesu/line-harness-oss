import Link from 'next/link'
import { useState } from 'react'
import FlexPreviewComponent from '@/components/flex-preview'
import { api } from '@/lib/api'
import type { ApiBroadcast, BroadcastDraft, ConsoleTag, ConsoleTemplate } from '../types'
import { normalizeTemplatePreview } from '../utils'
import { MiniList, MiniListItem } from './shared'

export function BroadcastTab({
  templates,
  tags,
  broadcasts,
  draft,
  setDraft,
  creating,
  onCreateDraft,
  onTemplateCreated,
}: {
  templates: ConsoleTemplate[]
  tags: ConsoleTag[]
  broadcasts: ApiBroadcast[]
  draft: BroadcastDraft
  setDraft: (draft: BroadcastDraft) => void
  creating: boolean
  onCreateDraft: () => void
  onTemplateCreated: (template: ConsoleTemplate) => void
}) {
  const [templateModalOpen, setTemplateModalOpen] = useState(false)
  const selectedTemplate = templates.find((template) => template.id === draft.templateId)
  const selectedTag = tags.find((tag) => tag.id === draft.targetTagId)

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-gray-950">配信を作る</p>
            <p className="mt-1 text-sm text-gray-500">テンプレート作成、対象選択、プレビュー、下書き作成までこのタブで行います。</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setTemplateModalOpen(true)} className="rounded-lg bg-gray-950 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800">
              テンプレ作成
            </button>
            <Link href="/broadcasts" className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50">
              配信管理
            </Link>
          </div>
        </div>

        <div className="mt-6 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
          <p className="text-sm font-bold text-emerald-950">配信下書き</p>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-emerald-900">タイトル</span>
              <input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} className="w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm" placeholder="例: 6月キャンペーン配信" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-emerald-900">テンプレート</span>
              <select value={draft.templateId} onChange={(event) => setDraft({ ...draft, templateId: event.target.value })} className="w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm">
                <option value="">選択してください</option>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-emerald-900">対象</span>
              <select value={draft.targetType} onChange={(event) => setDraft({ ...draft, targetType: event.target.value as 'all' | 'tag', targetTagId: '' })} className="w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm">
                <option value="all">全員</option>
                <option value="tag">タグ指定</option>
              </select>
            </label>
            {draft.targetType === 'tag' && (
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-emerald-900">対象タグ</span>
                <select value={draft.targetTagId} onChange={(event) => setDraft({ ...draft, targetTagId: event.target.value })} className="w-full rounded-lg border border-emerald-100 bg-white px-3 py-2 text-sm">
                  <option value="">選択してください</option>
                  {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
                </select>
              </label>
            )}
          </div>

          <div className="mt-4 rounded-xl bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400">プレビュー</p>
            {selectedTemplate ? (
              <div className="mt-2 grid gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
                <div>
                  <p className="text-sm font-bold text-gray-950">{selectedTemplate.name}</p>
                  <p className="mt-1 text-xs text-gray-500">{selectedTemplate.messageType} / 対象: {draft.targetType === 'all' ? '全員' : selectedTag?.name || 'タグ未選択'}</p>
                  <p className="mt-3 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-700">{normalizeTemplatePreview(selectedTemplate)}</p>
                </div>
                <MessagePreview template={selectedTemplate} />
              </div>
            ) : (
              <p className="mt-2 text-sm text-gray-500">テンプレートを選択すると内容を確認できます。</p>
            )}
          </div>
          <button onClick={onCreateDraft} disabled={creating || !draft.templateId || (draft.targetType === 'tag' && !draft.targetTagId)} className="mt-4 w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-50">
            {creating ? '作成中...' : '下書きを作成'}
          </button>
        </div>
      </section>

      <aside className="space-y-4">
        <MiniList title="最近の配信" href="/broadcasts" empty="配信履歴なし">
          {broadcasts.slice(0, 5).map((broadcast) => (
            <MiniListItem key={broadcast.id} title={broadcast.title} sub={`${broadcast.status} / ${broadcast.targetType}`} />
          ))}
        </MiniList>
        <MiniList title="テンプレート" href="/templates" empty="テンプレートなし">
          {templates.slice(0, 5).map((template) => (
            <MiniListItem key={template.id} title={template.name} sub={`${template.category} / ${template.messageType}`} />
          ))}
        </MiniList>
      </aside>

      {templateModalOpen && (
        <TemplateCreateModal
          onClose={() => setTemplateModalOpen(false)}
          onCreated={(template) => {
            onTemplateCreated(template)
            setDraft({ ...draft, templateId: template.id })
            setTemplateModalOpen(false)
          }}
        />
      )}
    </div>
  )
}

function MessagePreview({ template }: { template: ConsoleTemplate }) {
  if (template.messageType === 'flex' && template.messageContent.trim().startsWith('{')) {
    return <FlexPreviewComponent content={template.messageContent} maxWidth={260} />
  }
  if (template.messageType === 'image') {
    return <img src={template.messageContent.trim()} alt="テンプレート画像" className="max-h-64 rounded-xl object-contain" />
  }
  return <div className="rounded-2xl bg-[#8FE1B8] p-4 text-sm font-semibold leading-6 text-gray-900">{template.messageContent || '本文なし'}</div>
}

function TemplateCreateModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: (template: ConsoleTemplate) => void
}) {
  const [form, setForm] = useState({ name: '', category: 'broadcast', messageType: 'text', messageContent: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const isFlex = form.messageType === 'flex'
  const isImage = form.messageType === 'image'

  async function save() {
    if (!form.name.trim() || !form.messageContent.trim()) {
      setError('テンプレート名と内容を入力してください。')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await api.templates.create({
        name: form.name.trim(),
        category: form.category.trim() || 'broadcast',
        messageType: form.messageType,
        messageContent: form.messageContent,
      })
      if (!res.success) throw new Error(res.error || 'テンプレートを作成できませんでした。')
      onCreated(res.data as unknown as ConsoleTemplate)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'テンプレートを作成できませんでした。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end bg-black/45 p-0 sm:items-center sm:p-4">
      <section className="max-h-[92vh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-2xl sm:mx-auto sm:max-w-4xl sm:rounded-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-black text-gray-950">テンプレート作成</p>
            <p className="mt-1 text-sm text-gray-500">作成後、そのまま配信下書きに使えます。</p>
          </div>
          <button onClick={onClose} className="rounded-full bg-gray-100 px-3 py-1.5 text-sm font-bold text-gray-700">閉じる</button>
        </div>
        {error && <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">{error}</div>}
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-3">
            <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" placeholder="テンプレート名" />
            <div className="grid gap-3 sm:grid-cols-2">
              <input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm" placeholder="カテゴリ" />
              <select value={form.messageType} onChange={(event) => setForm({ ...form, messageType: event.target.value, messageContent: '' })} className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm">
                <option value="text">テキスト</option>
                <option value="flex">Flex</option>
                <option value="image">画像URL</option>
              </select>
            </div>
            <textarea
              value={form.messageContent}
              onChange={(event) => setForm({ ...form, messageContent: event.target.value })}
              rows={isFlex ? 14 : 7}
              className="w-full resize-none rounded-xl border border-gray-200 px-3 py-2 font-mono text-sm"
              placeholder={isFlex ? 'Flex JSONを貼り付け' : isImage ? '画像URLを入力' : '配信本文を入力'}
            />
            <div className="flex justify-end gap-2">
              <button onClick={onClose} className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-bold text-gray-700">キャンセル</button>
              <button onClick={() => void save()} disabled={saving} className="rounded-xl bg-emerald-500 px-5 py-2 text-sm font-bold text-white disabled:opacity-50">
                {saving ? '保存中' : '作成'}
              </button>
            </div>
          </div>
          <div className="rounded-2xl bg-gray-50 p-4">
            <p className="mb-3 text-xs font-bold text-gray-400">プレビュー</p>
            <MessagePreview template={form as ConsoleTemplate} />
          </div>
        </div>
      </section>
    </div>
  )
}
