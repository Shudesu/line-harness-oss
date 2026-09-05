'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { LightningIcon, PlusIcon, TrashIcon } from '@phosphor-icons/react'
import { Badge } from '@cloudflare/kumo/components/badge'
import type { BadgeVariant } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input, InputArea } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Select } from '@cloudflare/kumo/components/select'
import { Switch } from '@cloudflare/kumo/components/switch'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import Header from '@/components/layout/header'
import CcPromptButton from '@/components/cc-prompt-button'
import { summarizeAutomationActions } from './automation-action-summary'

type AutomationEventType = 'friend_add' | 'tag_change' | 'score_threshold' | 'cv_fire' | 'message_received' | 'postback_received' | 'calendar_booked'

interface AutomationAction {
  type: 'add_tag' | 'remove_tag' | 'start_scenario' | 'send_message' | 'send_webhook' | 'switch_rich_menu'
  params: Record<string, unknown>
}

interface Automation {
  id: string
  name: string
  description: string | null
  eventType: AutomationEventType
  conditions: Record<string, unknown>
  actions: AutomationAction[]
  isActive: boolean
  priority: number
  lineAccountId: string | null
  createdAt: string
  updatedAt: string
}

const eventTypeOptions: { value: AutomationEventType; label: string }[] = [
  { value: 'friend_add', label: '友だち追加' },
  { value: 'tag_change', label: 'タグ変更' },
  { value: 'score_threshold', label: 'スコア閾値' },
  { value: 'cv_fire', label: 'CV発火' },
  { value: 'message_received', label: 'メッセージ受信' },
  { value: 'postback_received', label: 'ポストバック受信（リッチメニュー等）' },
  { value: 'calendar_booked', label: 'カレンダー予約' },
]

const eventTypeLabelMap = Object.fromEntries(eventTypeOptions.map((option) => [option.value, option.label])) as Record<AutomationEventType, string>

const eventTypeBadgeVariant: Record<AutomationEventType, BadgeVariant> = {
  friend_add: 'success',
  tag_change: 'info',
  score_threshold: 'warning',
  cv_fire: 'error',
  message_received: 'purple',
  postback_received: 'teal',
  calendar_booked: 'blue',
}

interface CreateFormState {
  name: string
  description: string
  eventType: AutomationEventType
  actionsJson: string
  conditionsJson: string
  priority: number
}

type PendingAction = { kind: 'toggle' | 'delete'; automation: Automation }

const initialForm: CreateFormState = {
  name: '',
  description: '',
  eventType: 'friend_add',
  actionsJson: '[\n  {\n    "type": "add_tag",\n    "params": {}\n  }\n]',
  conditionsJson: '{}',
  priority: 0,
}

const ccPrompts = [
  {
    title: 'オートメーションルール作成',
    prompt: `新しいオートメーションルールを作成するサポートをしてください。
1. 利用可能なイベントタイプ（友だち追加、タグ変更、スコア閾値等）の説明
2. アクション設定のJSON形式テンプレートを提供
3. 条件設定と優先度の推奨値を提案
手順を示してください。`,
  },
  {
    title: 'オートメーション効果分析',
    prompt: `現在のオートメーションルールの効果を分析してください。
1. 各ルールの発火回数と成功率を確認
2. イベントタイプ別の自動化カバレッジを評価
3. 効果の低いルールの改善提案と新規ルールの推奨
結果をレポートしてください。`,
  },
]

