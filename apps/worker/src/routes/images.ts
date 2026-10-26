import { Hono } from 'hono';
import type { Env } from '../index.js';

const images = new Hono<Env>();

function decodeKeyForPublicPolicy(key: string): string {
  let decoded = key;
  // Hono normally decodes one layer. Decode at most two additional layers so
  // case/percent-encoded variants cannot bypass the private-prefix policy.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      break;
    }
  }
  return decoded;
}

function isPrivateIncomingObjectKey(key: string): boolean {
  return decodeKeyForPublicPolicy(key).toLowerCase().startsWith('incoming-');
}

function privateIncomingNotFound(): Response {
  return new Response(JSON.stringify({ success: false, error: 'Image not found' }), {
    status: 404,
    headers: {
      'Cache-Control': 'private, no-store',
      'Content-Type': 'application/json',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

// POST /api/images — upload image (base64 or binary)
images.post('/api/images', async (c) => {
  try {
    const contentType = c.req.header('Content-Type') || '';

    let data: ArrayBuffer;
    let mimeType: string;
    let filename: string | undefined;

    if (contentType.includes('application/json')) {
      const body = await c.req.json<{
        data: string;
        mimeType?: string;
        filename?: string;
      }>();

      if (!body.data) {
        return c.json({ success: false, error: 'data (base64) is required' }, 400);
      }

      let base64 = body.data;
      if (base64.startsWith('data:')) {
        const match = base64.match(/^data:([^;]+);base64,(.+)$/);
        if (match) {
          mimeType = match[1];
          base64 = match[2];
        }
      }
      mimeType ??= body.mimeType ?? 'image/png';
      filename = body.filename;

      const binary = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
      data = binary.buffer;
    } else {
      data = await c.req.arrayBuffer();
      mimeType = contentType.split(';')[0] || 'image/png';
    }

    if (data.byteLength > 10 * 1024 * 1024) {
      return c.json({ success: false, error: 'Image too large (max 10MB)' }, 400);
    }

    const allowedTypes = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(mimeType)) {
      return c.json({ success: false, error: `Unsupported image type: ${mimeType}. Allowed: ${allowedTypes.join(', ')}` }, 400);
    }

    const ext = mimeType.split('/')[1] === 'jpeg' ? 'jpg' : mimeType.split('/')[1];
    const id = crypto.randomUUID();
    const key = `${id}.${ext}`;

    await c.env.IMAGES.put(key, data, {
      httpMetadata: { contentType: mimeType },
      customMetadata: { originalFilename: filename ?? key },
    });

    const workerUrl = c.env.WORKER_URL || new URL(c.req.url).origin;
    const url = `${workerUrl}/images/${key}`;

    return c.json({
      success: true,
      data: { id, key, url, mimeType, size: data.byteLength },
    }, 201);
  } catch (err) {
    console.error('POST /api/images error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /images/:key — serve image (public, no auth)
images.get('/images/:key', async (c) => {
  const key = c.req.param('key');
  const policyKey = decodeKeyForPublicPolicy(key);
  // Public route: only flat "{uuid}.{ext}" keys are servable. Anything with a
  // path separator (e.g. archive/ objects) must 404.
  if (policyKey.includes('/') || policyKey.includes('\\')) {
    return c.json({ success: false, error: 'Image not found' }, 404);
  }
  // All incoming media is private after the #5229 ledger backfill and URL
  // rewrite. Keep this fail-closed in code rather than depending on an optional
  // runtime binding: a missing, stale, or mistyped binding must not reopen old
  // public URLs. This branch returns before R2 is consulted.
  if (isPrivateIncomingObjectKey(key)) {
    return privateIncomingNotFound();
  }
  const object = await c.env.IMAGES.get(key);

  if (!object) {
    return c.json({ success: false, error: 'Image not found' }, 404);
  }

  const headers = new Headers();
  headers.set('Content-Type', object.httpMetadata?.contentType || 'image/png');
  headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  headers.set('ETag', object.etag);

  return new Response(object.body, { headers });
});

// DELETE /api/images/:key — delete image
images.delete('/api/images/:key', async (c) => {
  try {
    const key = c.req.param('key');
    // The generic delete route must never remove private evidence while its D1
    // ledger row remains stored. Deletion/retention needs a ledger-aware flow.
    if (isPrivateIncomingObjectKey(key)) {
      return c.json({ success: false, error: 'Image not found' }, 404);
    }
    await c.env.IMAGES.delete(key);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/images/:key error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { images };
