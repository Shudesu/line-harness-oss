'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { eventsApi, type EventDetail, type EventSlot } from '@/lib/api'
import { getApiBase } from '@/lib/api-base'
import ImageUploader from '@/components/shared/image-uploader'
import OgEditor from '@/components/shared/og-editor'
import { useAccount } from '@/contexts/account-context'
import { generateBulkSlots, type BulkSlotInput } from './bulk-slot-generator'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input, InputArea } from '@cloudflare/kumo/components/input'
import { Select } from '@cloudflare/kumo/components/select'
import { Table } from '@cloudflare/kumo/components/table'

type Tab = 'overview' | 'slots' | 'publish'

const TABS: Array<{ key: Tab; label: string; saveLabel: string; sub: string }> = [
  { key: 'overview', label: '1. 概要', saveLabel: '概要を保存', sub: 'イベント名・場所・詳細を入力' },
  { key: 'slots', label: '2. 予約枠', saveLabel: '', sub: '友だちが選べる日時を追加' },
  { key: 'publish', label: '3. 公開設定', saveLabel: '公開設定を保存', sub: '承認制・リマインダ・公開' },
]

const DEFAULT_DRAFT: EventDetail = {
  id: '',
  name: '',
  venue_name: null,
  venue_url: null,
  image_url: null,
  description: null,
  description_centered: 0,
  max_bookings_per_friend: null,
  requires_approval: 0,
  cancel_deadline_hours_before: null,
  reminder_day_before_enabled: 1,
  reminder_hours_before: null,
  is_published: 0,
  sort_order: 0,
  confirmation_message_extra: null,
  reminder_message_extra: null,
  og_title: null,
  og_description: null,
  og_image_url: null,
}

export interface EventFormProps {
  accountId: string
  eventId: string | null
}

function jstNow(): Date {
  return new Date(Date.now())
}

function formatJpDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  })
}

