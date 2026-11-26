import { revokeAdminSession, revokeAdminSessionsForStaff, backfillStaffApiKeyHashes, purgeAuthSecurityData, purgeExpiredAdminSessions } from '@line-crm/db';
import { audit, limitAuth } from '../middleware/auth-security.js';
import { requireRole } from '../middleware/role-guard.js';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import {
  ADMIN_AUTH_COOKIE,
  CSRF_COOKIE,
  issueAdminSession,
  cookieToken,
  authenticateCookieSession,
  publicStaffProfile,
  requireAccess,
  authenticateApiToken,
  csrfCookie,
  csrfTokenFromCookie,
  expiredCookie,
} from '../middleware/auth.js';
import { resolveAdminAuthConfig } from '../middleware/admin-auth-config.js';

export const adminAuth = new Hono<Env>();
adminAuth.onError((_error, c) => c.json({success:false,error:'Authentication storage unavailable; check migrations'},503));

/**
 * POST /api/auth/login
 *
 * Validates the API key, then issues:
 *   - lh_admin_session (HttpOnly) — an opaque revocable session ID.
 *   - lh_csrf (readable) — the double-submit CSRF token, also returned in the
 *     body so a cross-site SPA (which cannot read the API's cookie) can echo it
 *     back via the X-CSRF-Token header.
 *
 * Refuses with a clear error when the topology cannot deliver the cookie,
 * turning the silent "login breaks after deploy" failure into an actionable
 * configuration error.
 */
adminAuth.post('/api/auth/login', async (c) => {
  c.header('Cache-Control', 'no-store');
  const limited = await limitAuth(c, 'login'); if (limited) return limited;
  const denied = await requireAccess(c); if (denied) return denied;
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  if (config.misconfigured) {
    console.error('[admin-auth] refused login — misconfigured topology:', config.misconfigured);
    return c.json({ success: false, error: config.misconfigured }, 500);
  }

  const body = await c.req
    .json<{ apiKey?: string }>()
    .catch(() => ({}) as { apiKey?: string });
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const staff = await authenticateApiToken(c, apiKey || null);

  if (!staff) {
    await audit(c, 'login', 'denied');
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  if (staff.apiScopes != null) {
    await audit(c, 'login', 'denied', staff.id);
    return c.json({success:false,error:'Scoped keys cannot create admin sessions'},403);
  }
  await audit(c, 'login', 'attempted', staff.id);
  const csrfToken = crypto.randomUUID();
  await issueAdminSession(c, staff, apiKey);
  c.header('Set-Cookie', csrfCookie(csrfToken, config.sameSite), { append: true });
  return c.json({ success: true, data: publicStaffProfile(staff), csrfToken });
});

/**
 * POST /api/auth/logout — clears both cookies. No CSRF required: clearing your
 * own session is not a meaningful CSRF target, and this keeps logout resilient
 * even if the CSRF token was lost client-side.
 */
adminAuth.post('/api/auth/logout', async (c) => {
  c.header('Cache-Control', 'no-store');
  const token = cookieToken(c);
  const staff = await authenticateCookieSession(c, token);
  if (token) await revokeAdminSession(c.env.DB, token);
  if (staff) await audit(c, 'logout', 'success', staff.id);
  const { sameSite } = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  c.header('Set-Cookie', expiredCookie(ADMIN_AUTH_COOKIE, sameSite), { append: true });
  c.header('Set-Cookie', expiredCookie(CSRF_COOKIE, sameSite), { append: true });
  return c.json({ success: true, data: null });
});

/**
 * GET /api/auth/session — returns the authenticated staff (set by the auth
 * middleware) plus the current CSRF token, refreshing the CSRF cookie if it is
 * missing (e.g. after a reload that dropped the in-memory token). This lets the
 * SPA recover the CSRF token without forcing a re-login.
 */
adminAuth.get('/api/auth/session', async (c) => {
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  let csrfToken = csrfTokenFromCookie(c);
  if (!csrfToken) {
    csrfToken = crypto.randomUUID();
    c.header('Set-Cookie', csrfCookie(csrfToken, config.sameSite), { append: true });
  }
  return c.json({ success: true, data: publicStaffProfile(c.get('staff')), csrfToken });
});

// Owner-driven, bounded Web Crypto backfill (25 rows leaves room for auth on Free); repeat until migrated === 0.
adminAuth.post('/api/auth/migrate-keys', requireRole('owner'), async (c) => {
  await audit(c, 'key_migration', 'attempted', c.get('staff').id);
  const migrated = await backfillStaffApiKeyHashes(c.env.DB);
  return c.json({success:true,data:{migrated}});
});
adminAuth.post('/api/auth/sessions/revoke', async (c) => {
  const staff = c.get('staff');
  await audit(c, 'sessions_revoke', 'attempted', staff.id);
  const revoked = await revokeAdminSessionsForStaff(c.env.DB, staff.id);
  return c.json({success:true,data:{revoked}});
});
adminAuth.post('/api/auth/maintenance', requireRole('owner'), async (c) => {
  await purgeAuthSecurityData(c.env.DB);
  await purgeExpiredAdminSessions(c.env.DB);
  return c.json({success:true});
});
