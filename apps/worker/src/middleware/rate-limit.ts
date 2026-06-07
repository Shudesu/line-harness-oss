/**
 * In-memory sliding window rate limiter for Cloudflare Workers.
 *
 * Cloudflare Workers have per-isolate memory that persists across
 * requests to the same instance. Counters are lost on cold start,
 * which is acceptable — this guards against burst abuse, not
 * long-term quota enforcement.
 */

import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

// ---------------------------------------------------------------------------
// Core rate-limit logic
// ---------------------------------------------------------------------------

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

const PRUNE_INTERVAL = 60_000;
let lastPrune = Date.now();

function prune(windowMs: number): void {
  const now = Date.now();
  if (now - lastPrune < PRUNE_INTERVAL) return;
  lastPrune = now;
  const cutoff = now - windowMs;
  for (const [key, entry] of store) {
    entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
    if (entry.timestamps.length === 0) store.delete(key);
  }
}

function check(key: string, max: number, windowMs: number): { ok: boolean; remaining: number; retryAfter: number } {
  const now = Date.now();
  const cutoff = now - windowMs;

  prune(windowMs);

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);

  if (entry.timestamps.length >= max) {
    const oldest = entry.timestamps[0];
    const retryAfter = Math.ceil((oldest + windowMs - now) / 1000);
    return { ok: false, remaining: 0, retryAfter: Math.max(retryAfter, 1) };
  }

  entry.timestamps.push(now);
  return { ok: true, remaining: max - entry.timestamps.length, retryAfter: 0 };
}

// ---------------------------------------------------------------------------
// Paths that are unauthenticated (lower limit, keyed by IP)
// ---------------------------------------------------------------------------

const UNAUTHENTICATED_PATTERNS: Array<string | RegExp> = [
  '/webhook',
  /^\/api\/forms\/[^/]+\/submit$/,
];

function isUnauthenticatedPath(path: string): boolean {
  return UNAUTHENTICATED_PATTERNS.some((p) =>
    typeof p === 'string' ? path === p : p.test(path),
  );
}

function getClientIp(c: Context): string {
  return (
    c.req.header('cf-connecting-ip') ||
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    '0.0.0.0'
  );
}

function getAdminCookieToken(c: Context): string | null {
  const cookie = c.req.header('Cookie');
  if (!cookie) return null;
  for (const part of cookie.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === 'lh_admin_session') {
      const raw = rawValue.join('=') || '';
      // Cookie values are client-controlled; a malformed percent escape must
      // not throw (it would turn the request into a 500 before auth runs).
      try {
        return decodeURIComponent(raw) || null;
      } catch {
        return raw || null;
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Hono middleware
// ---------------------------------------------------------------------------

const AUTHENTICATED_MAX = 1000;
const AUTHENTICATED_WINDOW = 60_000; // 1 min

const UNAUTHENTICATED_MAX = 100;
const UNAUTHENTICATED_WINDOW = 60_000; // 1 min

// Per-IP ceiling applied to token/cookie-keyed requests. Rate limiting runs
// BEFORE auth, so the token (Bearer or session cookie) is not yet validated —
// an attacker could otherwise rotate bogus tokens/cookies to mint endless
// fresh per-token buckets and bypass the IP limit. This ceiling bounds total
// throughput per IP (well above a single legitimate session's allowance) so
// rotation cannot escalate beyond it.
const IP_CEILING_MAX = 3000;
const IP_CEILING_WINDOW = 60_000; // 1 min

export async function rateLimitMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  const path = new URL(c.req.url).pathname;

  // Skip rate limiting for docs / static assets
  if (path === '/docs' || path === '/openapi.json' || path.startsWith('/r/')) {
    return next();
  }

  let key: string;
  let max: number;
  let windowMs: number;

  if (isUnauthenticatedPath(path)) {
    // Key by IP for unauthenticated endpoints
    key = `ip:${getClientIp(c)}`;
    max = UNAUTHENTICATED_MAX;
    windowMs = UNAUTHENTICATED_WINDOW;
  } else {
    // Key by API key for authenticated endpoints
    const authHeader = c.req.header('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : getAdminCookieToken(c);
    if (token) {
      // Use first 16 chars of token as key to avoid storing full secrets
      key = `key:${token.slice(0, 16)}`;
      max = AUTHENTICATED_MAX;
      windowMs = AUTHENTICATED_WINDOW;
      // Bound total per-IP throughput so an attacker cannot bypass the limiter
      // by rotating unvalidated tokens/cookies (each minting a fresh bucket).
      const ceiling = check(`ip-ceiling:${getClientIp(c)}`, IP_CEILING_MAX, IP_CEILING_WINDOW);
      if (!ceiling.ok) {
        return c.json(
          { success: false, error: 'Too many requests. Please try again later.' },
          { status: 429, headers: { 'Retry-After': String(ceiling.retryAfter) } },
        );
      }
    } else {
      // No auth header — key by IP with the lower limit
      key = `ip:${getClientIp(c)}`;
      max = UNAUTHENTICATED_MAX;
      windowMs = UNAUTHENTICATED_WINDOW;
    }
  }

  const result = check(key, max, windowMs);

  if (!result.ok) {
    return c.json(
      { success: false, error: 'Too many requests. Please try again later.' },
      { status: 429, headers: { 'Retry-After': String(result.retryAfter) } },
    );
  }

  // Proceed and attach rate-limit headers to the response
  await next();

  c.header('X-RateLimit-Remaining', String(result.remaining));
}
