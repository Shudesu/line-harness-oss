'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { fetchApi } from '@/lib/api'
import { useAccount } from '@/contexts/account-context'

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SegmentRule {
  type: string
  value: string | number | boolean | { key: string; value: string }
}

interface SegmentCondition {
  operator: 'AND' | 'OR'
  rules: (SegmentRule | SegmentCondition)[]
}

interface Tag {
  id: string
  name: string
}

// ─── Rule type options ─────────────────────────────────────────────────────────

const ruleTypeOptions = [
  { value: 'tag_exists', label: 'タグあり' },
  { value: 'tag_not_exists', label: 'タグなし' },
  { value: 'score_gte', label: 'スコア以上' },
  { value: 'score_lte', label: 'スコア以下' },
  { value: 'metadata_equals', label: 'メタデータ一致' },
  { value: 'metadata_not_equals', label: 'メタデータ不一致' },
  { value: 'ref_code', label: '流入経路' },
  { value: 'is_following', label: 'フォロー状態' },
  { value: 'created_at_after', label: '登録日以降' },
  { value: 'created_at_before', label: '登録日以前' },
]

function defaultValue(type: string): SegmentRule['value'] {
  if (type === 'tag_exists' || type === 'tag_not_exists' || type === 'ref_code') return ''
  if (type === 'score_gte' || type === 'score_lte') return 0
  if (type === 'is_following') return true
  if (type === 'metadata_equals' || type === 'metadata_not_equals') return { key: '', value: '' }
  if (type === 'created_at_after' || type === 'created_at_before') return ''
  return ''
}

// ─── Single rule row ───────────────────────────────────────────────────────────

function RuleRow({
  rule,
  tags,
  onChange,
  onRemove,
}: {
  rule: SegmentRule
  tags: Tag[]
  onChange: (rule: SegmentRule) => void
  onRemove: () => void
}) {
  const handleTypeChange = (newType: string) => {
    onChange({ type: newType, value: defaultValue(newType) })
  }

  return (
    <div className="flex items-start gap-2 bg-white rounded-lg p-2 border border-gray-200">
      {/* Rule type selector */}
      <select
        className="border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[120px]"
        value={rule.type}
        onChange={(e) => handleTypeChange(e.target.value)}
      >
        {ruleTypeOptions.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>

      {/* Value input based on type */}
      <div className="flex-1">
        {(rule.type === 'tag_exists' || rule.type === 'tag_not_exists') && (
          <select
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
            value={rule.value as string}
            onChange={(e) => onChange({ ...rule, value: e.target.value })}
          >
            <option value="">タグを選択...</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        )}

        {(rule.type === 'score_gte' || rule.type === 'score_lte') && (
          <input
            type="number"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="スコア値"
            value={rule.value as number}
            onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })}
          />
        )}

        {(rule.type === 'metadata_equals' || rule.type === 'metadata_not_equals') && (
          <div className="flex gap-1">
            <input
              type="text"
              className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="キー"
              value={(rule.value as { key: string; value: string }).key}
              onChange={(e) => onChange({ ...rule, value: { ...(rule.value as { key: string; value: string }), key: e.target.value } })}
            />
            <input
              type="text"
              className="flex-1 border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
              placeholder="値"
              value={(rule.value as { key: string; value: string }).value}
              onChange={(e) => onChange({ ...rule, value: { ...(rule.value as { key: string; value: string }), value: e.target.value } })}
            />
          </div>
        )}

        {rule.type === 'ref_code' && (
          <input
            type="text"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
            placeholder="流入経路コード"
            value={rule.value as string}
            onChange={(e) => onChange({ ...rule, value: e.target.value })}
          />
        )}

        {rule.type === 'is_following' && (
          <select
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-green-500"
            value={rule.value ? 'true' : 'false'}
            onChange={(e) => onChange({ ...rule, value: e.target.value === 'true' })}
          >
            <option value="true">フォロー中</option>
            <option value="false">ブロック/未フォロー</option>
          </select>
        )}

        {(rule.type === 'created_at_after' || rule.type === 'created_at_before') && (
          <input
            type="date"
            className="w-full border border-gray-300 rounded px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-green-500"
            value={rule.value as string}
            onChange={(e) => onChange({ ...rule, value: e.target.value })}
          />
        )}
      </div>

      <button
        type="button"
        onClick={onRemove}
        className="px-1.5 py-1 text-xs text-red-400 hover:text-red-600"
      >
        ✕
      </button>
    </div>
  )
}

// ─── Condition group ──────────────────────────────────────────────────────────

