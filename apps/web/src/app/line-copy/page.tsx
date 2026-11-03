'use client'

// KIDOUインターンの LINE で自動で送る文面。届く順に並べ、どれもここで直せる。
// アンケート・Q&A・再案内の文面はまとめて1回で保存し、あいさつ・回答後の文（定型文）は1つずつ保存する。
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/layout/header'
import { sendApi } from '@/lib/api'
import { cardToText, textToCard } from '@/lib/cream-card'

interface QaItem {
  id: string
  q: string
  a: string
}
interface QaSection {
  title: string
  items: QaItem[]
}
interface Copy {
  consent: { title: string; body: string; button: string }
  university: { kicker: string; title: string; button: string; typeOnly: string; retryPrompt: string }
  candidates: {
    title: string
    manyNote: string
    notFoundTitle: string
    notFoundNote: string
    retry: string
    notListed: string
    registerRaw: string
  }
  grade: { kicker: string; title: string }
  graduationYear: { kicker: string; title: string; years: string[] }
  done: { already: string }
  remind: { text: string }
  qa: { sections: QaSection[]; answerKicker: string; more: string }
}
interface Template {
  id: string
  name: string
  messageType: string
  messageContent: string
  updatedAt: string
}
type Group = 'greeting' | 'doneIntro'
interface CopyData {
  copy: Copy
  defaults: Copy
  updatedAt: string | null
  templates: Record<Group, Template[]>
  context: {
    hasPicker: boolean
    termsUrl: string | null
    privacyPolicyUrl: string | null
    doneImageUrl: string
    grades: string[]
    reminderOn: boolean
  }
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500'

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v))

function formatDate(value: string | null) {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
}

function newQaId() {
  return 'q-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

// ── 部品 ────────────────────────────────────────────────

function Field({
  label,
  hint,
  value,
  onChange,
  rows,
  max,
}: {
  label: string
  hint?: string
  value: string
  onChange: (v: string) => void
  rows?: number
  max?: number
}) {
  const over = max !== undefined && value.length > max
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-gray-600">{label}</span>
        {max !== undefined && <span className={`text-[11px] ${over ? 'text-red-600' : 'text-gray-400'}`}>{value.length}/{max}字</span>}
      </span>
      {rows ? (
        <textarea rows={rows} value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} className={inputClass} />
      )}
      {hint && <span className="mt-1 block text-[11px] text-gray-400">{hint}</span>}
    </label>
  )
}

/** LINE に届くカードのだいたいの見た目 */
function CardPreview({
  kicker,
  title,
  note,
  buttons = [],
  subButtons = [],
  links = [],
  cols = 1,
}: {
  kicker?: string
  title: string
  note?: string
  buttons?: string[]
  subButtons?: string[]
  links?: string[]
  cols?: number
}) {
  return (
    <div className="w-full max-w-[300px] rounded-2xl p-4" style={{ background: '#f6f1e7' }}>
      {kicker && <p className="text-[11px]" style={{ color: '#8a7f6a' }}>{kicker}</p>}
      <p className="text-[15px] font-bold whitespace-pre-wrap" style={{ color: '#3a3a3a' }}>{title}</p>
      {note && <p className="mt-1 text-[11px] whitespace-pre-wrap" style={{ color: '#8a7f6a' }}>{note}</p>}
      {buttons.length > 0 && (
        <div className="mt-3 grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {buttons.map((b, i) => (
            <div
              key={i}
              className={`rounded-lg border px-2 py-2 text-center text-[13px] ${cols === 1 && i === 0 && !subButtons.length && buttons.length === 1 ? 'font-bold text-white' : ''}`}
              style={
                cols === 1 && i === 0 && !subButtons.length && buttons.length === 1
                  ? { background: '#3a3a3a', borderColor: '#3a3a3a' }
                  : { background: '#fff', borderColor: '#e3dccd', color: '#3a3a3a' }
              }
            >
              {b}
            </div>
          ))}
        </div>
      )}
      {subButtons.length > 0 && (
        <div className="mt-2 space-y-2 border-t pt-2" style={{ borderColor: '#e3dccd' }}>
          {subButtons.map((b, i) => (
            <div key={i} className="rounded-lg border px-2 py-2 text-center text-[13px]" style={{ borderColor: '#e3dccd', color: '#8a7f6a' }}>
              {b}
            </div>
          ))}
        </div>
      )}
      {links.length > 0 && (
        <div className="mt-2 flex justify-center gap-5">
          {links.map((l) => (
            <span key={l} className="text-[13px] underline" style={{ color: '#1A73E8' }}>{l}</span>
          ))}
        </div>
      )}
    </div>
  )
}