export default function AutomationsPage() {
  const { selectedAccountId, loading: accountLoading } = useAccount()
  const [automations, setAutomations] = useState<Automation[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState<CreateFormState>({ ...initialForm })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  const loadAutomations = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.automations.list({ accountId: selectedAccountId || undefined })
      if (res.success) setAutomations(res.data)
      else setError(res.error)
    } catch {
      setError('オートメーションの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [selectedAccountId])

  useEffect(() => {
    if (accountLoading) return
    let cancelled = false

    const fetchData = async () => {
      setLoading(true)
      setError('')
      try {
        const res = await api.automations.list({ accountId: selectedAccountId || undefined })
        if (cancelled) return
        if (res.success) setAutomations(res.data)
        else setError(res.error)
      } catch {
        if (!cancelled) setError('オートメーションの読み込みに失敗しました。もう一度お試しください。')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void fetchData()
    return () => { cancelled = true }
  }, [selectedAccountId, accountLoading])

  const closeCreate = () => {
    if (saving) return
    setShowCreate(false)
    setFormError('')
  }

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!form.name.trim()) {
      setFormError('ルール名を入力してください')
      return
    }

    let parsedActions: AutomationAction[]
    let parsedConditions: Record<string, unknown>
    try {
      parsedActions = JSON.parse(form.actionsJson)
    } catch {
      setFormError('アクションのJSON形式が正しくありません')
      return
    }
    try {
      parsedConditions = JSON.parse(form.conditionsJson)
    } catch {
      setFormError('条件のJSON形式が正しくありません')
      return
    }

    setSaving(true)
    setFormError('')
    try {
      const res = await api.automations.create({
        name: form.name,
        description: form.description || null,
        eventType: form.eventType,
        actions: parsedActions,
        conditions: parsedConditions,
        priority: form.priority,
      })
      if (res.success) {
        setShowCreate(false)
        setForm({ ...initialForm })
        await loadAutomations()
      } else {
        setFormError(res.error)
      }
    } catch {
      setFormError('作成に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  const updateActive = async (automation: Automation) => {
    setTogglingId(automation.id)
    setError('')
    try {
      const response = await api.automations.update(automation.id, { isActive: !automation.isActive })
      if (!response.success) setError(response.error)
      else await loadAutomations()
    } catch {
      setError('ステータスの変更に失敗しました')
    } finally {
      setTogglingId(null)
    }
  }

  const requestToggle = (automation: Automation) => {
    if (automation.lineAccountId === null) setPendingAction({ kind: 'toggle', automation })
    else void updateActive(automation)
  }

  const confirmPendingAction = async () => {
    if (!pendingAction) return
    setConfirming(true)
    setError('')
    try {
      if (pendingAction.kind === 'toggle') {
        await updateActive(pendingAction.automation)
      } else {
        const response = await api.automations.delete(pendingAction.automation.id)
        if (!response.success) setError(response.error)
        else await loadAutomations()
      }
      setPendingAction(null)
    } catch {
      setError(pendingAction.kind === 'delete' ? '削除に失敗しました' : 'ステータスの変更に失敗しました')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <div>
      <Header
        title="オートメーション"
        description="LINE上の出来事をきっかけに、タグ付けや配信を自動実行します。"
        action={<Button type="button" variant="primary" icon={PlusIcon} onClick={() => setShowCreate(true)}>新規ルール</Button>}
      />

      {error ? <Banner className="mb-4" variant="error" title="操作を完了できませんでした" description={error} /> : null}

      {loading ? (
        <LayerCard className="flex min-h-48 items-center justify-center gap-2 text-sm text-kumo-subtle">
          <Loader size="sm" /> オートメーションを読み込み中
        </LayerCard>
      ) : automations.length === 0 ? (
        <Empty
          size="sm"
          title="オートメーションがありません"
          description="最初のルールを作成すると、定型作業を自動化できます。"
          contents={<Button type="button" variant="primary" icon={PlusIcon} onClick={() => setShowCreate(true)}>新規ルール</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {automations.map((automation) => {
            const actionSummary = summarizeAutomationActions(automation.actions)
            return (
              <LayerCard key={automation.id} className="flex flex-col p-5">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-semibold text-kumo-strong">{automation.name}</h2>
                    {automation.description ? <p className="mt-1 line-clamp-2 text-xs text-kumo-subtle">{automation.description}</p> : null}
                  </div>
                  <Switch
                    size="sm"
                    checked={automation.isActive}
                    transitioning={togglingId === automation.id}
                    disabled={togglingId !== null}
                    aria-label={`${automation.name}を${automation.isActive ? '無効化' : '有効化'}`}
                    onCheckedChange={() => requestToggle(automation)}
                  />
                </div>

                <div className="mb-4 flex flex-wrap items-center gap-2">
                  <Badge variant={eventTypeBadgeVariant[automation.eventType]}>{eventTypeLabelMap[automation.eventType]}</Badge>
                  <Badge variant={automation.isActive ? 'success' : 'neutral'} appearance="dot">{automation.isActive ? '有効' : '無効'}</Badge>
                  {automation.lineAccountId === null ? <Badge variant="warning">全アカウント共通</Badge> : null}
                </div>

                <div className="mb-4 grid grid-cols-2 gap-3 border-y border-kumo-line py-3 text-xs text-kumo-subtle">
                  <span>アクション <strong className="text-kumo-strong">{actionSummary.actionCount}件</strong></span>
                  <span>優先度 <strong className="text-kumo-strong">{automation.priority}</strong></span>
                  {actionSummary.templateReferenceCount > 0 ? (
                    <Link href="/templates" className="col-span-2 text-kumo-link hover:underline" title="テンプレート参照を確認">
                      テンプレート参照 × {actionSummary.templateReferenceCount}
                    </Link>
                  ) : null}
                </div>

                <div className="mt-auto flex justify-end">
                  <Button type="button" size="sm" variant="secondary-destructive" icon={TrashIcon} onClick={() => setPendingAction({ kind: 'delete', automation })}>
                    削除
                  </Button>
                </div>
              </LayerCard>
            )
          })}
        </div>
      )}

      <Dialog.Root open={showCreate} onOpenChange={(open) => { if (!open) closeCreate() }}>
        <Dialog size="lg" className="max-h-[90vh] overflow-y-auto p-6">
          <Dialog.Title className="text-lg font-semibold text-kumo-strong">新規オートメーションを作成</Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-kumo-subtle">実行のきっかけ・条件・アクションを設定します。</Dialog.Description>
          <form onSubmit={handleCreate} className="mt-5 space-y-4">
            <Input
              label="ルール名"
              required
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              placeholder="例: 友だち追加時にウェルカムタグ付与"
            />
            <InputArea
              label="説明"
              required={false}
              rows={2}
              value={form.description}
              onValueChange={(value) => setForm({ ...form, description: value })}
              placeholder="ルールの説明（省略可）"
            />
            <Select
              label="イベントタイプ"
              value={form.eventType}
              onValueChange={(value) => setForm({ ...form, eventType: (value ?? 'friend_add') as AutomationEventType })}
              items={eventTypeOptions}
            />
            <InputArea
              label="アクション（JSON）"
              className="font-mono"
              rows={6}
              value={form.actionsJson}
              onValueChange={(value) => setForm({ ...form, actionsJson: value })}
              description="複数の処理を配列で指定します。"
            />
            <InputArea
              label="条件（JSON）"
              className="font-mono"
              rows={3}
              value={form.conditionsJson}
              onValueChange={(value) => setForm({ ...form, conditionsJson: value })}
            />
            <Input
              label="優先度"
              type="number"
              value={form.priority}
              onChange={(event) => setForm({ ...form, priority: Number.parseInt(event.target.value, 10) || 0 })}
            />
            {formError ? <Banner size="sm" variant="error" title="作成できません" description={formError} /> : null}
            <div className="flex justify-end gap-2">
              <Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary" disabled={saving}>キャンセル</Button>} />
              <Button type="submit" variant="primary" icon={LightningIcon} loading={saving}>作成</Button>
            </div>
          </form>
        </Dialog>
      </Dialog.Root>

      <Dialog.Root role="alertdialog" open={pendingAction !== null} onOpenChange={(open) => { if (!open && !confirming) setPendingAction(null) }}>
        <Dialog size="base" className="p-6">
          <Dialog.Title className="text-lg font-semibold text-kumo-strong">
            {pendingAction?.kind === 'delete' ? 'オートメーションを削除しますか？' : '全アカウント共通ルールを変更しますか？'}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-kumo-subtle">
            {pendingAction?.kind === 'delete'
              ? `「${pendingAction.automation.name}」を削除します。この操作は取り消せません。${pendingAction.automation.lineAccountId === null ? '全アカウントから消えます。' : ''}`
              : `「${pendingAction?.automation.name ?? ''}」を${pendingAction?.automation.isActive ? '無効化' : '有効化'}すると、すべてのLINEアカウントに影響します。`}
          </Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary" disabled={confirming}>キャンセル</Button>} />
            <Button
              type="button"
              variant={pendingAction?.kind === 'delete' ? 'destructive' : 'primary'}
              loading={confirming}
              onClick={() => void confirmPendingAction()}
            >
              {pendingAction?.kind === 'delete' ? '削除する' : '変更する'}
            </Button>
          </div>
        </Dialog>
      </Dialog.Root>

      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
