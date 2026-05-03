import type { Context, Next } from 'hono';
import { getStaffByApiKey } from '@line-crm/db';
import type { Env } from '../index.js';

async function shortFingerprint(value: string | undefined): Promise<string | null> {
  if (!value) return null;

  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest))
    .slice(0, 6)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  // Skip auth for the LINE webhook endpoint — it uses signature verification instead
  // Skip auth for OpenAPI docs — public documentation
  const path = new URL(c.req.url).pathname;
  if (
    path === '/' ||
    path === '/book' ||
    path === '/admin/reservations' ||
    path.startsWith('/assets/') ||
    path === '/webhook' ||
    path === '/docs' ||
    path === '/openapi.json' ||
    path === '/api/affiliates/click' ||
    path.startsWith('/t/') ||
    path.startsWith('/r/') ||
    path.startsWith('/pool/') ||
    path.startsWith('/images/') ||
    path.startsWith('/api/liff/') ||
    path.startsWith('/api/public/reservation-') ||
    path.startsWith('/api/public/me/reservations') ||
    path.match(/^\/api\/public\/reservations\/[^/]+$/) ||
    path.match(/^\/api\/public\/reservations\/[^/]+\/cancel$/) ||
    path === '/api/integrations/google-calendar/oauth/callback' ||
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

  // Fallback: env API_KEY acts as owner
  if (token === c.env.API_KEY) {
    c.set('staff', { id: 'env-owner', name: 'Owner', role: 'owner' as const });
    return next();
  }

  console.warn('Unauthorized request', {
    path,
    hasAuthorizationHeader: true,
    tokenLength: token.length,
    apiKeyConfigured: Boolean(c.env.API_KEY),
    apiKeyLength: c.env.API_KEY?.length ?? 0,
    tokenFingerprint: await shortFingerprint(token),
    apiKeyFingerprint: await shortFingerprint(c.env.API_KEY),
  });

  return c.json({ success: false, error: 'Unauthorized' }, 401);
}