function Bubble({ text }: { text: string }) {
  return (
    <div className="max-w-[300px] rounded-2xl bg-white px-3 py-2 text-[13px] whitespace-pre-wrap text-gray-800 shadow-sm ring-1 ring-gray-200">
      {text}
    </div>
  )
}

function Step({
  no,
  title,
  when,
  children,
  preview,
  onReset,
}: {
  no: string
  title: string
  when: string
  children: React.ReactNode
  preview?: React.ReactNode
  onReset?: () => void
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-green-700">{no}</p>
          <h2 className="text-base font-bold text-gray-900">{title}</h2>
          <p className="mt-0.5 text-xs text-gray-500">{when}</p>
        </div>
        {onReset && (
          <button type="button" onClick={onReset} className="shrink-0 text-xs text-gray-400 underline hover:text-gray-600">
            初めの文面に戻す
          </button>
        )}
      </div>
      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-3">{children}</div>
        {preview && (
          <div className="lg:w-[320px] shrink-0">
            <p className="mb-2 text-[11px] font-medium text-gray-400">LINE での見え方（だいたい）</p>
            <div className="space-y-2 rounded-xl p-3" style={{ background: '#8cabd9' }}>{preview}</div>
          </div>
        )}
      </div>
    </section>
  )
}

// ── あいさつ・回答後の文（定型文）────────────────────────────

function TemplateEditor({ template, onSaved, onDeleted }: { template: Template; onSaved: () => void; onDeleted: () => void }) {
  const asText = template.messageType === 'flex' ? cardToText(template.messageContent) : null
  // 編集のしかた：card＝カードを文で / text＝ふつうの吹き出し / raw＝カードの中身をそのまま
  const initialMode = template.messageType === 'text' ? 'text' : asText !== null ? 'card' : 'raw'
  const [mode, setMode] = useState<'card' | 'text' | 'raw'>(initialMode)
  const [value, setValue] = useState(initialMode === 'card' ? asText ?? '' : template.messageContent)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const original = initialMode === 'card' ? asText ?? '' : template.messageContent
  const dirty = value !== original || mode !== initialMode

  const save = async () => {
    setSaving(true)
    setMsg('')
    const body =
      mode === 'card'
        ? { messageType: 'flex', messageContent: textToCard(value) }
        : mode === 'text'
          ? { messageType: 'text', messageContent: value }
          : { messageType: 'flex', messageContent: value }
    const res = await sendApi<{ success: boolean; error?: string }>('/api/intern/line-copy/templates/' + template.id, {
      method: 'PUT',
      body: JSON.stringify(body),
    }).catch(() => ({ success: false, error: '保存できませんでした' }))
    setSaving(false)
    if (!res.success) {
      setMsg(res.error ?? '保存できませんでした')
      return
    }
    setMsg('保存しました')
    onSaved()
  }

  const remove = async () => {
    if (!window.confirm(`「${template.name}」を消しますか？\n消すと、この文は送られなくなります。`)) return
    const res = await sendApi<{ success: boolean; error?: string }>('/api/intern/line-copy/templates/' + template.id, { method: 'DELETE' }).catch(
      () => ({ success: false, error: '消せませんでした' }),
    )
    if (!res.success) setMsg(res.error ?? '消せませんでした')
    else onDeleted()
  }

  const empty = !value.trim()
  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-gray-800">
          {template.name}
          {empty && <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[11px] text-gray-500">空なので送られません</span>}
        </p>
        <div className="flex items-center gap-1 text-[11px]">
          {(['card', 'text'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                if (m === mode) return
                if (mode === 'raw' && !window.confirm('カードの中身を文の形に作り直します。色や並びが少し変わることがあります。よろしいですか？')) return
                setMode(m)
              }}
              className={`rounded-full px-2.5 py-1 ${mode === m ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600'}`}
            >
              {m === 'card' ? 'カードで送る' : '吹き出しで送る'}
            </button>
          ))}
        </div>
      </div>
      {mode === 'raw' ? (
        <>
          <p className="mb-1 text-[11px] text-amber-700">このカードは文の形に直せない作りのため、中身をそのまま表示しています。</p>
          <textarea rows={8} value={value} onChange={(e) => setValue(e.target.value)} className={`${inputClass} font-mono text-xs`} />
        </>
      ) : (
        <>
          <textarea rows={mode === 'card' ? 14 : 6} value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} />
          {mode === 'card' && (
            <p className="mt-1 text-[11px] text-gray-400">1行目は太字の見出し。空の行で間をあける。「---」だけの行は区切り線。行の頭に全角の空白「　」を入れると少し右に下がります。</p>
          )}
        </>
      )}
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40"
        >
          {saving ? '保存中…' : 'この文を保存'}
        </button>
        <button type="button" onClick={remove} className="text-xs text-red-600 underline">
          消す
        </button>
        {msg && <span className={`text-xs ${msg === '保存しました' ? 'text-green-700' : 'text-red-600'}`}>{msg}</span>}
      </div>
    </div>
  )
}

