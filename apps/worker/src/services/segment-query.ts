export interface SegmentRule {
  type: 'tag_exists' | 'tag_not_exists' | 'metadata_equals' | 'metadata_not_equals' | 'ref_code' | 'is_following' | 'group'
  /** `group` takes a nested SegmentCondition (e.g. "any of these tags" inside an AND with exclusions). */
  value: string | boolean | { key: string; value: string } | SegmentCondition
}

export interface SegmentCondition {
  operator: 'AND' | 'OR'
  rules: SegmentRule[]
}

/** Nested groups beyond this depth are rejected (keeps SQL bounded). */
const MAX_SEGMENT_DEPTH = 8
/** Total rules across all groups. */
const MAX_SEGMENT_RULES = 200

export function buildSegmentQuery(condition: SegmentCondition): { sql: string; bindings: unknown[] } {
  const bindings: unknown[] = []
  const where = buildSegmentWhere(condition, bindings, 0, { rules: 0 })
  // Callers prepend account/following constraints. Keep the complete segment
  // grouped so `account AND (left OR right)` cannot become `(account AND left) OR right`.
  const sql = `SELECT f.id, f.line_user_id, f.display_name FROM friends f WHERE (${where}) ORDER BY f.created_at ASC, f.id ASC`

  return { sql, bindings }
}

function buildSegmentWhere(
  condition: SegmentCondition,
  bindings: unknown[],
  depth: number,
  counter: { rules: number },
): string {
  if (depth > MAX_SEGMENT_DEPTH) {
    throw new Error('Segment conditions are nested too deeply')
  }
  if (
    typeof condition !== 'object' || condition === null
    || (condition.operator !== 'AND' && condition.operator !== 'OR')
    || !Array.isArray(condition.rules)
  ) {
    throw new Error('Segment condition requires operator AND|OR and a rules array')
  }
  const clauses: string[] = []

  for (const rule of condition.rules) {
    counter.rules += 1
    if (counter.rules > MAX_SEGMENT_RULES) {
      throw new Error('Too many segment rules')
    }
    if (typeof rule !== 'object' || rule === null) {
      throw new Error('Segment rule must be an object')
    }
    switch (rule.type) {
      case 'tag_exists': {
        if (typeof rule.value !== 'string') {
          throw new Error('tag_exists rule requires a string tag ID value')
        }
        clauses.push(
          `EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)`,
        )
        bindings.push(rule.value)
        break
      }

      case 'tag_not_exists': {
        if (typeof rule.value !== 'string') {
          throw new Error('tag_not_exists rule requires a string tag ID value')
        }
        clauses.push(
          `NOT EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)`,
        )
        bindings.push(rule.value)
        break
      }

      case 'metadata_equals': {
        if (
          typeof rule.value !== 'object' ||
          rule.value === null ||
          typeof (rule.value as { key: string; value: string }).key !== 'string' ||
          typeof (rule.value as { key: string; value: string }).value !== 'string'
        ) {
          throw new Error('metadata_equals rule requires { key: string; value: string }')
        }
        const mv = rule.value as { key: string; value: string }
        clauses.push(`json_extract(f.metadata, ?) = ?`)
        bindings.push(`$.${mv.key}`, mv.value)
        break
      }

      case 'metadata_not_equals': {
        if (
          typeof rule.value !== 'object' ||
          rule.value === null ||
          typeof (rule.value as { key: string; value: string }).key !== 'string' ||
          typeof (rule.value as { key: string; value: string }).value !== 'string'
        ) {
          throw new Error('metadata_not_equals rule requires { key: string; value: string }')
        }
        const mv = rule.value as { key: string; value: string }
        clauses.push(`(json_extract(f.metadata, ?) IS NULL OR json_extract(f.metadata, ?) != ?)`)
        bindings.push(`$.${mv.key}`, `$.${mv.key}`, mv.value)
        break
      }

      case 'ref_code': {
        if (typeof rule.value !== 'string') {
          throw new Error('ref_code rule requires a string value')
        }
        clauses.push(`f.ref_code = ?`)
        bindings.push(rule.value)
        break
      }

      case 'is_following': {
        if (typeof rule.value !== 'boolean') {
          throw new Error('is_following rule requires a boolean value')
        }
        clauses.push(`f.is_following = ?`)
        bindings.push(rule.value ? 1 : 0)
        break
      }

      case 'group': {
        const inner = buildSegmentWhere(rule.value as SegmentCondition, bindings, depth + 1, counter)
        clauses.push(`(${inner})`)
        break
      }

      default: {
        const exhaustive: never = rule.type
        throw new Error(`Unknown segment rule type: ${exhaustive}`)
      }
    }
  }

  const separator = condition.operator === 'AND' ? ' AND ' : ' OR '
  return clauses.length > 0 ? clauses.join(separator) : '1=1'
}
