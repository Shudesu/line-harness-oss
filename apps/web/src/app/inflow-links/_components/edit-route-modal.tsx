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
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Input } from '@cloudflare/kumo/components/input'
import { Select } from '@cloudflare/kumo/components/select'

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
    <Dialog.Root open onOpenChange={(open) => { if (!open && !submitting) onClose() }}>
      <Dialog size="lg" className="max-h-[90vh] overflow-y-auto p-6">
        <Dialog.Title className="text-lg font-medium">
          {isNew ? '新規リファラルリンク' : 'リファラルリンク編集'}
        </Dialog.Title>
        <Dialog.Description className="mt-1 mb-4">流入後の送り先と自動処理を設定します。</Dialog.Description>

        {error && (
          <Banner className="mb-3" size="sm" variant="error" title="保存できませんでした" description={error} />
        )}

        <div className="space-y-3">
          <Input
            label="名前（運用用ラベル）"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="例: YouTube 動画概要欄"
          />

          <Input
            label="ref_code（URL に出る識別子）"
            value={form.refCode}
            onChange={(e) => setForm({ ...form, refCode: e.target.value })}
            disabled={refCodeLocked}
            className="font-mono"
            placeholder="例: youtube"
          />
          {refCodeLocked && (
            <p className="text-xs text-gray-500 mt-1">
              既に流入があった ref を登録中のため、ref_code は変更できません。
            </p>
          )}

          <div>
          <Select
            label="自動付与タグ（任意）"
            value={form.tagId ?? ''}
            onValueChange={(value) => setForm({ ...form, tagId: value || null })}
            placeholder="— 設定なし —"
            items={Object.fromEntries(tags.map((tag) => [tag.id, tag.name]))}
          />
          <p className="text-xs text-gray-500 mt-1">
            友だち追加時にこのタグを自動付与します。タグ未作成の場合は先にタグを作成してください。
          </p>
          </div>

          <Select
            label="送り先 Pool"
            value={form.poolId ?? ''}
            onValueChange={(value) => setForm({ ...form, poolId: value || null })}
            items={Object.fromEntries(pools.map((p) => {
              const members = poolMembers[p.id] ?? []
              const memberText =
                members.length === 0
                  ? '（アカウント未所属）'
                  : `— ${members.join(', ')}`
              return [p.id, `${p.name}${p.slug === 'main' ? '（既定）' : ''} ${memberText}`]
            }))}
          />

          <Select
            label="起動シナリオ（任意）"
            value={form.scenarioId ?? ''}
            onValueChange={(value) => setForm({ ...form, scenarioId: value || null })}
            placeholder="— 設定なし —"
            items={Object.fromEntries(scenarios.map((scenario) => [scenario.id, scenario.name]))}
          />

          <Select
            label="即時 push テンプレ（任意）"
            value={form.introTemplateId ?? ''}
            onValueChange={(value) => setForm({ ...form, introTemplateId: value || null })}
            placeholder="— 設定なし —"
            items={Object.fromEntries(templates.map((template) => [template.id, template.name]))}
          />

          <Checkbox
            label="アカウント標準の友だち追加時設定も実行する（並走モード）"
            checked={form.runAccountFriendAddScenarios ?? true}
            onCheckedChange={(checked) => {
              setForm({
                ...form,
                runAccountFriendAddScenarios: checked,
              })
              setWarning(null)
            }}
          />
          <p className="text-xs text-kumo-subtle">OFF にするとアカウント標準シナリオは抑止され、このリンクの設定だけが流れます。</p>

        {warning && (
          <Banner variant="alert" title="配信されない設定です" description={warning}>
            <div className="mt-2">
              <Button
                type="button"
                size="xs"
                variant="primary"
                onClick={doSave}
                loading={submitting}
                disabled={submitting}
              >
                それでも保存
              </Button>
            </div>
          </Banner>
        )}
        </div>

        <div className="flex justify-end gap-2 pt-3 border-t border-gray-100">
          <Button type="button" variant="secondary" onClick={onClose}>キャンセル</Button>
          <Button
            type="button"
            variant="primary"
            onClick={onSubmit}
            loading={submitting}
            disabled={submitting || !form.name || !form.refCode}
          >
            {isNew ? '作成' : '保存'}
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