function TemplateGroup({ group, items, onChange }: { group: Group; items: Template[]; onChange: () => void }) {
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const active = items.filter((t) => t.messageContent.trim()).length
  const add = async () => {
    setAdding(true)
    setError('')
    const res = await sendApi<{ success: boolean; error?: string }>('/api/intern/line-copy/templates', {
      method: 'POST',
      body: JSON.stringify({ group, messageType: 'text', messageContent: '新しい文' }),
    }).catch(() => ({ success: false, error: '足せませんでした' }))
    setAdding(false)
    if (!res.success) setError(res.error ?? '足せませんでした')
    else onChange()
  }
  return (
    <div className="space-y-3">
      {items.length === 0 && <p className="text-sm text-gray-500">まだありません。</p>}
      {items.map((t) => (
        <TemplateEditor key={t.id + t.updatedAt} template={t} onSaved={onChange} onDeleted={onChange} />
      ))}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={add}
          disabled={adding || active >= 4}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
        >
          ＋ 文を足す
        </button>
        <span className="text-[11px] text-gray-400">名前の番号の順に送ります（中身のあるものは4つまで）。</span>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  )
}

function templatePreview(t: Template) {
  if (!t.messageContent.trim()) return null
  if (t.messageType === 'text') return <Bubble key={t.id} text={t.messageContent} />
  const asText = cardToText(t.messageContent)
  const [head, ...rest] = (asText ?? '（カード）').split('\n')
  return (
    <div key={t.id} className="max-w-[300px] rounded-2xl p-4 text-[12px] whitespace-pre-wrap" style={{ background: '#f6f1e7', color: '#3a3a3a' }}>
      <p className="text-[14px] font-bold">{head}</p>
      {rest.join('\n')}
    </div>
  )
}

// ── 画面 ────────────────────────────────────────────────

