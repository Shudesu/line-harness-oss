/**
 * Self-update HTTP API — Phase 5 Task 18.
 *
 * Mounted at `/admin/update` from `index.ts`. Every endpoint is guarded by an
 * `x-admin-api-key` header check that must equal `c.env.ADMIN_API_KEY`. The
 * sibling `/admin/version` route is intentionally UN-authenticated (the
 * upgrade banner reads it pre-login) — that route lives in `admin-version.ts`
 * and is mounted at `/admin` directly. The per-router middleware here only
 * sees requests under `/admin/update/*`, so adding it does not leak auth to
 * `/admin/version`.
 *
 * High-level flow for `POST /start`:
 *   1. Read the release manifest.
 *   2. Locate the latest release as the *target*.
 *   3. Build a `CurrentVersion` from the build-stamped `_version.ts`.
 *   4. Detect fork — bail (409) on any mismatch so we never auto-update a
 *      custom build.
 *   5. Bail (200 already_latest) when target === current to keep the UI flow
 *      simple (operator clicked "update" with nothing to do).
 *   6. Call the engine's `runUpdate` which returns an {@link UpdateHandle}
 *      AS SOON AS the snapshot row exists (≈ 2 Pages API calls + 1 D1
 *      insert). The long-running phase work (`handle.done`) is fed into
 *      `executionCtx.waitUntil` so it keeps running after the response is
 *      sent. We return `202 { updateId }` immediately so the dashboard can
 *      open `/stream/:id` to watch progress live. Without the split the
 *      handler would block for 30-60s and risk hitting Worker CPU/wall
 *      limits before sending a single byte back.
 *
 * Compatibility note: `runUpdate` pulls in `node:stream`, `node:zlib`, and
 * `tar-stream`. The Worker requires `nodejs_compat` in `wrangler.toml`
 * (added by this task) — see the compatibility concerns in the PR
 * description.
 */

import { Hono } from 'hono';
import {
  runUpdate,
  fetchManifest,
  detectFork,
  findRelease,
  getSnapshot,
  listRecent,
  type D1Like,
  type ReleaseEntry,
  type CurrentVersion,
} from '@line-harness/update-engine';
import {
  BUNDLE_VERSION,
  WORKER_HASH,
  ADMIN_HASH,
  LIFF_HASH,
  WORKER_ASSETS_HASH,
} from '../_version.js';

/**
 * Env bindings consumed by this router. Kept local because only this file
 * needs the self-update vars; the main app `Env` in index.ts mirrors them
 * onto the global Bindings type.
 */
type UpdateEnv = {
  Bindings: {
    DB: D1Database;
    ADMIN_API_KEY: string;
    CF_API_TOKEN: string;
    CF_ACCOUNT_ID: string;
    WORKER_NAME: string;
    ADMIN_PAGES_PROJECT: string;
    LIFF_PAGES_PROJECT: string;
    D1_DATABASE_ID: string;
    MANIFEST_URL: string;
    WORKER_PUBLIC_URL: string;
    ADMIN_PUBLIC_URL: string;
    LIFF_PUBLIC_URL: string;
  };
};

const app = new Hono<UpdateEnv>();

/**
 * Adapter from Cloudflare's `D1Database` to the engine's local `D1Like`
 * interface. The engine deliberately doesn't depend on
 * `@cloudflare/workers-types` so it can also run under better-sqlite3 in
 * Node tests; we bridge the two shapes here.
 *
 * The engine only uses `prepare().bind().run()/first()/all()`, so the
 * adapter intentionally exposes nothing else.
 */
function adaptD1(db: D1Database): D1Like {
  return {
    prepare: (sql: string) => {
      const stmt = db.prepare(sql);
      return {
        bind: (...args: any[]) => {
          const bound = stmt.bind(...args);
          return {
            run: () => bound.run() as Promise<unknown>,
            first: <T = any>() => bound.first<T>() as Promise<T | null>,
            all: <T = any>() =>
              bound.all<T>() as Promise<{ results: T[] }>,
          };
        },
      };
    },
  };
}

/** Auth gate — single source of truth for every endpoint in this router. */
app.use('/*', async (c, next) => {
  const key = c.req.header('x-admin-api-key');
  if (!key || key !== c.env.ADMIN_API_KEY) {
    return c.text('unauthorized', 401);
  }
  await next();
});

