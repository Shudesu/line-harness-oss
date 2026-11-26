'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Select } from '@cloudflare/kumo/components/select'
import { api } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'
import { countryFlag } from '@/lib/country-flag'

interface PreviewData {
  totalSelected: number
  uniqueRecipients: number
  reduction: number
  reductionRate: number
  perAccount: Array<{
    accountId: string
    accountName: string
    accountCountry: string | null
    selectedCount: number
    sendCount: number
    excludedToHigherPriority: number
  }>
}

interface Props {
  accountIds: string[]
  dedupPriority: string[]
  targetTagId: string | null
  tags: Array<{ id: string; name: string }>
  onAccountIdsChange: (ids: string[]) => void
  onDedupPriorityChange: (ids: string[]) => void
  onTargetTagIdChange: (id: string | null) => void
}

function PriorityRow({ id, label, flag, ordinal }: { id: string; label: string; flag: string; ordinal: number }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex cursor-grab items-center gap-2 rounded-md border border-kumo-line bg-kumo-base px-3 py-2 text-sm"
      {...attributes}
      {...listeners}
    >
      <span className="text-kumo-subtle">⋮⋮</span>
      <span className="w-6 text-xs text-kumo-subtle">{ordinal}位</span>
      {flag && <span>{flag}</span>}
      <span>{label}</span>
    </div>
  )
}

