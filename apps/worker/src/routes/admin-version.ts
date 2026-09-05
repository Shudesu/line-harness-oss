import { Hono } from 'hono';
import {
  BUNDLE_VERSION,
  WORKER_HASH,
  ADMIN_HASH,
  LIFF_HASH,
  WORKER_ASSETS_HASH,
  RELEASED_AT,
} from '../_version.js';

const DEFAULT_MANIFEST_URL =
  'https://github.com/Shudesu/line-harness-oss/releases/latest/download/release-manifest.json';

type Env = {
  Bindings: {
    MANIFEST_URL?: string;
  };
};

// Unauthenticated by design — returns build-time public metadata used by the
// dashboard's upgrade banner before the user logs in. The manifest proxy exists
// because GitHub release assets do not reliably send browser CORS headers.
// Task 18's /admin/update/* mounts under the same /admin prefix but layers
// ADMIN_API_KEY middleware on those subpaths.
const app = new Hono<Env>();

app.get('/version', (c) =>
  c.json({
    version: BUNDLE_VERSION,
    worker_hash: WORKER_HASH,
    admin_hash: ADMIN_HASH,
    liff_hash: LIFF_HASH,
    worker_assets_hash: WORKER_ASSETS_HASH,
    released_at: RELEASED_AT,
  }),
);

app.get('/manifest', async (c) => {
  const manifestUrl = c.env?.MANIFEST_URL ?? DEFAULT_MANIFEST_URL;
  const upstream = await fetch(manifestUrl, {
    cf: { cacheTtl: 60, cacheEverything: true },
  });

  if (!upstream.ok) {
    return c.json({ error: 'manifest_fetch_failed' }, 502);
  }

  return new Response(upstream.body, {
    headers: {
      'Content-Type':
        upstream.headers.get('Content-Type') ?? 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=60',
    },
  });
});

export default app;