export default function EventForm({ accountId, eventId }: EventFormProps) {
  const router = useRouter()
  const { selectedAccount, accounts } = useAccount()
  const [tab, setTab] = useState<Tab>('overview')
  const [draft, setDraft] = useState<EventDetail>(DEFAULT_DRAFT)
  const [slots, setSlots] = useState<EventSlot[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copiedValue, setCopiedValue] = useState<string | null>(null)

  async function copyValue(v: string) {
    try {
      await navigator.clipboard.writeText(v)
      setCopiedValue(v)
      setTimeout(() => setCopiedValue(null), 2000)
    } catch {
      window.prompt('コピーしてください:', v)
    }
  }

  const liffId = selectedAccount?.liffId ?? null
  // single mode の公開 URL。Worker `/o` は ref 解決・追跡なしで liffId を直接
  // 受けるため、LINE 内配信も SNS 配信もこの 1 本で完結する。`liff.line.me`
  // 直貼りは OpenChat / IG DM 等で削除されるが、`/o` 経由なら通る。
  const workerBase = getApiBase() ?? ''
  const liffUrl = eventId && liffId && workerBase
    ? `${workerBase}/o?liffId=${encodeURIComponent(liffId)}&page=event&id=${encodeURIComponent(eventId)}`
    : null

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!eventId) {
        setLoading(false)
        return
      }
      try {
        const [ev, slotsRes] = await Promise.all([
          eventsApi.getEvent(accountId, eventId),
          eventsApi.listSlots(accountId, eventId),
        ])
        if (cancelled) return
        setDraft(ev)
        setSlots(slotsRes.items)
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [accountId, eventId])

  function update<K extends keyof EventDetail>(key: K, value: EventDetail[K]) {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  function flashToast(msg: string) {
    setToast(msg)
    setTimeout(() => setToast(null), 2200)
  }

  async function save(nextTab?: Tab) {
    setSaving(true)
    setError(null)
    try {
      if (!draft.name.trim()) throw new Error('イベント名は必須です')
      if (draft.name.length > 255) throw new Error('イベント名は255字以内で入力してください')
      if (draft.description && draft.description.length > 20000) {
        throw new Error('詳細は20000字以内で入力してください')
      }
      const targetType = draft.target_type ?? 'single'
      let accountIdsArr: string[] = Array.isArray(draft.account_ids)
        ? draft.account_ids
        : typeof draft.account_ids === 'string'
          ? (() => { try { return JSON.parse(draft.account_ids) as string[] } catch { return [] } })()
          : []
      // 現在ログイン中のアカウントは常に含める。保存後 redirect 先 (この
      // accountId scope) で 404 にならないための保証。チェックボックス側でも
      // 外せないが、stale draft 等の保険として save 時にも強制注入する。
      if (targetType === 'multi-account-dedup' && accountId && !accountIdsArr.includes(accountId)) {
        accountIdsArr = [accountId, ...accountIdsArr]
      }
      if (targetType === 'multi-account-dedup' && accountIdsArr.length === 0) {
        throw new Error('複数アカウント横断の場合は対象アカを 1 件以上選択してください')
      }
      const payload: Partial<EventDetail> = {
        name: draft.name,
        venue_name: draft.venue_name,
        venue_url: draft.venue_url,
        image_url: draft.image_url,
        description: draft.description,
        description_centered: draft.description_centered,
        max_bookings_per_friend: draft.max_bookings_per_friend,
        requires_approval: draft.requires_approval,
        cancel_deadline_hours_before: draft.cancel_deadline_hours_before,
        reminder_day_before_enabled: draft.reminder_day_before_enabled,
        reminder_hours_before: draft.reminder_hours_before,
        is_published: draft.is_published,
        sort_order: draft.sort_order,
        confirmation_message_extra: draft.confirmation_message_extra,
        reminder_message_extra: draft.reminder_message_extra,
        og_title: draft.og_title,
        og_description: draft.og_description,
        og_image_url: draft.og_image_url,
        target_type: targetType,
        // Worker は account_ids を配列で受け取って内部で JSON.stringify するので、
        // ここでは配列のまま送る (Partial<EventDetail> の union 型を許容)
        account_ids: targetType === 'multi-account-dedup'
          ? (accountIdsArr as unknown as EventDetail['account_ids'])
          : null,
      }
      if (eventId) {
        const updated = await eventsApi.updateEvent(accountId, eventId, payload)
        setDraft(updated)
        flashToast('保存しました')
        if (nextTab) setTab(nextTab)
      } else {
        const created = await eventsApi.createEvent(accountId, payload)
        flashToast('イベントを作成しました。続けて予約枠を追加してください。')
        router.replace(`/events/edit?id=${created.id}`)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  async function copyLiffUrl() {
    if (!liffUrl) return
    try {
      await navigator.clipboard.writeText(liffUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      window.prompt('コピーしてください:', liffUrl)
    }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 text-center text-gray-500">
          読み込み中...
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      {/* breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm">
        <Link href="/events" className="text-blue-600 hover:underline">イベント一覧</Link>
        <span className="text-gray-400">/</span>
        <span className="text-gray-700">{eventId ? draft.name || 'イベント編集' : '新規イベント'}</span>
      </div>

      {/* page header */}
      <div className="mb-4 flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            {eventId ? draft.name || 'イベント編集' : '新規イベント作成'}
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {eventId ? 'タブで各項目を編集できます' : 'まず「概要」を保存するとイベントが作成されます'}
          </p>
        </div>
        {eventId && (
          <Link
            href={`/events/bookings?id=${eventId}`}
            className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            予約を確認
          </Link>
        )}
      </div>

      {/* toast */}
      {toast && <Banner variant="secondary" title="保存しました" description={toast} className="mb-3" />}
      {error && <Banner variant="error" title="イベント操作に失敗しました" description={error} className="mb-3" />}

      {/* LIFF URL box(es) */}
      {eventId && draft.is_published === 1 && (() => {
        const targetType = draft.target_type ?? 'single'
        const accountIdsArr: string[] = Array.isArray(draft.account_ids)
          ? draft.account_ids
          : typeof draft.account_ids === 'string'
            ? (() => { try { return JSON.parse(draft.account_ids) as string[] } catch { return [] } })()
            : []

        if (targetType === 'multi-account-dedup') {
          const templateUrl = `https://liff.line.me/{{liff_id}}/?page=event&id=${eventId}&liffId={{liff_id}}`
          const targetAccounts = accounts.filter((a) => accountIdsArr.includes(a.id))
          return (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 space-y-4">
              <div>
                <div className="text-sm font-medium text-blue-900 mb-2">broadcast 用テンプレ URL</div>
                <div className="flex gap-2 items-center">
                  <Input
                    aria-label="broadcast 用テンプレ URL"
                    readOnly
                    value={templateUrl}
                    onFocus={(e) => e.currentTarget.select()}
                    className="flex-1 text-xs font-mono"
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="primary"
                    onClick={() => copyValue(templateUrl)}
                  >
                    {copiedValue === templateUrl ? 'コピー済' : 'コピー'}
                  </Button>
                </div>
                <p className="text-xs text-blue-700 mt-2">
                  broadcast 編集で「リンクするイベント」から選ぶと自動挿入。
                  {'{{liff_id}}'} は配信時に各友だちのアカに対応した値に置換されます。
                </p>
              </div>
              <div>
                <div className="text-sm font-medium text-blue-900 mb-2">各アカ固定 URL (QR・LP 直貼り用)</div>
                <div className="space-y-1.5">
                  {targetAccounts.length === 0 && (
                    <div className="text-xs text-amber-700">対象アカが選択されていません</div>
                  )}
                  {targetAccounts.map((a) => {
                    const acct = a as unknown as { liffId?: string | null; name: string; country: string | null }
                    if (!acct.liffId) {
                      return (
                        <div key={a.id} className="text-xs text-amber-700">
                          {acct.country ? acct.country + ' ' : ''}{acct.name}: LIFF ID 未設定
                        </div>
                      )
                    }
                    const url = `https://liff.line.me/${acct.liffId}/?page=event&id=${eventId}&liffId=${acct.liffId}`
                    return (
                      <div key={a.id} className="flex items-center gap-2">
                        <span className="text-xs text-gray-600 min-w-[80px] truncate">
                          {acct.country ? acct.country + ' ' : ''}{acct.name}
                        </span>
                        <Input
                          aria-label={`${acct.name} 固定URL`}
                          readOnly
                          value={url}
                          onFocus={(e) => e.currentTarget.select()}
                          className="flex-1 text-xs font-mono"
                        />
                        <Button
                          size="xs"
                          variant="primary"
                          onClick={() => copyValue(url)}
                        >
                          {copiedValue === url ? '✓' : 'コピー'}
                        </Button>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        }

        // single 用 (既存と同じ表示)
        if (liffUrl) {
          return (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
              <div className="text-sm font-medium text-blue-900 mb-2">予約 URL（友だちに案内する）</div>
              <div className="flex gap-2 items-center">
                <Input
                  aria-label="予約 URL"
                  readOnly
                  value={liffUrl}
                  onFocus={(e) => e.currentTarget.select()}
                  className="flex-1 text-xs font-mono"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="primary"
                  onClick={() => copyValue(liffUrl)}
                >
                  {copiedValue === liffUrl ? 'コピー済' : 'コピー'}
                </Button>
              </div>
              <p className="text-xs text-blue-700 mt-2">
                LINE / OpenChat / IG DM どこでも貼れます。受信者がタップすると LINE で予約画面が開きます。
              </p>
            </div>
          )
        }
        return (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-900">
            LIFF ID が未設定のため予約 URL を生成できません。LINE アカウント設定で LIFF ID を登録してください。
          </div>
        )
      })()}
      {eventId && draft.is_published === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-900">
          現在「下書き」状態です。公開設定タブで「公開する」を ON にすると友だち向けの予約 URL が表示されます。
        </div>
      )}

      {/* main card */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        {/* tab nav */}
        <div className="flex border-b border-gray-200">
          {TABS.map((t) => {
            const active = tab === t.key
            const disabled = t.key !== 'overview' && !eventId
            return (
              <Button
                key={t.key}
                variant={active ? 'primary' : 'ghost'}
                disabled={disabled}
                onClick={() => !disabled && setTab(t.key)}
                title={disabled ? 'まず「概要」を保存してください' : undefined}
                className="h-auto flex-1 py-3"
              >
                <div>{t.label}</div>
                <div className="text-xs font-normal mt-0.5 opacity-80">{t.sub}</div>
              </Button>
            )
          })}
        </div>

        {/* tab body */}
        <div className="p-6">
          {tab === 'overview' && <OverviewTab draft={draft} update={update} accounts={accounts} currentAccountId={accountId} />}
          {tab === 'slots' && (
            <SlotsTab
              accountId={accountId}
              eventId={eventId}
              slots={slots}
              setSlots={setSlots}
            />
          )}
          {tab === 'publish' && <PublishTab draft={draft} update={update} />}
        </div>

        {/* tab footer */}
        {tab !== 'slots' && (
          <div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
            <div className="text-xs text-gray-500">
              {tab === 'overview' && !eventId && '保存するとイベントが作成され、予約枠タブに進みます'}
              {tab === 'overview' && eventId && '変更を「概要を保存」で確定します'}
              {tab === 'publish' && '「公開する」ON で友だちに予約 URL を案内できます'}
            </div>
            <div className="flex gap-2">
              {tab === 'overview' && eventId && (
                <Button
                  variant="secondary"
                  onClick={() => save('slots')}
                  disabled={saving}
                >
                  保存して次へ →
                </Button>
              )}
              <Button
                variant="primary"
                onClick={() => save()}
                disabled={saving}
                loading={saving}
              >
                {tab === 'overview' && !eventId ? 'イベントを作成' : TABS.find((x) => x.key === tab)?.saveLabel ?? '保存'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------
// Tab 1: Overview
// ----------------------------------------------------------------

function OverviewTab({
  draft,
  update,
  accounts,
  currentAccountId,
}: {
  draft: EventDetail
  update: <K extends keyof EventDetail>(k: K, v: EventDetail[K]) => void
  accounts: Array<{ id: string; name: string; country: string | null; isActive: boolean }>
  currentAccountId: string
}) {
  const descLen = (draft.description ?? '').length
  const targetType = draft.target_type ?? 'single'
  const accountIds: string[] = Array.isArray(draft.account_ids)
    ? draft.account_ids
    : typeof draft.account_ids === 'string'
      ? (() => { try { return JSON.parse(draft.account_ids) as string[] } catch { return [] } })()
      : []
  const activeAccounts = accounts.filter((a) => a.isActive)
  return (
    <div className="space-y-5">
      <Input
          label="イベント名（必須）"
          type="text"
          value={draft.name}
          onChange={(e) => update('name', e.target.value)}
          maxLength={255}
          placeholder="例: 第1回 AAA 説明会"
      />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label="開催場所"
            type="text"
            value={draft.venue_name ?? ''}
            onChange={(e) => update('venue_name', e.target.value || null)}
            placeholder="例: 渋谷ベース 3F"
          />
          <Input
            label="会場 URL"
            type="url"
            value={draft.venue_url ?? ''}
            onChange={(e) => update('venue_url', e.target.value || null)}
            placeholder="https://..."
          />
      </div>
      <div>
        <ImageUploader
          mode="url"
          value={draft.image_url ? { mode: 'url', url: draft.image_url } : null}
          onChange={(v) => update('image_url', v?.mode === 'url' ? v.url : null)}
          label="イベント画像"
        />
      </div>
      <div>
        <label className="flex justify-between items-center text-sm font-medium text-gray-700 mb-1.5">
          <span>イベント詳細</span>
          <span className={`text-xs ${descLen > 20000 ? 'text-red-600' : 'text-gray-500'}`}>
            {descLen.toLocaleString()} / 20,000
          </span>
        </label>
        <InputArea
          label="イベント詳細"
          value={draft.description ?? ''}
          onValueChange={(value) => update('description', value || null)}
          minRows={8}
          maxRows={16}
          autoResize
          placeholder="開催趣旨、注意事項、持ち物などを記載..."
        />
        <div className="mt-2">
          <Checkbox
            label="詳細を中央揃えで表示"
            checked={draft.description_centered === 1}
            onCheckedChange={(checked) => update('description_centered', checked ? 1 : 0)}
          />
        </div>
      </div>
        <Select
          label="1 人あたり予約回数"
          value={String(draft.max_bookings_per_friend ?? 'unlimited')}
          onValueChange={(value) =>
            update(
              'max_bookings_per_friend',
              value === 'unlimited' ? null : Number(value),
            )
          }
          items={{ unlimited: '制限なし', '1': '1 回まで', '2': '2 回まで', '3': '3 回まで', '5': '5 回まで' }}
          className="w-48"
        />

      {/* 公開対象 */}
      <div className="border-t border-gray-200 pt-5">
        <div className="text-sm font-medium text-gray-700 mb-2">公開対象</div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <Button
            type="button"
            variant={targetType === 'single' ? 'primary' : 'secondary'}
            onClick={() => update('target_type', 'single')}
            className="h-auto justify-start p-3 text-left"
          >
            <div className="text-sm font-bold">単一アカウント</div>
            <div className="text-xs text-gray-600">1 つの LINE アカで運用</div>
          </Button>
          <Button
            type="button"
            variant={targetType === 'multi-account-dedup' ? 'primary' : 'secondary'}
            onClick={() => {
              update('target_type', 'multi-account-dedup')
              // single → multi 切替時: 編集中の admin account を account_ids[0]
              // sentinel として自動セット。active 一覧の先頭ではなく実際に
              // 編集している admin の account にしないと、保存後にその admin
              // が自分のイベントを見られなくなる (404)。
              if (accountIds.length === 0) {
                const seed = currentAccountId || activeAccounts[0]?.id || ''
                if (seed) {
                  update('account_ids', [seed] as unknown as EventDetail['account_ids'])
                }
              }
            }}
            className="h-auto justify-start p-3 text-left"
          >
            <div className="text-sm font-bold">複数アカウント横断</div>
            <div className="text-xs text-gray-600">重複なし配信に対応</div>
          </Button>
        </div>

        {targetType === 'multi-account-dedup' && (
          <div className="space-y-1.5">
            <div className="text-xs text-gray-600">対象アカ（重複なし配信）</div>
            {activeAccounts.length === 0 && (
              <div className="text-sm text-gray-500 italic p-2">アクティブなアカウントがありません</div>
            )}
            {activeAccounts.map((a) => {
              // 現在ログイン中のアカウントは外せない (外すと保存後 redirect が
              // 即 404 になる)。target_type 切替時に sentinel seed されている
              // ことの保護も兼ねる。
              const isCurrent = a.id === currentAccountId
              const checked = accountIds.includes(a.id) || isCurrent
              return (
                <div
                  key={a.id}
                  className={`flex items-center gap-2 p-2 border border-gray-200 rounded-lg ${isCurrent ? 'opacity-90 bg-gray-50 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-50'}`}
                  title={isCurrent ? '現在ログイン中のアカウントは必須です' : undefined}
                >
                  <Checkbox
                    label={`${a.country ? `${a.country} ` : ''}${a.name}${isCurrent ? '（現アカ・必須）' : ''}`}
                    checked={checked}
                    disabled={isCurrent}
                    onCheckedChange={(nextChecked) => {
                      if (isCurrent) return
                      const next = nextChecked
                        ? [...accountIds, a.id]
                        : accountIds.filter((x) => x !== a.id)
                      update('account_ids', next as unknown as EventDetail['account_ids'])
                    }}
                  />
                </div>
              )
            })}
            <div className="text-xs text-gray-500 mt-1">{accountIds.length} 件選択中</div>
          </div>
        )}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------
// Tab 2: Slots
// ----------------------------------------------------------------

function SlotsTab({
  accountId,
  eventId,
  slots,
  setSlots,
}: {
  accountId: string
  eventId: string | null
  slots: EventSlot[]
  setSlots: (s: EventSlot[]) => void
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [showAdd, setShowAdd] = useState(false)
  const [showBulk, setShowBulk] = useState(false)
  const [slotToDelete, setSlotToDelete] = useState<EventSlot | null>(null)

  if (!eventId) {
    return (
      <div className="text-center py-8 text-gray-500 text-sm">
        まず「概要」タブで保存してから予約枠を追加してください。
      </div>
    )
  }

  async function refresh() {
    if (!eventId) return
    const res = await eventsApi.listSlots(accountId, eventId)
    setSlots(res.items)
  }

  async function deleteSlot(slotId: string) {
    if (!eventId) return
    setBusy(true)
    setErr(null)
    try {
      await eventsApi.deleteSlot(accountId, eventId, slotId)
      await refresh()
      setSlotToDelete(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  async function toggleActive(s: EventSlot) {
    if (!eventId) return
    setBusy(true)
    try {
      await eventsApi.updateSlot(accountId, eventId, s.id, { is_active: s.is_active === 1 ? 0 : 1 })
      await refresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-4 items-center justify-between">
        <div className="text-sm text-gray-600">{slots.length} 件の予約枠</div>
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowAdd(true)}
          >
            ＋ 枠を追加
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={() => setShowBulk(true)}
          >
            📅 一括追加
          </Button>
        </div>
      </div>
      {err && <Banner variant="error" title="予約枠を更新できません" description={err} className="mb-3" />}
      {slots.length === 0 ? (
        <Empty title="予約枠がありません" description="「＋ 枠を追加」または「📅 一括追加」から作成してください。" />
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-lg">
          <Table className="w-full text-sm">
            <Table.Header>
              <Table.Row>
                <Table.Head>日時</Table.Head>
                <Table.Head>定員</Table.Head>
                <Table.Head>予約数</Table.Head>
                <Table.Head>状態</Table.Head>
                <Table.Head className="text-right">操作</Table.Head>
              </Table.Row>
            </Table.Header>
            <Table.Body>
              {slots.map((s) => (
                <Table.Row key={s.id}>
                  <Table.Cell className="text-kumo-strong">
                    {formatJpDateTime(s.starts_at)} 〜 {formatJpDateTime(s.ends_at).slice(-5)}
                  </Table.Cell>
                  <Table.Cell>{s.capacity ?? '無制限'}</Table.Cell>
                  <Table.Cell>{s.active_count ?? 0}</Table.Cell>
                  <Table.Cell>
                    <Button
                      size="xs"
                      variant={s.is_active === 1 ? 'primary' : 'secondary'}
                      onClick={() => toggleActive(s)}
                      disabled={busy}
                    >
                      {s.is_active === 1 ? '有効' : '停止'}
                    </Button>
                  </Table.Cell>
                  <Table.Cell className="text-right">
                    <Button
                      size="xs"
                      variant="secondary-destructive"
                      onClick={() => setSlotToDelete(s)}
                      disabled={busy || (s.active_count ?? 0) > 0}
                      title={(s.active_count ?? 0) > 0 ? '既存予約があるため削除できません' : '削除'}
                    >
                      削除
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
            </Table.Body>
          </Table>
        </div>
      )}

      {showAdd && (
        <AddSlotDialog
          onClose={() => setShowAdd(false)}
          onSubmit={async (s) => {
            await eventsApi.createSlots(accountId, eventId, [s])
            await refresh()
            setShowAdd(false)
          }}
        />
      )}
      {showBulk && (
        <BulkSlotDialog
          onClose={() => setShowBulk(false)}
          onSubmit={async (input) => {
            const generated = generateBulkSlots(input)
            if (generated.length === 0) {
              setErr('生成される枠が0件でした。条件を確認してください。')
              return
            }
            await eventsApi.createSlots(accountId, eventId, generated)
            await refresh()
            setShowBulk(false)
          }}
        />
      )}
      <Dialog.Root open={slotToDelete !== null} onOpenChange={(open) => { if (!open) setSlotToDelete(null) }} role="alertdialog">
        <Dialog size="base" className="p-6">
          <Dialog.Title className="text-lg font-semibold text-kumo-strong">予約枠を削除しますか？</Dialog.Title>
          <Dialog.Description className="mt-2 text-sm text-kumo-subtle">この操作は取り消せません。既存予約がある枠は削除できません。</Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close render={(props) => <Button {...props} variant="secondary" disabled={busy}>キャンセル</Button>} />
            <Button variant="destructive" loading={busy} disabled={busy} onClick={() => slotToDelete && void deleteSlot(slotToDelete.id)}>削除</Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </div>
  )
}

function AddSlotDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (s: { starts_at: string; ends_at: string; capacity: number | null }) => Promise<void>
}) {
  const todayJst = new Date(jstNow().getTime() + 9 * 3600_000).toISOString().slice(0, 10)
  const [date, setDate] = useState(todayJst)
  const [startTime, setStartTime] = useState('10:00')
  const [endTime, setEndTime] = useState('12:00')
  const [capacity, setCapacity] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      const s = jstHHMMToUtcIso(date, startTime)
      const e = jstHHMMToUtcIso(date, endTime)
      if (s >= e) throw new Error('開始時刻 < 終了時刻')
      const cap = capacity === '' ? null : Number(capacity)
      if (cap != null && (!Number.isInteger(cap) || cap < 1)) throw new Error('定員は1以上の整数')
      await onSubmit({ starts_at: s, ends_at: e, capacity: cap })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <Dialog size="base" className="p-6">
        <Dialog.Title className="text-lg font-bold text-kumo-strong">予約枠を追加</Dialog.Title>
        <Dialog.Description className="mt-1 text-sm text-kumo-subtle">日時と定員を設定します。</Dialog.Description>
        {err && <Banner variant="error" title="予約枠を追加できません" description={err} className="mt-3" />}
        <div className="space-y-3">
            <Input
              label="日付（JST）"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          <div className="grid grid-cols-2 gap-3">
              <Input
                label="開始"
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
              />
              <Input
                label="終了"
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
              />
          </div>
            <Input
              label="定員（空欄=無制限）"
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Dialog.Close render={(props) => <Button {...props} variant="secondary" disabled={busy}>キャンセル</Button>} />
          <Button
            variant="primary"
            onClick={submit}
            disabled={busy}
            loading={busy}
          >
            追加
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}

function BulkSlotDialog({
  onClose,
  onSubmit,
}: {
  onClose: () => void
  onSubmit: (input: BulkSlotInput) => Promise<void>
}) {
  const todayJst = new Date(jstNow().getTime() + 9 * 3600_000).toISOString().slice(0, 10)
  const [start, setStart] = useState(todayJst)
  const [end, setEnd] = useState(todayJst)
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5])
  const [patterns, setPatterns] = useState([{ start: '10:00', end: '11:00' }])
  const [capacity, setCapacity] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function toggleWeekday(d: number) {
    setWeekdays((ws) => (ws.includes(d) ? ws.filter((x) => x !== d) : [...ws, d]))
  }

  async function submit() {
    setBusy(true)
    setErr(null)
    try {
      const cap = capacity === '' ? null : Number(capacity)
      if (cap != null && (!Number.isInteger(cap) || cap < 1)) throw new Error('定員は1以上の整数')
      await onSubmit({
        start_date: start,
        end_date: end,
        weekdays,
        time_patterns: patterns.filter((p) => p.start && p.end && p.start < p.end),
        capacity: cap,
      })
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <Dialog size="base" className="p-6">
        <Dialog.Title className="text-lg font-bold text-kumo-strong">予約枠の一括追加</Dialog.Title>
        <Dialog.Description className="mt-1 text-sm text-kumo-subtle">期間、曜日、時刻パターンから予約枠を生成します。</Dialog.Description>
        {err && <Banner variant="error" title="予約枠を生成できません" description={err} className="mt-3" />}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Input label="開始日" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
            <Input label="終了日" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </div>
          <div>
            <span className="text-sm font-medium text-gray-700 block mb-1.5">曜日</span>
            <div className="flex gap-1.5">
              {['日', '月', '火', '水', '木', '金', '土'].map((d, i) => (
                <Button
                  key={i}
                  type="button"
                  size="xs"
                  variant={weekdays.includes(i) ? 'primary' : 'secondary'}
                  onClick={() => toggleWeekday(i)}
                  className="flex-1"
                >
                  {d}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <span className="text-sm font-medium text-gray-700 block mb-1.5">時刻パターン</span>
            {patterns.map((p, i) => (
              <div key={i} className="flex gap-2 mb-1.5 items-center">
                <Input
                  aria-label={`時刻パターン${i + 1} 開始`}
                  type="time"
                  value={p.start}
                  onChange={(e) => setPatterns((ps) => ps.map((x, j) => (j === i ? { ...x, start: e.target.value } : x)))}
                  className="flex-1"
                />
                <span className="text-gray-500">〜</span>
                <Input
                  aria-label={`時刻パターン${i + 1} 終了`}
                  type="time"
                  value={p.end}
                  onChange={(e) => setPatterns((ps) => ps.map((x, j) => (j === i ? { ...x, end: e.target.value } : x)))}
                  className="flex-1"
                />
                {patterns.length > 1 && (
                  <Button
                    type="button"
                    size="xs"
                    shape="square"
                    title="時刻パターンを削除"
                    variant="secondary-destructive"
                    onClick={() => setPatterns((ps) => ps.filter((_, j) => j !== i))}
                  >
                    ×
                  </Button>
                )}
              </div>
            ))}
            <Button
              type="button"
              size="xs"
              variant="ghost"
              onClick={() => setPatterns((ps) => [...ps, { start: '14:00', end: '15:00' }])}
            >
              ＋ パターン追加
            </Button>
          </div>
            <Input
              label="定員（各枠共通・空欄=無制限）"
              type="number"
              min={1}
              value={capacity}
              onChange={(e) => setCapacity(e.target.value)}
            />
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Dialog.Close render={(props) => <Button {...props} variant="secondary" disabled={busy}>キャンセル</Button>} />
          <Button
            variant="primary"
            onClick={submit}
            disabled={busy}
            loading={busy}
          >
            生成
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}

function jstHHMMToUtcIso(date: string, hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const totalMin = h * 60 + m - 9 * 60
  const [y, mo, d] = date.split('-').map(Number)
  const t = Date.UTC(y, mo - 1, d) + totalMin * 60_000
  return new Date(t).toISOString()
}

// ----------------------------------------------------------------
// Tab 3: Publish settings
// ----------------------------------------------------------------

function PublishTab({
  draft,
  update,
}: {
  draft: EventDetail
  update: <K extends keyof EventDetail>(k: K, v: EventDetail[K]) => void
}) {
  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-gray-200 p-3">
        <Checkbox
          label="承認制"
          checked={draft.requires_approval === 1}
          onCheckedChange={(checked) => update('requires_approval', checked ? 1 : 0)}
        />
          <div className="ml-6 text-xs text-gray-500 mt-0.5">
            ON: 友だちが予約しても運営が「承認」するまで未確定<br />
            OFF: 定員空きがあれば即時確定
          </div>
      </div>

        <Select
          label="キャンセル期限（友だち側）"
          value={String(draft.cancel_deadline_hours_before ?? 'disabled')}
          onValueChange={(value) =>
            update(
              'cancel_deadline_hours_before',
              value === 'disabled' ? null : Number(value),
            )
          }
          items={{ disabled: '不可（運営に LINE 連絡）', '0': '直前まで可', '6': '6 時間前まで', '12': '12 時間前まで', '24': '24 時間前まで', '48': '48 時間前まで' }}
          className="w-72"
        />

      <div className="rounded-lg border border-gray-200 p-3">
        <Checkbox
          label="前日リマインダ"
          checked={draft.reminder_day_before_enabled === 1}
          onCheckedChange={(checked) => update('reminder_day_before_enabled', checked ? 1 : 0)}
        />
        <div className="ml-6 text-xs text-gray-500 mt-0.5">前日 18:00 JST に LINE で通知</div>
      </div>

        <Select
          label="開始 N 時間前リマインダ"
          value={String(draft.reminder_hours_before ?? 'off')}
          onValueChange={(value) =>
            update('reminder_hours_before', value === 'off' ? null : Number(value))
          }
          items={{ off: '送信しない', '1': '1 時間前', '2': '2 時間前', '3': '3 時間前', '6': '6 時間前', '24': '24 時間前' }}
          className="w-52"
        />

      {/* 予約者向けカスタムメッセージ追記 */}
      <div className="border-t border-gray-200 pt-5 space-y-4">
        <div>
          <div className="text-sm font-medium text-gray-900 mb-1">予約者向けカスタムメッセージ</div>
          <p className="text-xs text-gray-500">
            予約者だけに届く LINE 通知の末尾に追加されます（Zoom URL など）。空欄ならデフォルト文言のみ。
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            ✉️ 予約確定メッセージへの追記
            <span className="ml-2 text-xs text-gray-400">
              {(draft.confirmation_message_extra ?? '').length} / 2,000
            </span>
          </label>
          <InputArea
            label="予約確定メッセージへの追記"
            value={draft.confirmation_message_extra ?? ''}
            onValueChange={(value) => update('confirmation_message_extra', value || null)}
            minRows={3}
            maxRows={8}
            autoResize
            maxLength={2000}
            placeholder="例: 当日の Zoom URL: https://us02web.zoom.us/j/..."
          />
          <p className="text-xs text-gray-500 mt-1">確定通知（即時 / 後追い承認）の末尾に追加</p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            🔔 リマインドメッセージへの追記
            <span className="ml-2 text-xs text-gray-400">
              {(draft.reminder_message_extra ?? '').length} / 2,000
            </span>
          </label>
          <InputArea
            label="リマインドメッセージへの追記"
            value={draft.reminder_message_extra ?? ''}
            onValueChange={(value) => update('reminder_message_extra', value || null)}
            minRows={3}
            maxRows={8}
            autoResize
            maxLength={2000}
            placeholder="例: 開始 10 分前に同じ URL からご入室ください"
          />
          <p className="text-xs text-gray-500 mt-1">前日 / N 時間前のリマインド末尾に追加</p>
        </div>
      </div>

      <hr className="border-gray-200" />

      <div>
        <div className="text-sm font-medium text-gray-700 mb-2">公開状態</div>
        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            variant={draft.is_published === 0 ? 'primary' : 'secondary'}
            onClick={() => update('is_published', 0)}
            className="h-auto justify-start p-3 text-left"
          >
            <div className="text-sm font-bold text-gray-900">下書き</div>
            <div className="text-xs text-gray-600 mt-0.5">友だちには見えない</div>
          </Button>
          <Button
            type="button"
            variant={draft.is_published === 1 ? 'primary' : 'secondary'}
            onClick={() => update('is_published', 1)}
            className="h-auto justify-start p-3 text-left"
          >
            <div className="text-sm font-bold text-gray-900">公開する</div>
            <div className="text-xs text-gray-600 mt-0.5">予約 URL が有効になる</div>
          </Button>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          {draft.is_published === 1
            ? '✓ 保存後、友だちに「予約 URL」を案内できます。'
            : '保存しても友だちには表示されません。'}
        </p>
      </div>

      <OgEditor
        value={{
          ogTitle: draft.og_title,
          ogDescription: draft.og_description,
          ogImageUrl: draft.og_image_url,
        }}
        onChange={(v) => {
          update('og_title', v.ogTitle)
          update('og_description', v.ogDescription)
          update('og_image_url', v.ogImageUrl)
        }}
        autoTitle={draft.name || undefined}
        autoDescription={draft.description ?? undefined}
        autoImageUrl={draft.image_url ?? undefined}
      />
    </div>
  )
}
