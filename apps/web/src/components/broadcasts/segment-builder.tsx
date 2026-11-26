'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Input } from '@cloudflare/kumo/components/input'
import { Radio } from '@cloudflare/kumo/components/radio'
import {
  audienceCondition,
  conditionToTagFilter,
  emptyTagFilter,
  tagFilterToCondition,
  type SegmentCondition,
  type TagFilter,
} from './segment-conditions'

interface SegmentBuilderProps {
  tags: Tag[]
  accountId: string | null
  /** Target tag of the broadcast (when 対象 = タグで絞り込み); the conditions narrow it further. */
  targetTagId?: string | null
  initialConditions?: SegmentCondition | null
  /** null = clear the conditions (send to the plain target again). */
  onApply: (conditions: SegmentCondition | null) => void | Promise<void>
  onCancel: () => void
}

function TagChecklist({ tags, selected, onChange, query, label }: {
  tags: Tag[]
  selected: string[]
  onChange: (ids: string[]) => void
  query: string
  label: string
}) {
  const visible = tags.filter((t) => !query || t.name.includes(query) || selected.includes(t.id))
  return (
    <div className="max-h-48 overflow-y-auto rounded border border-gray-200 bg-white p-2 space-y-1" aria-label={label}>
      {visible.length === 0 && <p className="text-xs text-gray-400">該当するタグがありません</p>}
      {visible.map((tag) => (
        <Checkbox
          key={tag.id}
          label={tag.name}
          checked={selected.includes(tag.id)}
          onCheckedChange={(checked) => onChange(checked ? [...selected, tag.id] : selected.filter((id) => id !== tag.id))}
        />
      ))}
    </div>
  )
}

export default function SegmentBuilder({ tags, accountId, targetTagId, initialConditions, onApply, onCancel }: SegmentBuilderProps) {
  const parsed = conditionToTagFilter(initialConditions ?? null)
  const [filter, setFilter] = useState<TagFilter>(parsed ?? { ...emptyTagFilter })
  const [query, setQuery] = useState('')
  const [count, setCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)
  const [saving, setSaving] = useState(false)

  const condition = tagFilterToCondition(filter)

  const fetchCount = useCallback(async () => {
    const saved = tagFilterToCondition(filter)
    // With nothing selected the broadcast goes to its plain target; the detail
    // screen shows that number, so no segment count is needed here.
    if (!saved) { setCount(null); return }
    setCounting(true)
    try {
      const res = await api.segments.count(audienceCondition(saved, targetTagId), accountId ?? undefined)
      if (res.success) setCount(res.count ?? 0)
    } catch { /* ignore */ }
    finally { setCounting(false) }
  }, [filter, targetTagId, accountId])

  useEffect(() => {
    const timer = setTimeout(fetchCount, 400)
    return () => clearTimeout(timer)
  }, [fetchCount])

  const apply = async (value: SegmentCondition | null) => {
    setSaving(true)
    try { await onApply(value) } finally { setSaving(false) }
  }

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-700">配信対象をタグで絞り込む（複数タグ・除外）</h3>
      {parsed === null && (
        <p className="text-xs text-amber-700">
          API などで設定された詳細条件が保存されています。ここで「適用」すると、下の内容で上書きされます。
        </p>
      )}
      <Input
        type="text"
        placeholder="タグ名で絞り込み"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="タグ名で絞り込み"
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-600">含めるタグ（未選択なら全員が対象）</p>
          <Radio.Group
            legend="含めるタグの条件"
            value={filter.includeMode}
            onValueChange={(value) => setFilter({ ...filter, includeMode: value === 'all' ? 'all' : 'any' })}
            className="flex gap-4"
          >
            <Radio.Item value="any" label="いずれかが付いている" />
            <Radio.Item value="all" label="すべて付いている" />
          </Radio.Group>
          <TagChecklist tags={tags} selected={filter.includeTagIds} onChange={(ids) => setFilter({ ...filter, includeTagIds: ids })} query={query} label="含めるタグ" />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-600">除外するタグ（どれか1つでも付いていたら送らない）</p>
          <TagChecklist tags={tags} selected={filter.excludeTagIds} onChange={(ids) => setFilter({ ...filter, excludeTagIds: ids })} query={query} label="除外するタグ" />
        </div>
      </div>

      <p className="text-xs text-gray-500">
        条件を付けると、LINE公式アカウントの全フォロワー宛て（一斉送信）ではなく、LINE Harness に登録されている友だちのうち条件に合うフォロー中の人だけに送ります。
      </p>

      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-700">
          {condition == null ? '条件なし' : counting ? '計算中...' : count != null ? `該当: ${count.toLocaleString('ja-JP')}人` : ''}
        </span>
        <div className="flex gap-2">
          {initialConditions && (
            <Button type="button" variant="ghost" disabled={saving} onClick={() => apply(null)}>条件をクリア</Button>
          )}
          <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>キャンセル</Button>
          <Button type="button" variant="primary" disabled={saving || condition == null} onClick={() => apply(condition)}>適用</Button>
        </div>
      </div>
    </div>
  )
}
