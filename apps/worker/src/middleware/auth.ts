import type { Context, Next } from 'hono';
import { getStaffByApiKey, getStaffById, parseStaffApiScopes, createAdminSession, getAdminSession, hashApiKey, staffCredentialFingerprint, type StaffApiScope } from '@line-crm/db';
import { timingSafeEqualString } from '@line-crm/shared';
import { allowsApiScope } from './api-scope.js';
import { resolveAdminAuthConfig } from './admin-auth-config.js';
import { verifyAccessJwt } from '../lib/access-jwt.js';
import { audit, limitAuth } from './auth-security.js';
import type { Env } from '../index.js';
import type { AdminSameSite } from './admin-auth-config.js';
import { safeDecode } from '../utils/safe-decode.js';

export const ADMIN_AUTH_COOKIE = 'lh_admin_session';
export const CSRF_COOKIE = 'lh_csrf';
export const CSRF_HEADER = 'x-csrf-token';

// 7 days, matching the previous localStorage session longevity.
const SESSION_MAX_AGE = 604800;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName) continue;
    cookies[rawName] = safeDecode(rawValue.join('=') || '');
  }
  return cookies;
}

function bearerToken(c: Context<Env>): string | null {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length);
}

export function cookieToken(c: Context<Env>): string | null {
  return parseCookieHeader(c.req.header('Cookie'))[ADMIN_AUTH_COOKIE] || null;
}

export function csrfTokenFromCookie(c: Context<Env>): string | null {
  return parseCookieHeader(c.req.header('Cookie'))[CSRF_COOKIE] || null;
}

function buildCookie(
  name: string,
  value: string,
  sameSite: AdminSameSite,
  maxAge: number,
  httpOnly: boolean,
): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/'];
  if (httpOnly) parts.push('HttpOnly');
  parts.push('Secure', `SameSite=${sameSite}`, `Max-Age=${maxAge}`);
  return parts.join('; ');
}

/** HttpOnly session cookie carrying only an opaque revocable session token. */
export function adminSessionCookie(token: string, sameSite: AdminSameSite): string {
  return buildCookie(ADMIN_AUTH_COOKIE, token, sameSite, SESSION_MAX_AGE, true);
}

/**
 * CSRF cookie. NOT HttpOnly so it can participate in double-submit, but in a
 * cross-site topology the SPA cannot read it (different registrable domain) —
 * the token is therefore also returned in the login/session response body and
 * the SPA echoes it via the X-CSRF-Token header. The Worker validates that
 * header against this cookie, which the browser does send back to the API
 * (SameSite=None).
 */
export function csrfCookie(token: string, sameSite: AdminSameSite): string {
  return buildCookie(CSRF_COOKIE, token, sameSite, SESSION_MAX_AGE, false);
}

export function expiredCookie(name: string, sameSite: AdminSameSite): string {
  return buildCookie(name, '', sameSite, 0, name === ADMIN_AUTH_COOKIE);
}

export type AuthenticatedStaff = {
  apiScopes?: StaffApiScope[] | null;
  sessionId?: string;
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'staff';
};

/**
 * Resolve a token (from a Bearer header or the session cookie) to a staff
 * identity. Shared by the auth middleware and the /api/auth/login endpoint so
 * cookie and Bearer auth accept exactly the same credentials.
 */
export async function authenticateApiToken(
  c: Context<Env>,
  token: string | null,
): Promise<AuthenticatedStaff | null> {
  if (!token || token.length > 4096) return null;

  const staff = await getStaffByApiKey(c.env.DB, token);
  if (staff) {
    if (!['owner', 'admin', 'staff'].includes(staff.role)) return null;
    return { id: staff.id, name: staff.name, role: staff.role, ...(staff.api_scopes == null ? {} : { apiScopes: parseStaffApiScopes(staff.api_scopes) }) };
  }

  // Fallback: env API_KEY acts as owner (current rotation slot)
  if (await timingSafeEqualString(token, c.env.API_KEY)) {
    return { id: 'env-owner', name: 'Owner', role: 'owner' };
  }

  // Legacy fallback: LEGACY_API_KEY accepted during rotation grace period.
  // Same-value guard: if both env vars are set to the same secret, the primary
  // check above already accepts it; this branch must skip to avoid false
  // LEGACY counters. Logs accept_via=LEGACY_API_KEY so operators can confirm
  // zero legacy usage before deleting the secret.
  if (
    c.env.LEGACY_API_KEY &&
    !(await timingSafeEqualString(c.env.LEGACY_API_KEY, c.env.API_KEY)) &&
    await timingSafeEqualString(token, c.env.LEGACY_API_KEY)
  ) {
    console.log('[auth] accept_via=LEGACY_API_KEY');
    return { id: 'env-owner', name: 'Owner', role: 'owner' };
  }

  return null;
}