/**
 * POST /admin/update/start — kick off a self-update.
 *
 * Returns:
 *   - 202 { updateId } on success (engine running in background)
 *   - 200 { error: 'already_latest' } when nothing to update
 *   - 409 { error: 'fork_detected', reason } for non-vanilla builds
 *   - 500 { error: 'manifest_missing_target' | 'no_current_release' } when
 *     the manifest is missing the version we need to look up
 *   - 500 { error: 'update_failed', message } when engine setup fails
 *     BEFORE the snapshot row is created (e.g. CF Pages API down so
 *     `getLatestDeployment` rejects). Once `runUpdate` resolves with a
 *     handle this branch is unreachable — phase failures land in the
 *     snapshot row and are visible via `/status/:id`.
 */
app.post('/start', async (c) => {
  const manifest = await fetchManifest(c.env.MANIFEST_URL);
  // The manifest always pins one "latest" version; locate that entry. If the
  // manifest is malformed (latest doesn't appear in releases[]) we fail
  // closed rather than guess.
  const target = manifest.releases.find((r) => r.version === manifest.latest);
  if (!target) {
    return c.json({ error: 'manifest_missing_target' }, 500);
  }

  const current: CurrentVersion = {
    version: BUNDLE_VERSION,
    worker_hash: WORKER_HASH,
    admin_hash: ADMIN_HASH,
    liff_hash: LIFF_HASH,
    worker_assets_hash: WORKER_ASSETS_HASH,
  };

  const fork = detectFork(current, manifest);
  if (fork.kind === 'fork') {
    return c.json({ error: 'fork_detected', reason: fork.reason }, 409);
  }

  // No-op path: we matched a manifest entry AND the version equals the
  // target. Returning 200 (not 204) so the dashboard can show a
  // confirmation toast with the version label.
  if (target.version === current.version) {
    return c.json({ error: 'already_latest', version: current.version }, 200);
  }

  // For rollback purposes the engine needs to know where the *current*
  // worker bundle is stored. We carry that on the matching release entry.
  // If the manifest doesn't know about our current version we can't
  // construct a safe rollback path, so we bail.
  const currentRelease = findRelease(manifest, current.version);
  if (!currentRelease) {
    return c.json({ error: 'no_current_release' }, 500);
  }

  const d1 = adaptD1(c.env.DB);

  // The engine returns an UpdateHandle as soon as the snapshot row is
  // written (≈ 2 Pages API calls + 1 D1 insert). Phase work continues
  // in the background via `handle.done`. We hand that to
  // `executionCtx.waitUntil` so the isolate stays alive long enough for
  // the engine to flush its terminal status row, but the HTTP response
  // goes back immediately with the updateId — letting the dashboard
  // open `/stream/:id` for live progress.
  //
  // The outer `await runUpdate(...)` only rejects when SETUP fails
  // (CF Pages API down, etc.) — at that point no snapshot row exists
  // and we surface a 500 so the dashboard can tell the operator the
  // update never started. Phase failures (preflight/apply/verify) do
  // NOT throw here; they land in the snapshot row and are observable
  // via `/status/:id` and `/stream/:id`.
  let handle;
  try {
    handle = await runUpdate({
      ctx: {
        creds: {
          accountId: c.env.CF_ACCOUNT_ID,
          apiToken: c.env.CF_API_TOKEN,
        },
        workerName: c.env.WORKER_NAME,
        adminPagesProject: c.env.ADMIN_PAGES_PROJECT,
        liffPagesProject: c.env.LIFF_PAGES_PROJECT,
        d1DatabaseId: c.env.D1_DATABASE_ID,
        current,
        target,
        manifestUrl: c.env.MANIFEST_URL,
        // Enables admin-bundle placeholder materialization in the apply
        // phase — without it the deployed admin calls __LH_WORKER_URL__.
        workerPublicUrl: c.env.WORKER_PUBLIC_URL,
      },
      d1,
      workerHealthUrl: `${c.env.WORKER_PUBLIC_URL}/api/health`,
      adminUrl: c.env.ADMIN_PUBLIC_URL,
      // Empty for worker-assets installs (LIFF_PAGES_PROJECT="") — the
      // engine skips the LIFF probe in that topology.
      liffUrl: c.env.LIFF_PAGES_PROJECT ? c.env.LIFF_PUBLIC_URL : '',
      currentWorkerBundleUrl: currentRelease.bundle_url,
    });
  } catch (err) {
    // Setup failure (before snapshot row creation). No tracking id to
    // return; the operator must retry. We don't have a row to mark
    // failed because the engine never got that far.
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: 'update_failed', message }, 500);
  }

  // Phase work runs in the background. Attach a no-op .catch so an
  // unhandled rejection doesn't terminate the isolate — the engine has
  // already persisted the error to the snapshot row.
  c.executionCtx.waitUntil(handle.done.catch(() => undefined));

  return c.json({ updateId: handle.updateId }, 202);
});

