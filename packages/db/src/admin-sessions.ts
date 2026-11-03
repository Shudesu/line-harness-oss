import { hashApiKey } from './staff.js';

export type AdminSessionAuthMethod = 'api_key' | 'sso';
export interface AdminSession {
  id_hash: string;
  staff_id: string;
  credential_fp: string;
  role_at_issue: 'owner' | 'admin' | 'staff';
  auth_method: AdminSessionAuthMethod;
  created_at: number;
  last_seen_at: number;
  expires_at: number;
  revoked_at: number | null;
  user_agent: string | null;
  auth_subject: string | null;
}
const TOKEN = /^lhs_[A-Za-z0-9_-]{43}$/;
export function adminSessionTtl(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.max(1, Math.min(2_592_000, Math.floor(parsed))) : 604_800;
}
export async function createAdminSession(db: D1Database, input: {
  staffId: string; credentialFp: string; role: AdminSession['role_at_issue'];
  authMethod: AdminSessionAuthMethod; ttlSeconds?: number; now?: number; userAgent?: string; authSubject?:string;
}): Promise<{ token: string; expiresAt: number; createdAt: number; sessionId: string }> {
  if (!/^[0-9a-f]{64}$/.test(input.credentialFp)) throw new Error('Invalid session credential fingerprint');
  const random = crypto.getRandomValues(new Uint8Array(32));
  const token = 'lhs_' + btoa(String.fromCharCode(...random)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const sessionId = await hashApiKey(token);
  const now = Math.floor(input.now ?? Date.now() / 1000);
  const expiresAt = now + adminSessionTtl(input.ttlSeconds);
  await db.prepare(`INSERT INTO admin_sessions
    (id_hash,staff_id,credential_fp,role_at_issue,auth_method,created_at,last_seen_at,expires_at,user_agent,auth_subject)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(sessionId,input.staffId,input.credentialFp,input.role,input.authMethod,now,now,expiresAt,input.userAgent?.slice(0,200) ?? null,input.authSubject??null).run();
  return { token, expiresAt, createdAt: now, sessionId };
}
export async function getAdminSession(db: D1Database, token: string, now = Math.floor(Date.now()/1000)): Promise<AdminSession | null> {
  if (!TOKEN.test(token)) return null;
  const hash = await hashApiKey(token);
  const row = await db.prepare('SELECT * FROM admin_sessions WHERE id_hash = ? AND revoked_at IS NULL AND expires_at > ?')
    .bind(hash,now).first<AdminSession>();
  if (!row) return null;
  if (row.last_seen_at <= now - 300) {
    try {
      await db.prepare('UPDATE admin_sessions SET last_seen_at = ? WHERE id_hash = ? AND last_seen_at <= ? AND revoked_at IS NULL AND expires_at > ?')
        .bind(now,hash,now-300,now).run();
    } catch { /* Best-effort activity metadata must not log users out. */ }
  }
  return row;
}
export async function revokeAdminSession(db: D1Database, token: string, now = Math.floor(Date.now()/1000)): Promise<void> {
  if (!TOKEN.test(token)) return;
  await db.prepare('UPDATE admin_sessions SET revoked_at = ? WHERE id_hash = ? AND revoked_at IS NULL')
    .bind(now,await hashApiKey(token)).run();
}
export async function revokeAdminSessionsForStaff(db: D1Database, staffId: string, now = Math.floor(Date.now()/1000)): Promise<number> {
  const result = await db.prepare('UPDATE admin_sessions SET revoked_at = ? WHERE staff_id = ? AND revoked_at IS NULL AND expires_at > ?')
    .bind(now,staffId,now).run();
  return result.meta.changes;
}
export async function purgeExpiredAdminSessions(db: D1Database, now = Math.floor(Date.now()/1000), limit = 100): Promise<number> {
  const bounded = Number.isFinite(limit) ? Math.max(1,Math.min(100,Math.floor(limit))) : 100;
  const result = await db.prepare(`DELETE FROM admin_sessions WHERE id_hash IN
    (SELECT id_hash FROM admin_sessions WHERE expires_at <= ? ORDER BY expires_at,id_hash LIMIT ?)`)
    .bind(now,bounded).run();
  return result.meta.changes;
}
