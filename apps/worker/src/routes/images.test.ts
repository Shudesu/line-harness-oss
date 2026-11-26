import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { images } from './images.js';

type TestEnv = {
  Bindings: { DB: D1Database; IMAGES: R2Bucket };
};

function makeR2Stub() {
  const store = new Map<string, { body: string; contentType?: string }>();
  const r2 = {
    async put(key: string, value: string, options?: { httpMetadata?: { contentType?: string } }) {
      store.set(key, { body: String(value), contentType: options?.httpMetadata?.contentType });
      return {} as never;
    },
    async get(key: string) {
      const item = store.get(key);
      if (!item) return null;
      return {
        body: item.body,
        httpMetadata: { contentType: item.contentType },
        etag: 'test-etag',
      } as never;
    },
    async delete() {},
  } as unknown as R2Bucket;
  return { r2, store };
}

function setupApp() {
  const { r2, store } = makeR2Stub();
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.env = { DB: {} as D1Database, IMAGES: r2 };
    await next();
  });
  app.route('/', images);
  return { app, store };
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
});
