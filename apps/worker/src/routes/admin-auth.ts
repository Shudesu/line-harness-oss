import { Hono, type Context } from 'hono';
import { getAdminUserByEmail } from '@line-crm/db';
import type { Env } from '../index.js';
import {
  ADMIN_AUTH_COOKIE,
  CSRF_COOKIE,
  adminSessionCookie,
  authenticateApiToken,
  createAdminSessionToken,
  csrfCookie,
  csrfTokenFromCookie,
  expiredCookie,
  type AuthenticatedStaff,
} from '../middleware/auth.js';
import { resolveAdminAuthConfig } from '../middleware/admin-auth-config.js';

export const adminAuth = new Hono<Env>();

/**
 * POST /api/auth/login
 *
 * Validates an admin email/password, then issues:
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

  const body = await c.req
    .json<{ email?: string; password?: string; apiKey?: string }>()
    .catch(() => ({}) as { email?: string; password?: string; apiKey?: string });
  const email = body.email?.trim() ?? '';
  const password = body.password ?? '';
  const staff =
    email && password
      ? await authenticateAdminPassword(c, email, password)
      : // Legacy compatibility only: old installs and SDK-style callers that
        // still POST { apiKey } can receive a cookie session. The dashboard UI
        // no longer asks humans to paste an API key.
        await authenticateApiToken(c, body.apiKey?.trim() || null);

  if (!staff) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const csrfToken = crypto.randomUUID();
  const sessionToken = await createAdminSessionToken(c.env, staff);
  c.header('Set-Cookie', adminSessionCookie(sessionToken, config.sameSite, config.secure), {
    append: true,
  });
  c.header('Set-Cookie', csrfCookie(csrfToken, config.sameSite, config.secure), {
    append: true,
  });
  return c.json({ success: true, data: staff, csrfToken });
});

/**
 * POST /api/auth/logout — clears both cookies. No CSRF required: clearing your
 * own session is not a meaningful CSRF target, and this keeps logout resilient
 * even if the CSRF token was lost client-side.
 */
adminAuth.post('/api/auth/logout', async (c) => {
  const config = resolveAdminAuthConfig(c.env, { requestOrigin: new URL(c.req.url).origin });
  c.header('Set-Cookie', expiredCookie(ADMIN_AUTH_COOKIE, config.sameSite, config.secure), {
    append: true,
  });
  c.header('Set-Cookie', expiredCookie(CSRF_COOKIE, config.sameSite, config.secure), {
    append: true,
  });
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
    c.header('Set-Cookie', csrfCookie(csrfToken, config.sameSite, config.secure), { append: true });
  }
  return c.json({ success: true, data: c.get('staff'), csrfToken });
});

function timingSafeEqual(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    keyMaterial,
    256,
  );
  return bytesToBase64(new Uint8Array(bits));
}

async function verifyPasswordHash(password: string, storedHash: string): Promise<boolean> {
  // Preferred format for LINE Harness admin users:
  //   pbkdf2-sha256:<iterations>:<salt-base64>:<hash-base64>
  const [scheme, rawIterations, salt, hash] = storedHash.split(':');
  if (scheme !== 'pbkdf2-sha256' || !rawIterations || !salt || !hash) {
    return false;
  }
  const iterations = Number(rawIterations);
  if (!Number.isInteger(iterations) || iterations < 100_000) return false;
  const derived = await pbkdf2(password, base64ToBytes(salt), iterations);
  return timingSafeEqual(derived, hash);
}

async function authenticateAdminPassword(
  c: Context<Env>,
  email: string,
  password: string,
): Promise<AuthenticatedStaff | null> {
  if (
    c.env.ADMIN_EMAIL &&
    c.env.ADMIN_PASSWORD &&
    email.toLowerCase() === c.env.ADMIN_EMAIL.toLowerCase() &&
    timingSafeEqual(password, c.env.ADMIN_PASSWORD)
  ) {
    return { id: 'env-owner', name: 'Owner', role: 'owner' };
  }

  const user = await getAdminUserByEmail(c.env.DB, email);
  if (!user) return null;
  const ok = await verifyPasswordHash(password, user.password_hash);
  if (!ok) return null;
  return { id: user.id, name: user.email, role: 'owner' };
}
