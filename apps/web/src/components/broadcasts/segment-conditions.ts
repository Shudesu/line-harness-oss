// Shared helpers for broadcast segment conditions (include / exclude tags).
// The worker (apps/worker/src/services/saved-segment.ts) wraps the saved
// condition as: following AND (target tag, if any) AND (saved condition).

export interface SegmentRule {
  type: 'tag_exists' | 'tag_not_exists' | 'metadata_equals' | 'metadata_not_equals' | 'ref_code' | 'is_following' | 'group'
  value: string | boolean | { key: string; value: string } | SegmentCondition
}

export interface SegmentCondition {
  operator: 'AND' | 'OR'
  rules: SegmentRule[]
}

export interface TagFilter {
  includeTagIds: string[]
  includeMode: 'any' | 'all'
  excludeTagIds: string[]
}

export const emptyTagFilter: TagFilter = { includeTagIds: [], includeMode: 'any', excludeTagIds: [] }

/** Build the condition saved on the broadcast. Returns null when nothing is selected. */
export function tagFilterToCondition(filter: TagFilter): SegmentCondition | null {
  const rules: SegmentRule[] = []
  if (filter.includeTagIds.length > 0) {
    rules.push({
      type: 'group',
      value: {
        operator: filter.includeMode === 'all' ? 'AND' : 'OR',
        rules: filter.includeTagIds.map((id) => ({ type: 'tag_exists', value: id })),
      },
    })
  }
  for (const id of filter.excludeTagIds) rules.push({ type: 'tag_not_exists', value: id })
  return rules.length > 0 ? { operator: 'AND', rules } : null
}

/**
 * Inverse of tagFilterToCondition. Returns null when the saved condition was
 * created elsewhere (API / MCP) and cannot be shown as a simple tag filter.
 */
export function conditionToTagFilter(condition: SegmentCondition | null | undefined): TagFilter | null {
  if (!condition) return { ...emptyTagFilter }
  if (condition.operator !== 'AND' || !Array.isArray(condition.rules)) return null
  const filter: TagFilter = { includeTagIds: [], includeMode: 'any', excludeTagIds: [] }
  let sawGroup = false
  for (const rule of condition.rules) {
    if (rule.type === 'tag_not_exists' && typeof rule.value === 'string') {
      filter.excludeTagIds.push(rule.value)
    } else if (rule.type === 'tag_exists' && typeof rule.value === 'string' && !sawGroup) {
      // A single include tag saved as a plain rule.
      filter.includeTagIds.push(rule.value)
      filter.includeMode = 'all'
    } else if (rule.type === 'group' && !sawGroup && typeof rule.value === 'object' && rule.value !== null) {
      const inner = rule.value as SegmentCondition
      if (!Array.isArray(inner.rules) || !inner.rules.every((r) => r.type === 'tag_exists' && typeof r.value === 'string')) return null
      sawGroup = true
      filter.includeMode = inner.operator === 'AND' ? 'all' : 'any'
      filter.includeTagIds.push(...inner.rules.map((r) => r.value as string))
    } else {
      return null
    }
  }
  return filter
}

/** The audience actually delivered to (mirrors the worker). Used for the live count. */
export function audienceCondition(saved: SegmentCondition, targetTagId?: string | null): SegmentCondition {
  const rules: SegmentRule[] = [{ type: 'is_following', value: true }]
  if (targetTagId) rules.push({ type: 'tag_exists', value: targetTagId })
  rules.push({ type: 'group', value: saved })
  return { operator: 'AND', rules }
}

/** Human readable summary, e.g. 「含める（いずれか）: A, B ／ 除外: C」 */
export function describeCondition(condition: SegmentCondition | null | undefined, tagName: (id: string) => string): string {
  const filter = conditionToTagFilter(condition)
  if (!condition) return ''
  if (!filter) return 'API などで設定された詳細条件'
  const parts: string[] = []
  if (filter.includeTagIds.length > 0) {
    parts.push(`含める（${filter.includeMode === 'all' ? 'すべて' : 'いずれか'}）: ${filter.includeTagIds.map(tagName).join(', ')}`)
  }
  if (filter.excludeTagIds.length > 0) parts.push(`除外: ${filter.excludeTagIds.map(tagName).join(', ')}`)
  return parts.join(' ／ ')
}
