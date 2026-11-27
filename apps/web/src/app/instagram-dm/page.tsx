'use client'

// KIDOUインターンの Instagram 自動DM。リール・投稿に決めた言葉のコメントをした人へ、公式LINEへの案内を DM で送る
// （iステップのような仕組み）。Instagram アカウントは複数つなげ、上の切り替えで選んだアカウントのルール・試し・記録を扱う。
// 仕組みは worker の services/intern-instagram.ts
import { useEffect, useMemo, useState } from 'react'
import Header from '@/components/layout/header'
import InternOnly from '@/components/intern-only'
import { fetchApi, sendApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

type MatchMode = 'contains' | 'exact' | 'any'
type MediaScope = 'all' | 'selected'

interface Rule {
  id: string
  name: string
  isActive: boolean
  mediaScope: MediaScope
  mediaIds: string[]
  keywords: string[]
  matchMode: MatchMode
  dmText: string
  buttonLabel: string
  linkUrl: string
  publicReplies: string[]
  activatedAt: string | null
  createdAt: string
}

interface IgAccount {
  igUserId: string
  username: string
  pollEnabled: boolean
  lastPolledAt: string | null
  lastWebhookAt: string | null
  lastWebhookNote: string | null
  connectedVia: 'login' | 'token'
  connectedAt: string
}

interface AppSettings {
  appId: string
  configId: string
  hasAppSecret: boolean
  verifyToken: string
}

interface Overview {
  app: AppSettings
  accounts: IgAccount[]
  redirectUri: string
  webhookUrl: string
}

type Stats = Record<string, { sent: number; failed: number; matched: number; lastAt: string | null }>

interface Media {
  id: string
  caption?: string
  media_type?: string
  media_product_type?: string
  permalink?: string
  thumbnail_url?: string
  media_url?: string
  timestamp?: string
}

interface LogRow {
  commentId: string
  ruleId: string | null
  mediaId: string
  username: string | null
  text: string
  status: string
  detail: string | null
  publicReplyStatus: string | null
  via: string
  createdAt: string
}

interface JoinLink {
  id: string
  refCode: string
  name: string
  isActive: boolean
  friendCount: number
}

const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  sent: { label: 'DM送信', tone: 'bg-green-100 text-green-800' },
  sent_text: { label: 'DM送信（文のみ）', tone: 'bg-green-100 text-green-800' },
  failed: { label: '送れず', tone: 'bg-red-100 text-red-700' },
  sending: { label: '送信中', tone: 'bg-yellow-100 text-yellow-800' },
  already_sent: { label: '送信済みの人', tone: 'bg-gray-100 text-gray-600' },
}

const MATCH_LABEL: Record<MatchMode, string> = {
  contains: 'この言葉を含むコメント',
  exact: 'この言葉だけのコメント',
  any: 'すべてのコメント',
}

const EMPTY_RULE: Omit<Rule, 'id' | 'activatedAt' | 'createdAt'> = {
  name: '',
  isActive: false,
  mediaScope: 'all',
  mediaIds: [],
  keywords: [],
  matchMode: 'contains',
  dmText: 'コメントありがとうございます！\n\nお約束の特典は、KIDOUインターンの公式LINEでお渡ししています。\n下のボタンから友だち追加してください。',
  buttonLabel: 'LINEで受け取る',
  linkUrl: '',
  publicReplies: ['DMをお送りしました！ご確認ください。'],
}

function formatDate(value: string | null | undefined) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ja-JP', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' })
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 shrink-0 text-xs text-gray-500">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-gray-50 px-2 py-1 text-xs text-gray-800">{value}</code>
      <button
        type="button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
          } catch {
            window.prompt('コピーしてください', value)
          }
        }}
        className="shrink-0 rounded-md border border-gray-300 bg-white px-2.5 py-1 text-xs text-gray-700 hover:bg-gray-50"
      >
        {copied ? 'コピーしました' : 'コピー'}
      </button>
    </div>
  )
}

export default function InstagramDmPage() {
  return (
    <InternOnly title="Instagram自動DM">
      <InstagramDmBody />
    </InternOnly>
  )
}

const SELECTED_KEY = 'lh_ig_selected_account'

