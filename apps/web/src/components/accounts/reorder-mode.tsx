'use client'

import { useState } from 'react'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
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
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { api } from '@/lib/api'
import { countryFlag } from '@/lib/country-flag'

interface AccountItem {
  id: string
  name: string
  displayName?: string
  country: string | null
}

interface Props {
  accounts: AccountItem[]
  onClose: () => void
  onSaved: () => void
}

function SortableRow({ account }: { account: AccountItem }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: account.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex cursor-grab items-center gap-3 rounded-lg border border-kumo-line bg-kumo-base p-3"
      {...attributes}
      {...listeners}
    >
      <span className="text-lg text-kumo-subtle">⋮⋮</span>
      {countryFlag(account.country) && (
        <span className="text-lg">{countryFlag(account.country)}</span>
      )}
      <span className="text-sm font-medium text-kumo-default">{account.displayName || account.name}</span>
    </div>
  )
}

export default function ReorderMode({ accounts, onClose, onSaved }: Props) {
  const [items, setItems] = useState<AccountItem[]>(accounts)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  const handleDragEnd = (e: DragEndEvent) => {
    const { active, over } = e
    if (!over || active.id === over.id) return
    setItems((current) => {
      const oldIndex = current.findIndex((x) => x.id === active.id)
      const newIndex = current.findIndex((x) => x.id === over.id)
      return arrayMove(current, oldIndex, newIndex)
    })
  }

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const ordered = items.map((account, index) => ({ id: account.id, displayOrder: index }))
      const response = await api.lineAccounts.updateOrder(ordered)
      if (!response.success) {
        setError(response.error || '保存に失敗しました')
        return
      }
      await onSaved()
      onClose()
    } catch {
      setError('保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !saving) onClose() }}>
      <Dialog size="base" className="max-h-[80vh] overflow-y-auto p-5">
        <Dialog.Title className="mb-2 text-base font-bold text-kumo-strong">アカウントを並び替え</Dialog.Title>
        <Dialog.Description className="mb-4 text-xs text-kumo-subtle">ドラッグまたはキーボードで順序を変更します。サイドバーにも反映されます。</Dialog.Description>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-2">
              {items.map((a) => <SortableRow key={a.id} account={a} />)}
            </div>
          </SortableContext>
        </DndContext>
        {error ? <Banner className="mt-4" variant="error" title="並び順を保存できません" description={error} /> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={onClose}>キャンセル</Button>
          <Button type="button" variant="primary" loading={saving} onClick={() => void handleSave()}>保存</Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
