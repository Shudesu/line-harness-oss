'use client'

// KIDOUインターン以外の LINE で自動で送る文面。そのアカウントのシナリオと自動返信を届く順に並べ、
// カードは見た目（色・並び・ボタンの動き）を変えずに「文の部分」だけをここで直せるようにする。
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'

type Json = Record<string, unknown>

interface Step {
  id: string
  stepOrder: number
  delayMinutes: number
  offsetDays?: number | null
  offsetMinutes?: number | null
  deliveryTime?: string | null
  messageType: string
  messageContent: string
  conditionType?: string | null
  conditionValue?: string | null
}
interface ScenarioFull {
  id: string
  name: string
  description: string | null
  triggerType: string
  triggerTagId: string | null
  isActive: boolean
  lineAccountId?: string | null
  deliveryMode?: string
  steps: Step[]
}
interface Reply {
  id: string
  keyword: string
  responseType: string
  responseContent: string
  lineAccountId: string | null
  isActive: boolean
}

const inputClass =
  'w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500'

// ── カードの中の「直せる文」を集める ───────────────────────────────

interface Slot {
  path: (string | number)[]
  label: string
  multiline: boolean
}

function collectSlots(msg: Json): Slot[] {
  const slots: Slot[] = []
  if (typeof msg.altText === 'string') slots.push({ path: ['altText'], label: '通知に出る文', multiline: true })
  const walk = (node: unknown, path: (string | number)[], area: string) => {
    if (Array.isArray(node)) {
      node.forEach((n, i) => walk(n, [...path, i], area))
      return
    }
    if (!node || typeof node !== 'object') return
    const n = node as Json
    // 飾り付きの文（span がある）は、LINE が span だけを表示するので span の側を直す
    const hasSpans = Array.isArray(n.contents) && n.contents.length > 0
    if ((n.type === 'text' || n.type === 'span') && typeof n.text === 'string' && n.text !== '' && !hasSpans) {
      slots.push({ path: [...path, 'text'], label: area, multiline: n.type === 'text' })
    }
    if (n.type === 'button' && n.action && typeof n.action === 'object') {
      const a = n.action as Json
      if (typeof a.label === 'string') slots.push({ path: [...path, 'action', 'label'], label: 'ボタンの文字', multiline: false })
      if (typeof a.uri === 'string') slots.push({ path: [...path, 'action', 'uri'], label: 'ボタンのリンク先', multiline: false })
    }
    for (const key of ['contents', 'header', 'hero', 'body', 'footer']) {
      if (key in n) {
        const next = key === 'header' ? '見出し' : key === 'footer' ? 'ボタンまわり' : area
        walk(n[key], [...path, key], next)
      }
    }
  }
  // 包みのない形（bubble / carousel をそのまま保存したもの）にも対応する
  if (msg.type === 'bubble' || msg.type === 'carousel') walk(msg, [], '本文')
  else walk(msg.contents, ['contents'], '本文')
  return slots
}

function getAt(obj: unknown, path: (string | number)[]): unknown {
  return path.reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string | number, unknown>)[k]), obj)
}
function setAt(obj: Json, path: (string | number)[], value: string): Json {
  const copy = JSON.parse(JSON.stringify(obj)) as Json
  let cur: Record<string | number, unknown> = copy
  path.slice(0, -1).forEach((k) => {
    cur = cur[k] as Record<string | number, unknown>
  })
  cur[path[path.length - 1]] = value
  return copy
}

// ── カードのだいたいの見た目 ──────────────────────────────────────

const SIZE: Record<string, number> = { xxs: 10, xs: 11, sm: 13, md: 14, lg: 16, xl: 18, xxl: 20, '3xl': 22, '4xl': 26, '5xl': 30 }
const SPACE: Record<string, number> = { none: 0, xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 20 }
const px = (v: unknown, fallback = 0) => (typeof v === 'string' ? (v.endsWith('px') ? parseInt(v, 10) : SPACE[v] ?? fallback) : fallback)

