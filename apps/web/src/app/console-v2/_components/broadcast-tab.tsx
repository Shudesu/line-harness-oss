import Link from 'next/link'
import type { ApiBroadcast, BroadcastDraft, ConsoleTag, ConsoleTemplate } from '../types'
import { normalizeTemplatePreview } from '../utils'
import { MiniList, MiniListItem, StepCard } from './shared'

export function BroadcastTab({
  templates,
  tags,
  broadcasts,
  draft,
  setDraft,
  creating,
  onCreateDraft,
}: {
  templates: ConsoleTemplate[]
  tags: ConsoleTag[]
  broadcasts: ApiBroadcast[]
  draft: BroadcastDraft
  setDraft: (draft: BroadcastDraft) => void
  creating: boolean
  onCreateDraft: () => void
}) {
  const selectedTemplate = templates.find((template) => template.id === draft.templateId)
  const selectedTag = tags.find((tag) => tag.id === draft.targetTagId)

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-gray-950">配信を作る</p>
            <p className="mt-1 text-sm text-gray-500">テンプレートを選び、全員またはタグ指定で下書きを作ります。</p>
          </div>
          <Link href="/broadcasts" className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600">
            配信管理
          </Link>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <StepCard index="1" title="テンプレ作成" body="文章やカードを先にテンプレートとして作ります。" href="/templates" />
          <StepCard index="2" title="対象を絞る" body="全員配信か、タグで絞った配信を選びます。" href="/tags-events" />
          <StepCard index="3" title="確認して送信" body="下書きを作成し、配信管理画面で送信します。" href="/broadcasts" />
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
              <div className="mt-2">
                <p className="text-sm font-bold text-gray-950">{selectedTemplate.name}</p>
                <p className="mt-1 text-xs text-gray-500">{selectedTemplate.messageType} / 対象: {draft.targetType === 'all' ? '全員' : selectedTag?.name || 'タグ未選択'}</p>
                <pre className="mt-3 max-h-44 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-3 text-xs text-gray-700">{normalizeTemplatePreview(selectedTemplate)}</pre>
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
    </div>
  )
}
