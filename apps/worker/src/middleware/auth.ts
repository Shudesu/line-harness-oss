import type { Context, Next } from 'hono';
import { getStaffByApiKey } from '@line-crm/db';
import type { Env } from '../index.js';

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
    path.startsWith('/pool/') ||
    path.startsWith('/images/') ||
    path.startsWith('/api/liff/') ||
    path.startsWith('/auth/') ||
    path === '/setup' ||
    path === '/api/integrations/stripe/webhook' ||
    path.match(/^\/api\/webhooks\/incoming\/[^/]+\/receive$/) ||
    path.match(/^\/api\/forms\/[^/]+\/submit$/) ||
    path.match(/^\/api\/forms\/[^/]+\/opened$/) ||
    path.match(/^\/api\/forms\/[^/]+\/partial$/) ||
    path.match(/^\/api\/forms\/[^/]+$/) || // GET form definition (public for LIFF)
    path === '/api/meet-callback' || // Meet Harness completion callback
    path === '/api/qr' // Public QR proxy — used by desktop landing pages
  ) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice('Bearer '.length);

  // Check staff_members table first
  const staff = await getStaffByApiKey(c.env.DB, token);
  if (staff) {
    c.set('staff', { id: staff.id, name: staff.name, role: staff.role });
    return next();
  }

  // Fallback: env API_KEY acts as owner (current rotation slot)
  if (token === c.env.API_KEY) {
    c.set('staff', { id: 'env-owner', name: 'Owner', role: 'owner' as const });
    return next();
  }

  // Legacy fallback: LEGACY_API_KEY accepted during rotation grace period.
  // Uses the same staff.id as primary so /api/staff/me's special-case keeps
  // working. Logs accept_via=LEGACY_API_KEY so operators can confirm zero
  // legacy usage before deleting the secret to revoke the old key.
  // Same-value guard: if both env vars are set to the same secret, the
  // primary check above already accepts it; this branch must skip to avoid
  // false LEGACY counters.
  if (
    c.env.LEGACY_API_KEY &&
    c.env.LEGACY_API_KEY !== c.env.API_KEY &&
    token === c.env.LEGACY_API_KEY
  ) {
    c.set('staff', { id: 'env-owner', name: 'Owner', role: 'owner' as const });
    console.log('[auth] accept_via=LEGACY_API_KEY');
    return next();
  }

  return c.json({ success: false, error: 'Unauthorized' }, 401);
}
