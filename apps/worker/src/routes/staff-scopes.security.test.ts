import { afterEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { Hono } from 'hono';
import { authMiddleware } from '../middleware/auth.js';
import { staff } from './staff.js';
import { images } from './images.js';
import { adminAuth } from './admin-auth.js';
import { lineProxy } from './line-proxy.js';
import type { Env } from '../index.js';

const databases: Database.Database[] = [];
afterEach(() => { databases.splice(0).forEach(db => db.close()); vi.unstubAllGlobals(); });
function setup() {
  const sql = new Database(':memory:');
  databases.push(sql);
  sql.exec(readFileSync(new NodeURL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8'));
  const db = { prepare(query: string) {
    const statement = sql.prepare(query);
    let values: unknown[] = [];
    return {
      bind(...args: unknown[]) { values = args; return this; },
      async first() { return statement.get(...values) ?? null; },
      async all() { return { results: statement.all(...values) }; },
      async run() { return { meta: { changes: statement.run(...values).changes } }; },
    };
  } } as unknown as D1Database;
  const get = vi.fn(async () => ({ body: 'private-image', httpMetadata: { contentType: 'image/png' }, etag: 'tag' }));
  const put = vi.fn();
  const remove = vi.fn();
  const bindings = { DB: db, API_KEY: 'owner-secret', IMAGES: { get, put, delete: remove }, WORKER_URL: 'https://worker.example.test' } as unknown as Env['Bindings'];
  const app = new Hono<Env>();
  app.use('*', authMiddleware);
  app.route('/', staff);
  app.route('/', adminAuth);
  app.route('/', images);
  app.route('/', lineProxy);
  // Sentinel handlers prove the common gate runs before read/write effects.
  const write = vi.fn((c: any) => c.json({ success: true }));
  app.post('/api/friends/:id/messages', write);
  app.post('/api/chats/:id/send', write);
  app.post('/api/broadcasts', write);
  app.get('/api/friends/:id/messages', c => c.json({ success: true }));
  app.get('/api/conversations', c => c.json({ success: true }));
  app.get('/api/conversations/:id', c => c.json({ success: true }));
  app.get('/api/chats/:id', c => c.json({ success: true }));
  app.get('/api/line-accounts', c => c.json({ secret: 'must-not-leak' }));
  app.get('/api/new-admin-feature', c => c.json({ secret: 'must-not-leak' }));
  app.get('/api/forms/:id', c => c.json({ privileged: !!c.get('staff') }));
  const request = (path: string, token?: string, method = 'GET', body?: unknown) => app.request(path, {
    method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }, bindings);
  async function create(apiScopes: unknown, role = 'staff') {
    const res = await request('/api/staff', 'owner-secret', 'POST', { name: 'Integration', role, apiScopes });
    expect(res.status).toBe(201);
    return (await res.json() as any).data as { id: string; apiKey: string; apiScopes: string[] | null };
  }
  return { request, create, sql, get, put, remove, write, app, bindings };
}

describe('persisted staff API scopes through the real auth and management routes', () => {
  it('read-only allows conversation/private image reads and denies sending, settings and escalation', async () => {
    const s = setup(); const key = await s.create(['messages:read']);
    expect(key.apiScopes).toEqual(['messages:read']);
    for (const path of ['/api/friends/f1/messages', '/api/chats/f1', '/api/conversations', '/api/conversations/f1', '/api/incoming-images/incoming-old-123.png']) {
      expect((await s.request(path, key.apiKey)).status).toBe(200);
    }
    for (const [method, path, body] of [
      ['POST', '/api/friends/f1/messages', {}], ['POST', '/api/chats/f1/send', {}],
      ['POST', '/api/broadcasts', {}], ['GET', '/api/line-accounts', undefined],
      ['POST', '/api/staff', { role: 'owner', name: 'Escalate' }],
      ['PATCH', `/api/staff/${key.id}`, { apiScopes: null, role: 'owner' }],
      ['GET', '/api/new-admin-feature', undefined], ['POST', '/api/images', { data: 'AQID', mimeType: 'image/png' }],
    ] as const) expect((await s.request(path, key.apiKey, method, body)).status).toBe(403);
    expect(s.write).not.toHaveBeenCalled(); expect(s.put).not.toHaveBeenCalled();
    const form = await s.request('/api/forms/f1', key.apiKey);
    expect(await form.json()).toEqual({ privileged: false });
    const login = await s.request('/api/auth/login', undefined, 'POST', { apiKey: key.apiKey });
    expect(login.status).toBe(403); expect(login.headers.get('Set-Cookie')).toBeNull();
  });

  it('messaging key permits only explicit individual send routes and upload, not raw proxy or broadcast', async () => {
    const s = setup(); const key = await s.create(['messages:read', 'messages:send']);
    for (const path of ['/api/friends/f1/messages', '/api/chats/f1/send']) {
      expect((await s.request(path, key.apiKey, 'POST', {})).status).toBe(200);
    }
    expect((await s.request('/api/images', key.apiKey, 'POST', { data: 'AQID', mimeType: 'image/png' })).status).toBe(201);
    expect(s.put).toHaveBeenCalledOnce();
    const upstream = vi.fn(); vi.stubGlobal('fetch', upstream);
    for (const path of ['/line-api/v2/bot/message/push', '/line-api/v2/bot/message/broadcast', '/line-api-data/v2/bot/message/123/content']) {
      expect((await s.request(path, key.apiKey, path.includes('/content') ? 'GET' : 'POST', path.includes('/content') ? undefined : {})).status).toBe(403);
    }
    expect(upstream).not.toHaveBeenCalled();
    expect((await s.request('/api/broadcasts', key.apiKey, 'POST', {})).status).toBe(403);
    expect(s.write).toHaveBeenCalledTimes(2);
  });

  it('restrictions persist across rotation, cookie auth, revocation, malformed stored values and unknown paths', async () => {
    const s = setup(); const key = await s.create(['messages:read']);
    const cookieRes = await s.app.request('/api/chats/f1/send', { method: 'POST', headers: {
      Cookie: `lh_admin_session=${key.apiKey}; lh_csrf=test`, 'X-CSRF-Token': 'test',
    } }, s.bindings);
    expect(cookieRes.status).toBe(403);
    const rotation = await s.request(`/api/staff/${key.id}/regenerate-key`, 'owner-secret', 'POST');
    const rotated = (await rotation.json() as any).data.apiKey;
    expect((await s.request('/api/chats/f1', key.apiKey)).status).toBe(401);
    expect((await s.request('/api/chats/f1/send', rotated, 'POST', {})).status).toBe(403);
    for (const malformed of ['bad-json', 'null', '{}', '["unknown"]', '[]']) {
      s.sql.prepare('UPDATE staff_members SET api_scopes = ? WHERE id = ?').run(malformed, key.id);
      expect((await s.request('/api/chats/f1', rotated)).status).toBe(403);
    }
    expect((await s.request(`/api/staff/${key.id}`, 'owner-secret', 'PATCH', { isActive: false })).status).toBe(200);
    expect((await s.request('/api/chats/f1', rotated)).status).toBe(401);
    expect(s.write).not.toHaveBeenCalled();
  });

  it('validates scopes before create/update and retains legacy staff capability', async () => {
    const s = setup(); const legacy = await s.create(null);
    expect((await s.request('/api/chats/f1/send', legacy.apiKey, 'POST', {})).status).toBe(200);
    for (const apiScopes of ['messages:read', ['unknown'], {}, [null]]) {
      expect((await s.request('/api/staff', 'owner-secret', 'POST', { name: 'Bad', role: 'staff', apiScopes })).status).toBe(400);
      expect((await s.request(`/api/staff/${legacy.id}`, 'owner-secret', 'PATCH', { apiScopes })).status).toBe(400);
    }
    expect((await s.request('/api/staff', 'owner-secret', 'POST', { name: 'Bad', role: 'owner', apiScopes: [] })).status).toBe(400);
    expect((await s.request(`/api/staff/${legacy.id}`, 'owner-secret', 'PATCH', { apiScopes: ['messages:read'] })).status).toBe(200);
    expect((await s.request('/api/chats/f1/send', legacy.apiKey, 'POST', {})).status).toBe(403);
  });

  it('private images deny anonymous GET/HEAD and preserve authenticated HEAD without cache', async () => {
    const s = setup(); const key = await s.create(['messages:read']);
    for (const method of ['GET', 'HEAD']) {
      expect((await s.request('/api/incoming-images/incoming-old-123.png', undefined, method)).status).toBe(401);
    }
    expect(s.get).not.toHaveBeenCalled();
    for (const path of ['/images/incoming-old-123.png', '/images/%69ncoming-old-123.png', '/images/InCoMiNg-old-123.png', '/images/%2569ncoming-old-123.png', '/images/archive%2Fsecret.png']) {
      for (const method of ['GET', 'HEAD']) {
        const res = await s.request(path, undefined, method);
        expect(res.status).toBe(404); expect(res.headers.get('Cache-Control')).toBe('private, no-store');
      }
    }
    expect(s.get).not.toHaveBeenCalled();
    for (const path of ['/images/incoming-old-123.png', '/images/%69ncoming-old-123.png']) {
      const legacy = await s.request(path, key.apiKey);
      expect(legacy.status).toBe(200);
      expect(legacy.headers.get('Cache-Control')).toBe('private, no-store');
      expect(await legacy.text()).toBe('private-image');
    }
    const read = await s.request('/api/incoming-images/incoming-old-123.png', key.apiKey);
    expect(await read.text()).toBe('private-image'); expect(read.headers.get('Cache-Control')).toBe('private, no-store');
    const head = await s.request('/api/incoming-images/incoming-old-123.png', key.apiKey, 'HEAD');
    expect(head.status).toBe(200); expect(await head.text()).toBe('');
    const publicImage = await s.request('/images/public-upload.png');
    expect(publicImage.status).toBe(200); expect(publicImage.headers.get('Cache-Control')).toContain('public');
    expect((await s.request('/api/images/incoming-old-123.png', 'owner-secret', 'DELETE')).status).toBe(404);
    expect(s.remove).not.toHaveBeenCalled();
  });
});