function FlexNode({ node, horizontal, first, parentSpacing }: { node: Json; horizontal?: boolean; first?: boolean; parentSpacing?: number }) {
  const gap = !first ? (node.margin ? px(node.margin) : parentSpacing ?? 0) : 0
  const outer: React.CSSProperties = horizontal
    ? { marginLeft: gap, flex: node.flex === 0 ? '0 0 auto' : `${typeof node.flex === 'number' ? node.flex : 1} 1 0`, minWidth: 0 }
    : { marginTop: gap }
  if (node.type === 'text') {
    const style: React.CSSProperties = {
      ...outer,
      fontSize: SIZE[(node.size as string) ?? 'md'] ?? 14,
      fontWeight: node.weight === 'bold' ? 700 : 400,
      color: (node.color as string) ?? '#111',
      textAlign: (node.align as 'left' | 'center' | 'right') ?? 'left',
      whiteSpace: node.wrap ? 'pre-wrap' : 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      lineHeight: 1.5,
    }
    if (Array.isArray(node.contents) && node.contents.length) {
      return (
        <p style={style}>
          {(node.contents as Json[]).map((s, i) => (
            <span key={i} style={{ color: (s.color as string) ?? undefined, fontWeight: s.weight === 'bold' ? 700 : undefined }}>
              {s.text as string}
            </span>
          ))}
        </p>
      )
    }
    return <p style={style}>{node.text as string}</p>
  }
  if (node.type === 'button') {
    const a = (node.action ?? {}) as Json
    // LINE のボタン：primary＝色の地に白い字／secondary＝色の地に黒い字／link＝色の字だけ
    const style = (node.style as string) ?? 'link'
    return (
      <div
        style={{
          ...outer,
          background: style === 'primary' ? ((node.color as string) ?? '#17c950') : style === 'secondary' ? ((node.color as string) ?? '#dcdfe5') : 'transparent',
          color: style === 'primary' ? '#fff' : style === 'secondary' ? '#111' : ((node.color as string) ?? '#2563eb'),
          borderRadius: 8,
          padding: node.height === 'sm' ? '6px 8px' : '10px 8px',
          textAlign: 'center',
          fontSize: 13,
        }}
      >
        {a.label as string}
      </div>
    )
  }
  if (node.type === 'separator') return <hr style={{ ...outer, borderColor: (node.color as string) ?? '#ddd' }} />
  if (node.type === 'image' && typeof node.url === 'string') {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={node.url} alt="" style={{ ...outer, width: '100%', borderRadius: 8 }} />
  }
  if (node.type === 'filler' || node.type === 'spacer') return <div style={{ ...outer, flex: 1 }} />
  if (node.type === 'box') {
    const row = node.layout === 'horizontal' || node.layout === 'baseline'
    const pad = px(node.paddingAll)
    const style: React.CSSProperties = {
      ...outer,
      display: 'flex',
      flexDirection: row ? 'row' : 'column',
      alignItems: row ? (node.layout === 'baseline' ? 'baseline' : 'flex-start') : 'stretch',
      background: (node.backgroundColor as string) ?? undefined,
      borderRadius: px(node.cornerRadius),
      paddingTop: node.paddingTop !== undefined ? px(node.paddingTop) : pad,
      paddingBottom: node.paddingBottom !== undefined ? px(node.paddingBottom) : pad,
      paddingLeft: node.paddingStart !== undefined ? px(node.paddingStart) : pad,
      paddingRight: node.paddingEnd !== undefined ? px(node.paddingEnd) : pad,
      borderWidth: node.borderWidth ? 1 : 0,
      borderColor: (node.borderColor as string) ?? undefined,
      borderStyle: node.borderWidth ? 'solid' : undefined,
    }
    const spacing = px(node.spacing)
    return (
      <div style={style}>
        {((node.contents as Json[]) ?? []).map((c, i) => (
          <FlexNode key={i} node={c} horizontal={row} first={i === 0} parentSpacing={spacing} />
        ))}
      </div>
    )
  }
  return null
}

