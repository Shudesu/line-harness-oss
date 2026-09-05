/**
 * Replay ledger for external admin SSO tokens (`GET /admin/sso?token=…`).
 *
 * A signed, unexpired token is a bearer credential that lives in a URL, so it
 * must work exactly once. Worker isolates do not share memory, so the ledger
 * has to be durable — a two-column D1 table is enough.
 */

export interface ConsumeAdminSsoJtiResult {
  /** True when this jti had never been seen — i.e. the token may be redeemed. */
  consumed: boolean;
  /** Expired ledger rows removed on the way through (observability only). */
  purged: number;
}

/**
 * Atomically burn `jti`. Returns `consumed: false` when it was already burnt,
 * which the caller must treat as a replay and reject.
 *
 * Expired rows are swept lazily in the same batch. That is safe: any row whose
 * `exp` has passed belongs to a token the signature/claim check would already
 * reject, so removing it cannot resurrect a usable token.
 */
export async function consumeAdminSsoJti(
  db: D1Database,
  jti: string,
  expEpochSeconds: number,
  nowEpochSeconds: number,
): Promise<ConsumeAdminSsoJtiResult> {
  const [purge, insert] = await db.batch([
    db.prepare('DELETE FROM sso_jti WHERE exp <= ?').bind(nowEpochSeconds),
    db
      .prepare('INSERT OR IGNORE INTO sso_jti (jti, exp) VALUES (?, ?)')
      .bind(jti, expEpochSeconds),
  ]);

  return {
    consumed: (insert?.meta?.changes ?? 0) > 0,
    purged: purge?.meta?.changes ?? 0,
  };
}