function InstagramDmBody() {
  const { selectedAccountId } = useAccount()
  const [data, setData] = useState<Overview | null>(null)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [igId, setIgId] = useState<string>('')
  const [rules, setRules] = useState<Rule[]>([])
  const [stats, setStats] = useState<Stats>({})
  const [editing, setEditing] = useState<Rule | 'new' | null>(null)
  const [log, setLog] = useState<LogRow[]>([])

  const load = async (prefer?: string) => {
    try {
      const res = await fetchApi<{ success: boolean; data?: Overview; error?: string }>('/api/intern/instagram')
      if (!res.success || !res.data) {
        setError(res.error ?? '読み込めませんでした')
        return
      }
      setData(res.data)
      setError('')
      const ids = res.data.accounts.map((a) => a.igUserId)
      const saved = typeof window !== 'undefined' ? window.localStorage.getItem(SELECTED_KEY) ?? '' : ''
      const next = [prefer, igId, saved].find((x) => x && ids.includes(x)) ?? ids[0] ?? ''
      setIgId(next)
    } catch {
      setError('読み込めませんでした。時間をおいてもう一度お試しください')
    }
  }

  const loadAccount = async (id: string) => {
    if (!id) {
      setRules([])
      setStats({})
      setLog([])
      return
    }
    const base = `/api/intern/instagram/accounts/${encodeURIComponent(id)}`
    type RulesRes = { success: boolean; error?: string; data?: { rules: Rule[]; stats: Stats } }
    type LogRes = { success: boolean; error?: string; data?: LogRow[] }
    const [r, l] = await Promise.all([sendApi<RulesRes>(`${base}/rules`), sendApi<LogRes>(`${base}/log`)]).catch(
      (): [RulesRes, LogRes] => [{ success: false }, { success: false }],
    )
    if (!r.success) setError(r.error || 'ルールを読み込めませんでした')
    setRules(r.data?.rules ?? [])
    setStats(r.data?.stats ?? {})
    setLog(l.data ?? [])
  }

  // Meta のログインから戻ってきたときの結果を出し、アドレスの後ろの印は消す
  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const connected = q.get('ig_connected')
    const err = q.get('ig_error')
    const note = q.get('ig_note')
    if (connected) setNotice({ tone: 'ok', text: `Instagram をつなぎました。${note ? `（${note}）` : ''}` })
    else if (err) setNotice({ tone: 'error', text: `つなげませんでした：${err}` })
    if (connected || err) window.history.replaceState(null, '', window.location.pathname)
    load(connected?.split(',')[0] || undefined)
  }, [])

  useEffect(() => {
    if (igId) window.localStorage.setItem(SELECTED_KEY, igId)
    loadAccount(igId)
  }, [igId])

  const reloadAll = async () => {
    await load()
    await loadAccount(igId)
  }

  const toggleRule = async (rule: Rule) => {
    const res = await sendApi<{ success: boolean; error?: string }>(`/api/intern/instagram/rules/${rule.id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...rule, isActive: !rule.isActive }),
    })
    if (!res.success) {
      window.alert(res.error ?? '切り替えられませんでした')
      return
    }
    await loadAccount(igId)
  }

  const removeRule = async (rule: Rule) => {
    if (!window.confirm(`ルール「${rule.name}」を消します。よろしいですか？（送った記録は残ります）`)) return
    await sendApi(`/api/intern/instagram/rules/${rule.id}`, { method: 'DELETE' })
    await loadAccount(igId)
  }

  const account = data?.accounts.find((a) => a.igUserId === igId) ?? null

  return (
    <div>
      <Header
        title="Instagram自動DM"
        description="リールや投稿に決めた言葉のコメントをした人へ、公式LINEへの案内をDMで自動で送ります。Instagramアカウントごとにルールと記録を分けて管理します。"
      />
      {error && <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {notice && (
        <p className={`mb-4 rounded-lg px-3 py-2 text-sm ${notice.tone === 'ok' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700'}`}>{notice.text}</p>
      )}
      {!data ? (
        !error && <p className="text-sm text-gray-500">読み込んでいます…</p>
      ) : (
        <div className="space-y-6">
          <AccountsCard data={data} selected={igId} onSelect={setIgId} onChanged={reloadAll} />

          {account && (
            <section className="rounded-lg border border-gray-200 bg-white p-5">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <h2 className="text-base font-bold text-gray-900">@{account.username || account.igUserId} のルール</h2>
                  <p className="mt-1 text-xs text-gray-500">上にあるルールから順に確かめ、最初に合ったルールのDMを送ります。同じ人には同じルールで1回だけ送ります。</p>
                </div>
                <button
                  type="button"
                  onClick={() => setEditing('new')}
                  className="whitespace-nowrap rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700"
                >
                  ＋ ルールを作る
                </button>
              </div>
              {rules.length === 0 ? (
                <p className="rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">まだルールがありません。「＋ ルールを作る」から始めてください。</p>
              ) : (
                <div className="space-y-3">
                  {rules.map((rule) => {
                    const st = stats[rule.id]
                    return (
                      <div key={rule.id} className="rounded-lg border border-gray-200 p-4">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${rule.isActive ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                                {rule.isActive ? '動いています' : '止めています'}
                              </span>
                              <span className="font-medium text-gray-900">{rule.name}</span>
                            </div>
                            <p className="mt-2 text-xs text-gray-600">
                              対象：{rule.mediaScope === 'all' ? 'すべての投稿・リール' : `選んだ投稿 ${rule.mediaIds.length}件`}
                              　反応：{rule.matchMode === 'any' ? 'すべてのコメント' : `${MATCH_LABEL[rule.matchMode]}「${rule.keywords.join('」「')}」`}
                            </p>
                            <p className="mt-1 text-xs text-gray-600">
                              送った数 <b className="text-gray-900">{st?.sent ?? 0}</b>人
                              {st?.failed ? <span className="ml-2 text-red-600">送れず {st.failed}件</span> : null}
                              <span className="ml-2 text-gray-400">最後の反応 {formatDate(st?.lastAt)}</span>
                            </p>
                          </div>
                          <div className="flex shrink-0 gap-2">
                            <button type="button" onClick={() => toggleRule(rule)} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50">
                              {rule.isActive ? '止める' : '動かす'}
                            </button>
                            <button type="button" onClick={() => setEditing(rule)} className="rounded-md border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50">
                              直す
                            </button>
                            <button type="button" onClick={() => removeRule(rule)} className="rounded-md border border-red-200 px-3 py-1.5 text-xs text-red-600 hover:bg-red-50">
                              消す
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          )}

          {account && rules.length > 0 && <TryBox igId={account.igUserId} />}

          {account && <LogTable log={log} rules={rules} onReload={() => loadAccount(igId)} />}
        </div>
      )}

      {editing && selectedAccountId && account && (
        <RuleEditor
          rule={editing === 'new' ? null : editing}
          igId={account.igUserId}
          accountId={selectedAccountId}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await loadAccount(igId)
          }}
        />
      )}
    </div>
  )
}

// ── アカウントの切り替え・つなぎ方 ─────────────────────

function AccountsCard({
  data,
  selected,
  onSelect,
  onChanged,
}: {
  data: Overview
  selected: string
  onSelect: (id: string) => void
  onChanged: () => Promise<void>
}) {
  const appReady = !!(data.app.appId && data.app.configId && data.app.hasAppSecret)
  const [open, setOpen] = useState(!appReady)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [invite, setInvite] = useState<{ url: string; expiresAt: string } | null>(null)
  const [inviteCopied, setInviteCopied] = useState(false)
  const account = data.accounts.find((a) => a.igUserId === selected) ?? null

  const run = async (work: () => Promise<void>) => {
    setBusy(true)
    setMessage('')
    setError('')
    try {
      await work()
    } finally {
      setBusy(false)
    }
  }

  const connect = () =>
    run(async () => {
      const res = await sendApi<{ success: boolean; error?: string; data?: { url: string } }>('/api/intern/instagram/login', {
        method: 'POST',
        body: JSON.stringify({ returnTo: `${window.location.origin}${window.location.pathname}` }),
      })
      if (!res.success || !res.data) {
        setError(res.error ?? 'ログイン画面を開けませんでした')
        if (!appReady) setOpen(true)
        return
      }
      window.location.href = res.data.url
    })

  const makeInvite = () =>
    run(async () => {
      const res = await sendApi<{ success: boolean; error?: string; data?: { url: string; expiresAt: string } }>('/api/intern/instagram/invites', { method: 'POST' })
      if (!res.success || !res.data) {
        setError(res.error ?? 'リンクを作れませんでした')
        if (!appReady) setOpen(true)
        return
      }
      setInvite(res.data)
      setInviteCopied(false)
    })

  const copyInvite = async () => {
    if (!invite) return
    await navigator.clipboard.writeText(invite.url).catch(() => {})
    setInviteCopied(true)
  }

  const pollNow = () =>
    run(async () => {
      if (!account) return
      const res = await sendApi<{ success: boolean; error?: string; data?: Record<string, number> }>(
        `/api/intern/instagram/accounts/${encodeURIComponent(account.igUserId)}/poll`,
        { method: 'POST' },
      )
      if (!res.success) setError(res.error ?? '確かめられませんでした')
      else {
        const sent = (res.data?.sent ?? 0) + (res.data?.sent_text ?? 0)
        const failed = res.data?.failed ?? 0
        const errs = (res.data?.media_error ?? 0) + (res.data?.comments_error ?? 0)
        setMessage(`確かめました。新しく送ったDM ${sent}件${failed ? `・送れず ${failed}件` : ''}${errs ? '・Instagram から読めない投稿がありました' : ''}`)
      }
      await onChanged()
    })

  const togglePoll = () =>
    run(async () => {
      if (!account) return
      const res = await sendApi<{ success: boolean; error?: string }>(`/api/intern/instagram/accounts/${encodeURIComponent(account.igUserId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ pollEnabled: !account.pollEnabled }),
      })
      if (!res.success) setError(res.error ?? '切り替えられませんでした')
      await onChanged()
    })

  const disconnect = () =>
    run(async () => {
      if (!account) return
      if (!window.confirm(`@${account.username || account.igUserId} とのつながりを外します。ルールと記録は残りますが、DM は送られなくなります。よろしいですか？`)) return
      await sendApi(`/api/intern/instagram/accounts/${encodeURIComponent(account.igUserId)}`, { method: 'DELETE' })
      await onChanged()
    })

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-gray-900">Instagram アカウント</h2>
          <p className="mt-1 text-xs text-gray-500">選んだアカウントのルールと記録が下に出ます。DMの案内先は、どのアカウントもKIDOUインターンの公式LINEです。</p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={connect}
            className="whitespace-nowrap rounded-lg bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            ＋ Instagramをつなぐ
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={makeInvite}
            className="whitespace-nowrap rounded-lg border border-green-600 px-3 py-2 text-sm font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
          >
            運用者に送るリンクを作る
          </button>
          <button type="button" onClick={() => setOpen((v) => !v)} className="whitespace-nowrap rounded-lg border border-gray-300 px-3 py-2 text-xs hover:bg-gray-50">
            {open ? '設定を閉じる' : 'Metaのアプリの設定'}
          </button>
        </div>
      </div>

      {invite && (
        <div className="mt-4 space-y-2 rounded-lg border border-green-200 bg-green-50 p-3 text-xs text-gray-700">
          <p className="font-medium text-green-800">このリンクを、Instagramを運用している本人に送ってください（{formatDate(invite.expiresAt)} まで何度でも使えます）。</p>
          <div className="flex flex-wrap items-center gap-2">
            <input readOnly value={invite.url} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 font-mono text-xs" />
            <button type="button" onClick={copyInvite} className="whitespace-nowrap rounded-md bg-green-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-green-700">
              {inviteCopied ? 'コピーしました' : 'コピー'}
            </button>
          </div>
          <p>本人がリンクを開いて自分のFacebookでログインし、Instagramを選ぶと、ここの一覧に出ます（画面を開き直すと反映）。Metaの審査が通るまでは、本人を先にアプリの「役割」の「テスター」に追加しておく必要があります。</p>
        </div>
      )}

      {data.accounts.length === 0 ? (
        <p className="mt-4 rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
          まだつながっていません。{appReady ? '「＋ Instagramをつなぐ」から、運用するアカウントでログインしてください。' : '先に「Metaのアプリの設定」を保存してください。'}
        </p>
      ) : (
        <div className="mt-4 flex flex-wrap gap-2">
          {data.accounts.map((a) => (
            <button
              type="button"
              key={a.igUserId}
              onClick={() => onSelect(a.igUserId)}
              className={`rounded-full border px-3 py-1.5 text-sm ${a.igUserId === selected ? 'border-green-600 bg-green-50 font-medium text-green-800' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
            >
              @{a.username || a.igUserId}
            </button>
          ))}
        </div>
      )}

      {account && (
        <div className="mt-4 flex flex-wrap items-start justify-between gap-3 rounded-lg bg-gray-50 p-3">
          <div className="space-y-1 text-xs text-gray-600">
            <p>
              つないだ日時 {formatDate(account.connectedAt)}（{account.connectedVia === 'login' ? 'ログインでつないだ' : '鍵を貼ってつないだ'}）
            </p>
            <p>
              コメントの知らせ：{account.lastWebhookAt ? `最後に届いたのは ${formatDate(account.lastWebhookAt)}（${account.lastWebhookNote ?? ''}）` : 'まだ届いていません（Metaの審査を通ってアプリを公開すると届きます）'}
            </p>
            <p>
              見回り（知らせが届かないときの代わり・1分ごと）：{account.pollEnabled ? 'する' : 'しない'}　最後に見た時刻 {formatDate(account.lastPolledAt)}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 sm:shrink-0">
            <button type="button" disabled={busy} onClick={pollNow} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50">
              今すぐコメントを確かめる
            </button>
            <button type="button" disabled={busy} onClick={togglePoll} className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs hover:bg-gray-50 disabled:opacity-50">
              見回りを{account.pollEnabled ? '止める' : '始める'}
            </button>
            <button type="button" disabled={busy} onClick={disconnect} className="rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50">
              つながりを外す
            </button>
          </div>
        </div>
      )}

      {message && <p className="mt-3 rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">{message}</p>}
      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      {open && <AppSettingsForm data={data} onChanged={onChanged} />}
    </section>
  )
}

function AppSettingsForm({ data, onChanged }: { data: Overview; onChanged: () => Promise<void> }) {
  const [appId, setAppId] = useState(data.app.appId)
  const [configId, setConfigId] = useState(data.app.configId)
  const [secret, setSecret] = useState('')
  const [token, setToken] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const save = async () => {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const res = await sendApi<{ success: boolean; error?: string }>('/api/intern/instagram/app', {
        method: 'PUT',
        body: JSON.stringify({ appId, configId, appSecret: secret || undefined }),
      })
      if (!res.success) {
        setError(res.error ?? '保存できませんでした')
        return
      }
      setSecret('')
      setMessage('保存しました。「＋ Instagramをつなぐ」からアカウントをつなげます。')
      await onChanged()
    } finally {
      setSaving(false)
    }
  }

  const connectWithToken = async () => {
    setSaving(true)
    setMessage('')
    setError('')
    try {
      const res = await sendApi<{ success: boolean; error?: string; data?: { accounts: IgAccount[]; notes: string[] } }>('/api/intern/instagram/accounts', {
        method: 'POST',
        body: JSON.stringify({ accessToken: token }),
      })
      if (!res.success || !res.data) {
        setError(res.error ?? 'つなげませんでした')
        return
      }
      setToken('')
      setMessage([`つなぎました：${res.data.accounts.map((a) => `@${a.username || a.igUserId}`).join('、')}`, ...res.data.notes].join(' '))
      await onChanged()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-5 space-y-5 border-t border-gray-100 pt-5">
      <div>
        <h3 className="mb-2 text-sm font-bold text-gray-900">Metaのアプリの設定（最初に1回だけ・無料）</h3>
        <ol className="list-decimal space-y-1.5 pl-5 text-xs leading-relaxed text-gray-700">
          <li>
            <a href="https://developers.facebook.com/apps/" target="_blank" rel="noreferrer" className="text-green-700 underline">Meta for Developers</a>
            のアプリ（自動DM）を開き、「アプリの設定」→「ベーシック」の「アプリID」と「app secret」を下に入れます。
          </li>
          <li>
            「ユースケース」→「Instagramでメッセージとコンテンツを管理」→「API setup with Unified login」の「設定ID」を下に入れ、同じ画面の「リダイレクトURL」に下の「ログインの戻り先」を登録します。
          </li>
          <li>
            「アクセス許可と機能」で、pages_show_list・pages_read_engagement・business_management と、instagram_basic・instagram_manage_comments・instagram_manage_messages を追加します。
          </li>
          <li>
            「Webhookを設定」には、下の「コールバックURL」と「確認トークン」を貼り、「comments」を受け取る設定にします。
            <span className="text-gray-500">コメントの知らせはMetaの審査を通ってアプリを公開すると届きます。それまでは1分ごとの見回りでコメントを拾います。</span>
          </li>
          <li>審査前は、Metaのアプリの「アプリの役割」に入れた人だけつなげます。</li>
        </ol>
      </div>

      <div className="space-y-2">
        <CopyRow label="ログインの戻り先" value={data.redirectUri} />
        <CopyRow label="コールバック URL" value={data.webhookUrl} />
        <CopyRow label="確認トークン" value={data.app.verifyToken} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="text-xs text-gray-600">アプリID</span>
          <input value={appId} onChange={(e) => setAppId(e.target.value)} inputMode="numeric" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" autoComplete="off" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-600">app secret{data.app.hasAppSecret && '（登録済み・変えるときだけ）'}</span>
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" autoComplete="off" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-600">設定ID（統合ログイン）</span>
          <input value={configId} onChange={(e) => setConfigId(e.target.value)} inputMode="numeric" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" autoComplete="off" />
        </label>
      </div>
      <button
        type="button"
        disabled={saving}
        onClick={save}
        className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
      >
        {saving ? '保存しています…' : '保存する'}
      </button>

      <details className="rounded-lg border border-gray-200 p-3">
        <summary className="cursor-pointer text-xs text-gray-600">予備：Metaの画面で作った鍵（アクセストークン）を貼ってつなぐ</summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="EAA…"
            className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
            autoComplete="off"
          />
          <button
            type="button"
            disabled={saving || !token}
            onClick={connectWithToken}
            className="rounded-lg border border-gray-300 px-3 py-2 text-xs hover:bg-gray-50 disabled:opacity-50"
          >
            貼ってつなぐ
          </button>
        </div>
      </details>

      {message && <p className="rounded-lg bg-green-50 px-3 py-2 text-xs text-green-800">{message}</p>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
    </div>
  )
}

// ── ルールの作成・編集 ─────────────────────────────

function RuleEditor({
  rule,
  igId,
  accountId,
  onClose,
  onSaved,
}: {
  rule: Rule | null
  igId: string
  accountId: string
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const [form, setForm] = useState(() => (rule ? { ...rule } : { ...EMPTY_RULE }))
  const [keywordsText, setKeywordsText] = useState((rule?.keywords ?? []).join('、'))
  const [repliesText, setRepliesText] = useState((rule ?? EMPTY_RULE).publicReplies.join('\n'))
  const [media, setMedia] = useState<Media[] | null>(null)
  const [mediaError, setMediaError] = useState('')
  const [joinLinks, setJoinLinks] = useState<JoinLink[]>([])
  const [linkBase, setLinkBase] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }))

  useEffect(() => {
    fetchApi<{ success: boolean; data?: { links: JoinLink[]; linkBase: string } }>('/api/intern/join-links?lineAccountId=' + encodeURIComponent(accountId))
      .then((res) => {
        setJoinLinks((res.data?.links ?? []).filter((l) => l.isActive))
        setLinkBase(res.data?.linkBase ?? '')
      })
      .catch(() => {})
  }, [accountId])

  useEffect(() => {
    if (form.mediaScope !== 'selected' || media) return
    sendApi<{ success: boolean; error?: string; data?: Media[] }>(`/api/intern/instagram/accounts/${encodeURIComponent(igId)}/media`)
      .then((res) => {
        if (res.success) setMedia(res.data ?? [])
        else setMediaError(res.error ?? '投稿を読み込めませんでした')
      })
      .catch(() => setMediaError('投稿を読み込めませんでした'))
  }, [form.mediaScope, media, igId])

  const selectedJoin = joinLinks.find((l) => linkBase && form.linkUrl === linkBase + l.refCode)

  // このルール専用の経路リンクを作る（どのリールから何人 LINE に来たかを「友だち追加リンク」で数えられる）
  const createJoinLink = async () => {
    const name = window.prompt('新しい経路リンクの名前', `Instagram自動DM：${form.name || 'リール'}`)
    if (!name?.trim()) return
    const res = await sendApi<{ success: boolean; error?: string; data?: { refCode: string } }>(
      '/api/intern/join-links?lineAccountId=' + encodeURIComponent(accountId),
      { method: 'POST', body: JSON.stringify({ name: name.trim() }) },
    )
    if (!res.success || !res.data) {
      setError(res.error ?? '経路リンクを作れませんでした')
      return
    }
    const created = res.data
    setJoinLinks((ls) => [{ id: created.refCode, refCode: created.refCode, name: name.trim(), isActive: true, friendCount: 0 }, ...ls])
    set('linkUrl', linkBase + created.refCode)
  }

  const save = async () => {
    setSaving(true)
    setError('')
    const body = {
      ...form,
      keywords: keywordsText.split(/[、,，\n]/).map((s) => s.trim()).filter(Boolean),
      publicReplies: repliesText.split('\n').map((s) => s.trim()).filter(Boolean),
    }
    try {
      const res = await sendApi<{ success: boolean; error?: string }>(rule ? `/api/intern/instagram/rules/${rule.id}` : `/api/intern/instagram/accounts/${encodeURIComponent(igId)}/rules`, {
        method: rule ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      })
      if (!res.success) {
        setError(res.error ?? '保存できませんでした')
        return
      }
      await onSaved()
    } finally {
      setSaving(false)
    }
  }

  const previewText = form.dmText.split('{ユーザー名}').join('sample_user').split('{リンク}').join(form.linkUrl)

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4">
      <div className="my-8 w-full max-w-3xl rounded-lg bg-white p-6 shadow-xl">
        <h2 className="mb-5 text-base font-bold text-gray-900">{rule ? 'ルールを直す' : 'ルールを作る'}</h2>
        <div className="grid gap-6 md:grid-cols-[1fr_260px]">
          <div className="space-y-5">
            <label className="block">
              <span className="text-xs font-medium text-gray-700">ルールの名前（自分たち用）</span>
              <input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="例：11月リール「LINE」で特典" className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
            </label>

            <div>
              <span className="text-xs font-medium text-gray-700">どの投稿のコメントに反応するか</span>
              <div className="mt-1 flex gap-4 text-sm">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={form.mediaScope === 'all'} onChange={() => set('mediaScope', 'all')} />
                  すべての投稿・リール
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={form.mediaScope === 'selected'} onChange={() => set('mediaScope', 'selected')} />
                  選んだ投稿だけ
                </label>
              </div>
              {form.mediaScope === 'selected' && (
                <div className="mt-2">
                  {mediaError && <p className="text-xs text-red-600">{mediaError}</p>}
                  {!media && !mediaError && <p className="text-xs text-gray-500">投稿を読み込んでいます…</p>}
                  {media && (
                    <div className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto rounded-md border border-gray-200 p-2 sm:grid-cols-5">
                      {media.map((m) => {
                        const on = form.mediaIds.includes(m.id)
                        const img = m.thumbnail_url || (m.media_type === 'IMAGE' ? m.media_url : undefined)
                        return (
                          <button
                            type="button"
                            key={m.id}
                            title={m.caption ?? ''}
                            onClick={() => set('mediaIds', on ? form.mediaIds.filter((x) => x !== m.id) : [...form.mediaIds, m.id])}
                            className={`relative aspect-[9/16] overflow-hidden rounded border-2 bg-gray-100 text-left ${on ? 'border-green-600' : 'border-transparent'}`}
                          >
                            {img ? <img src={img} alt="" className="h-full w-full object-cover" /> : <span className="p-1 text-[10px] text-gray-500">{m.caption?.slice(0, 30)}</span>}
                            <span className="absolute left-1 top-1 rounded bg-black/60 px-1 text-[10px] text-white">{m.media_product_type === 'REELS' ? 'リール' : '投稿'}</span>
                            {on && <span className="absolute right-1 top-1 rounded-full bg-green-600 px-1.5 text-[10px] text-white">✓</span>}
                            <span className="absolute bottom-0 left-0 right-0 bg-black/50 px-1 text-[10px] text-white">{formatDate(m.timestamp)}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>

            <div>
              <span className="text-xs font-medium text-gray-700">反応するコメント</span>
              <select value={form.matchMode} onChange={(e) => set('matchMode', e.target.value as MatchMode)} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
                <option value="contains">この言葉を含むコメント（おすすめ）</option>
                <option value="exact">この言葉だけのコメント</option>
                <option value="any">すべてのコメント</option>
              </select>
              {form.matchMode !== 'any' && (
                <>
                  <input
                    value={keywordsText}
                    onChange={(e) => setKeywordsText(e.target.value)}
                    placeholder="例：LINE、ライン、ほしい"
                    className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                  <p className="mt-1 text-xs text-gray-500">「、」で区切って複数入れられます。全角・半角、大文字・小文字、カタカナ・ひらがなの違いは気にしません。</p>
                </>
              )}
            </div>

            <label className="block">
              <span className="text-xs font-medium text-gray-700">送る DM の文面</span>
              <textarea value={form.dmText} onChange={(e) => set('dmText', e.target.value)} rows={6} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
              <span className="mt-1 block text-xs text-gray-500">{'{ユーザー名}'} は相手の Instagram の名前に置き換わります。ボタンを使わないときは {'{リンク}'} の位置にリンクが入ります（無ければ最後に付きます）。</span>
            </label>

            <div>
              <span className="text-xs font-medium text-gray-700">案内するリンク（公式LINEの友だち追加）</span>
              <select
                value={selectedJoin ? selectedJoin.refCode : form.linkUrl ? '__custom__' : ''}
                onChange={(e) => {
                  const v = e.target.value
                  if (v === '__new__') createJoinLink()
                  else if (v === '__custom__') set('linkUrl', form.linkUrl || 'https://')
                  else set('linkUrl', v ? linkBase + v : '')
                }}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">リンクを付けない</option>
                {joinLinks.map((l) => (
                  <option key={l.refCode} value={l.refCode}>
                    経路リンク：{l.name}（友だち {l.friendCount}人）
                  </option>
                ))}
                <option value="__new__">＋ このルール専用の経路リンクを作る（おすすめ）</option>
                <option value="__custom__">ほかのリンクを入れる…</option>
              </select>
              {!selectedJoin && form.linkUrl && (
                <input value={form.linkUrl} onChange={(e) => set('linkUrl', e.target.value)} className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
              )}
              <p className="mt-1 text-xs text-gray-500">経路リンクを使うと、このDMから何人が友だち追加したかを「友だち追加リンク」の画面で数えられます。</p>
            </div>

            <label className="block">
              <span className="text-xs font-medium text-gray-700">ボタンの文字（空にするとボタンなし・文の中にリンク）</span>
              <input value={form.buttonLabel} onChange={(e) => set('buttonLabel', e.target.value)} maxLength={20} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
            </label>

            <label className="block">
              <span className="text-xs font-medium text-gray-700">コメント欄への返信（任意・1行に1つ。複数あれば毎回ランダムに選びます）</span>
              <textarea value={repliesText} onChange={(e) => setRepliesText(e.target.value)} rows={3} className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
              <span className="mt-1 block text-xs text-gray-500">DMを送れたときだけ、コメントに返信します。同じ文ばかりだと機械的に見えるので、2〜3通りあると自然です。</span>
            </label>

            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />
              保存したらすぐ動かす（動かした時刻より前のコメントには送りません）
            </label>
          </div>

          <div>
            <p className="mb-2 text-xs font-medium text-gray-700">届くDMの見え方</p>
            <div className="rounded-2xl bg-gray-100 p-3">
              <div className="rounded-2xl bg-white p-3 text-sm whitespace-pre-wrap text-gray-900 shadow-sm">
                {previewText || '（文面を入れてください）'}
                {!form.buttonLabel && form.linkUrl && !form.dmText.includes('{リンク}') && (
                  <>
                    {'\n\n'}
                    <span className="break-all text-blue-600 underline">{form.linkUrl}</span>
                  </>
                )}
              </div>
              {form.buttonLabel && form.linkUrl && (
                <div className="mt-1 rounded-xl bg-white py-2 text-center text-sm font-medium text-blue-600 shadow-sm">{form.buttonLabel}</div>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-500">Instagram の決まりで、DMはコメントから7日以内・1つのコメントに1通だけ送れます。</p>
          </div>
        </div>

        {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={saving} className="rounded-lg bg-gray-100 px-4 py-2 text-sm hover:bg-gray-200 disabled:opacity-50">
            やめる
          </button>
          <button type="button" onClick={save} disabled={saving} className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50">
            {saving ? '保存しています…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── 試し ───────────────────────────────────────────

function TryBox({ igId }: { igId: string }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<{ matched: boolean; ruleName?: string; message?: { text?: string; attachment?: { payload?: { text?: string; buttons?: { title: string; url: string }[] } } }; publicReply?: string | null } | null>(null)

  const run = async () => {
    const res = await sendApi<{ success: boolean; data?: typeof result }>(`/api/intern/instagram/accounts/${encodeURIComponent(igId)}/try`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    })
    setResult(res.data ?? null)
  }

  const msgText = result?.message?.text ?? result?.message?.attachment?.payload?.text
  const button = result?.message?.attachment?.payload?.buttons?.[0]

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <h2 className="text-base font-bold text-gray-900">試してみる</h2>
      <p className="mt-1 text-xs text-gray-500">コメントの例を入れると、どのルールが反応してどんなDMになるかを確かめられます（実際には送りません）。</p>
      <div className="mt-3 flex gap-2">
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && run()} placeholder="例：LINEください！" className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm" />
        <button type="button" onClick={run} className="rounded-lg border border-gray-300 px-4 py-2 text-sm hover:bg-gray-50">
          確かめる
        </button>
      </div>
      {result && (
        <div className="mt-3 rounded-lg bg-gray-50 p-3 text-sm">
          {result.matched ? (
            <>
              <p className="text-xs text-gray-500">反応するルール：<b className="text-gray-900">{result.ruleName}</b>（全部の投稿が対象のルールで判定）</p>
              <p className="mt-2 whitespace-pre-wrap text-gray-900">{msgText}</p>
              {button && <p className="mt-1 text-xs text-blue-600">［{button.title}］→ {button.url}</p>}
              {result.publicReply && <p className="mt-2 text-xs text-gray-500">コメント欄への返信：{result.publicReply}</p>}
            </>
          ) : (
            <p className="text-gray-600">どのルールにも当てはまりません（DMは送りません）。止めているルールは数えていません。</p>
          )}
        </div>
      )}
    </section>
  )
}

// ── 記録 ───────────────────────────────────────────

function LogTable({ log, rules, onReload }: { log: LogRow[]; rules: Rule[]; onReload: () => Promise<void> }) {
  const ruleName = useMemo(() => new Map(rules.map((r) => [r.id, r.name])), [rules])
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-5">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-gray-900">最近の反応</h2>
          <p className="mt-1 text-xs text-gray-500">ルールに当てはまったコメントだけを新しい順に100件まで出します。</p>
        </div>
        <button type="button" onClick={onReload} className="shrink-0 whitespace-nowrap rounded-md border border-gray-300 px-3 py-1.5 text-xs hover:bg-gray-50">
          最新にする
        </button>
      </div>
      {log.length === 0 ? (
        <p className="rounded-lg bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">まだありません。</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="border-b border-gray-200 text-gray-500">
              <tr>
                <th className="py-2 pr-3 font-medium">日時</th>
                <th className="py-2 pr-3 font-medium">相手</th>
                <th className="py-2 pr-3 font-medium">コメント</th>
                <th className="py-2 pr-3 font-medium">ルール</th>
                <th className="py-2 pr-3 font-medium">結果</th>
              </tr>
            </thead>
            <tbody>
              {log.map((row) => {
                const st = STATUS_LABEL[row.status] ?? { label: row.status, tone: 'bg-gray-100 text-gray-600' }
                return (
                  <tr key={row.commentId} className="border-b border-gray-100 align-top">
                    <td className="whitespace-nowrap py-2 pr-3 text-gray-500">{formatDate(row.createdAt)}</td>
                    <td className="py-2 pr-3 text-gray-900">{row.username ? `@${row.username}` : '—'}</td>
                    <td className="max-w-[16rem] py-2 pr-3 text-gray-700">{row.text}</td>
                    <td className="py-2 pr-3 text-gray-700">{row.ruleId ? ruleName.get(row.ruleId) ?? '（消したルール）' : '—'}</td>
                    <td className="py-2 pr-3">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 ${st.tone}`}>{st.label}</span>
                      {row.detail && <p className="mt-1 max-w-[18rem] text-[11px] text-gray-500">{row.detail}</p>}
                      {row.publicReplyStatus && row.publicReplyStatus !== 'sent' && <p className="mt-1 text-[11px] text-red-500">コメント返信：{row.publicReplyStatus}</p>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
