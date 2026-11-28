import type { Broadcast, UpdateBroadcastInput } from '@line-crm/db';
import { broadcastIntentColumns } from './broadcast-start-claim.js';

/** Editable fields, plus the saved segment conditions the route validates itself. */
export type BroadcastSnapshotEdit = UpdateBroadcastInput & { segment_conditions?: string | null };

const editColumns = [
  'title', 'message_type', 'message_content', 'target_type', 'target_tag_id',
  'status', 'scheduled_at', 'track_links', 'segment_conditions',
] as const satisfies readonly (keyof BroadcastSnapshotEdit)[];

/** Edit and clear obsolete receipts only while the validated snapshot is editable. */
export async function editBroadcastSnapshot(
  db: D1Database,
  expected: Broadcast & { line_request_id?: string | null },
  updates: BroadcastSnapshotEdit,
): Promise<boolean> {
  if (expected.status !== 'draft' && expected.status !== 'scheduled') return false;
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const column of editColumns) {
    if (updates[column] === undefined) continue;
    assignments.push(`${column} = ?`);
    values.push(column === 'track_links' ? (updates[column] ? 1 : 0) : updates[column]);
  }
  assignments.push(
    'dedup_progress = NULL', 'batch_lock_at = NULL', 'success_count = 0',
    'failed_account_ids = NULL', 'sent_at = NULL', 'aggregation_unit = NULL', 'line_request_id = NULL',
  );
  // Include usage markers so a stale preflight cannot erase a later receipt even
  // if another recovery path has already returned the status to editable.
  const columns = ['title', ...broadcastIntentColumns, 'success_count', 'sent_at', 'dedup_progress', 'line_request_id'] as const;
  const predicate = `id = ? AND status = ? AND ${columns.map(column => `${column} IS ?`).join(' AND ')}`;
  const observed = [expected.id, expected.status, ...columns.map(column => expected[column] ?? null)];

  // D1 batch is transactional: no sender may claim between the edit and its
  // cleanup. Delete first using the same predicate, before the UPDATE changes
  // the observed values. A failure in either statement rolls both back.
  const results = await db.batch([
    db.prepare(`DELETE FROM broadcast_insights WHERE broadcast_id = ?
      AND EXISTS (SELECT 1 FROM broadcasts WHERE ${predicate})`).bind(expected.id, ...observed),
    db.prepare(`UPDATE broadcasts SET ${assignments.join(', ')} WHERE ${predicate}`)
      .bind(...values, ...observed),
  ]);
  return (results[1].meta.changes ?? 0) > 0;
}
