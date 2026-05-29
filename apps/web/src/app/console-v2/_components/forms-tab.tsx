import Link from 'next/link'
import type { ConsoleForm, ConsoleTag, FormDraft } from '../types'
import { buildFormPresetFields } from '../utils'
import { MiniList, MiniListItem, StepCard } from './shared'

export function FormsTab({
  forms,
  tags,
  draft,
  setDraft,
  creating,
  onCreateForm,
}: {
  forms: ConsoleForm[]
  tags: ConsoleTag[]
  draft: FormDraft
  setDraft: (draft: FormDraft) => void
  creating: boolean
  onCreateForm: () => void
}) {
  const fields = buildFormPresetFields(draft.preset)

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
      <section className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-gray-950">フォームで受付を作る</p>
            <p className="mt-1 text-sm text-gray-500">問診、体験申込、応募、アンケートを作り、回答を集計します。</p>
          </div>
          <Link href="/form-submissions" className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-600">
            回答を見る
          </Link>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <StepCard index="1" title="入力項目" body="名前、電話、メール、希望内容、問診などを集める。" />
          <StepCard index="2" title="送信後処理" body="送信後メッセージやタグ付けで次の対応へつなげる。" />
          <StepCard index="3" title="集計" body="回答一覧を確認し、必要ならCSV出力する。" href="/form-submissions" />
        </div>

        <div className="mt-6 rounded-2xl border border-blue-100 bg-blue-50 p-4">
          <p className="text-sm font-bold text-blue-950">簡易フォームを作成</p>
          <p className="mt-1 text-xs text-blue-800">問い合わせ・体験申込・問診に使う最小フォームを作ります。細かい編集は既存フォーム管理で行います。</p>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-blue-900">フォーム名</span>
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} className="w-full rounded-lg border border-blue-100 bg-white px-3 py-2 text-sm" placeholder="例: 初回体験申込フォーム" />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-blue-900">用途</span>
              <select value={draft.preset} onChange={(event) => setDraft({ ...draft, preset: event.target.value as FormDraft['preset'] })} className="w-full rounded-lg border border-blue-100 bg-white px-3 py-2 text-sm">
                <option value="inquiry">問い合わせ</option>
                <option value="trial">体験申込</option>
                <option value="questionnaire">問診・アンケート</option>
              </select>
            </label>
            <label className="block lg:col-span-2">
              <span className="mb-1 block text-xs font-bold text-blue-900">説明文</span>
              <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} rows={2} className="w-full resize-none rounded-lg border border-blue-100 bg-white px-3 py-2 text-sm" placeholder="フォームの説明を入力" />
            </label>
            <label className="block lg:col-span-2">
              <span className="mb-1 block text-xs font-bold text-blue-900">回答後につけるタグ</span>
              <select value={draft.onSubmitTagId} onChange={(event) => setDraft({ ...draft, onSubmitTagId: event.target.value })} className="w-full rounded-lg border border-blue-100 bg-white px-3 py-2 text-sm">
                <option value="">タグをつけない</option>
                {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
            </label>
          </div>

          <div className="mt-4 rounded-xl bg-white p-4">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400">作成される項目</p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {fields.map((field) => (
                <div key={field.name} className="rounded-lg bg-gray-50 px-3 py-2">
                  <p className="text-sm font-semibold text-gray-900">{field.label}{field.required && <span className="ml-1 text-red-500">*</span>}</p>
                  <p className="mt-0.5 text-xs text-gray-400">{field.type}</p>
                </div>
              ))}
            </div>
          </div>

          <button onClick={onCreateForm} disabled={creating || !draft.name.trim()} className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50">
            {creating ? '作成中...' : 'フォームを作成'}
          </button>
        </div>
      </section>

      <MiniList title="フォーム一覧" href="/form-submissions" empty="フォームなし">
        {forms.slice(0, 8).map((form) => <MiniListItem key={form.id} title={form.name} sub={`${form.submitCount ?? 0}件の回答`} />)}
      </MiniList>
    </div>
  )
}
