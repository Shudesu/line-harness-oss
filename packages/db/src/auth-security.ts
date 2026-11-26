import { hashApiKey } from './staff.js';

/** Atomic fixed window; a primary-key UPSERT serializes concurrent isolates.
 * Denied attempts do not increment the saturated row. No raw IP/key is stored. */
export async function consumeAuthRateLimit(db: D1Database, namespace: string, identity: string,
  max: number, windowSeconds: number, now = Math.floor(Date.now() / 1000)) {
  const start = Math.floor(now / windowSeconds) * windowSeconds;
  const expires = start + windowSeconds;
  const hash = await hashApiKey(JSON.stringify([namespace, identity]));
  const row = await db.prepare(`INSERT INTO auth_rate_limits (bucket_hash,window_start,attempts,expires_at)
    VALUES (?,?,1,?) ON CONFLICT(bucket_hash) DO UPDATE SET
    window_start=excluded.window_start,
    attempts=CASE WHEN auth_rate_limits.window_start < excluded.window_start THEN 1 ELSE auth_rate_limits.attempts+1 END,
    expires_at=excluded.expires_at
    WHERE auth_rate_limits.window_start < excluded.window_start OR auth_rate_limits.attempts < ?
    RETURNING attempts`).bind(hash,start,expires,max).first<{attempts: number}>();
  return { allowed: row !== null, remaining: row ? Math.max(0,max-row.attempts) : 0, retryAfter: Math.max(1,expires-now) };
}

export type AuditAction = 'login' | 'logout' | 'sso' | 'key_rejected' | 'access_rejected' | 'staff_change' | 'admin_update' | 'key_migration' | 'sessions_revoke';
export type AuditOutcome = 'success' | 'denied' | 'attempted';
/** No request bodies, URLs, credentials, arbitrary metadata or user agents. */
export async function writeAuthAudit(db: D1Database, event: {
  actorId: string; action: AuditAction; ip: string; outcome: AuditOutcome;
}, now = Math.floor(Date.now()/1000)): Promise<void> {
  await db.prepare('INSERT INTO auth_audit_log (id,actor_id,action,occurred_at,ip,outcome) VALUES (?,?,?,?,?,?)')
    .bind(crypto.randomUUID(),event.actorId,event.action,now,event.ip,event.outcome).run();
}

/** Indexed, bounded retention; invoked explicitly by the owner, never a sweep. */
export async function purgeAuthSecurityData(db: D1Database, now = Math.floor(Date.now()/1000)): Promise<void> {
  await db.batch([
    db.prepare('DELETE FROM auth_rate_limits WHERE bucket_hash IN (SELECT bucket_hash FROM auth_rate_limits WHERE expires_at <= ? ORDER BY expires_at,bucket_hash LIMIT 100)').bind(now),
    db.prepare('DELETE FROM auth_audit_log WHERE id IN (SELECT id FROM auth_audit_log WHERE occurred_at < ? ORDER BY occurred_at,id LIMIT 100)').bind(now-90*86400),
  ]);
}