export function publicStaffProfile(staff: AuthenticatedStaff) {
  return { id: staff.id, name: staff.name, role: staff.role, apiScopes: staff.apiScopes };
}

export async function issueAdminSession(c: Context<Env>, staff: AuthenticatedStaff, credential: string, method: 'api_key' | 'sso' = 'api_key') {
  if (staff.apiScopes != null) throw new Error('Scoped integration keys cannot create browser sessions');
  const session = await createAdminSession(c.env.DB, { staffId: staff.id, role: staff.role,
    credentialFp: await hashApiKey(credential), authMethod: method });
  const config = resolveAdminAuthConfig(c.env, {requestOrigin: new URL(c.req.url).origin});
  c.header('Set-Cookie', adminSessionCookie(session.token, config.sameSite), {append: true});
}

export async function authenticateCookieSession(c: Context<Env>, token: string | null): Promise<AuthenticatedStaff | null> {
  if (!token) return null;
  const session = await getAdminSession(c.env.DB, token);
  if (!session) return null;
  if (session.staff_id === 'env-owner') {
    const matches = await Promise.all([c.env.API_KEY, c.env.LEGACY_API_KEY].map(async key =>
      !!key && await timingSafeEqualString(session.credential_fp, await hashApiKey(key))));
    if (session.role_at_issue !== 'owner' || !matches.some(Boolean)) return null;
    return {id: 'env-owner', name: 'Owner', role: 'owner', sessionId: session.id_hash};
  }
  const current = await getStaffById(c.env.DB, session.staff_id);
  if (!current || current.is_active !== 1 || current.role !== session.role_at_issue || parseStaffApiScopes(current.api_scopes) != null) return null;
  if (!await timingSafeEqualString(session.credential_fp, await staffCredentialFingerprint(current))) return null;
  return {id: current.id, name: current.name, role: current.role, sessionId: session.id_hash};
}

/** Optional second factor at the Worker; does not gate public LINE/LIFF routes. */
export async function requireAccess(c: Context<Env>): Promise<Response | null> {
  if (c.env.ACCESS_REQUIRED !== 'true') return null;
  if (await verifyAccessJwt(c.req.header('Cf-Access-Jwt-Assertion'), c.env)) return null;
  await audit(c, 'access_rejected', 'denied');
  return c.json({success:false,error:'Cloudflare Access assertion required'},403);
}

