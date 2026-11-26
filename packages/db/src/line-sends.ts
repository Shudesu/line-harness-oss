/** LINE only deduplicates a retry key for 24 hours from its first request. */
export const LINE_RETRY_WINDOW_MS = 24 * 60 * 60_000;

export type LineSendClaim =
  | { state: 'claimed'; requestBody: string; token: string; firstStartedAt: number }
  | { state: 'completed' | 'in_progress' | 'requires_review' };

/**
 * Persist BEFORE sending. Unlike an API lease, a live send cannot be reclaimed:
 * the original request may still be running. Only a caught failure makes it
 * retryable, and never beyond the original retry window. Freeze the rendered
 * request so template/tracking changes cannot alter a retried LINE payload.
 */
export async function claimLineSend(
  db: D1Database,
  id: string,
  requestBody: string,
  now: number,
): Promise<LineSendClaim> {
  const token = crypto.randomUUID();
  const inserted = await db.prepare(`INSERT INTO api_line_sends (id, request_body, claim_token, status, first_started_at)
    VALUES (?, ?, ?, 'sending', ?) ON CONFLICT(id) DO NOTHING RETURNING id`)
    .bind(id, requestBody, token, now).first();
  if (inserted) return { state: 'claimed', requestBody, token, firstStartedAt: now };
  const row = await db.prepare(`SELECT status, request_body, first_started_at FROM api_line_sends WHERE id = ?`)
    .bind(id).first<{ status: string; request_body: string; first_started_at: number }>();
  if (!row) return { state: 'in_progress' };
  if (row.status === 'completed') return { state: 'completed' };
  if (now - row.first_started_at >= LINE_RETRY_WINDOW_MS) return { state: 'requires_review' };
  if (row.status === 'sending') return { state: 'in_progress' };
  const claimed = await db.prepare(`UPDATE api_line_sends SET status = 'sending', claim_token = ?
    WHERE id = ? AND status = 'retryable' AND first_started_at > ? RETURNING request_body, first_started_at`)
    .bind(token, id, now - LINE_RETRY_WINDOW_MS).first<{ request_body: string; first_started_at: number }>();
  return claimed ? { state: 'claimed', requestBody: claimed.request_body, token, firstStartedAt: claimed.first_started_at } : { state: 'in_progress' };
}

/** Call only after the request and its local message log have both succeeded. */
export async function completeLineSend(db: D1Database, id: string, token: string): Promise<void> {
  await db.prepare(`UPDATE api_line_sends SET status = 'completed' WHERE id = ? AND status = 'sending' AND claim_token = ?`)
    .bind(id, token).run();
}

/** Preserve the original start time and payload even when LINE's result is unknown. */
export async function failLineSend(db: D1Database, id: string, token: string): Promise<void> {
  await db.prepare(`UPDATE api_line_sends SET status = 'retryable' WHERE id = ? AND status = 'sending' AND claim_token = ?`)
    .bind(id, token).run();
}