/**
 * GET /admin/update/status/:id — single-shot snapshot of an update.
 *
 * Splits `events_jsonl` into a parsed array on the way out so the dashboard
 * doesn't need to parse JSONL client-side.
 */
app.get('/status/:id', async (c) => {
  const d1 = adaptD1(c.env.DB);
  const id = c.req.param('id');
  const row = await getSnapshot(d1, id);
  if (!row) {
    return c.json({ error: 'not_found' }, 404);
  }
  const events = row.events_jsonl
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        // A malformed line shouldn't kill the whole response — return it as
        // a placeholder object so the UI can show "<unparsable event>"
        // instead of 500ing. Engine should never emit garbage here, but
        // defensiveness costs us nothing.
        return { raw: line, parse_error: true };
      }
    });
  return c.json({ ...row, events });
});

/**
 * GET /admin/update/stream/:id — SSE live feed of update events.
 *
 * Polls `getSnapshot` every 800ms and emits any new events as
 * `event: progress` frames. Emits a single `event: complete` frame when
 * the row's status reaches a terminal state, then closes the stream.
 *
 * Loop cap: 1000 iterations × 800ms ≈ 13 minutes — well past the worst
 * realistic update time (≈ 2-3 min). This protects against runaway loops
 * if the engine never writes a terminal status (e.g. silent crash).
 */
app.get('/stream/:id', (c) => {
  const id = c.req.param('id');
  const d1 = adaptD1(c.env.DB);
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const enc = new TextEncoder();

  c.executionCtx.waitUntil(
    (async () => {
      try {
        let lastLen = 0;
        for (let i = 0; i < 1000; i++) {
          const row = await getSnapshot(d1, id);
          if (!row) {
            // Snapshot vanished or never existed — emit an error frame so
            // the dashboard doesn't hang waiting forever.
            await writer.write(
              enc.encode(
                `event: error\ndata: ${JSON.stringify({ error: 'not_found' })}\n\n`,
              ),
            );
            break;
          }
          const lines = row.events_jsonl
            .trim()
            .split('\n')
            .filter(Boolean);
          for (const line of lines.slice(lastLen)) {
            await writer.write(
              enc.encode(`event: progress\ndata: ${line}\n\n`),
            );
          }
          lastLen = lines.length;
          if (row.status !== 'running') {
            await writer.write(
              enc.encode(
                `event: complete\ndata: ${JSON.stringify({
                  status: row.status,
                  error: row.error,
                })}\n\n`,
              ),
            );
            break;
          }
          await new Promise((r) => setTimeout(r, 800));
        }
      } catch (err) {
        // Surface unexpected errors as an SSE error frame instead of
        // crashing the stream silently.
        const message = err instanceof Error ? err.message : String(err);
        try {
          await writer.write(
            enc.encode(
              `event: error\ndata: ${JSON.stringify({ error: message })}\n\n`,
            ),
          );
        } catch {
          // writer may already be closed by client; nothing to do.
        }
      } finally {
        try {
          await writer.close();
        } catch {
          // ignore — close races with client disconnect are expected.
        }
      }
    })(),
  );

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      // Disable proxy buffering so events stream in real-time. CF Workers
      // honors this hint on the way out via the dashboard's reverse proxy.
      'X-Accel-Buffering': 'no',
    },
  });
});

/**
 * GET /admin/update/history — last 20 update rows, newest first.
 */
app.get('/history', async (c) => {
  const d1 = adaptD1(c.env.DB);
  const history = await listRecent(d1, 20);
  return c.json({ history });
});

export default app;
