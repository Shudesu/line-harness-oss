import type { Broadcast } from '@line-crm/db';

// These fields determine the payload, audience, sender, and due-time checks.
// Compare nullable columns with IS so legacy NULL values can still be claimed.
const intentColumns = [
  'message_type', 'message_content', 'target_type', 'target_tag_id',
  'line_account_id', 'account_ids', 'dedup_priority', 'track_links',
  'alt_text', 'scheduled_at',
] as const satisfies readonly (keyof Broadcast)[];

/** Start only the editable delivery intent that the caller actually validated. */
export async function claimBroadcastStart(
  db: D1Database,
  expected: Broadcast,
  queue?: { totalCount?: number; segmentConditions?: string },
): Promise<boolean> {
  if (expected.status !== 'draft' && expected.status !== 'scheduled') return false;
  const assignments = ["status = 'sending'"];
  const values: unknown[] = [];
  if (queue) assignments.push('batch_offset = 0');
  if (queue?.totalCount !== undefined) {
    assignments.push('total_count = ?');
    values.push(queue.totalCount);
  }
  if (queue?.segmentConditions !== undefined) {
    assignments.push('segment_conditions = ?');
    values.push(queue.segmentConditions);
  }
  const result = await db.prepare(
    `UPDATE broadcasts SET ${assignments.join(', ')}
      WHERE id = ? AND status = ?
        AND ${intentColumns.map(column => `${column} IS ?`).join(' AND ')}`,
  ).bind(...values, expected.id, expected.status,
    ...intentColumns.map(column => expected[column] ?? null)).run();
  return (result.meta.changes ?? 0) > 0;
}
