import { PERSONALIZED_EMPTY } from './broadcast-personalized-intent.js';
const owned = `id = ? AND status = 'sending' AND sent_at IS NULL
  AND batch_offset = -1 AND batch_lock_at = ?`;
const receiptCount = `SELECT COUNT(*) FROM messages_log WHERE broadcast_id = ?
  AND direction = 'outgoing' AND COALESCE(delivery_type, '') != 'test'`;

export async function personalizedFriendState(db: D1Database, id: string, claimAt: string, friendId: string) {
  return db.prepare(`SELECT EXISTS(SELECT 1 FROM broadcasts WHERE ${owned}) AS owned,
    EXISTS(SELECT 1 FROM messages_log WHERE broadcast_id = ? AND friend_id = ?
      AND direction = 'outgoing' AND COALESCE(delivery_type, '') != 'test') AS logged`)
    .bind(id, claimAt, id, friendId).first<{ owned: number; logged: number }>();
}

export async function recordPersonalizedReceipt(db: D1Database, receipt: {
  id: string; claimAt: string; friendId: string; messageType: string;
  content: string; accountId: string | null; createdAt: string; pendingRaw?: string;
}): Promise<boolean> {
  const receiptId = crypto.randomUUID();
  const insert = db.prepare(`INSERT INTO messages_log
    (id, friend_id, direction, message_type, content, broadcast_id, scenario_step_id, source, line_account_id, created_at)
    SELECT ?, ?, 'outgoing', ?, ?, ?, NULL, 'broadcast', ?, ?
    WHERE EXISTS(SELECT 1 FROM broadcasts WHERE ${owned}${receipt.pendingRaw === undefined ? '' : ' AND dedup_progress IS ?'})
      AND NOT EXISTS(SELECT 1 FROM messages_log WHERE broadcast_id = ? AND friend_id = ?
        AND direction = 'outgoing' AND COALESCE(delivery_type, '') != 'test')`)
    .bind(receiptId, receipt.friendId, receipt.messageType, receipt.content, receipt.id,
      receipt.accountId, receipt.createdAt, receipt.id, receipt.claimAt,
      ...(receipt.pendingRaw === undefined ? [] : [receipt.pendingRaw]), receipt.id, receipt.friendId);
  if (receipt.pendingRaw === undefined) return (await insert.run()).meta.changes === 1;
  // Acceptance receipt and journal consumption must commit together. An old
  // response cannot consume another claim's request or invent a second receipt.
  try {
    const results = await db.batch([insert,
    db.prepare(`UPDATE broadcasts SET dedup_progress = ? WHERE ${owned} AND dedup_progress IS ?
      AND EXISTS(SELECT 1 FROM messages_log WHERE id = ? AND broadcast_id = ?)`)
      .bind(PERSONALIZED_EMPTY, receipt.id, receipt.claimAt, receipt.pendingRaw, receiptId, receipt.id),
  ]);
    return results[0].meta.changes === 1 && results[1].meta.changes === 1;
  } catch (error) {
    // The commit may have succeeded even if its response was lost. Require the
    // exact newly minted receipt and unchanged owner, not a guessed row count.
    const committed = await db.prepare(`SELECT EXISTS(SELECT 1 FROM broadcasts WHERE ${owned}
      AND dedup_progress = ? AND EXISTS(SELECT 1 FROM messages_log WHERE id = ? AND broadcast_id = ?)) AS committed`)
      .bind(receipt.id, receipt.claimAt, PERSONALIZED_EMPTY, receiptId, receipt.id).first<{ committed: number }>();
    if (committed?.committed === 1) return true;
    throw error;
  }
}

export async function releasePersonalizedClaim(db: D1Database, state: {
  id: string; claimAt: string; offset: number; total: number; lastError?: string;
}): Promise<void> {
  await db.prepare(`UPDATE broadcasts SET batch_offset = ?, batch_lock_at = NULL,
    total_count = MAX(total_count, ?), success_count = (${receiptCount})
    ${state.lastError === undefined ? '' : ', last_error = ?'} WHERE ${owned}`)
    .bind(state.offset, state.total, state.id, ...(state.lastError === undefined ? [] : [state.lastError]), state.id, state.claimAt).run();
}

const noPending = ` AND (dedup_progress IS NULL OR dedup_progress = '${PERSONALIZED_EMPTY}')`;

export async function finishPersonalizedClaim(db: D1Database, state: {
  id: string; claimAt: string; offset: number; total: number;
  unit: string; sentAt: string; lastError: string | null;
}): Promise<void> {
  await db.batch([
    db.prepare(`INSERT INTO broadcast_insights (id, broadcast_id, status)
      SELECT ?, id, 'pending' FROM broadcasts WHERE ${owned}${noPending}
        AND NOT EXISTS(SELECT 1 FROM broadcast_insights WHERE broadcast_id = broadcasts.id)`)
      .bind(crypto.randomUUID(), state.id, state.claimAt),
    db.prepare(`UPDATE broadcasts SET status = 'sent', sent_at = ?, batch_offset = ?, batch_lock_at = NULL,
      total_count = MAX(total_count, ?), success_count = (${receiptCount}),
      dedup_progress = NULL, line_request_id = NULL, aggregation_unit = ?, last_error = ? WHERE ${owned}${noPending}`)
      .bind(state.sentAt, state.offset, state.total, state.id, state.unit, state.lastError, state.id, state.claimAt),
  ]);
}
