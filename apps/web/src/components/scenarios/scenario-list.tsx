'use client'

import { useState } from 'react'
import Link from 'next/link'
import { LightningIcon, PencilSimpleIcon, TrashIcon } from '@phosphor-icons/react'
import { Badge } from '@cloudflare/kumo/components/badge'
import type { BadgeVariant } from '@cloudflare/kumo/components/badge'
import { Button, LinkButton } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Switch } from '@cloudflare/kumo/components/switch'
import type { Scenario, DeliveryMode } from '@line-crm/shared'

type ScenarioWithCount = Scenario & { stepCount?: number }
type PendingAction = { kind: 'toggle' | 'delete'; scenario: ScenarioWithCount }

const triggerLabels: Record<string, string> = {
  friend_add: '友だち追加時',
  tag_added: 'タグ付与時',
  manual: '手動',
}

const deliveryModes: Record<DeliveryMode, { variant: BadgeVariant; label: string }> = {
  relative: { variant: 'neutral', label: 'Legacy' },
  elapsed: { variant: 'info', label: '経過時間' },
  absolute_time: { variant: 'warning', label: '時刻指定' },
}

interface ScenarioListProps {
  scenarios: ScenarioWithCount[]
  onToggleActive: (id: string, current: boolean) => Promise<void>
  onDelete: (id: string) => Promise<void>
  loading?: boolean
}

export default function ScenarioList({ scenarios, onToggleActive, onDelete, loading }: ScenarioListProps) {
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [togglingId, setTogglingId] = useState<string | null>(null)

  if (scenarios.length === 0) {
    return <Empty size="sm" title="シナリオがありません" description="新規シナリオから最初の配信フローを作成してください。" />
  }

  const requestToggle = async (scenario: ScenarioWithCount) => {
    if (scenario.lineAccountId === null) {
      setPendingAction({ kind: 'toggle', scenario })
      return
    }
    setTogglingId(scenario.id)
    try { await onToggleActive(scenario.id, scenario.isActive) } finally { setTogglingId(null) }
  }

  const confirmAction = async () => {
    if (!pendingAction) return
    setConfirming(true)
    try {
      if (pendingAction.kind === 'toggle') await onToggleActive(pendingAction.scenario.id, pendingAction.scenario.isActive)
      else await onDelete(pendingAction.scenario.id)
      setPendingAction(null)
    } finally {
      setConfirming(false)
    }
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {scenarios.map((scenario) => {
          const mode = deliveryModes[scenario.deliveryMode ?? 'relative']
          return (
            <LayerCard key={scenario.id} className="flex flex-col gap-3 p-5">
              <div className="flex items-start justify-between gap-3">
                <Link href={`/scenarios/detail?id=${scenario.id}`} className="text-sm font-semibold text-kumo-strong hover:text-kumo-link">
                  {scenario.name}
                </Link>
                <Switch
                  size="sm"
                  checked={scenario.isActive}
                  transitioning={togglingId === scenario.id}
                  disabled={loading || togglingId !== null}
                  aria-label={`${scenario.name}を${scenario.isActive ? '無効化' : '有効化'}`}
                  onCheckedChange={() => void requestToggle(scenario)}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {scenario.lineAccountId === null ? <Badge variant="warning">全アカウント共通</Badge> : null}
                <Badge variant={mode.variant}>{mode.label}</Badge>
                <Badge variant={scenario.isActive ? 'success' : 'neutral'} appearance="dot">{scenario.isActive ? '有効' : '無効'}</Badge>
              </div>

              {scenario.description ? <p className="line-clamp-2 text-xs text-kumo-subtle">{scenario.description}</p> : null}

              <div className="grid grid-cols-2 gap-3 border-y border-kumo-line py-3 text-xs text-kumo-subtle">
                <span className="flex items-center gap-1"><LightningIcon size={14} />{triggerLabels[scenario.triggerType] ?? scenario.triggerType}</span>
                <span>ステップ <strong className="text-kumo-strong">{scenario.stepCount ?? '-'}</strong></span>
              </div>

              <div className="mt-auto flex justify-end gap-2">
                <LinkButton href={`/scenarios/detail?id=${scenario.id}`} size="sm" variant="secondary" icon={PencilSimpleIcon}>編集</LinkButton>
                <Button type="button" size="sm" variant="secondary-destructive" icon={TrashIcon} onClick={() => setPendingAction({ kind: 'delete', scenario })}>削除</Button>
              </div>
            </LayerCard>
          )
        })}
      </div>

      <Dialog.Root role="alertdialog" open={pendingAction !== null} onOpenChange={(open) => { if (!open && !confirming) setPendingAction(null) }}>
        <Dialog size="base" className="p-6">
          <Dialog.Title className="text-lg font-semibold text-kumo-strong">
            {pendingAction?.kind === 'delete' ? 'シナリオを削除しますか？' : '全アカウント共通シナリオを変更しますか？'}
          </Dialog.Title>
          <Dialog.Description className="mt-2 text-sm leading-6 text-kumo-subtle">
            {pendingAction?.kind === 'delete'
              ? `「${pendingAction.scenario.name}」を削除します。${pendingAction.scenario.lineAccountId === null ? '全アカウントから消えます。' : ''}この操作は取り消せません。`
              : `「${pendingAction?.scenario.name ?? ''}」を${pendingAction?.scenario.isActive ? '無効化' : '有効化'}すると、すべてのLINEアカウントに影響します。`}
          </Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Dialog.Close render={(props) => <Button {...props} type="button" variant="secondary" disabled={confirming}>キャンセル</Button>} />
            <Button type="button" variant={pendingAction?.kind === 'delete' ? 'destructive' : 'primary'} loading={confirming} onClick={() => void confirmAction()}>
              {pendingAction?.kind === 'delete' ? '削除する' : '変更する'}
            </Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </>
  )
}
