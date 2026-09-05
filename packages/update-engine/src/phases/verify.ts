import type { UpdateContext } from '../types.js';
import type { EventEmitter } from '../events.js';
import { executeD1Query } from '../cf-api/d1.js';

/**
 * URLs the verify phase probes after a successful apply phase.
 *
 * The orchestrator is responsible for resolving these from the freshly
 * deployed Pages/Worker — verify just needs ready-to-hit URLs.
 */
export interface VerifyUrls {
  /** Worker `/health` endpoint (e.g. `https://your-worker-name.example.workers.dev/health`). */
  workerHealthUrl: string;
  /** Admin Pages root URL (e.g. `https://admin.example.pages.dev/`). */
  adminUrl: string;
  /**
   * LIFF Pages root URL (e.g. `https://liff.example.pages.dev/`), or ''
   * for worker-assets installs — the LIFF probe is skipped when empty
   * (the Worker /health probe already covers the serving script).
   */
  liffUrl: string;
}

const RETRIES = 3;
const RETRY_DELAY_MS = 3000;

/**
 * Phase 2 — Verify.
 *
 * Runs post-deploy health probes to confirm the new Worker, schema, admin
 * UI and LIFF UI are all reachable before declaring the update successful.
 *
 * Order is deliberate so a failure points at the most likely culprit:
 *   1. Worker `/health` — proves the new Worker booted and responds.
 *   2. D1 `SELECT 1` — proves the Worker (and our token) can still talk
 *      to the database after migrations. Using `executeD1Query` directly
 *      keeps the assertion close to what the Worker itself would do.
 *   3. Admin Pages — confirms the admin bundle is being served.
 *   4. LIFF Pages — confirms the customer-facing bundle is being served.
 *
 * Each HTTP probe (1, 3, 4) retries up to 3 times with a 3s delay between
 * attempts to absorb the propagation lag Cloudflare's edge sometimes
 * exhibits right after a deploy. D1 does NOT retry here — the orchestrator
 * will retry the whole phase if it has to, and a transient D1 error is
 * rare enough that adding two more failed queries would just add noise.
 *
 * The `running` event is emitted up front; `done` is ONLY emitted on full
 * success. Any failure re-throws and the orchestrator owns the `failed`
 * event + rollback policy. We intentionally do not catch + emit here so
 * the error message naming the failing URL surfaces unmodified upstream.
 */
export async function runVerify(
  ctx: UpdateContext,
  urls: VerifyUrls,
  ev: EventEmitter,
): Promise<void> {
  await ev.emit({ step: 'verify', status: 'running' });

  // 1. Worker /health — most common failure mode (new bundle crashed on
  //    boot), so probe first and surface the URL in the error message.
  //    ANY response below 500 counts as alive: bundles released before the
  //    public /api/health route answer 401 (auth middleware) or 404, and a
  //    Worker that routes a request to either has provably booted. Only
  //    5xx / network errors indicate a broken deploy worth rolling back.
  try {
    await fetchWithRetry(urls.workerHealthUrl, (r) => r.status < 500);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Worker /health failed: ${reason} (${urls.workerHealthUrl})`);
  }

  // 2. D1 reachability — proves the new Worker can talk to the new schema.
  //    No retry here; executeD1Query throws verbatim and we let it bubble.
  await executeD1Query({
    creds: ctx.creds,
    databaseId: ctx.d1DatabaseId,
    sql: 'SELECT 1 as ok',
  });

  // 3. Admin Pages — internal UI; failure is contained but still a hard
  //    fail because the operator needs admin to diagnose any later issue.
  try {
    await fetchWithRetry(urls.adminUrl);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Admin URL failed: ${reason} (${urls.adminUrl})`);
  }

  // 4. LIFF Pages — customer-facing UI. Last because a failure here is
  //    the most "user visible" and we want the other probes to have
  //    succeeded before we even report this one missing. Skipped for
  //    worker-assets installs (no separate LIFF deployment to probe).
  if (urls.liffUrl) {
    try {
      await fetchWithRetry(urls.liffUrl);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(`LIFF URL failed: ${reason} (${urls.liffUrl})`);
    }
  }

  await ev.emit({ step: 'verify', status: 'done' });
}

/**
 * Fetch with retry — 3 attempts, 3s delay between attempts.
 *
 * Treats both rejected promises (network errors) and non-accepted
 * responses as retryable. `accept` decides what counts as success
 * (default: 2xx). The final error preserves the underlying cause so the
 * caller can wrap it with a URL-naming message.
 */
async function fetchWithRetry(
  url: string,
  accept: (r: Response) => boolean = (r) => r.ok,
  retries = RETRIES,
  delayMs = RETRY_DELAY_MS,
): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url);
      if (accept(r)) return r;
      last = new Error(`HTTP ${r.status}`);
    } catch (e) {
      last = e;
    }
    if (i < retries - 1) {
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}
