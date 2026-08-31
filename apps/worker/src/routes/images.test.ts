import { describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { images } from './images.js';

type TestEnv = {
  Bindings: { DB: D1Database; IMAGES: R2Bucket };
};

function makeR2Stub() {
  const store = new Map<string, { body: string; contentType?: string }>();
  const get = vi.fn(async (key: string) => {
    const item = store.get(key);
    if (!item) return null;
    return {
      body: item.body,
      httpMetadata: { contentType: item.contentType },
      etag: 'test-etag',
    } as never;
  });
  const deleteObject = vi.fn(async () => undefined);
  const r2 = {
    async put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, { body: String(value), contentType: options?.httpMetadata?.contentType });
      return {} as never;
    },
    get,
    delete: deleteObject,
  } as unknown as R2Bucket;
  return { r2, store, get, deleteObject };
}

function setupApp() {
  const { r2, store, get, deleteObject } = makeR2Stub();
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.env = { DB: {} as D1Database, IMAGES: r2 };
    await next();
  });
  app.route('/', images);
  return { app, store, get, deleteObject };
}

describe('GET /images/:key', () => {
  it('serves a flat key that exists', async () => {
    const { app, store } = setupApp();
    store.set('abc.png', { body: 'png-bytes', contentType: 'image/png' });
    const res = await app.request('/images/abc.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('image/png');
  });

  it('404s for a missing key', async () => {
    const { app } = setupApp();
    const res = await app.request('/images/missing.png');
    expect(res.status).toBe(404);
  });

  it('never serves slash-containing keys (archive/ objects are not public)', async () => {
    const { app, store } = setupApp();
    store.set('archive/messages_log/2026-01-01/m1.ndjson', {
      body: 'secret',
      contentType: 'application/x-ndjson',
    });
    const res = await app.request('/images/archive%2Fmessages_log%2F2026-01-01%2Fm1.ndjson');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('secret');
  });

  it('never serves incoming-* evidence objects or consults R2 for them', async () => {
    const { app, store, get } = setupApp();
    store.set('incoming-secret.png', { body: 'private-evidence', contentType: 'image/png' });
    const res = await app.request('/images/incoming-secret.png');
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('private-evidence');
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    '/images/InCoMiNg-secret.png',
    '/images/%69nCoMiNg-secret.png',
    '/images/%2569ncoming-secret.png',
  ])('blocks case and percent-encoded incoming prefixes: %s', async (path) => {
    const { app, get } = setupApp();
    const res = await app.request(path);
    expect(res.status).toBe(404);
    expect(get).not.toHaveBeenCalled();
  });

  it('keeps ordinary public uploads retrievable from their returned /images URL', async () => {
    const { app } = setupApp();
    const upload = await app.request('/api/images', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: 'AQIDBA==', mimeType: 'image/png', filename: 'public.png' }),
    });
    expect(upload.status).toBe(201);
    const payload = await upload.json() as { data: { url: string; key: string } };
    expect(payload.data.key).not.toMatch(/^incoming-/);

    const served = await app.request(new URL(payload.data.url).pathname);
    expect(served.status).toBe(200);
    expect(served.headers.get('Cache-Control')).toContain('public');
  });
});

describe('DELETE /api/images/:key', () => {
  it.each([
    '/api/images/incoming-secret.png',
    '/api/images/InCoMiNg-secret.png',
    '/api/images/%69nCoMiNg-secret.png',
    '/api/images/%2569ncoming-secret.png',
  ])('never deletes normalized private incoming objects: %s', async (path) => {
    const { app, deleteObject } = setupApp();
    const res = await app.request(path, { method: 'DELETE' });
    expect(res.status).toBe(404);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it('keeps ordinary public image deletion working', async () => {
    const { app, deleteObject } = setupApp();
    const res = await app.request('/api/images/public.png', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(deleteObject).toHaveBeenCalledWith('public.png');
  });
});