export default function MultiAccountDedupSection({
  accountIds,
  dedupPriority,
  targetTagId,
  tags,
  onAccountIdsChange,
  onDedupPriorityChange,
  onTargetTagIdChange,
}: Props) {
  const { accounts } = useAccount()
  const [preview, setPreview] = useState<PreviewData | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Initialize on mount: select all active accounts, priority follows displayOrder.
  useEffect(() => {
    if (accountIds.length === 0 && accounts.length > 0) {
      const activeIds = accounts
        .filter((a) => a.isActive)
        .sort((a, b) => a.displayOrder - b.displayOrder)
        .map((a) => a.id)
      onAccountIdsChange(activeIds)
      onDedupPriorityChange(activeIds)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts.length])

  // Keep dedupPriority in sync with accountIds.
  useEffect(() => {
    const filtered = dedupPriority.filter((id) => accountIds.includes(id))
    if (filtered.length !== dedupPriority.length) {
      onDedupPriorityChange(filtered)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountIds.join(',')])

  // Debounced preview fetch.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (accountIds.length === 0) {
      setPreview(null)
      return
    }
    debounceRef.current = setTimeout(async () => {
      setPreviewLoading(true)
      setPreviewError('')
      try {
        const res = await api.broadcasts.dedupPreview({
          accountIds,
          dedupPriority,
          targetTagId: targetTagId || null,
        })
        if (res.success && res.data) {
          setPreview(res.data)
        } else {
          setPreviewError(res.error || 'プレビュー取得失敗')
        }
      } catch {
        setPreviewError('プレビュー取得失敗')
      } finally {
        setPreviewLoading(false)
      }
    }, 500)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [accountIds.join(','), dedupPriority.join(','), targetTagId])

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    const oldIndex = dedupPriority.indexOf(String(active.id))
    const newIndex = dedupPriority.indexOf(String(over.id))
    onDedupPriorityChange(arrayMove(dedupPriority, oldIndex, newIndex))
  }

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts])
  const isSingleAccount = accountIds.length === 1
  const showDedupUI = accountIds.length >= 2
  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => a.displayOrder - b.displayOrder),
    [accounts],
  )

  return (
    <LayerCard className="mt-3 space-y-4 bg-kumo-tint p-4">
      <div>
        <p className="mb-2 text-xs font-medium text-kumo-default">配信先アカウント</p>
        <div className="space-y-1">
          {sortedAccounts.map((account) => (
            <Checkbox
                key={account.id}
                checked={accountIds.includes(account.id)}
                onCheckedChange={(checked) => {
                  if (checked) {
                    onAccountIdsChange([...accountIds, account.id])
                  } else {
                    onAccountIdsChange(accountIds.filter((id) => id !== account.id))
                  }
                }}
                label={<span>{countryFlag(account.country) ? `${countryFlag(account.country)} ` : ''}{account.displayName || account.name}{!account.isActive ? '（無効）' : ''}</span>}
            />
          ))}
        </div>
      </div>

      <div className={`text-xs ${isSingleAccount ? 'text-kumo-subtle' : 'text-kumo-default'}`}>
        ☑ 重複除外モード
        {isSingleAccount && '（1 アカ選択時は無効）'}
      </div>

      {/* Optional tag filter — narrows the recipient population to friends
          who carry the selected tag, then dedup runs on that narrowed set. */}
      <div>
        <Select
          label="タグ絞込"
          required={false}
          className="w-full"
          value={targetTagId ?? ''}
          onValueChange={(value) => onTargetTagIdChange(value || null)}
          items={[{ value: '', label: 'タグ絞込なし（選択アカウントの全友だち）' }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]}
        />
        <p className="mt-1 text-[11px] text-kumo-subtle">
          タグを選ぶと、そのタグが付いた友達だけ対象に重複除外する。空なら全員対象。
        </p>
      </div>

      {showDedupUI && (
        <div>
          <p className="mb-2 text-xs font-medium text-kumo-default">送信元優先順（上が優先）</p>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={dedupPriority} strategy={verticalListSortingStrategy}>
              <div className="space-y-1">
                {dedupPriority.map((id, idx) => {
                  const a = accountById.get(id)
                  if (!a) return null
                  return (
                    <PriorityRow
                      key={id}
                      id={id}
                      label={a.displayName || a.name}
                      flag={countryFlag(a.country)}
                      ordinal={idx + 1}
                    />
                  )
                })}
              </div>
            </SortableContext>
          </DndContext>
          <p className="mt-1 text-xs text-kumo-subtle">※ デフォルト順は /accounts の並び替えモードで変更</p>
        </div>
      )}

      <LayerCard className="p-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-bold text-kumo-default">プレビュー</p>
          {previewLoading ? <span className="flex items-center gap-1 text-xs text-kumo-subtle"><Loader size="sm" />更新中</span> : null}
        </div>
        {previewError ? <Banner className="mb-2" size="sm" variant="error" title="プレビューを更新できません" description={`${previewError}（前回の値を表示中）`} /> : null}
        {preview ? (
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-kumo-subtle">合計選択</span>
              <span>{preview.totalSelected.toLocaleString()} 通</span>
            </div>
            <div className="flex justify-between font-medium">
              <span className="text-kumo-default">ユニーク配信</span>
              <span>{preview.uniqueRecipients.toLocaleString()} 通</span>
            </div>
            <div className="flex justify-between text-kumo-success">
              <span>削減</span>
              <span>{preview.reduction.toLocaleString()} 通 ({(preview.reductionRate * 100).toFixed(1)}%)</span>
            </div>
            <div className="mt-2 border-t border-kumo-line pt-2">
              <p className="mb-1 text-xs font-medium text-kumo-default">送信内訳</p>
              {preview.perAccount.map((p) => {
                const flag = countryFlag(p.accountCountry)
                const ordinal = dedupPriority.indexOf(p.accountId)
                // Prefer the LINE-fetched bot displayName (held in account-context)
                // over the operator-set DB `name` returned by the dedup API. The
                // sidebar already uses displayName, so the broadcast preview
                // matching it avoids the "why does this say a different name?"
                // surprise the operator hit on the test environment.
                const ctxAccount = accounts.find((a) => a.id === p.accountId)
                const renderedName = ctxAccount?.displayName || ctxAccount?.name || p.accountName
                return (
                  <div key={p.accountId} className="flex justify-between text-xs py-0.5">
                    <span className="text-kumo-default">
                      {flag && <span className="mr-1">{flag}</span>}
                      {renderedName}
                      {ordinal >= 0 && <span className="text-kumo-subtle"> ({ordinal + 1}位)</span>}
                    </span>
                    <span>
                      {p.sendCount.toLocaleString()} 通
                      {p.excludedToHigherPriority > 0 && (
                        <span className="ml-1 text-kumo-subtle">[{p.excludedToHigherPriority} 除外]</span>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="mt-2 text-xs text-kumo-subtle">
              ⓘ 実際の送信数は送信時の友だち状態で決定。preview と若干ズレる場合あり
            </p>
          </div>
        ) : (
          <p className="text-xs text-kumo-subtle">アカウントを選択するとプレビュー表示</p>
        )}
      </LayerCard>
    </LayerCard>
  )
}
