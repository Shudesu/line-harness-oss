import { buildSegmentQuery } from './segment-query.js';
import type { SegmentCondition } from './segment-query.js';

/**
 * Segment conditions saved on a draft/scheduled broadcast (admin UI
 * 「セグメント条件を編集」 or PUT /api/broadcasts/:id { segmentConditions }).
 *
 * Before this module existed the conditions were silently dropped on save and
 * ignored by /send and the scheduler, so an operator who "excluded" a tag
 * still delivered to everyone. Every send/preview path now resolves the real
 * audience through `savedSegmentAudience`.
 */

type BroadcastLike = { target_type: string; target_tag_id?: string | null };

/**
 * Parse + validate segment conditions coming from an API body or the DB
 * column. Returns null for "no conditions" (null / '' / empty rules) and
 * throws on malformed input.
 */
export function parseSavedSegmentConditions(input: unknown): SegmentCondition | null {
  if (input === null || input === undefined || input === '') return null;
  let value: unknown = input;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new Error('segmentConditions must be valid JSON');
    }
  }
  if (typeof value !== 'object' || value === null) {
    throw new Error('segmentConditions must be an object');
  }
  const condition = value as SegmentCondition;
  // Validates operator / rules / every rule shape (throws on invalid).
  buildSegmentQuery(condition);
  if (condition.rules.length === 0) return null;
  return { operator: condition.operator, rules: condition.rules };
}

/**
 * The exact audience a broadcast with saved conditions is delivered to:
 * following friends, inside the broadcast's target tag (when target_type is
 * 'tag'), matching the saved conditions. Returns null when the broadcast has
 * no saved conditions or uses a target that does not support them.
 */
export function savedSegmentAudience(broadcast: BroadcastLike): SegmentCondition | null {
  if (broadcast.target_type !== 'all' && broadcast.target_type !== 'tag') return null;
  const raw = (broadcast as unknown as Record<string, unknown>).segment_conditions;
  let saved: SegmentCondition | null;
  try {
    saved = parseSavedSegmentConditions(raw);
  } catch {
    // Fail closed: a corrupt saved condition must never widen to "everyone".
    throw new Error('Saved segment conditions are invalid; edit the broadcast conditions before sending');
  }
  if (!saved) return null;
  const rules: SegmentCondition['rules'] = [{ type: 'is_following', value: true }];
  if (broadcast.target_type === 'tag' && broadcast.target_tag_id) {
    rules.push({ type: 'tag_exists', value: broadcast.target_tag_id });
  }
  rules.push({ type: 'group', value: saved });
  return { operator: 'AND', rules };
}

/**
 * Count the audience with the same account scoping as the queued executor
 * (processQueuedBroadcastBatches): `line_account_id = ?` for an account
 * broadcast, `line_account_id IS NULL` otherwise.
 */
export async function countSegmentAudience(
  db: D1Database,
  broadcast: BroadcastLike,
  conditions: SegmentCondition,
): Promise<{ total: number; missingName: number }> {
  const { sql, bindings } = buildSegmentQuery(conditions);
  const accountId = (broadcast as unknown as Record<string, unknown>).line_account_id as string | null;
  const scopedBindings = [...bindings];
  let scopedSql: string;
  if (accountId) {
    scopedSql = sql.replace('WHERE', 'WHERE f.line_account_id = ? AND');
    scopedBindings.unshift(accountId);
  } else {
    scopedSql = sql.replace('WHERE', 'WHERE f.line_account_id IS NULL AND');
  }
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN q.display_name IS NULL OR trim(q.display_name) = '' THEN 1 ELSE 0 END) AS missing_name
         FROM (${scopedSql}) q`,
    )
    .bind(...scopedBindings)
    .first<{ total: number; missing_name: number | null }>();
  return { total: Number(row?.total ?? 0), missingName: Number(row?.missing_name ?? 0) };
}
