import type { CfApiCreds, UpdateContext } from '../types.js';
import type { EventEmitter } from '../events.js';
import { compareSemver } from '../manifest.js';
import { executeD1Query } from '../cf-api/d1.js';

/**
 * Phase 0 — Preflight checks.
 *
 * Validates the upgrade is even attemptable before we touch a single byte
 * of customer infrastructure. The goal is to fail loud and early with a
 * message a non-engineer customer can act on (token expired? Worker
 * renamed? D1 deleted?). No partial state should be possible from this
 * phase — every check is read-only.
 *
 * Order is significant:
 *   1. semver gate (cheap, deterministic, doesn't burn API quota)
 *   2. token verify (every subsequent call needs the token to be valid)
 *   3. resource existence checks (Worker, Pages projects, D1) — these
 *      all use the same token so they fail uniformly if the token lacks
 *      a needed scope
 *   4. informational `requires_secrets` event — does NOT enforce that
 *      secrets are present; that's the caller's job in Phase 5.
 *
 * Any failure throws; the caller is responsible for emitting a `failed`
 * event before re-throwing (kept out of this function so error policy
 * lives with the orchestrator).
 */
export async function runPreflight(
  ctx: UpdateContext,
  ev: EventEmitter,
): Promise<void> {
  await ev.emit({ step: 'preflight', status: 'running' });

  // 1. Semver gate — refuse upgrades that skip a required intermediate
  //    release. The manifest's `min_from_version` is authoritative.
  if (compareSemver(ctx.current.version, ctx.target.min_from_version) < 0) {
    throw new Error(
      `min_from_version ${ctx.target.min_from_version} not satisfied (current ${ctx.current.version})`,
    );
  }

  // 2. Verify the CF API token is live and scoped.
  await verifyToken(ctx.creds);

  // 3. Verify each CF resource the update will touch actually exists.
  //    The LIFF Pages project is optional — CLI installs serve the LIFF
  //    SPA from Worker assets and set liffPagesProject to ''.
  await verifyWorker(ctx.creds, ctx.workerName);
  await verifyPagesProject(ctx.creds, ctx.adminPagesProject);
  if (ctx.liffPagesProject) {
    await verifyPagesProject(ctx.creds, ctx.liffPagesProject);
  }

  // 4. D1 reachability — a trivial SELECT 1 confirms the database is
  //    online AND our token has query rights. Failure mentions the D1
  //    id so customers can paste it into Cloudflare support.
  try {
    await executeD1Query({
      creds: ctx.creds,
      databaseId: ctx.d1DatabaseId,
      sql: 'SELECT 1',
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`D1 ${ctx.d1DatabaseId} unreachable: ${msg}`);
  }

  // 5. Informational event for any secrets the new release requires
  //    that the old one didn't. Caller decides what to do with this
  //    (CLI may prompt; cloud-side may surface a banner). Empty list
  //    intentionally produces no event so dashboards don't show a
  //    spurious "requires_secrets:" line.
  if (ctx.target.new_required_secrets.length > 0) {
    await ev.emit({
      step: 'preflight',
      status: 'running',
      name: `requires_secrets:${ctx.target.new_required_secrets.join(',')}`,
    });
  }

  await ev.emit({ step: 'preflight', status: 'done' });
}

async function readBodyExcerpt(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.length > 500 ? text.slice(0, 500) + '…' : text;
  } catch {
    return '';
  }
}

async function verifyToken(creds: CfApiCreds): Promise<void> {
  const res = await fetch(
    'https://api.cloudflare.com/client/v4/user/tokens/verify',
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${creds.apiToken}` },
    },
  );
  if (!res.ok) {
    const excerpt = await readBodyExcerpt(res);
    throw new Error(`CF API token verify failed: HTTP ${res.status} ${excerpt}`);
  }
}

async function verifyWorker(
  creds: CfApiCreds,
  workerName: string,
): Promise<void> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/workers/scripts/${workerName}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${creds.apiToken}` },
    },
  );
  if (!res.ok) {
    const excerpt = await readBodyExcerpt(res);
    throw new Error(
      `Worker '${workerName}' not found or inaccessible: HTTP ${res.status} ${excerpt}`,
    );
  }
}

async function verifyPagesProject(
  creds: CfApiCreds,
  projectName: string,
): Promise<void> {
  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${creds.accountId}/pages/projects/${projectName}`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${creds.apiToken}` },
    },
  );
  if (!res.ok) {
    const excerpt = await readBodyExcerpt(res);
    throw new Error(
      `Pages project '${projectName}' not found or inaccessible: HTTP ${res.status} ${excerpt}`,
    );
  }
}
