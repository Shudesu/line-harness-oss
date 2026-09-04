'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Tag } from '@line-crm/shared'
import { api } from '@/lib/api'
import { Button } from '@cloudflare/kumo/components/button'
import { Input } from '@cloudflare/kumo/components/input'
import { Select } from '@cloudflare/kumo/components/select'

interface SegmentRule {
  type: 'tag_exists' | 'tag_not_exists' | 'metadata_equals' | 'metadata_not_equals' | 'is_following'
  value: string | boolean | { key: string; value: string }
}

interface SegmentCondition {
  operator: 'AND' | 'OR'
  rules: SegmentRule[]
}

interface SegmentBuilderProps {
  tags: Tag[]
  accountId: string | null
  initialConditions?: SegmentCondition | null
  onApply: (conditions: SegmentCondition) => void
  onCancel: () => void
}

const ruleTypeLabels: Record<SegmentRule['type'], string> = {
  tag_exists: 'タグあり',
  tag_not_exists: 'タグなし',
  metadata_equals: 'メタデータ一致',
  metadata_not_equals: 'メタデータ不一致',
  is_following: 'フォロー中のみ',
}

export default function SegmentBuilder({ tags, accountId, initialConditions, onApply, onCancel }: SegmentBuilderProps) {
  const [operator, setOperator] = useState<'AND' | 'OR'>(initialConditions?.operator ?? 'AND')
  const [rules, setRules] = useState<SegmentRule[]>(initialConditions?.rules ?? [{ type: 'tag_exists', value: '' }])
  const [count, setCount] = useState<number | null>(null)
  const [counting, setCounting] = useState(false)

  const fetchCount = useCallback(async () => {
    const validRules = rules.filter(r => {
      if (r.type === 'is_following') return true
      if (typeof r.value === 'string') return r.value !== ''
      if (typeof r.value === 'object' && r.value !== null) return (r.value as { key: string }).key !== ''
      return false
    })
    if (validRules.length === 0) { setCount(null); return }

    setCounting(true)
    try {
      const res = await api.segments.count({ operator, rules: validRules }, accountId ?? undefined)
      if (res.success) setCount(res.count ?? 0)
    } catch { /* ignore */ }
    finally { setCounting(false) }
  }, [operator, rules, accountId])

  useEffect(() => {
    const timer = setTimeout(fetchCount, 500)
    return () => clearTimeout(timer)
  }, [fetchCount])

  const updateRule = (index: number, updates: Partial<SegmentRule>) => {
    setRules(prev => prev.map((r, i) => i === index ? { ...r, ...updates } as SegmentRule : r))
  }

  const removeRule = (index: number) => {
    setRules(prev => prev.filter((_, i) => i !== index))
  }

  const addRule = () => {
    setRules(prev => [...prev, { type: 'tag_exists', value: '' }])
  }

  return (
    <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">配信対象を絞り込む</h3>
        <Select
          size="sm"
          value={operator}
          onValueChange={(value) => setOperator((value ?? 'AND') as 'AND' | 'OR')}
          aria-label="条件の組み合わせ"
          items={{ AND: 'すべて満たす (AND)', OR: 'いずれか満たす (OR)' }}
        />
      </div>

      <div className="space-y-2 mb-3">
        {rules.map((rule, i) => (
          <div key={i} className="flex items-center gap-2 bg-white rounded border border-gray-200 p-2">
            <Select
              size="sm"
              value={rule.type}
              onValueChange={(value) => {
                const type = (value ?? 'tag_exists') as SegmentRule['type']
                const defaultValue = type === 'is_following' ? true
                  : (type === 'metadata_equals' || type === 'metadata_not_equals') ? { key: '', value: '' }
                  : ''
                updateRule(i, { type, value: defaultValue })
              }}
              className="min-w-[120px]"
              aria-label={`ルール${i + 1}の種類`}
              items={ruleTypeLabels}
            />

            {(rule.type === 'tag_exists' || rule.type === 'tag_not_exists') && (
              <Select
                size="sm"
                value={typeof rule.value === 'string' ? rule.value : ''}
                onValueChange={(value) => updateRule(i, { value: value ?? '' })}
                className="flex-1"
                aria-label={`ルール${i + 1}のタグ`}
                items={[{ value: '', label: 'タグを選択...' }, ...tags.map((tag) => ({ value: tag.id, label: tag.name }))]}
              />
            )}

            {(rule.type === 'metadata_equals' || rule.type === 'metadata_not_equals') && (
              <>
                <Input
                  type="text"
                  placeholder="key"
                  value={typeof rule.value === 'object' && rule.value !== null ? (rule.value as { key: string }).key : ''}
                  onChange={(e) => updateRule(i, { value: { key: e.target.value, value: typeof rule.value === 'object' && rule.value !== null ? (rule.value as { value: string }).value : '' } })}
                  className="w-24"
                  aria-label={`ルール${i + 1}のメタデータキー`}
                />
                <Input
                  type="text"
                  placeholder="value"
                  value={typeof rule.value === 'object' && rule.value !== null ? (rule.value as { value: string }).value : ''}
                  onChange={(e) => updateRule(i, { value: { key: typeof rule.value === 'object' && rule.value !== null ? (rule.value as { key: string }).key : '', value: e.target.value } })}
                  className="w-24"
                  aria-label={`ルール${i + 1}のメタデータ値`}
                />
              </>
            )}

            {rule.type !== 'is_following' && (
              <Button type="button" size="xs" shape="square" variant="ghost" onClick={() => removeRule(i)} aria-label={`ルール${i + 1}を削除`}>×</Button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between">
        <Button type="button" size="xs" variant="ghost" onClick={addRule}>+ ルール追加</Button>
        <span className="text-xs text-gray-500">
          {counting ? '計算中...' : count != null ? `該当: ${count.toLocaleString('ja-JP')}人` : ''}
        </span>
      </div>

      <div className="flex gap-2 mt-3 pt-3 border-t border-gray-200">
        <Button
          type="button"
          onClick={() => onApply({ operator, rules })}
          variant="primary"
        >
          適用
        </Button>
        <Button type="button" variant="secondary" onClick={onCancel}>
          キャンセル
        </Button>
      </div>
    </div>
  )
}
