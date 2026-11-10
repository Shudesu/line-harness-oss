// Claim-first store behind the Idempotency-Key header (see
// apps/worker/src/services/idempotency.ts for the state table).

export type IdempotencyClaim =
  /** `fresh` is false when an earlier attempt for this key already ran. */
  | { state: 'claimed'; token: string; fresh: boolean }
  | { state: 'completed'; status: number; body: string }
  | { state: 'in_progress' }
  | { state: 'mismatch' };

interface IdempotencyKeyRow {
  request_hash: string;
  status: 'processing' | 'completed';
  response_status: number | null;
  response_body: string | null;
  locked_until: number;
}

/**
 * Atomically take ownership of (scope, key) for one request. Only the caller
 * that gets `claimed` may run side effects. A `processing` row whose lease has
 * expired (the previous attempt crashed or failed) can be claimed again by the
 * same request, never by a different one.
 *
 * Every claim gets its own token. complete / fail / release only act for the
 * token that currently owns the row, so an attempt that outlived its lease
 * cannot touch the claim of the attempt that replaced it.
 */
export async function claimIdempotencyKey(
  db: D1Database,
  input: { scope: string; key: string; requestHash: string; now: number; leaseMs: number },
): Promise<IdempotencyClaim> {
  const { scope, key, requestHash, now } = input;
  const token = crypto.randomUUID();
  const inserted = await db
    .prepare(
      `INSERT INTO api_idempotency_keys (scope, key, request_hash, claim_token, status, locked_until, created_at)
       VALUES (?, ?, ?, ?, 'processing', ?, ?)
       ON CONFLICT(scope, key) DO NOTHING RETURNING key`,
    )
    .bind(scope, key, requestHash, token, now + input.leaseMs, now)
    .first<{ key: string }>();
  if (inserted) return { state: 'claimed', token, fresh: true };

  const row = await db
    .prepare(
      `SELECT request_hash, status, response_status, response_body, locked_until
         FROM api_idempotency_keys WHERE scope = ? AND key = ?`,
    )
    .bind(scope, key)
    .first<IdempotencyKeyRow>();
  // Released between the two statements: let the client retry.
  if (!row) return { state: 'in_progress' };
  if (row.request_hash !== requestHash) return { state: 'mismatch' };
  if (row.status === 'completed') {
    return { state: 'completed', status: row.response_status ?? 200, body: row.response_body ?? 'null' };
  }
  if (row.locked_until > now) return { state: 'in_progress' };

  const retaken = await db
    .prepare(
      `UPDATE api_idempotency_keys SET locked_until = ?, claim_token = ?
        WHERE scope = ? AND key = ? AND status = 'processing' AND locked_until <= ? AND request_hash = ?
        RETURNING key`,
    )
    .bind(now + input.leaseMs, token, scope, key, now, requestHash)
    .first<{ key: string }>();
  return retaken ? { state: 'claimed', token, fresh: false } : { state: 'in_progress' };
}

/** Store the response; later requests with the same key replay it. */
export async function completeIdempotencyKey(
  db: D1Database,
  scope: string,
  key: string,
  token: string,
  response: { status: number; body: string },
): Promise<void> {
  await db
    .prepare(
      `UPDATE api_idempotency_keys SET status = 'completed', response_status = ?, response_body = ?
        WHERE scope = ? AND key = ? AND status = 'processing' AND claim_token = ?`,
    )
    .bind(response.status, response.body, scope, key, token)
    .run();
}

/**
 * The attempt failed after side effects may have started. Keep the row (the
 * key stays bound to this request) but end the lease so the same request can
 * be retried immediately.
 */
export async function failIdempotencyKey(db: D1Database, scope: string, key: string, token: string): Promise<void> {
  await db
    .prepare(`UPDATE api_idempotency_keys SET locked_until = 0 WHERE scope = ? AND key = ? AND status = 'processing' AND claim_token = ?`)
    .bind(scope, key, token)
    .run();
}

/** A first attempt was rejected before any side effect: forget the key. */
export async function releaseIdempotencyKey(db: D1Database, scope: string, key: string, token: string): Promise<void> {
  await db
    .prepare(`DELETE FROM api_idempotency_keys WHERE scope = ? AND key = ? AND status = 'processing' AND claim_token = ?`)
    .bind(scope, key, token)
    .run();
}