function Bubble({ bubble }: { bubble: Json }) {
  const styles = (bubble.styles ?? {}) as Record<string, Json>
  const part = (key: string) => {
    const node = bubble[key] as Json | undefined
    if (!node) return null
    return (
      <div style={{ background: (styles[key]?.backgroundColor as string) ?? '#fff', padding: node.paddingAll === undefined ? 16 : 0 }}>
        <FlexNode node={node} first />
      </div>
    )
  }
  return (
    <div className="w-[280px] shrink-0 overflow-hidden rounded-2xl bg-white shadow-sm">
      {part('header')}
      {part('hero')}
      {part('body')}
      {part('footer')}
    </div>
  )
}

function MessagePreview({ type, content }: { type: string; content: string }) {
  if (type !== 'text' && type !== 'flex') return <p className="text-xs text-white">（画像などで、文はありません）</p>
  if (type === 'text') {
    return <div className="max-w-[280px] rounded-2xl bg-white px-3 py-2 text-[13px] whitespace-pre-wrap text-gray-800 shadow-sm">{content}</div>
  }
  try {
    const msg = JSON.parse(content) as Json
    const c = (msg.contents ?? msg) as Json
    if (c.type === 'carousel') {
      return (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {((c.contents as Json[]) ?? []).map((b, i) => (
            <Bubble key={i} bubble={b} />
          ))}
        </div>
      )
    }
    return <Bubble bubble={c} />
  } catch {
    return <p className="text-xs text-red-600">カードの中身を読めませんでした</p>
  }
}

// ── 1通ぶんの編集欄 ────────────────────────────────────────────

function MessageEditor({
  title,
  when,
  type,
  content,
  onSave,
}: {
  title: string
  when?: string
  type: string
  content: string
  onSave: (next: string) => Promise<string | null>
}) {
  const [value, setValue] = useState(content)
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => setValue(content), [content])

  const parsed = useMemo(() => {
    if (type !== 'flex') return null
    try {
      return JSON.parse(value) as Json
    } catch {
      return null
    }
  }, [type, value])
  const slots = useMemo(() => (parsed ? collectSlots(parsed) : []), [parsed])
  const dirty = value !== content

  const save = async () => {
    setSaving(true)
    setMsg('')
    const err = await onSave(value)
    setSaving(false)
    setMsg(err ?? '保存しました')
  }

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="mb-3">
        <p className="text-sm font-bold text-gray-900">{title}</p>
        {when && <p className="mt-0.5 text-xs text-gray-500">{when}</p>}
      </div>
      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="min-w-0 flex-1 space-y-2">
          {type === 'text' ? (
            <textarea rows={Math.min(18, Math.max(4, value.split('\n').length + 1))} value={value} onChange={(e) => setValue(e.target.value)} className={inputClass} />
          ) : type !== 'flex' ? (
            <p className="text-xs text-gray-500">この種類（画像など）は、ここで直す文がありません。</p>
          ) : parsed ? (
            slots.map((s, i) => {
              const v = String(getAt(parsed, s.path) ?? '')
              const set = (next: string) => setValue(JSON.stringify(setAt(parsed, s.path, next)))
              return (
                <label key={i} className="block">
                  <span className="mb-0.5 block text-[11px] font-medium text-gray-500">{s.label}</span>
                  {s.multiline || v.includes('\n') ? (
                    <textarea rows={Math.max(1, v.split('\n').length)} value={v} onChange={(e) => set(e.target.value)} className={inputClass} />
                  ) : (
                    <input value={v} onChange={(e) => set(e.target.value)} className={inputClass} />
                  )}
                </label>
              )
            })
          ) : (
            <p className="text-xs text-red-600">カードの中身を読めませんでした（直すときは声をかけてください）</p>
          )}
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={save}
              disabled={saving || !dirty}
              className="rounded-lg bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-40"
            >
              {saving ? '保存中…' : 'この文を保存'}
            </button>
            {dirty && (
              <button type="button" onClick={() => setValue(content)} className="text-xs text-gray-500 underline">
                取り消す
              </button>
            )}
            {msg && <span className={`text-xs ${msg === '保存しました' ? 'text-green-700' : 'text-red-600'}`}>{msg}</span>}
          </div>
          {type === 'flex' && <p className="text-[11px] text-gray-400">カードは色・並び・ボタンの動きはそのままで、文だけを直せます。見た目を変えたいときは声をかけてください。</p>}
        </div>
        <div className="shrink-0 lg:w-[310px]">
          <p className="mb-2 text-[11px] font-medium text-gray-400">LINE での見え方（だいたい）</p>
          <div className="rounded-xl p-3" style={{ background: '#8cabd9' }}>
            <MessagePreview type={type} content={value} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── いつ届くか・誰に届くかを日常の言葉にする ─────────────────────────

