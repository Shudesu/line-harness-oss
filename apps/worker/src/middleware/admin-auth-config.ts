import type { Env } from '../index.js';

// ---------------------------------------------------------------------------
// Admin auth configuration & topology resolution
//
// The admin SPA (Cloudflare Pages) and the Worker API (workers.dev / custom
// domain) may live on different sites. Cookie auth only works if the cookie's
// SameSite attribute matches the topology:
//
//   * same-site (shared registrable domain) → SameSite=Lax is fine.
//   * cross-site (e.g. *.pages.dev ↔ *.workers.dev) → the cookie is only sent
//     with SameSite=None; Secure, and the operator must opt in because
//     browsers increasingly block third-party cookies.
//
// This module derives the safe attributes from the environment and refuses
// (loudly) to issue a cookie the browser would silently drop — that silent
// drop is exactly the merge/deploy blocker found in review of #57/#59.
// ---------------------------------------------------------------------------

export type AdminSameSite = 'Strict' | 'Lax' | 'None';

export interface AdminAuthConfig {
  /** Origins permitted to make credentialed cross-origin requests. */
  allowedOrigins: string[];
  /** SameSite attribute applied to the session + CSRF cookies. */
  sameSite: AdminSameSite;
  /** Cookies are always Secure (HTTPS only) in this app. */
  secure: boolean;
  /** True when an admin origin is cross-site relative to the Worker API. */
  crossSite: boolean;
  /**
   * Non-null when the configured topology cannot deliver the session cookie.
   * Login refuses with this message instead of silently issuing a cookie the
   * browser will never send back.
   */
  misconfigured: string | null;
}

// Bindings this module reads. Declared here (rather than only on Env) so the
// helpers stay testable with a plain object.
export type AdminAuthEnv = {
  WORKER_URL?: string;
  ADMIN_ORIGIN?: string;
  ADMIN_COOKIE_SAMESITE?: string;
  ADMIN_ALLOW_CROSS_SITE?: string;
};

/**
 * Public-suffix-style multi-tenant hosts where every subdomain is its own
 * registrable site. `line-crm-admin.pages.dev` and `x.workers.dev` are
 * therefore cross-site to each other. Not a full PSL — just the suffixes this
 * deployment topology actually uses.
 */
const MULTI_TENANT_SUFFIXES = [
  'pages.dev',
  'workers.dev',
  'github.io',
  'vercel.app',
  'netlify.app',
];

export function stripTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