export default function LineCopyPage() {
  const [data, setData] = useState<CopyData | null>(null)
  const [copy, setCopy] = useState<Copy | null>(null)
  const [yearsText, setYearsText] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState('')

  const load = async (keepEdits = false) => {
    setError('')
    const res = await sendApi<{ success: boolean; data?: CopyData; error?: string }>('/api/intern/line-copy').catch(() => ({
      success: false as const,
      error: '読み込めませんでした。時間をおいてもう一度お試しください',
      data: undefined,
    }))
    setLoading(false)
    if (!res.success || !res.data) {
      setError(res.error ?? '読み込めませんでした')
      return
    }
    setData(res.data)
    if (!keepEdits) {
      setCopy(clone(res.data.copy))
      setYearsText(res.data.copy.graduationYear.years.join('、'))
    }
  }

  useEffect(() => {
    load()
  }, [])

  const dirty = useMemo(() => {
    if (!data || !copy) return false
    const withYears = { ...copy, graduationYear: { ...copy.graduationYear, years: parseYears(yearsText) } }
    return JSON.stringify(withYears) !== JSON.stringify(data.copy)
  }, [data, copy, yearsText])

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault()
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  if (loading) return <p className="text-sm text-gray-500">読み込んでいます…</p>
  if (!data || !copy) {
    return (
      <div>
        <Header title="自動で送る文面" />
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error || '読み込めませんでした'}</p>
      </div>
    )
  }

  const set = <G extends keyof Copy>(group: G, patch: Partial<Copy[G]>) => setCopy({ ...copy, [group]: { ...copy[group], ...patch } })
  const reset = <G extends keyof Copy>(group: G) => {
    if (!window.confirm('この欄を初めの文面に戻しますか？（保存するまで LINE には届きません）')) return
    setCopy({ ...copy, [group]: clone(data.defaults[group]) })
    if (group === 'graduationYear') setYearsText(data.defaults.graduationYear.years.join('、'))
  }
  const setSections = (sections: QaSection[]) => setCopy({ ...copy, qa: { ...copy.qa, sections } })
  const sections = copy.qa.sections

  const save = async () => {
    setSaving(true)
    setError('')
    setSaved('')
    const body = { copy: { ...copy, graduationYear: { ...copy.graduationYear, years: parseYears(yearsText) } } }
    const res = await sendApi<{ success: boolean; error?: string; errors?: string[] }>('/api/intern/line-copy', {
      method: 'PUT',
      body: JSON.stringify(body),
    }).catch(() => ({ success: false, error: '保存できませんでした。時間をおいてもう一度お試しください', errors: undefined }))
    setSaving(false)
    if (!res.success) {
      setError(res.errors?.join('\n') ?? res.error ?? '保存できませんでした')
      return
    }
    setSaved('保存しました。次に届く分からこの文面になります。')
    await load()
  }

  const ctx = data.context
  const consentLinks = [ctx.termsUrl ? '利用規約' : null, ctx.privacyPolicyUrl ? 'プライバシーポリシー' : null].filter(Boolean) as string[]
  const sample = '早稲田'

  return (
    <div className="pb-24">
      <Header
        title="自動で送る文面"
        description="KIDOUインターンの LINE で、友だち追加・アンケート・メニューの Q&A などに自動で返している文です。届く順に並べています。"
      />
      {formatDate(data.updatedAt) && <p className="-mt-6 mb-6 text-xs text-gray-400">アンケート・Q&A の文面を最後に保存した日時：{formatDate(data.updatedAt)}</p>}

      <div className="space-y-5">
        <Step
          no="友だち追加したとき ①"
          title="あいさつ"
          when="はじめて友だち追加した人に、アンケートのお願いの前に1回だけ送ります。この欄は1つずつ保存します。"
          preview={data.templates.greeting.map(templatePreview).filter(Boolean).length ? <>{data.templates.greeting.map(templatePreview)}</> : undefined}
        >
          <TemplateGroup group="greeting" items={data.templates.greeting} onChange={() => load(true)} />
        </Step>

        <Step
          no="友だち追加したとき ②"
          title="アンケートのお願い（同意のカード）"
          when="あいさつのすぐ後に送ります。メニューの鍵を押したとき・翌日20時の再案内でも同じカードを送ります。"
          onReset={() => reset('consent')}
          preview={<CardPreview title={copy.consent.title} note={copy.consent.body} buttons={[copy.consent.button]} links={consentLinks} />}
        >
          <Field label="見出し" value={copy.consent.title} onChange={(v) => set('consent', { title: v })} max={200} />
          <Field label="説明" value={copy.consent.body} onChange={(v) => set('consent', { body: v })} rows={4} />
          <Field label="ボタン" value={copy.consent.button} onChange={(v) => set('consent', { button: v })} max={20} />
          <p className="text-[11px] text-gray-400">下の「利用規約」「プライバシーポリシー」のリンクは自動で付きます。</p>
        </Step>

        <Step
          no="アンケート 1問目"
          title="大学名"
          when="同意のボタンを押した人に送ります。"
          onReset={() => reset('university')}
          preview={
            ctx.hasPicker ? (
              <CardPreview kicker={copy.university.kicker} title={copy.university.title} buttons={[copy.university.button]} />
            ) : (
              <Bubble text={copy.university.typeOnly} />
            )
          }
        >
          <Field label="小見出し" value={copy.university.kicker} onChange={(v) => set('university', { kicker: v })} />
          <Field label="問い" value={copy.university.title} onChange={(v) => set('university', { title: v })} max={200} />
          <Field label="ボタン（大学を選ぶ画面を開く）" value={copy.university.button} onChange={(v) => set('university', { button: v })} max={20} />
          <Field
            label="「もう一度入力する」を押したときの文"
            value={copy.university.retryPrompt}
            onChange={(v) => set('university', { retryPrompt: v })}
          />
          <Field
            label="大学を選ぶ画面が使えないときの文"
            hint={ctx.hasPicker ? 'いまは大学を選ぶ画面を使っているので、この文は送られません。' : 'いまはこの文を送っています。'}
            value={copy.university.typeOnly}
            onChange={(v) => set('university', { typeOnly: v })}
            rows={2}
          />
        </Step>

        <Step
          no="アンケート 1問目（続き）"
          title="大学名をトークに打ったときの候補"
          when="画面を使わずにトークに大学名を打った人に、当てはまる大学の候補を返します。文の中の {入力} は、打った文字に置き換わります。"
          onReset={() => reset('candidates')}
          preview={
            <>
              <CardPreview
                kicker={copy.university.kicker}
                title={copy.candidates.title}
                buttons={['早稲田大学']}
                subButtons={[copy.candidates.retry, copy.candidates.notListed]}
              />
              <CardPreview
                kicker={copy.university.kicker}
                title={copy.candidates.notFoundTitle.split('{入力}').join(sample + 'ほげ')}
                note={copy.candidates.notFoundNote}
                subButtons={[copy.candidates.retry, copy.candidates.registerRaw.split('{入力}').join(sample + 'ほげ')]}
              />
            </>
          }
        >
          <Field label="候補があったときの問い" value={copy.candidates.title} onChange={(v) => set('candidates', { title: v })} max={200} />
          <Field label="候補が多いときの補足" value={copy.candidates.manyNote} onChange={(v) => set('candidates', { manyNote: v })} rows={2} />
          <Field label="見つからなかったときの問い" value={copy.candidates.notFoundTitle} onChange={(v) => set('candidates', { notFoundTitle: v })} max={200} />
          <Field label="見つからなかったときの補足" value={copy.candidates.notFoundNote} onChange={(v) => set('candidates', { notFoundNote: v })} rows={2} />
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="ボタン：打ち直す" value={copy.candidates.retry} onChange={(v) => set('candidates', { retry: v })} max={20} />
            <Field label="ボタン：候補にない" value={copy.candidates.notListed} onChange={(v) => set('candidates', { notListed: v })} max={20} />
            <Field label="ボタン：そのまま登録" value={copy.candidates.registerRaw} onChange={(v) => set('candidates', { registerRaw: v })} max={20} />
          </div>
        </Step>

        <Step
          no="アンケート 2問目"
          title="学年"
          when="大学名を選んだ人に送ります。"
          onReset={() => reset('grade')}
          preview={<CardPreview kicker={copy.grade.kicker} title={copy.grade.title} buttons={ctx.grades} cols={2} />}
        >
          <Field label="小見出し" value={copy.grade.kicker} onChange={(v) => set('grade', { kicker: v })} />
          <Field label="問い" value={copy.grade.title} onChange={(v) => set('grade', { title: v })} max={200} />
          <p className="text-[11px] text-gray-400">学年の選択肢は、ミニアプリのマイページの学年とつながっているため、ここでは変えられません。</p>
        </Step>

        <Step
          no="アンケート 3問目"
          title="卒業予定年"
          when="学年を選んだ人に送ります。選ぶとアンケートが終わり、メニューが開きます。"
          onReset={() => reset('graduationYear')}
          preview={
            <CardPreview kicker={copy.graduationYear.kicker} title={copy.graduationYear.title} buttons={parseYears(yearsText).map((y) => `${y}年`)} cols={2} />
          }
        >
          <Field label="小見出し" value={copy.graduationYear.kicker} onChange={(v) => set('graduationYear', { kicker: v })} />
          <Field label="問い" value={copy.graduationYear.title} onChange={(v) => set('graduationYear', { title: v })} max={200} />
          <Field
            label="選択肢（西暦4桁を「、」で区切る）"
            hint="毎年、新しい年を足して古い年を外してください。12個まで。"
            value={yearsText}
            onChange={setYearsText}
          />
        </Step>

        <Step
          no="答え終えたとき"
          title="回答後の文と画像"
          when="3問目を選んだ人に、この文のあとにメニューの説明の画像を1回で送ります。この欄の文は1つずつ保存します。"
          preview={
            <>
              {data.templates.doneIntro.map(templatePreview)}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={ctx.doneImageUrl} alt="答え終えたときの画像" className="max-w-[300px] rounded-xl" />
            </>
          }
        >
          <TemplateGroup group="doneIntro" items={data.templates.doneIntro} onChange={() => load(true)} />
          <p className="text-[11px] text-gray-400">最後の画像（メニューの説明）は、いまは差し替えを頼んでもらう形です。</p>
          <div className="border-t border-gray-100 pt-3">
            <Field
              label="答え終えた人がもう一度アンケートのボタンを押したときの文"
              value={copy.done.already}
              onChange={(v) => set('done', { already: v })}
            />
          </div>
        </Step>

        <Step
          no="メニュー「Q&A」"
          title="よくある質問"
          when="メニューの「Q&A」を押すと、カードを横に並べて送ります。質問を押すと、その回答を返します。カードの大きさをそろえるため、どのカードも同じ数の質問にするのがおすすめです。"
          onReset={() => reset('qa')}
          preview={
            <div className="flex gap-2 overflow-x-auto pb-1">
              {sections.map((s, i) => (
                <div key={i} className="w-[200px] shrink-0">
                  <CardPreview kicker={`よくある質問 ${i + 1}/${sections.length}`} title={s.title} buttons={s.items.map((it) => it.q + '  ›')} />
                </div>
              ))}
            </div>
          }
        >
          {sections.map((s, i) => (
            <div key={i} className="rounded-lg border border-gray-200 p-3">
              <div className="mb-2 flex items-end gap-2">
                <div className="flex-1">
                  <Field
                    label={`${i + 1}枚目の見出し`}
                    value={s.title}
                    onChange={(v) => setSections(sections.map((x, k) => (k === i ? { ...x, title: v } : x)))}
                    max={40}
                  />
                </div>
                <div className="flex shrink-0 gap-1 pb-1 text-xs">
                  <button type="button" disabled={i === 0} onClick={() => setSections(move(sections, i, -1))} className="rounded border px-2 py-1 disabled:opacity-30">
                    ←
                  </button>
                  <button
                    type="button"
                    disabled={i === sections.length - 1}
                    onClick={() => setSections(move(sections, i, 1))}
                    className="rounded border px-2 py-1 disabled:opacity-30"
                  >
                    →
                  </button>
                  <button
                    type="button"
                    disabled={sections.length <= 1}
                    onClick={() => window.confirm(`「${s.title}」のカードを質問ごと消しますか？`) && setSections(sections.filter((_, k) => k !== i))}
                    className="rounded border border-red-200 px-2 py-1 text-red-600 disabled:opacity-30"
                  >
                    カードを消す
                  </button>
                </div>
              </div>
              <div className="space-y-3">
                {s.items.map((it, j) => {
                  const setItem = (patch: Partial<QaItem>) =>
                    setSections(sections.map((x, k) => (k === i ? { ...x, items: x.items.map((y, m) => (m === j ? { ...y, ...patch } : y)) } : x)))
                  return (
                    <div key={it.id} className="rounded-md bg-gray-50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-bold text-gray-500">{j + 1}問目</span>
                        <div className="flex gap-1 text-xs">
                          <button
                            type="button"
                            disabled={j === 0}
                            onClick={() => setSections(sections.map((x, k) => (k === i ? { ...x, items: move(x.items, j, -1) } : x)))}
                            className="rounded border bg-white px-2 py-0.5 disabled:opacity-30"
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            disabled={j === s.items.length - 1}
                            onClick={() => setSections(sections.map((x, k) => (k === i ? { ...x, items: move(x.items, j, 1) } : x)))}
                            className="rounded border bg-white px-2 py-0.5 disabled:opacity-30"
                          >
                            ↓
                          </button>
                          <button
                            type="button"
                            disabled={s.items.length <= 1}
                            onClick={() =>
                              window.confirm('この質問を消しますか？') &&
                              setSections(sections.map((x, k) => (k === i ? { ...x, items: x.items.filter((_, m) => m !== j) } : x)))
                            }
                            className="rounded border border-red-200 bg-white px-2 py-0.5 text-red-600 disabled:opacity-30"
                          >
                            消す
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Field label="質問（カードには2行まで出ます）" value={it.q} onChange={(v) => setItem({ q: v })} max={60} />
                        <Field label="回答" value={it.a} onChange={(v) => setItem({ a: v })} rows={4} max={1000} />
                      </div>
                    </div>
                  )
                })}
                <button
                  type="button"
                  disabled={s.items.length >= 6}
                  onClick={() => setSections(sections.map((x, k) => (k === i ? { ...x, items: [...x.items, { id: newQaId(), q: '', a: '' }] } : x)))}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
                >
                  ＋ このカードに質問を足す
                </button>
              </div>
            </div>
          ))}
          <button
            type="button"
            disabled={sections.length >= 12}
            onClick={() => setSections([...sections, { title: '', items: [{ id: newQaId(), q: '', a: '' }] }])}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-40"
          >
            ＋ カードを足す
          </button>
          <div className="grid gap-3 border-t border-gray-100 pt-3 sm:grid-cols-2">
            <Field label="回答のカードの小見出し" value={copy.qa.answerKicker} onChange={(v) => set('qa', { answerKicker: v })} />
            <Field label="回答の下のボタン" value={copy.qa.more} onChange={(v) => set('qa', { more: v })} max={20} />
          </div>
        </Step>

        <Step
          no="翌日の20時"
          title="アンケートが途中の人への再案内"
          when={
            ctx.reminderOn
              ? '友だち追加の翌日以降の20時に、まだ答え終えていない人へ1回だけ、この文と続きの問い（またはお願いのカード）を送ります。'
              : 'いまは再案内を止めています（送っていません）。動かすときは声をかけてください。'
          }
          onReset={() => reset('remind')}
          preview={<Bubble text={copy.remind.text} />}
        >
          <Field label="文" value={copy.remind.text} onChange={(v) => set('remind', { text: v })} rows={3} />
        </Step>
      </div>

      {/* 保存の帯（アンケート・Q&A・再案内の文面） */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving || !dirty}
            className="rounded-lg bg-green-600 px-5 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:opacity-40"
          >
            {saving ? '保存中…' : '文面を保存する'}
          </button>
          {dirty && !saving && (
            <>
              <span className="text-xs text-amber-700">保存していない直しがあります（あいさつ・回答後の文は各欄で保存）</span>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm('保存していない直しを取り消しますか？')) return
                  setCopy(clone(data.copy))
                  setYearsText(data.copy.graduationYear.years.join('、'))
                }}
                className="text-xs text-gray-500 underline"
              >
                取り消す
              </button>
            </>
          )}
          {saved && !dirty && <span className="text-xs text-green-700">{saved}</span>}
          {error && <span className="w-full whitespace-pre-wrap text-xs text-red-600">{error}</span>}
        </div>
      </div>
    </div>
  )
}

function parseYears(text: string): string[] {
  return text
    .split(/[、,，\s]+/)
    .map((y) => y.trim().replace(/年$/, ''))
    .filter(Boolean)
}

function move<T>(list: T[], index: number, delta: number): T[] {
  const next = [...list]
  const [item] = next.splice(index, 1)
  next.splice(index + delta, 0, item)
  return next
}
