import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

/**
 * Constant-time string comparison using Web Crypto HMAC to prevent timing oracle attacks.
 */
export async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  // Length mismatch must not short-circuit — do a dummy digest to normalise timing.
  if (aBytes.length !== bBytes.length) {
    await crypto.subtle.digest('SHA-256', aBytes);
    return false;
  }
  // Cross-HMAC pattern: sign b with key derived from a, and vice versa, then XOR.
  const aKey = await crypto.subtle.importKey('raw', aBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const aHash = await crypto.subtle.sign('HMAC', aKey, bBytes);
  const bKey = await crypto.subtle.importKey('raw', bBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bHash = await crypto.subtle.sign('HMAC', bKey, aBytes);
  const aView = new Uint8Array(aHash);
  const bView = new Uint8Array(bHash);
  let diff = 0;
  for (let i = 0; i < aView.length; i++) diff |= aView[i] ^ bView[i];
  return diff === 0;
}

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  // Skip auth for the LINE webhook endpoint — it uses signature verification instead
  // Skip auth for OpenAPI docs — public documentation
  const path = new URL(c.req.url).pathname;
  if (
    path === '/webhook' ||
    path === '/docs' ||
    path === '/openapi.json' ||
    path === '/api/affiliates/click' ||
    path.startsWith('/t/') ||
    path.startsWith('/r/') ||
    path.startsWith('/api/liff/') ||
    path.startsWith('/auth/') ||
    path === '/api/integrations/stripe/webhook' ||
    path.match(/^\/api\/webhooks\/incoming\/[^/]+\/receive$/) ||
    path.match(/^\/api\/forms\/[^/]+\/submit$/) ||
    path.match(/^\/api\/forms\/[^/]+$/) // GET form definition (public for LIFF)
  ) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice('Bearer '.length);
  const valid = await timingSafeEqual(token, c.env.API_KEY);
  if (!valid) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  return next();
}
