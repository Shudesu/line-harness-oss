import type { UpdateContext } from '../types.js';
import type { EventEmitter } from '../events.js';
import {
  deployWorkerVersion,
  listWorkerBindings,
  putWorkerScript,
} from '../cf-api/workers.js';
import { rollbackPagesDeployment } from '../cf-api/pages.js';

/**
 * Snapshot fields required to roll back a partially-applied update.
 *
 * The orchestrator captures these BEFORE doing anything destructive — they
 * are the "known-good" coordinates we revert to if Apply or Verify fails.
 */
export interface RollbackSnapshot {
  /** Encoded version snapshot, or a legacy Worker bundle URL. */
  snapshotWorkerBundleUrl: string;
  /** CF Pages deployment id to revert the admin project to. */
  snapshotAdminDeployment: string;
  /** CF Pages deployment id to revert the liff project to. */
  snapshotLiffDeployment: string;
}

const WORKER_SNAPSHOT_PREFIX = 'line-harness-worker-snapshot:v1:';

export function encodeWorkerSnapshot(opts: {
  bundleUrl: string;
  versionId: string;
}): string {
  return WORKER_SNAPSHOT_PREFIX + encodeURIComponent(JSON.stringify(opts));
}

export function decodeWorkerSnapshot(value: string): {
  bundleUrl: string;
  versionId?: string;
} {
  if (!value.startsWith(WORKER_SNAPSHOT_PREFIX)) return { bundleUrl: value };
  try {
    const parsed = JSON.parse(
      decodeURIComponent(value.slice(WORKER_SNAPSHOT_PREFIX.length)),
    ) as { bundleUrl?: unknown; versionId?: unknown };
    if (typeof parsed.bundleUrl !== 'string' || typeof parsed.versionId !== 'string') {
      throw new Error('missing fields');
    }
    return { bundleUrl: parsed.bundleUrl, versionId: parsed.versionId };
  } catch (error) {
    throw new Error(
      `rollback: invalid Worker snapshot coordinate: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

async function readBodyExcerpt(res: Response): Promise<string> {
  try {
    const text = await res.text();
    return text.length > 500 ? text.slice(0, 500) + '…' : text;
  } catch {
    return '';
  }
}

/**
 * Phase 3 — Rollback.
 *
 * Re-runs the deploy steps in reverse semantic order using the snapshot
 * captured by the orchestrator BEFORE the failed update:
 *
 *   1. Fetch the previous Worker bundle bytes from `snapshotWorkerBundleUrl`.
 *   2. List the Worker's current bindings — CF wipes bindings on every PUT,
 *      so we re-attach them. Even though the new Worker may have crashed,
 *      its bindings are the customer's source of truth (they aren't part
 *      of the bundle — they're env wiring).
 *   3. PUT the old Worker bundle with the preserved bindings.
 *   4. Roll back the admin Pages project to its previous deployment id.
 *   5. Roll back the liff Pages project to its previous deployment id.
 *
 * **D1 migrations are NOT rolled back.** The harness contract is
 * additive-only migrations (new tables/columns), so the old Worker
 * continues to function against the new-but-superset schema. Reverting
 * schema would risk losing rows that were written after the migration
 * succeeded but before Apply failed downstream.
 *
 * Steps run sequentially with no retry — if any step throws, the error
 * propagates and the orchestrator records both the original failure and
 * the rollback failure. We intentionally do NOT swallow errors here so
 * the operator can see exactly which step left the system in a degraded
 * state.
 */
export async function runRollback(
  ctx: UpdateContext,
  snap: RollbackSnapshot,
  ev: EventEmitter,
): Promise<void> {
  await ev.emit({ step: 'rollback', status: 'running' });

  const workerSnapshot = decodeWorkerSnapshot(snap.snapshotWorkerBundleUrl);
  if (workerSnapshot.versionId) {
    // Versions retain the exact code, bindings and Workers Assets that were
    // live together. This is the only complete rollback for asset updates.
    await deployWorkerVersion({
      creds: ctx.creds,
      scriptName: ctx.workerName,
      versionId: workerSnapshot.versionId,
    });
  } else {
    // Backward-compatible fallback for snapshots created by older engines.
    const res = await fetch(workerSnapshot.bundleUrl);
    if (!res.ok) {
      const excerpt = await readBodyExcerpt(res);
      throw new Error(
        `rollback: failed to fetch snapshot worker bundle from ${workerSnapshot.bundleUrl}: HTTP ${res.status} ${excerpt}`,
      );
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    const bindings = await listWorkerBindings({
      creds: ctx.creds,
      scriptName: ctx.workerName,
    });
    await putWorkerScript({
      creds: ctx.creds,
      scriptName: ctx.workerName,
      scriptContent: bytes,
      bindings,
      compatibilityFlags: ['nodejs_compat'],
      keepAssets: true,
    });
  }

  // Step 4: admin Pages rollback. Done before liff so a failure here
  // surfaces before we touch the customer-facing UI, leaving liff still
  // on the new (possibly-broken) version for now — but admin is internal
  // so that's a smaller blast radius than leaving the operator without
  // a console.
  await rollbackPagesDeployment({
    creds: ctx.creds,
    projectName: ctx.adminPagesProject,
    deploymentId: snap.snapshotAdminDeployment,
  });

  // Step 5: liff Pages rollback. Customer-facing, done last so the swap
  // back happens only after the admin console is already on the old
  // version. Skipped for worker-assets installs (no LIFF Pages project —
  // the Worker script rollback in step 3 already restored their LIFF).
  if (ctx.liffPagesProject && snap.snapshotLiffDeployment) {
    await rollbackPagesDeployment({
      creds: ctx.creds,
      projectName: ctx.liffPagesProject,
      deploymentId: snap.snapshotLiffDeployment,
    });
  }

  await ev.emit({ step: 'rollback', status: 'done' });
}
