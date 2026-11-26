import {apiKeyLoginMode} from './login-policy.js';
import {accessConfig,accessOwnerAllowed,verifyAccessJwt,type AccessEnv} from '../lib/access-jwt.js';
import {getStaffByNormalizedEmail} from '@line-crm/db';
import { authenticateMachineKey, parseMachineScopes } from '@line-crm/db';
import type {MachinePrincipal} from './scopes.js';
import { staffRolePolicy, staffRouteAllowed, type StaffPolicyEnv } from './staff-policy.js';
import { timingSafeEqualString } from '@line-crm/shared';
import type { Context, Next } from 'hono';
import { getStaffByApiKey, getStaffById, hashApiKey, staffCredentialFingerprint, createAdminSession, getAdminSession, adminSessionTtl, parseStaffApiScopes, type StaffApiScope, type AdminSessionAuthMethod } from '@line-crm/db';
import type { Env } from '../index.js';
import { resolveAdminAuthConfig, type AdminSameSite } from './admin-auth-config.js';
import { safeDecode } from '../utils/safe-decode.js';
import { allowsApiScope } from './api-scope.js';

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

/** HttpOnly cookie carrying an opaque, server-revocable session token. */
export function adminSessionCookie(token: string, sameSite: AdminSameSite, maxAge = SESSION_MAX_AGE): string {
  return buildCookie(ADMIN_AUTH_COOKIE, token, sameSite, maxAge, true);
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
  machine?: MachinePrincipal;
  authMethod?: AdminSessionAuthMethod;
  sessionId?: string;
  sessionCreatedAt?: number;
  apiScopes?: StaffApiScope[] | null;
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
  if (!token) return null;

  const staff = await getStaffByApiKey(c.env.DB, token, {erasePlaintext:c.env.SECURITY_MIGRATION_STAGE!=='compat'});
  if (staff) {
    if (!['owner', 'admin', 'staff'].includes(staff.role)) return null;
    return {
      id: staff.id, name: staff.name, role: staff.role,
      ...(staff.api_scopes == null ? {} : { apiScopes: parseStaffApiScopes(staff.api_scopes) }),
    };
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

export async function accessCredentialFingerprint(env:AccessEnv,email:string,staffFingerprint='env-owner'):Promise<string> {
 return hashApiKey(JSON.stringify(['access',accessConfig(env),email,staffFingerprint]));
}
export async function issueVerifiedAdminSession(c:Context<Env>,staff:AuthenticatedStaff,fingerprint:string,authMethod:AdminSessionAuthMethod,options:{subject?:string;maxTtl?:number}={}):Promise<AuthenticatedStaff> {
 if(c.env.SECURITY_MIGRATION_STAGE==='compat')throw new Error('Identity issuance is not active during compatibility rollout');
 if(staff.machine||staff.apiScopes!=null)throw new Error('Human session required');
 const config=resolveAdminAuthConfig(c.env,{requestOrigin:new URL(c.req.url).origin});if(config.misconfigured)throw new Error('Admin cookie topology is misconfigured');
 const ttl=Math.min(adminSessionTtl(c.env.ADMIN_SESSION_TTL_SECONDS),options.maxTtl??2592000);
 if(ttl<=0)throw new Error('Identity expired');
 const session=await createAdminSession(c.env.DB,{staffId:staff.id,role:staff.role,credentialFp:fingerprint,authMethod,ttlSeconds:ttl,authSubject:options.subject});
 c.header('Set-Cookie',adminSessionCookie(session.token,config.sameSite,session.expiresAt-session.createdAt),{append:true});
 return {...staff,authMethod,sessionId:session.sessionId,sessionCreatedAt:session.createdAt};
}

/** Human/API compatibility is resolved first, including env keys with lhk_ prefix. */
export async function authenticateBearer(c:Context<Env>,token:string):Promise<AuthenticatedStaff|null> {
  const human=await authenticateApiToken(c,token);if(human)return human;
  if(!token.startsWith('lhk_'))return null;
  const key=await authenticateMachineKey(c.env.DB,token);if(!key)return null;
  const scopes=parseMachineScopes(key.scopes)!;
  return {id:key.id,name:key.name,role:scopes.includes('admin')?'admin':'staff',machine:{type:'machine',id:key.id,scopes}};
}

/** Public profile deliberately excludes internal session identifiers. */
export function publicStaffProfile(staff: AuthenticatedStaff, env?: StaffPolicyEnv) {
  return { id: staff.id, name: staff.name, role: staff.role, apiScopes: staff.apiScopes, authMethod: staff.authMethod, staffRolePolicy: env ? staffRolePolicy(env) : undefined };
}

export async function issueAdminSession(c: Context<Env>, staff: AuthenticatedStaff, credential: string, authMethod: AdminSessionAuthMethod = 'api_key'): Promise<AuthenticatedStaff> {
  if (!credential) throw new Error('Missing authentication credential');
  if (staff.machine || staff.apiScopes != null) throw new Error('Integration keys cannot create admin sessions');
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  if (config.misconfigured) throw new Error('Admin cookie topology is misconfigured');
  if(c.env.SECURITY_MIGRATION_STAGE==='compat'){
    c.header('Set-Cookie',adminSessionCookie(credential,config.sameSite,adminSessionTtl(c.env.ADMIN_SESSION_TTL_SECONDS)),{append:true});
    return {...staff,authMethod:'legacy_cookie'};
  }
  const session = await createAdminSession(c.env.DB, {
    staffId: staff.id, role: staff.role, credentialFp: await hashApiKey(credential),
    authMethod, ttlSeconds: adminSessionTtl(c.env.ADMIN_SESSION_TTL_SECONDS),
  });
  c.header('Set-Cookie', adminSessionCookie(session.token, config.sameSite, session.expiresAt - session.createdAt), { append: true });
  return { ...staff, authMethod, sessionId: session.sessionId, sessionCreatedAt: session.createdAt };
}

export async function authenticateCookieSession(c: Context<Env>, token: string | null): Promise<AuthenticatedStaff | null> {
  if (!token) return null;
  if (token.startsWith('lhs_')) {
    const session = await getAdminSession(c.env.DB, token);
    if (!session) return null;
    let staff: AuthenticatedStaff;
    if (session.staff_id === 'env-owner') {
      if (session.role_at_issue !== 'owner') return null;
      if(session.auth_method==='access'){
        const email=session.auth_subject;
        if(!email||!accessOwnerAllowed(c.env,email)||(await getStaffByNormalizedEmail(c.env.DB,email)).length!==0||!await timingSafeEqualString(session.credential_fp,await accessCredentialFingerprint(c.env,email)))return null;
      }else{
      const candidates = [{ key: c.env.API_KEY, legacy: false }, { key: c.env.LEGACY_API_KEY, legacy: true }];
      const matches = await Promise.all(candidates.map(async candidate => ({
        legacy: candidate.legacy,
        matches: !!candidate.key && await timingSafeEqualString(session.credential_fp, await hashApiKey(candidate.key)),
      })));
      if (!matches.some(value => value.matches)) return null;
      if (!matches.some(value => value.matches && !value.legacy)) console.log('[auth] accept_via=LEGACY_API_KEY');
      }
      staff = { id: 'env-owner', name: 'Owner', role: 'owner' };
    } else {
      const current = await getStaffById(c.env.DB, session.staff_id);
      if (!current || current.is_active !== 1 || current.role !== session.role_at_issue) return null;
      if (parseStaffApiScopes(current.api_scopes) != null) return null;
      let fingerprint = await staffCredentialFingerprint(current);
      if(!fingerprint)return null;
      if(session.auth_method==='magic_link'){
        const email=session.auth_subject;const matches=email?await getStaffByNormalizedEmail(c.env.DB,email):[];
        if(!email||current.email?.trim().toLowerCase()!==email||matches.length!==1||matches[0].id!==current.id)return null;
      }
      if(session.auth_method==='access'){
        const email=session.auth_subject;const matches=email?await getStaffByNormalizedEmail(c.env.DB,email):[];
        if(!accessConfig(c.env)||!email||current.email?.trim().toLowerCase()!==email||matches.length!==1||matches[0].id!==current.id)return null;
        fingerprint=await accessCredentialFingerprint(c.env,email,fingerprint);
      }
      if (!(await timingSafeEqualString(session.credential_fp, fingerprint))) return null;
      staff = { id: current.id, name: current.name, role: current.role };
    }
    return { ...staff, authMethod: session.auth_method, sessionId: session.id_hash, sessionCreatedAt: session.created_at };
  }
  // A raw API-key cookie must not bypass a disabled login endpoint. Existing
  // opaque sessions remain valid according to their expiry/revocation.
  if (c.env.ADMIN_LEGACY_SESSION_COOKIE === 'reject' || apiKeyLoginMode(c.env)!=='allow') return null;
  const staff = await authenticateApiToken(c, token);
  if (!staff || staff.apiScopes != null) return staff;
  if(c.env.SECURITY_MIGRATION_STAGE==='compat')return {...staff,authMethod:'legacy_cookie'};
  // Do not mint sessions for requests which will fail CSRF validation.
  if (!SAFE_METHODS.has(c.req.method.toUpperCase()) &&
      !(await timingSafeEqualString(c.req.header(CSRF_HEADER), csrfTokenFromCookie(c)))) {
    return { ...staff, authMethod: 'legacy_cookie' };
  }
  try {
    const upgraded = await issueAdminSession(c, staff, token, 'legacy_cookie');
    console.warn('[deprecation] legacy admin cookie upgraded');
    return upgraded;
  } catch {
    // Legacy auth was already verified. Preserve it during schema rollout;
    // opaque sessions never fall back to API-key authentication on failures.
    console.warn('[deprecation] legacy admin cookie migration deferred');
    return { ...staff, authMethod: 'legacy_cookie' };
  }
}

/**
 * Optional Cloudflare Access gate (opt-in via ACCESS_REQUIRED=true). Kept for
 * deployments that enabled it before the hardening port; it does not gate
 * public LINE/LIFF routes.
 */
export async function requireAccess(c: Context<Env>): Promise<Response | null> {
  if (c.env.ACCESS_REQUIRED !== 'true') return null;
  if (await verifyAccessJwt(c.req.header('Cf-Access-Jwt-Assertion'), c.env)) return null;
  return c.json({success:false,error:'Cloudflare Access assertion required'},403);
}

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
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
  if (!path.startsWith('/api/') && !path.startsWith('/admin/update/')) {
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
    const staff = bearer ? await authenticateBearer(c, bearer) : await authenticateCookieSession(c, cookieToken(c));
    if (staff && !staff.machine && staff.apiScopes == null && staffRouteAllowed(staff, method, path, c.env)) c.set('staff', staff);
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
    path === '/api/auth/passkeys/login/options' ||
    path === '/api/auth/passkeys/login/verify' ||
    path === '/api/auth/magic-link' ||
    path === '/api/auth/magic-link/consume' ||
    path === '/api/auth/methods' ||
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

  const accessDenied = await requireAccess(c); if (accessDenied) return accessDenied;
  const bearer = bearerToken(c);
  const cookie = cookieToken(c);
  let staff: AuthenticatedStaff | null;
  try {
    staff = bearer ? await authenticateBearer(c, bearer) : await authenticateCookieSession(c, cookie);
  } catch {
    return c.json({ success: false, error: 'Admin session storage unavailable; check database migrations' }, 503);
  }
  if (!staff) {
    return c.json({ success: false, error: legacyIncoming ? 'Image not found' : 'Unauthorized' }, legacyIncoming ? 404 : 401);
  }

  if (!allowsApiScope(staff.apiScopes, method, scopePath)) {
    return c.json({ success: false, error: 'API key scope does not allow this operation' }, 403);
  }

  if (!staff.machine && !staffRouteAllowed(staff, method, scopePath, c.env)) {
    return c.json({ success: false, error: 'insufficient_role', message: 'この操作には管理者以上の権限が必要です' }, 403);
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

  c.set('staff', staff);
  if(staff.machine)c.set('principal',staff.machine);
  return next();
}
