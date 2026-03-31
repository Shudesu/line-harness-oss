export interface SegmentRule {
  type:
    | 'tag_exists'
    | 'tag_not_exists'
    | 'metadata_equals'
    | 'metadata_not_equals'
    | 'ref_code'
    | 'is_following'
    | 'score_gte'
    | 'score_lte'
    | 'created_at_after'
    | 'created_at_before'
  value: string | number | boolean | { key: string; value: string }
}

export interface SegmentCondition {
  operator: 'AND' | 'OR'
  rules: (SegmentRule | SegmentCondition)[]
}

/** Check if an entry is a nested SegmentCondition (has operator + rules) */
function isCondition(entry: SegmentRule | SegmentCondition): entry is SegmentCondition {
  return 'operator' in entry && 'rules' in entry
}

/** Recursively build a WHERE clause from a SegmentCondition tree */
function buildClause(
  condition: SegmentCondition,
  bindings: unknown[],
): string {
  const parts: string[] = []

  for (const entry of condition.rules) {
    if (isCondition(entry)) {
      // Recursive nested group
      const nested = buildClause(entry, bindings)
      if (nested) parts.push(`(${nested})`)
      continue
    }

    const rule = entry
    switch (rule.type) {
      case 'tag_exists': {
        parts.push(`EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)`)
        bindings.push(rule.value)
        break
      }

      case 'tag_not_exists': {
        parts.push(`NOT EXISTS (SELECT 1 FROM friend_tags ft WHERE ft.friend_id = f.id AND ft.tag_id = ?)`)
        bindings.push(rule.value)
        break
      }

      case 'metadata_equals': {
        const mv = rule.value as { key: string; value: string }
        parts.push(`json_extract(f.metadata, ?) = ?`)
        bindings.push(`$.${mv.key}`, mv.value)
        break
      }

      case 'metadata_not_equals': {
        const mv = rule.value as { key: string; value: string }
        parts.push(`(json_extract(f.metadata, ?) IS NULL OR json_extract(f.metadata, ?) != ?)`)
        bindings.push(`$.${mv.key}`, `$.${mv.key}`, mv.value)
        break
      }

      case 'ref_code': {
        parts.push(`f.ref_code = ?`)
        bindings.push(rule.value)
        break
      }

      case 'is_following': {
        parts.push(`f.is_following = ?`)
        bindings.push(rule.value ? 1 : 0)
        break
      }

      case 'score_gte': {
        parts.push(`COALESCE(f.score, 0) >= ?`)
        bindings.push(Number(rule.value))
        break
      }

      case 'score_lte': {
        parts.push(`COALESCE(f.score, 0) <= ?`)
        bindings.push(Number(rule.value))
        break
      }

      case 'created_at_after': {
        parts.push(`f.created_at >= ?`)
        bindings.push(rule.value)
        break
      }

      case 'created_at_before': {
        parts.push(`f.created_at <= ?`)
        bindings.push(rule.value)
        break
      }

      default: {
        console.warn(`Unknown segment rule type: ${(rule as SegmentRule).type}`)
      }
    }
  }

  const separator = condition.operator === 'AND' ? ' AND ' : ' OR '
  return parts.length > 0 ? parts.join(separator) : '1=1'
}

export function buildSegmentQuery(condition: SegmentCondition): { sql: string; bindings: unknown[] } {
  const bindings: unknown[] = []
  const where = buildClause(condition, bindings)
  const sql = `SELECT f.id, f.line_user_id FROM friends f WHERE ${where}`
  return { sql, bindings }
}

/** Count-only variant for audience preview */
export function buildSegmentCountQuery(condition: SegmentCondition): { sql: string; bindings: unknown[] } {
  const bindings: unknown[] = []
  const where = buildClause(condition, bindings)
  const sql = `SELECT COUNT(*) as count FROM friends f WHERE ${where}`
  return { sql, bindings }
}
