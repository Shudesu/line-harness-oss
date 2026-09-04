import { Hono } from 'hono';
import type { Context, Next } from 'hono';
import { getStoredIncomingMedia } from '@line-crm/db';
import type { IncomingMediaRow } from '@line-crm/db';
import type { Env } from '../index.js';

const incomingMedia = new Hono<Env>();
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/;
const INCOMING_MEDIA_METADATA_PATH = '/api/incoming-media/:accountId/:messageId';

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

function privateError(status: number, error: string): Response {
  const headers = privateHeaders();
  headers.set('Content-Type', 'application/json');
  return new Response(JSON.stringify({ success: false, error }), { status, headers });
}

function metadataMatches(row: IncomingMediaRow, object: R2Object): boolean {
  if (!row.mime_type || row.byte_size === null || !row.sha256) return false;
  const objectType = object.httpMetadata?.contentType
    ?.split(';')[0]
    .trim()
    .toLowerCase();
  if (object.size !== row.byte_size || objectType !== row.mime_type) return false;
  const objectHash = object.customMetadata?.sha256;
  const objectSize = object.customMetadata?.byteSize;
  if (objectHash !== undefined && objectHash !== row.sha256) return false;
  if (objectSize !== undefined && objectSize !== String(row.byte_size)) return false;
  return true;
}

function logReadFailure(c: Context<Env>, stage: string): void {
  const principal = c.get('incomingMediaService');
  console.error(JSON.stringify({
    event: 'incoming_media_private_read_failed',
    stage,
    method: c.req.method,
    credential_id: principal?.credentialId ?? null,
    cf_ray: c.req.header('cf-ray') ?? null,
  }));
}

async function requireIncomingMediaRead(
  c: Context<Env>,
  next: Next,
): Promise<Response | void> {
  const rawAccountSegment = new URL(c.req.url).pathname.split('/')[3] ?? '';
  let accountId: string;
  try {
    accountId = decodeURIComponent(rawAccountSegment);
  } catch {
    return notFound();
  }
  if (accountId !== rawAccountSegment || !SAFE_IDENTIFIER.test(accountId)) {
    return notFound();
  }
  c.set('incomingMediaAccountId', accountId);

  const staff = c.get('staff');
  if (staff) {
    if (staff.role !== 'owner' && staff.role !== 'admin') {
      return privateError(403, 'この操作にはowner権限が必要です');
    }
    return next();
  }

  const principal = c.get('incomingMediaService');
  if (!principal) {
    return privateError(401, 'Unauthorized');
  }
  if (principal.lineAccountId !== accountId) {
    return notFound();
  }
  return next();
}

incomingMedia.use('/api/incoming-media/*', requireIncomingMediaRead);

function notFound(): Response {
  return new Response(JSON.stringify({ success: false, error: 'Incoming media not found' }), {
    status: 404,
    headers: privateHeaders(),
  });
}

async function resolveStored(c: Context<Env>): Promise<IncomingMediaRow | null> {
  const accountId = c.get('incomingMediaAccountId') ?? '';
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
  try {
    const row = await resolveStored(c);
    if (!row) return notFound();
    const object = await c.env.IMAGES.head(row.r2_key);
    if (!object) return notFound();
    if (!metadataMatches(row, object)) {
      logReadFailure(c, 'metadata_mismatch');
      return privateError(503, 'Incoming media temporarily unavailable');
    }
    return new Response(null, { status: 200, headers: privateHeaders(row) });
  } catch {
    logReadFailure(c, 'provider_error');
    return privateError(503, 'Incoming media temporarily unavailable');
  }
});

incomingMedia.get('/api/incoming-media/:accountId/:messageId/content', async (c) => {
  if (c.req.method !== 'GET') {
    return new Response(null, { status: 405, headers: privateHeaders() });
  }
  try {
    const row = await resolveStored(c);
    if (!row) return notFound();
    const object = await c.env.IMAGES.get(row.r2_key);
    if (!object) return notFound();
    if (!metadataMatches(row, object)) {
      logReadFailure(c, 'metadata_mismatch');
      return privateError(503, 'Incoming media temporarily unavailable');
    }
    return new Response(object.body, { status: 200, headers: privateHeaders(row) });
  } catch {
    logReadFailure(c, 'provider_error');
    return privateError(503, 'Incoming media temporarily unavailable');
  }
});

export { incomingMedia };
