import {apiKeyLoginMode} from '../middleware/login-policy.js';
import {timingSafeEqualString} from '@line-crm/shared';
import {hashApiKey, backfillStaffApiKeyHashes, purgeExpiredAdminSessions, purgeMagicLinks, purgeWebauthnChallenges} from '@line-crm/db';
import { requireRole } from '../middleware/role-guard.js';
import { requireAccess } from '../middleware/auth.js';
import { createAuthorizedRouter } from '../middleware/authorized-router.js';
import { Hono } from 'hono';
import { revokeAdminSession, revokeAdminSessionsForStaff } from '@line-crm/db';
import type { Env } from '../index.js';
import {
  ADMIN_AUTH_COOKIE,
  CSRF_COOKIE,
  issueAdminSession,
  issueVerifiedAdminSession,
  publicStaffProfile,
  cookieToken,
  authenticateApiToken,
  csrfCookie,
  csrfTokenFromCookie,
  expiredCookie,
} from '../middleware/auth.js';
import { resolveAdminAuthConfig } from '../middleware/admin-auth-config.js';

export const adminAuth = createAuthorizedRouter<Env>();

/**
 * POST /api/auth/login
 *
 * Validates the API key, then issues:
 *   - lh_admin_session (HttpOnly) — the credential, never exposed to JS.
 *   - lh_csrf (readable) — the double-submit CSRF token, also returned in the
 *     body so a cross-site SPA (which cannot read the API's cookie) can echo it
 *     back via the X-CSRF-Token header.
 *
 * Refuses with a clear error when the topology cannot deliver the cookie,
 * turning the silent "login breaks after deploy" failure into an actionable
 * configuration error.
 */
adminAuth.post('/api/auth/login', async (c) => {
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  if (config.misconfigured) {
    console.error('[admin-auth] refused login — misconfigured topology:', config.misconfigured);
    return c.json({ success: false, error: config.misconfigured }, 500);
  }

  // Deployments that opted into ACCESS_REQUIRED keep the gate on session issuance.
  const denied = await requireAccess(c); if (denied) return denied;

  const body = await c.req
    .json<{ apiKey?: string }>()
    .catch(() => ({}) as { apiKey?: string });
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : '';
  const mode=apiKeyLoginMode(c.env);
  if(mode==='disabled')return c.json({success:false,error:'API key login is disabled; use an enabled identity login'},403);
  const staff = mode==='break-glass'
    ? await timingSafeEqualString(apiKey,c.env.API_KEY) ? {id:'env-owner',name:'Owner',role:'owner' as const} : null
    : await authenticateApiToken(c, apiKey || null);

  if (!staff) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  if (staff.apiScopes != null) {
    return c.json({ success: false, error: 'Integration keys cannot sign in to the admin console' }, 403);
  }

  const csrfToken = crypto.randomUUID();
  let sessionStaff;
  try {
    sessionStaff = mode==='break-glass'
      ? await issueVerifiedAdminSession(c,staff,await hashApiKey(apiKey),'break_glass',{maxTtl:3600})
      : await issueAdminSession(c, staff, apiKey);
  } catch {
    return c.json({ success: false, error: 'Admin session storage unavailable; apply migration 074_security_hardening.sql' }, 503);
  }
  c.header('Set-Cookie', csrfCookie(csrfToken, config.sameSite), { append: true });
  return c.json({ success: true, data: publicStaffProfile(sessionStaff, c.env), csrfToken });
});

/**
 * POST /api/auth/logout — clears both cookies. No CSRF required: clearing your
 * own session is not a meaningful CSRF target, and this keeps logout resilient
 * even if the CSRF token was lost client-side.
 */
adminAuth.post('/api/auth/logout', async (c) => {
  const { sameSite } = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  let storageFailed = false;
  try { await revokeAdminSession(c.env.DB, cookieToken(c) ?? ''); } catch { storageFailed = true; }
  c.header('Set-Cookie', expiredCookie(ADMIN_AUTH_COOKIE, sameSite), { append: true });
  c.header('Set-Cookie', expiredCookie(CSRF_COOKIE, sameSite), { append: true });
  if (storageFailed) return c.json({ success: false, error: 'Session revocation unavailable; browser cookies cleared' }, 503);
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
  return c.json({ success: true, data: publicStaffProfile(c.get('staff'), c.env), csrfToken });
});


// The common auth/CSRF gate protects this endpoint; it only affects the caller.
adminAuth.post('/api/auth/logout-all', async (c) => {
  try {
    const revoked = await revokeAdminSessionsForStaff(c.env.DB, c.get('staff').id);
    const { sameSite } = resolveAdminAuthConfig(c.env);
    c.header('Set-Cookie', expiredCookie(ADMIN_AUTH_COOKIE, sameSite), { append: true });
    c.header('Set-Cookie', expiredCookie(CSRF_COOKIE, sameSite), { append: true });
    return c.json({ success: true, data: { revoked } });
  } catch { return c.json({ success: false, error: 'Session revocation unavailable' }, 503); }
});

// Owner-driven, bounded Web Crypto backfill of plaintext staff keys (25 rows per
// call leaves room for auth on the Free plan); repeat until migrated === 0.
// Used by scripts/migrate-staff-keys.mjs — see docs/SECURITY-UPGRADE.en.md.
adminAuth.post('/api/auth/migrate-keys', requireRole('owner'), async (c) => {
  const migrated = await backfillStaffApiKeyHashes(c.env.DB, { limit: 25 });
  return c.json({ success: true, data: { migrated } });
});

// Kept for clients written against the earlier hardening release; same effect
// as logout-all for the caller's own sessions, without clearing cookies.
adminAuth.post('/api/auth/sessions/revoke', async (c) => {
  const revoked = await revokeAdminSessionsForStaff(c.env.DB, c.get('staff').id);
  return c.json({ success: true, data: { revoked } });
});

// Owner-driven bounded cleanup of expired sessions, magic links and WebAuthn
// challenges. No cron is added; call it from existing maintenance.
adminAuth.post('/api/auth/maintenance', requireRole('owner'), async (c) => {
  await purgeExpiredAdminSessions(c.env.DB);
  await purgeMagicLinks(c.env.DB);
  await purgeWebauthnChallenges(c.env.DB);
  return c.json({ success: true });
});
