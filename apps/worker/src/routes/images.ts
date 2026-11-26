import { Hono, type Context } from 'hono';
import type { Env } from '../index.js';

const images = new Hono<Env>();

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

// Private image reads use the common staff/scope auth gate. Historical flat
// incoming keys remain readable here without rewriting message history or R2.
async function serveIncomingImage(c: Context<Env>) {
  c.header('Cache-Control', 'private, no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  const key = c.req.param('key') ?? '';
  if (!/^incoming-[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|gif|webp)$/.test(key)) {
    return c.json({ success: false, error: 'Image not found' }, 404);
  }
  const object = await c.env.IMAGES.get(key);
  if (!object) return c.json({ success: false, error: 'Image not found' }, 404);
  c.header('Content-Type', object.httpMetadata?.contentType || 'application/octet-stream');
  return c.body(object.body);
}
images.get('/api/incoming-images/:key', serveIncomingImage);

// GET /images/:key — serve image (public, no auth)
images.get('/images/:key', async (c) => {
  const key = c.req.param('key') ?? '';
  if (/^incoming-[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|gif|webp)$/.test(key) && c.get('staff')) {
    return serveIncomingImage(c);
  }
  // Only flat image filenames are public. This also rejects encoded aliases.
  if (!/^[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|gif|webp)$/.test(key) || /^incoming-/i.test(key)) {
    c.header('Cache-Control', 'private, no-store');
    c.header('X-Content-Type-Options', 'nosniff');
    return c.json({ success: false, error: 'Image not found' }, 404);
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
    const key = c.req.param('key') ?? '';
    if (!/^[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|gif|webp)$/.test(key) || /^incoming-/i.test(key)) {
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
