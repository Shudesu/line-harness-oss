'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import type {
  EntryRoute,
  CreateEntryRouteInput,
  TrafficPool,
  Scenario,
  Tag,
} from '@line-crm/shared'

interface MessageTemplate {
  id: string
  name: string
  messageType: string
  messageContent: string
}

interface Props {
  route: EntryRoute | null
  pools: TrafficPool[]
  scenarios: Scenario[]
  templates: MessageTemplate[]
  tags: Tag[]
  /** Pre-filled ref_code for "register an unregistered inflow ref" flow. */
  initialRefCode?: string
  onClose: () => void
  onSaved: () => void
}

export default function EditRouteModal({
  route,
  pools,
  scenarios,
  templates,
  tags,
  initialRefCode,
  onClose,
  onSaved,
}: Props) {
  // Per-pool member account names, loaded lazily so the dropdown can show
  // "Pool 名 — アカA, アカB" instead of just the pool name.
  const [poolMembers, setPoolMembers] = useState<Record<string, string[]>>({})
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const entries = await Promise.all(
        pools.map(async (p) => {
          const res = await api.pools.accounts.list(p.id)
          const names = res.success ? res.data.map((m) => m.accountName ?? '—') : []
          return [p.id, names] as const
        }),
      )
      if (!cancelled) setPoolMembers(Object.fromEntries(entries))
    })()
    return () => {
      cancelled = true
    }
  }, [pools])
  const isNew = !route
  const mainPool = pools.find((p) => p.slug === 'main')
  // Unregistered-ref registration flow: refCode is fixed (the actual ref code
  // that has already been seen in inflow), so we lock the input to prevent
  // the user from accidentally renaming the ref and orphaning the prior stats.
  const refCodeLocked = isNew && !!initialRefCode
  const [form, setForm] = useState<CreateEntryRouteInput>(() => ({
    refCode: route?.refCode ?? initialRefCode ?? '',
    name: route?.name ?? '',
    tagId: route?.tagId ?? null,
    poolId: route?.poolId ?? mainPool?.id ?? null,
    scenarioId: route?.scenarioId ?? null,
    introTemplateId: route?.introTemplateId ?? null,
    runAccountFriendAddScenarios: route?.runAccountFriendAddScenarios ?? true,
    redirectUrl: route?.redirectUrl ?? null,
    isActive: route?.isActive ?? true,
  }))
  const [submitting, setSubmitting] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState('')

  const validateBeforeSave = () => {
    const nothingDelivers =
      !form.runAccountFriendAddScenarios && !form.scenarioId && !form.introTemplateId
    if (nothingDelivers) {
      setWarning(
        '上書きモードかつ起動シナリオも即時 push も未設定です。このリンクで友だち追加した人には何も届きません。続行しますか?',
      )
      return false
    }
    return true
  }

  const doSave = async () => {
    setSubmitting(true)
    setError('')
    const res = isNew
      ? await api.entryRoutes.create(form)
      : await api.entryRoutes.update(route!.id, form)
    setSubmitting(false)
    if (res.success) onSaved()
    else setError(res.error ?? '保存に失敗しました')
  }

  const onSubmit = async () => {
    // If validation produced a warning, only the explicit "それでも保存"
    // button (which calls doSave directly) may bypass it. The main save
    // button must not be a second-click escape hatch.
    if (!validateBeforeSave()) return
    await doSave()
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg w-full max-w-lg p-6 space-y-3 max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-medium">
          {isNew ? '新規リファラルリンク' : 'リファラルリンク編集'}
        </h2>

        {error && (
          <div className="p-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
            {error}
          </div>
        )}

        <Field label="名前（運用用ラベル）">
          <input
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm"
            placeholder="例: YouTube 動画概要欄"
          />
        </Field>

        <Field label="ref_code（URL に出る識別子）">
          <input
            value={form.refCode}
            onChange={(e) => setForm({ ...form, refCode: e.target.value })}
            disabled={refCodeLocked}
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm font-mono disabled:bg-gray-50 disabled:text-gray-500"
            placeholder="例: youtube"
          />
          {refCodeLocked && (
            <p className="text-xs text-gray-500 mt-1">
              既に流入があった ref を登録中のため、ref_code は変更できません。
            </p>
          )}
        </Field>

        <Field label="自動付与タグ（任意）">
          <select
            value={form.tagId ?? ''}
            onChange={(e) => setForm({ ...form, tagId: e.target.value || null })}
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm"
          >
            <option value="">— 設定なし —</option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </select>
          <p className="text-xs text-gray-500 mt-1">
            友だち追加時にこのタグを自動付与します。タグ未作成の場合は先にタグを作成してください。
          </p>
        </Field>

        <Field label="送り先 Pool">
          <select
            value={form.poolId ?? ''}
            onChange={(e) => setForm({ ...form, poolId: e.target.value || null })}
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm"
          >
            {pools.map((p) => {
              const members = poolMembers[p.id] ?? []
              const memberText =
                members.length === 0
                  ? '（アカウント未所属）'
                  : `— ${members.join(', ')}`
              return (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.slug === 'main' ? '（既定）' : ''} {memberText}
                </option>
              )
            })}
          </select>
        </Field>

        <Field label="起動シナリオ（任意）">
          <select
            value={form.scenarioId ?? ''}
            onChange={(e) => setForm({ ...form, scenarioId: e.target.value || null })}
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm"
          >
            <option value="">— 設定なし —</option>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </Field>

        <Field label="即時 push テンプレ（任意）">
          <select
            value={form.introTemplateId ?? ''}
            onChange={(e) => setForm({ ...form, introTemplateId: e.target.value || null })}
            className="w-full border border-gray-200 rounded px-3 py-2 text-sm"
          >
            <option value="">— 設定なし —</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </Field>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.runAccountFriendAddScenarios ?? true}
            onChange={(e) => {
              setForm({
                ...form,
                runAccountFriendAddScenarios: e.target.checked,
              })
              setWarning(null)
            }}
            className="mt-0.5"
          />
          <span>
            アカウント標準の友だち追加時設定も実行する（並走モード）
            <span className="block text-xs text-gray-500 mt-0.5">
              OFF にするとアカウント標準シナリオは抑止され、このリンクの設定だけが流れます。
            </span>
          </span>
        </label>

        {warning && (
          <div className="p-3 rounded bg-yellow-50 border border-yellow-200 text-yellow-800 text-sm">
            {warning}
            <div className="mt-2">
              <button
                onClick={doSave}
                disabled={submitting}
                className="text-xs px-2 py-1 rounded bg-yellow-600 text-white disabled:opacity-50"
              >
                それでも保存
              </button>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
          <button onClick={onClose} className="text-sm px-3 py-1.5 text-gray-600">
            キャンセル
          </button>
          <button
            onClick={onSubmit}
            disabled={submitting || !form.name || !form.refCode}
            className="text-sm px-3 py-1.5 rounded bg-blue-600 text-white disabled:opacity-50"
          >
            {submitting ? '保存中…' : isNew ? '作成' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  )
}