/** True for localhost / 127.0.0.1 / ::1 origins (local development). */
export function isLoopbackOrigin(value: string | undefined | null): boolean {
  if (!value) return false;
  try {
    const host = new URL(value).hostname;
    return host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

/** Returns the canonical `scheme://host[:port]` origin, or null if unparizable. */
export function normalizeOrigin(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Best-effort registrable domain. Honours the multi-tenant suffix list so each
 * `*.pages.dev` / `*.workers.dev` host is treated as its own site; otherwise
 * falls back to the last two labels.
 */
export function registrableDomain(host: string): string {
  const labels = host.toLowerCase().split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  for (const suffix of MULTI_TENANT_SUFFIXES) {
    const suffixLabels = suffix.split('.');
    if (labels.slice(-suffixLabels.length).join('.') === suffix) {
      return labels.slice(-(suffixLabels.length + 1)).join('.');
    }
  }
  return labels.slice(-2).join('.');
}

/** True when the two origins do not share a registrable domain. */
export function isCrossSite(originA: string, originB: string): boolean {
  try {
    const a = new URL(originA);
    const b = new URL(originB);
    return registrableDomain(a.hostname) !== registrableDomain(b.hostname);
  } catch {
    // Unknown → fail safe by assuming cross-site.
    return true;
  }
}

function parseSameSite(value: string | undefined): AdminSameSite | null {
  if (!value) return null;
  switch (value.trim().toLowerCase()) {
    case 'strict':
      return 'Strict';
    case 'lax':
      return 'Lax';
    case 'none':
      return 'None';
    default:
      return null;
  }
}

/** Parse the comma-separated ADMIN_ORIGIN allowlist into normalized origins. */
export function parseAllowedOrigins(env: AdminAuthEnv): string[] {
  if (!env.ADMIN_ORIGIN) return [];
  return env.ADMIN_ORIGIN.split(',')
    .map((value) => normalizeOrigin(value.trim()))
    .filter((value): value is string => Boolean(value));
}

export function resolveAdminAuthConfig(
  env: AdminAuthEnv,
  opts: { requestOrigin?: string } = {},
): AdminAuthConfig {
  const allowedOrigins = parseAllowedOrigins(env);
  // WORKER_URL is the source of truth, but the installer doesn't always set it.
  // Fall back to the request origin (which IS the Worker's own origin when an
  // API route is handling the request) so cross-site detection stays correct
  // even when WORKER_URL is unset in production.
  const workerOrigin = normalizeOrigin(env.WORKER_URL) ?? normalizeOrigin(opts.requestOrigin);

  const crossSite =
    allowedOrigins.length > 0 &&
    workerOrigin != null &&
    allowedOrigins.some((origin) => isCrossSite(origin, workerOrigin));

  const explicit = parseSameSite(env.ADMIN_COOKIE_SAMESITE);
  const allowCrossSite = env.ADMIN_ALLOW_CROSS_SITE === 'true';

  // Opting into cross-site cookies means SameSite=None (the only value a
  // browser sends cross-site). An explicit override always wins.
  const sameSite: AdminSameSite =
    explicit ?? (allowCrossSite ? 'None' : 'Lax');

  let misconfigured: string | null = null;
  if (crossSite && sameSite !== 'None') {
    misconfigured =
      `Admin origin (${allowedOrigins.join(', ')}) is cross-site to the Worker API ` +
      `(${env.WORKER_URL ?? 'unset'}); a SameSite=${sameSite} session cookie will not be ` +
      `sent and login would break. Either serve the admin under a same-site custom domain, ` +
      `or set ADMIN_ALLOW_CROSS_SITE=true (issues SameSite=None; Secure cookies).`;
  } else if (sameSite === 'None' && allowedOrigins.length === 0) {
    misconfigured =
      `SameSite=None admin cookies require an explicit ADMIN_ORIGIN allowlist for ` +
      `credentialed CORS, but ADMIN_ORIGIN is unset.`;
  }

  return { allowedOrigins, sameSite, secure: true, crossSite, misconfigured };
}

/**
 * CORS origin resolver for credentialed admin requests. Returns the origin to
 * echo back, or '' when the origin is not allowed (so no ACAO header is set).
 * Same-origin requests (and non-browser callers with no Origin header) are
 * always permitted; this keeps SDK/MCP Bearer callers working.
 */
export function resolveCorsOrigin(
  env: AdminAuthEnv,
  origin: string | null | undefined,
  requestUrl: string,
): string {
  let requestOrigin = '';
  try {
    requestOrigin = new URL(requestUrl).origin;
  } catch {
    requestOrigin = '';
  }
  if (!origin) return requestOrigin;

  // Local development: when the Worker itself runs on loopback (e.g.
  // `wrangler dev` on localhost:8787), allow loopback admin origins (e.g.
  // `pnpm dev:web` on localhost:3001) so dev login works without configuring
  // ADMIN_ORIGIN. Never enabled in production, where requestOrigin is the
  // deployed (non-loopback) Worker origin.
  if (isLoopbackOrigin(requestOrigin) && isLoopbackOrigin(origin)) {
    return origin;
  }

  const { allowedOrigins } = resolveAdminAuthConfig(env);
  const allowed = new Set(
    [...allowedOrigins, requestOrigin].filter(Boolean).map(stripTrailingSlash),
  );
  return allowed.has(stripTrailingSlash(origin)) ? origin : '';
}
