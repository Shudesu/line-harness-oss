import { describe, expect, it } from 'vitest'
import { audienceCondition, conditionToTagFilter, describeCondition, tagFilterToCondition } from './segment-conditions'

describe('segment tag filter conversion', () => {
  it('builds exclude-only conditions (休会・退会以外)', () => {
    const c = tagFilterToCondition({ includeTagIds: [], includeMode: 'any', excludeTagIds: ['paused', 'left'] })
    expect(c).toEqual({ operator: 'AND', rules: [{ type: 'tag_not_exists', value: 'paused' }, { type: 'tag_not_exists', value: 'left' }] })
    expect(conditionToTagFilter(c)).toEqual({ includeTagIds: [], includeMode: 'any', excludeTagIds: ['paused', 'left'] })
  })

  it('builds include-any + exclude with a nested group and round-trips it', () => {
    const filter = { includeTagIds: ['a', 'b'], includeMode: 'any' as const, excludeTagIds: ['x'] }
    const c = tagFilterToCondition(filter)!
    expect(c.rules[0]).toEqual({ type: 'group', value: { operator: 'OR', rules: [{ type: 'tag_exists', value: 'a' }, { type: 'tag_exists', value: 'b' }] } })
    expect(conditionToTagFilter(c)).toEqual(filter)
    expect(describeCondition(c, (id) => id.toUpperCase())).toBe('含める（いずれか）: A, B ／ 除外: X')
  })

  it('returns null for nothing selected and for conditions it cannot represent', () => {
    expect(tagFilterToCondition({ includeTagIds: [], includeMode: 'all', excludeTagIds: [] })).toBeNull()
    expect(conditionToTagFilter({ operator: 'OR', rules: [{ type: 'tag_not_exists', value: 'x' }] })).toBeNull()
    expect(conditionToTagFilter({ operator: 'AND', rules: [{ type: 'metadata_equals', value: { key: 'k', value: 'v' } }] })).toBeNull()
  })

  it('wraps the saved condition the same way the worker does', () => {
    const saved = { operator: 'AND' as const, rules: [{ type: 'tag_not_exists' as const, value: 'x' }] }
    expect(audienceCondition(saved, 'target')).toEqual({
      operator: 'AND',
      rules: [{ type: 'is_following', value: true }, { type: 'tag_exists', value: 'target' }, { type: 'group', value: saved }],
    })
  })
})