async function authenticateRequest(c: Context<Env>, next: Next): Promise<Response | void> {
  // Skip auth for the LINE webhook endpoint — it uses signature verification instead
  // Skip auth for OpenAPI docs — public documentation
  const path = new URL(c.req.url).pathname;
  // LIFF / admin の SPA アセットは Authorization ヘッダなしで HTML を取りに
  // くる。Worker は API 以外のパスを ASSETS バインディングから配信するので、
  // /api/ で始まらないパスは認証 skip して static asset として返す。
  // (admin は別ホスト、Worker の non-API path はすべて LIFF/SPA 経由)
  const method = c.req.method.toUpperCase();
  const decodedPath = safeDecode(path);
  const legacyIncoming = /^\/images\/incoming-[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|gif|webp)$/.test(decodedPath);
  const scopePath = legacyIncoming ? decodedPath.replace('/images/', '/api/incoming-images/') : path;
  if (path.startsWith('/api/incoming-images/') || legacyIncoming) {
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Content-Type-Options', 'nosniff');
  }
  if (!path.startsWith('/api/') && !path.startsWith('/admin/update')) {
    // ただし内部用エンドポイント (/webhook, /auth, /setup) は元の skip 判定に任せる
    if (
      path !== '/webhook' &&
      !path.startsWith('/auth/') &&
      path !== '/setup' &&
      !path.startsWith('/t/') &&
      !path.startsWith('/r/') &&
      !path.startsWith('/pool/') &&
      !path.startsWith('/images/')
    ) {
      return next();
    }
  }

  // A form definition is public because the LIFF client must render it before
  // submission. Authenticate opportunistically so the same GET can still
  // return the full admin representation to SDK/admin callers, while an
  // unauthenticated LIFF caller receives the redacted public representation.
  // Crucially, this exception is method-aware: PUT/DELETE on the same path
  // must continue through the normal admin authentication below.
  const isPublicFormDefinition = method === 'GET' && /^\/api\/forms\/[^/]+$/.test(path);
  if (isPublicFormDefinition) {
    const bearer = bearerToken(c);
    const cookie = cookieToken(c);
    const accessOk = c.env.ACCESS_REQUIRED !== 'true' || await verifyAccessJwt(c.req.header('Cf-Access-Jwt-Assertion'), c.env);
    const staff = accessOk ? (bearer ? await authenticateApiToken(c, bearer) : await authenticateCookieSession(c, cookieToken(c))) : null;
    if (!staff && (bearer || cookie)) {
      const limited = await limitAuth(c, 'key', bearer || cookie!);
      if (limited) return limited;
    }
    if (staff && staff.apiScopes == null) c.set('staff', staff);
    return next();
  }

  // These LIFF actions perform their own LINE ID-token verification inside
  // the route. They cannot use the admin auth gate because their Bearer token
  // is a LINE ID token, not a Harness staff API key.
  const isPublicFormAction =
    method === 'POST' &&
    (/^\/api\/forms\/[^/]+\/submit$/.test(path) ||
      /^\/api\/forms\/[^/]+\/opened$/.test(path) ||
      /^\/api\/forms\/[^/]+\/partial$/.test(path));
  if (isPublicFormAction) return next();

  if (
    path === '/api/integrations/x-harness/events' ||
    path === '/api/integrations/x-harness/capabilities' ||
    path === '/api/integrations/x-harness/engagement' ||
    path === '/webhook' ||
    path === '/docs' ||
    path === '/openapi.json' ||
    path === '/api/affiliates/click' ||
    path.startsWith('/t/') ||
    path.startsWith('/r/') ||
    path.startsWith('/pool/') ||
    (path.startsWith('/images/') && !legacyIncoming) ||
    // 画像 src として <img> 経由でブラウザが取得するため (Authorization ヘッダ不可)。
    // R2 key 内に group_id / page_id (UUID) が含まれるので推測困難。draft 画像も
    // 最終的に LINE 上で公開されるため機密性は低い。
    path.startsWith('/api/rich-menu-images/') ||
    // LINE 上 rich menu 画像 proxy (Authorization ヘッダなしで <img src> 経由表示)
    path.match(/^\/api\/rich-menu-groups\/external\/[^/]+\/image$/) ||
    path.startsWith('/api/liff/') ||
    // Admin login/logout — issue/clear the session cookie before auth exists.
    path === '/api/auth/login' ||
    path === '/api/auth/logout' ||
    path.startsWith('/auth/') ||
    path === '/setup' ||
    path === '/api/integrations/stripe/webhook' ||
    path.match(/^\/api\/webhooks\/incoming\/[^/]+\/receive$/) ||
    path === '/api/meet-callback' || // Meet Harness completion callback
    // Google OAuth redirects without admin headers. Route verifies a signed, expiring state.
    (path === '/api/booking/google-calendar/oauth/callback' && method === 'GET') ||
    path === '/api/qr' || // Public QR proxy — used by desktop landing pages
    path === '/api/health' || // Liveness probe (update CLI / self-update verify)
    // Public lead form. Origin validation and field validation happen in-route.
    (path === '/api/public/media-inquiries' && method === 'POST')
  ) {
    return next();
  }

  const bearer = bearerToken(c);
  const cookie = cookieToken(c);
  const accessDenied = await requireAccess(c); if (accessDenied) return accessDenied;
  const staff = bearer ? await authenticateApiToken(c, bearer) : await authenticateCookieSession(c, cookie);
  if (!staff) {
    if (bearer || cookie) {
      const limited = await limitAuth(c, 'key', bearer || cookie!);
      if (limited) return limited;
    }
    if (bearer) await audit(c, 'key_rejected', 'denied');
    return c.json({ success: false, error: legacyIncoming ? 'Image not found' : 'Unauthorized' }, legacyIncoming ? 404 : 401);
  }

  // CSRF protection applies ONLY to cookie-authenticated, state-changing
  // requests. Bearer callers (SDK/MCP) cannot be driven cross-site by a
  // browser (an attacker cannot set the Authorization header), so they are
  // exempt. Safe methods (GET/HEAD/OPTIONS) never mutate, so they are exempt.
  if (!bearer && cookie && !SAFE_METHODS.has(c.req.method.toUpperCase())) {
    const header = c.req.header(CSRF_HEADER);
    const expected = csrfTokenFromCookie(c);
    if (!header || !expected || !(await timingSafeEqualString(header, expected))) {
      return c.json({ success: false, error: 'CSRF token mismatch' }, 403);
    }
  }

  if (!allowsApiScope(staff.apiScopes, method, scopePath)) return c.json({success:false,error:'API key scope does not allow this operation'},403);
  c.set('staff', staff);
  if (!SAFE_METHODS.has(method)) {
    if (path.startsWith('/api/staff')) await audit(c, 'staff_change', 'attempted', staff.id);
    if (path.startsWith('/admin/update')) await audit(c, 'admin_update', 'attempted', staff.id);
  }
  return next();
}

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  let dispatched = false;
  try { return await authenticateRequest(c, async () => { dispatched = true; await next(); }); }
  catch (error) {
    if (dispatched) throw error;
    return c.json({success:false,error:'Authentication storage unavailable; check migrations'},503);
  }
}
