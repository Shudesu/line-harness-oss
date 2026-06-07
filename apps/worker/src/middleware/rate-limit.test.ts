import { describe, expect, test } from 'vitest';
import { Hono } from 'hono';
import { rateLimitMiddleware } from './rate-limit.js';
import type { Env } from '../index.js';

function app() {
  const a = new Hono<Env>();
  a.use('*', rateLimitMiddleware);
  a.get('/api/protected', (c) => c.json({ success: true }));
  return a;
}

const env = {} as Env['Bindings'];

describe('rate-limit IP ceiling (pre-auth token rotation)', () => {
  test('rotating unvalidated session cookies from one IP cannot bypass the limiter', async () => {
    // A unique IP isolates this test from the module-level store. Each request
    // uses a DIFFERENT bogus cookie, so the per-token bucket never trips — only
    // the per-IP ceiling (3000) should eventually return 429.
    const ip = '203.0.113.77';
    const a = app();
    let saw429 = false;

    for (let i = 0; i < 3001; i++) {
      const res = await a.request('/api/protected', {
        headers: {
          'cf-connecting-ip': ip,
          Cookie: `lh_admin_session=bogus-${i}`,
        },
      }, env);
      if (res.status === 429) {
        saw429 = true;
        break;
      }
    }

    expect(saw429).toBe(true);
  });

  test('a single legitimate token keeps its full allowance from one IP', async () => {
    const ip = '198.51.100.42';
    const a = app();
    // Well under both AUTHENTICATED_MAX and the IP ceiling.
    for (let i = 0; i < 50; i++) {
      const res = await a.request('/api/protected', {
        headers: { 'cf-connecting-ip': ip, Cookie: 'lh_admin_session=stable-token' },
      }, env);
      expect(res.status).toBe(200);
    }
  });
});