function whenText(s: Step, mode: string | undefined, tagName: (id: string) => string, isFirst: boolean): string {
  const d = s.offsetDays ?? 0
  const span = (mins: number) =>
    mins % 1440 === 0 ? `${mins / 1440}日後` : mins % 60 === 0 ? `${mins / 60}時間後` : `${mins}分後`
  let t: string
  if (mode === 'absolute_time') {
    const time = s.deliveryTime ?? '00:00'
    t = d === 0 && time === '00:00' ? '始まってすぐ' : `${d === 0 ? '始まった日' : `始まった${d}日後`}の ${time}`
  } else if (mode === 'elapsed') {
    // 始まった時刻から数える
    const mins = d * 1440 + (s.offsetMinutes ?? 0)
    t = mins === 0 ? '始まってすぐ' : `始まってから${span(mins)}`
  } else {
    // 前の通から数える
    const mins = s.delayMinutes ?? 0
    t = mins === 0 ? (isFirst ? '始まってすぐ' : '前の通のすぐあと') : `前の通の${span(mins)}`
  }
  if (s.conditionType === 'tags_match' && s.conditionValue) {
    try {
      const c = JSON.parse(s.conditionValue) as { all?: string[]; none?: string[] }
      const parts: string[] = []
      if (c.all?.length) parts.push(`${c.all.map((id) => `「${tagName(id)}」`).join('')}の印がある人`)
      if (c.none?.length) parts.push(`${c.none.map((id) => `「${tagName(id)}」`).join('')}の印がない人`)
      if (parts.length) t += `／${parts.join('で、')}だけ`
    } catch {
      // 条件が読めないときは時刻だけ
    }
  }
  return t
}

function triggerText(s: ScenarioFull, tagName: (id: string) => string): string {
  if (s.triggerType === 'friend_add') return '友だち追加したときに始まります'
  if (s.triggerType === 'tag_added' && s.triggerTagId) return `「${tagName(s.triggerTagId)}」の印が付いたときに始まります`
  if (s.triggerType === 'manual') return 'ほかの仕組み（予約の完了など）から呼ばれたときに始まります'
  return ''
}

// 自動返信の見出し：Q&A の質問はそのまま、英数字だけの合図はボタンから届くもの
function replyTitle(keyword: string): string {
  if (/^[\x21-\x7e]+$/.test(keyword)) return `ボタンの合図「${keyword}」が届いたとき（メニューなど）`
  return `「${keyword}」が届いたとき`
}

const triggerOrder = (t: string) => (t === 'friend_add' ? 0 : t === 'tag_added' ? 1 : 2)

// ── 画面 ────────────────────────────────────────────────

