import { Hono } from 'hono';
import type { Context } from 'hono';
import { getStoredIncomingMedia } from '@line-crm/db';
import type { IncomingMediaRow } from '@line-crm/db';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';

const incomingMedia = new Hono<Env>();
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/;
const INCOMING_MEDIA_METADATA_PATH = '/api/incoming-media/:accountId/:messageId';

incomingMedia.use('/api/incoming-media/*', requireRole('owner', 'admin'));

function privateHeaders(row?: IncomingMediaRow): Headers {
  const headers = new Headers({
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  if (!row || !row.mime_type || row.byte_size === null || !row.sha256) return headers;
  headers.set('Content-Type', row.mime_type);
  headers.set('Content-Length', String(row.byte_size));
  headers.set('X-Content-SHA256', row.sha256);
  return headers;
}

function notFound(): Response {
  return new Response(JSON.stringify({ success: false, error: 'Incoming media not found' }), {
    status: 404,
    headers: privateHeaders(),
  });
}

async function resolveStored(c: Context<Env>): Promise<IncomingMediaRow | null> {
  const accountId = c.req.param('accountId');
  const messageId = c.req.param('messageId');
  if (!accountId || !messageId) return null;
  if (!SAFE_IDENTIFIER.test(accountId) || !SAFE_IDENTIFIER.test(messageId)) return null;
  return getStoredIncomingMedia(c.env.DB, accountId, messageId);
}

// @api-route HEAD /api/incoming-media/:accountId/:messageId
// Hono dispatches HEAD through its GET router and strips the body, so this
// registration intentionally uses GET with an original-method guard. The
// annotation above is consumed by the OpenAPI coverage extractor.
incomingMedia.get(INCOMING_MEDIA_METADATA_PATH, async (c) => {
  if (c.req.method !== 'HEAD') {
    return new Response(null, { status: 405, headers: privateHeaders() });
  }
  const row = await resolveStored(c);
  if (!row) return notFound();
  const object = await c.env.IMAGES.head(row.r2_key);
  if (!object) return notFound();
  return new Response(null, { status: 200, headers: privateHeaders(row) });
});

incomingMedia.get('/api/incoming-media/:accountId/:messageId/content', async (c) => {
  const row = await resolveStored(c);
  if (!row) return notFound();
  const object = await c.env.IMAGES.get(row.r2_key);
  if (!object) return notFound();
  return new Response(object.body, { status: 200, headers: privateHeaders(row) });
});

export { incomingMedia };