function ConditionGroup({
  condition,
  tags,
  onChange,
  depth,
}: {
  condition: SegmentCondition
  tags: Tag[]
  onChange: (condition: SegmentCondition) => void
  depth: number
}) {
  const addRule = () => {
    onChange({ ...condition, rules: [...condition.rules, { type: 'tag_exists', value: '' }] })
  }

  const addGroup = () => {
    if (depth >= 2) return // max 3 levels
    onChange({
      ...condition,
      rules: [...condition.rules, { operator: 'AND', rules: [{ type: 'tag_exists', value: '' }] }],
    })
  }

  const updateEntry = (index: number, entry: SegmentRule | SegmentCondition) => {
    const next = [...condition.rules]
    next[index] = entry
    onChange({ ...condition, rules: next })
  }

  const removeEntry = (index: number) => {
    onChange({ ...condition, rules: condition.rules.filter((_, i) => i !== index) })
  }

  const isNested = (entry: SegmentRule | SegmentCondition): entry is SegmentCondition => {
    return 'operator' in entry && 'rules' in entry
  }

  const bgColors = ['bg-gray-50', 'bg-blue-50', 'bg-green-50']

  return (
    <div className={`${bgColors[depth] || 'bg-gray-50'} rounded-lg p-3 border border-gray-200`}>
      {/* Operator toggle */}
      <div className="flex items-center gap-2 mb-2">
        <div className="flex rounded-md border border-gray-300 overflow-hidden">
          <button
            type="button"
            onClick={() => onChange({ ...condition, operator: 'AND' })}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              condition.operator === 'AND' ? 'bg-green-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            AND
          </button>
          <button
            type="button"
            onClick={() => onChange({ ...condition, operator: 'OR' })}
            className={`px-3 py-1 text-xs font-medium transition-colors ${
              condition.operator === 'OR' ? 'bg-orange-500 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            OR
          </button>
        </div>
        <span className="text-xs text-gray-400">
          {condition.operator === 'AND' ? '全て満たす' : 'いずれかを満たす'}
        </span>
      </div>

      {/* Rules */}
      <div className="space-y-2">
        {condition.rules.map((entry, i) => (
          <div key={i}>
            {isNested(entry) ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => removeEntry(i)}
                  className="absolute -top-1 -right-1 z-10 px-1.5 py-0.5 text-xs text-red-400 hover:text-red-600 bg-white rounded-full border border-gray-200"
                >
                  ✕
                </button>
                <ConditionGroup
                  condition={entry}
                  tags={tags}
                  onChange={(updated) => updateEntry(i, updated)}
                  depth={depth + 1}
                />
              </div>
            ) : (
              <RuleRow
                rule={entry}
                tags={tags}
                onChange={(updated) => updateEntry(i, updated)}
                onRemove={() => removeEntry(i)}
              />
            )}
          </div>
        ))}
      </div>

      {/* Add buttons */}
      <div className="flex gap-2 mt-2">
        <button
          type="button"
          onClick={addRule}
          className="text-xs text-green-600 hover:text-green-800"
        >
          + 条件追加
        </button>
        {depth < 2 && (
          <button
            type="button"
            onClick={addGroup}
            className="text-xs text-blue-600 hover:text-blue-800"
          >
            + グループ追加
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Audience preview ─────────────────────────────────────────────────────────

function AudiencePreview({ condition }: { condition: SegmentCondition }) {
  const { selectedAccount } = useAccount()
  const [count, setCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchCount = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetchApi<{ success: boolean; data: { count: number } }>('/api/segments/preview', {
        method: 'POST',
        body: JSON.stringify({ conditions: condition, lineAccountId: selectedAccount?.id }),
      })
      setCount(res.data?.count ?? 0)
    } catch {
      setCount(null)
    } finally {
      setLoading(false)
    }
  }, [condition, selectedAccount?.id])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(fetchCount, 500)
    return () => { if (timerRef.current) clearTimeout(timerRef.current) }
  }, [fetchCount])

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-green-50 border border-green-200 rounded-lg">
      <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
      {loading ? (
        <span className="text-sm text-gray-500">集計中...</span>
      ) : count !== null ? (
        <span className="text-sm font-semibold text-green-700">対象: {count.toLocaleString()}人</span>
      ) : (
        <span className="text-sm text-gray-400">--</span>
      )}
    </div>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

interface SegmentBuilderProps {
  condition: SegmentCondition
  onChange: (condition: SegmentCondition) => void
  showPreview?: boolean
}

export default function SegmentBuilder({ condition, onChange, showPreview = true }: SegmentBuilderProps) {
  const [tags, setTags] = useState<Tag[]>([])

  useEffect(() => {
    fetchApi<{ success: boolean; data: Tag[] }>('/api/tags').then((res) => {
      if (res.data) setTags(res.data)
    }).catch(() => {})
  }, [])

  return (
    <div className="space-y-3">
      <ConditionGroup condition={condition} tags={tags} onChange={onChange} depth={0} />
      {showPreview && <AudiencePreview condition={condition} />}
    </div>
  )
}

export type { SegmentCondition, SegmentRule }
