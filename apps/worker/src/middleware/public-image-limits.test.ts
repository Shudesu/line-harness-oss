import { afterEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { rateLimitMiddleware } from './rate-limit.js';
import { authMiddleware } from './auth.js';
import { images } from '../routes/images.js';
import type { Env } from '../index.js';

afterEach(() => { vi.restoreAllMocks(); });

function setup() {
  const bucket = {
    get: vi.fn(async () => ({ body: new Uint8Array([1, 2, 3]), etag: 'synthetic-etag', httpMetadata: { contentType: 'image/png' } })),
    put: vi.fn(), delete: vi.fn(),
  };
  const a = new Hono<Env>();
  a.use('*', rateLimitMiddleware);
  a.use('*', authMiddleware);
  a.route('/', images);
  const env = { API_KEY: 'synthetic-key', IMAGES: bucket };
  return { a, env, bucket };
}

describe('public image and protected management routes', () => {
  it.each(['GET', 'HEAD'])('%s images remain available and do not consume the anonymous API budget', async method => {
    const { a, env, bucket } = setup();
    const ip = method === 'GET' ? '192.0.2.201' : '192.0.2.202';
    for (let i = 0; i < 105; i++) {
      const res = await a.request('/images/synthetic.png', { method, headers: { 'cf-connecting-ip': ip } }, env);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(res.headers.get('cache-control')).toContain('immutable');
      expect(res.headers.get('etag')).toBe('synthetic-etag');
      expect(res.headers.get('X-RateLimit-Remaining')).toBeNull();
      expect((await res.arrayBuffer()).byteLength).toBe(method === 'GET' ? 3 : 0);
    }
    const upload = await a.request('/api/images', { method: 'POST', headers: { 'cf-connecting-ip': ip } }, env);
    expect(upload.status).toBe(401);
    expect(bucket.put).not.toHaveBeenCalled();
    expect(bucket.delete).not.toHaveBeenCalled();
  });

  it.each(['POST', 'DELETE'])('%s management stays authenticated and limited', async method => {
    const { a, env, bucket } = setup();
    const path = method === 'POST' ? '/api/images' : '/api/images/synthetic.png';
    const ip = method === 'POST' ? '192.0.2.203' : '192.0.2.204';
    for (let i = 0; i < 101; i++) {
      const res = await a.request(path, { method, headers: { 'cf-connecting-ip': ip } }, env);
      expect(res.status).toBe(i < 100 ? 401 : 429);
    }
    expect(bucket.put).not.toHaveBeenCalled();expect(bucket.delete).not.toHaveBeenCalled();
  });

  it('does not exempt non-read methods or a normalized traversal to the management API', async () => {
    const { a, env, bucket } = setup();
    for (let i = 0; i < 101; i++) {
      const res = await a.request('/images/%2e%2e/api/images/synthetic.png', { method: 'DELETE', headers: { 'cf-connecting-ip': '192.0.2.205' } }, env);
      expect(res.status).toBe(i < 100 ? 401 : 429);
    }
    for (let i = 0; i < 101; i++) {
      const res = await a.request('/images/synthetic.png', { method: 'POST', headers: { 'cf-connecting-ip': '192.0.2.206' } }, env);
      expect(res.status).toBe(i < 100 ? 404 : 429);
    }
    expect(bucket.put).not.toHaveBeenCalled();expect(bucket.delete).not.toHaveBeenCalled();
  });

  it.each(['/images/incoming-synthetic.jpg', '/images/%69ncoming-synthetic.jpg'])('keeps the authenticated legacy incoming image path %s under the API limit', async path => {
    const { a, env, bucket } = setup();
    const ip = path.includes('%') ? '192.0.2.208' : '192.0.2.207';
    for (let i = 0; i < 101; i++) {
      const res = await a.request(path, { headers: { 'cf-connecting-ip': ip } }, env);
      expect(res.status).toBe(i < 100 ? 404 : 429);
    }
    expect(bucket.get).not.toHaveBeenCalled();
  });
});
