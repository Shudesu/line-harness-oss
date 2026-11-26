import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';

// The notFound handler imports DB query helpers transitively (via the
// /r/:ref routes file isn't reached here, but `buildOgForLiffPath` reads
// from `@line-crm/db`-shaped tables through `c.env.DB.prepare`). The bot UA
// path is not exercised by these tests; everything else stays inside the
// handler so no DB calls happen.
vi.mock('@line-crm/db', () => ({
  // index.ts pulls these eagerly at module load; provide no-op stubs so the
  // import graph resolves under Vitest.
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getTrafficPoolBySlug: vi.fn(),
  getTrafficPoolById: vi.fn(),
  getRandomPoolAccount: vi.fn(),
  getPoolAccounts: vi.fn(),
  getEntryRouteByRefCode: vi.fn(),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
}));

import { notFoundHandler, type Env } from './index.js';

function makeApp(env: Partial<Env['Bindings']>) {
  const app = new Hono<Env>();
  app.notFound(notFoundHandler);
  return (path: string, init?: RequestInit) =>
    app.fetch(new Request(`https://worker.example.com${path}`, init), env as Env['Bindings']);
}

describe('notFoundHandler — root / request', () => {
  it('returns 404 JSON when ASSETS binding is undefined (no TypeError)', async () => {
    const fetchApp = makeApp({ DB: {} as D1Database });
    const res = await fetchApp('/');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body).toEqual({ success: false, error: 'Not found' });
  });

  it('returns 404 JSON when ASSETS exists but has no fetch method', async () => {
    const fetchApp = makeApp({
      DB: {} as D1Database,
      ASSETS: {} as unknown as Fetcher,
    });
    const res = await fetchApp('/');
    expect(res.status).toBe(404);
  });

  it('delegates to ASSETS.fetch when the binding is present', async () => {
    const assets: Fetcher = {
      fetch: vi.fn().mockResolvedValue(new Response('static', { status: 200 })),
    } as unknown as Fetcher;
    const fetchApp = makeApp({ DB: {} as D1Database, ASSETS: assets });
    const res = await fetchApp('/some-spa-path');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('static');
    expect(assets.fetch).toHaveBeenCalledOnce();
  });

  it('returns JSON 404 (not ASSETS lookup) for /api/* unknown paths', async () => {
    const assets: Fetcher = {
      fetch: vi.fn().mockResolvedValue(new Response('should not be called', { status: 200 })),
    } as unknown as Fetcher;
    const fetchApp = makeApp({ DB: {} as D1Database, ASSETS: assets });
    const res = await fetchApp('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(assets.fetch).not.toHaveBeenCalled();
  });
});

describe('notFoundHandler — SPA fallback', () => {
  // アセットストアに実ファイルが無いパス (LIFF の深いルート) は 404 で返るが、
  // HTML を要求する GET ナビゲーションに限り index.html を返す。
  function makeAssets(): Fetcher {
    return {
      fetch: vi.fn(async (req: Request) => {
        const path = new URL(req.url).pathname;
        if (path === '/') return new Response('<html>index</html>', { status: 200 });
        return new Response(null, { status: 404 });
      }),
    } as unknown as Fetcher;
  }

  it('serves root index.html for a deep-link GET that accepts HTML (/webinar/:slug)', async () => {
    const assets = makeAssets();
    const fetchApp = makeApp({ DB: {} as D1Database, ASSETS: assets });
    const res = await fetchApp('/webinar/harness-day2?liffId=x', {
      headers: { accept: 'text/html,application/xhtml+xml' },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<html>index</html>');
    // 3 fetches: exact path (404) → /webinar/index.html (404, no such surface) → / (200).
    expect(assets.fetch).toHaveBeenCalledTimes(3);
  });

  it('keeps 404 for non-HTML requests (missing asset file)', async () => {
    const assets = makeAssets();
    const fetchApp = makeApp({ DB: {} as D1Database, ASSETS: assets });
    const res = await fetchApp('/assets/missing.js', {
      headers: { accept: '*/*' },
    });
    expect(res.status).toBe(404);
    expect(assets.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps 404 for non-GET methods even when HTML is accepted', async () => {
    const assets = makeAssets();
    const fetchApp = makeApp({ DB: {} as D1Database, ASSETS: assets });
    const res = await fetchApp('/webinar/harness-day2', {
      method: 'POST',
      headers: { accept: 'text/html' },
    });
    expect(res.status).toBe(404);
    expect(assets.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('notFoundHandler — three-surfaces bundle prefix fallback (2026-08-24)', () => {
  // three-surfaces bundle 以降、このオリジンは root（LIFF アプリ）以外にも
  // /<adminBasePath>（admin）・/liff-app（apps/liff）という別サーフェスを配信する。
  // ここでは各サーフェスの deep link が自分自身の index.html に落ちること —
  // root の LIFF アプリの index.html に誤って着地しないこと — を確認する。
  function makeMultiSurfaceAssets(indexPaths: readonly string[]): Fetcher {
    return {
      fetch: vi.fn(async (req: Request) => {
        const path = new URL(req.url).pathname;
        if (indexPaths.includes(path)) {
          return new Response(`<html>${path}</html>`, { status: 200 });
        }
        return new Response(null, { status: 404 });
      }),
    } as unknown as Fetcher;
  }

  it('falls back to /console/index.html for an admin deep link, not the root LIFF app', async () => {
    const assets = makeMultiSurfaceAssets(['/', '/console/index.html']);
    const fetchApp = makeApp({ DB: {} as D1Database, ASSETS: assets });
    const res = await fetchApp('/console/friends/123', {
      headers: { accept: 'text/html' },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<html>/console/index.html</html>');
    // exact path (404) → /console/index.html (200) — must NOT also try root.
    expect(assets.fetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to /liff-app/index.html for an apps/liff deep link, not the root LIFF app', async () => {
    const assets = makeMultiSurfaceAssets(['/', '/liff-app/index.html']);
    const fetchApp = makeApp({ DB: {} as D1Database, ASSETS: assets });
    const res = await fetchApp('/liff-app/webinar/harness-day2', {
      headers: { accept: 'text/html' },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<html>/liff-app/index.html</html>');
    expect(assets.fetch).toHaveBeenCalledTimes(2);
  });

  it('still falls back to root index.html for the root LIFF app itself (no matching prefix dir)', async () => {
    const assets = makeMultiSurfaceAssets(['/', '/console/index.html', '/liff-app/index.html']);
    const fetchApp = makeApp({ DB: {} as D1Database, ASSETS: assets });
    const res = await fetchApp('/events/some-event-id', {
      headers: { accept: 'text/html' },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('<html>/</html>');
  });
});