export default function AccountLineCopy({ accountId, accountName }: { accountId: string; accountName: string }) {
  const [scenarios, setScenarios] = useState<ScenarioFull[]>([])
  const [replies, setReplies] = useState<Reply[]>([])
  const [tags, setTags] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = async () => {
    setError('')
    try {
      const [list, rep, tagRes] = await Promise.all([api.scenarios.list({ accountId }), api.autoReplies.list({ accountId }), api.tags.list()])
      if (!list.success) throw new Error()
      const full = await Promise.all(list.data.map((s) => api.scenarios.get(s.id)))
      setScenarios(
        full
          .filter((r) => r.success)
          .map((r) => r.data as unknown as ScenarioFull)
          .sort((a, b) => triggerOrder(a.triggerType) - triggerOrder(b.triggerType) || a.name.localeCompare(b.name, 'ja')),
      )
      const isSignal = (k: string) => /^[\x21-\x7e]+$/.test(k)
      setReplies(
        rep.success
          ? (rep.data as Reply[]).filter((r) => r.lineAccountId === accountId).sort((a, b) => Number(isSignal(b.keyword)) - Number(isSignal(a.keyword)))
          : [],
      )
      setTags(tagRes.success ? Object.fromEntries(tagRes.data.map((t) => [t.id, t.name])) : {})
    } catch {
      setError('読み込めませんでした。時間をおいてもう一度お試しください')
    }
    setLoading(false)
  }

  useEffect(() => {
    setLoading(true)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  const tagName = (id: string) => tags[id] ?? '（消された印）'

  if (loading) return <p className="text-sm text-gray-500">読み込んでいます…</p>

  const saveStep = (scenarioId: string, stepId: string) => async (next: string) => {
    const res = await api.scenarios.updateStep(scenarioId, stepId, { messageContent: next }).catch(() => ({ success: false as const }))
    if (!res.success) return '保存できませんでした'
    setScenarios((list) =>
      list.map((s) => (s.id !== scenarioId ? s : { ...s, steps: s.steps.map((st) => (st.id === stepId ? { ...st, messageContent: next } : st)) })),
    )
    return null
  }
  const saveReply = (id: string) => async (next: string) => {
    const res = await api.autoReplies.update(id, { responseContent: next }).catch(() => ({ success: false as const }))
    if (!res.success) return '保存できませんでした'
    setReplies((list) => list.map((r) => (r.id === id ? { ...r, responseContent: next } : r)))
    return null
  }

  return (
    <div className="pb-16">
      <Header
        title="自動で送る文面"
        description={`${accountName} の LINE で、友だち追加・印・キーワードに合わせて自動で送っている文です。始まるきっかけごとに、届く順に並べています。`}
      />
      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      <div className="space-y-6">
        {scenarios.map((s) => (
          <section key={s.id} className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="mb-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-gray-900">{s.name}</h2>
                {!s.lineAccountId && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] text-amber-800">すべての LINE に共通（直すと全部に効きます）</span>
                )}
                <span className={`rounded-full px-2 py-0.5 text-[11px] ${s.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                  {s.isActive ? '送っています' : 'いまは止めています'}
                </span>
              </div>
              <p className="mt-0.5 text-xs text-gray-500">{triggerText(s, tagName)}</p>
            </div>
            <div className="space-y-3">
              {s.steps
                .slice()
                .sort((a, b) => a.stepOrder - b.stepOrder)
                .map((st, i) => (
                  <MessageEditor
                    key={st.id}
                    title={`${st.stepOrder}通目`}
                    when={whenText(st, s.deliveryMode, tagName, i === 0)}
                    type={st.messageType}
                    content={st.messageContent}
                    onSave={saveStep(s.id, st.id)}
                  />
                ))}
              {s.steps.length === 0 && <p className="text-sm text-gray-500">まだ文がありません。</p>}
            </div>
          </section>
        ))}

        {replies.length > 0 && (
          <section className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="mb-4">
              <h2 className="text-base font-bold text-gray-900">キーワードへの返事（メニューの Q&A など）</h2>
              <p className="mt-0.5 text-xs text-gray-500">決まった言葉が届いたとき（メニューやカードのボタンを押したときも含む）に返す文です。</p>
            </div>
            <div className="space-y-3">
              {replies.map((r) => (
                <MessageEditor
                  key={r.id}
                  title={replyTitle(r.keyword)}
                  when={r.isActive ? undefined : 'いまは止めています'}
                  type={r.responseType}
                  content={r.responseContent}
                  onSave={saveReply(r.id)}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
