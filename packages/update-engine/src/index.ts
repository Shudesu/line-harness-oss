import { Readable } from 'node:stream';
import type { UpdateContext, UpdateEvent } from './types.js';
import {
  parseBundleStream,
  verifyBundleHashes,
  verifyBundleIntegrity,
} from './bundle.js';
import { getLatestDeployment } from './cf-api/pages.js';
import {
  createSnapshot,
  getSnapshot,
  updateStatus,
  appendEvent,
  setError,
  type D1Like,
} from './snapshot.js';
import { createEventEmitter } from './events.js';
import { runPreflight } from './phases/preflight.js';
import { runApply } from './phases/apply.js';
import { runVerify } from './phases/verify.js';
import { runRollback } from './phases/rollback.js';
import { encodeWorkerSnapshot } from './phases/rollback.js';
import { getLatestWorkerDeployment } from './cf-api/workers.js';

export * from './types.js';
export * from './manifest.js';
export * from './fork-detect.js';
export * from './bundle.js';
export * from './materialize.js';
export * from './migrations.js';
export * from './snapshot.js';
export * from './cf-api/workers.js';
export * from './cf-api/assets.js';
export * from './cf-api/pages.js';
export * from './cf-api/d1.js';
export * from './cf-api/subdomain.js';
export * from './events.js';
export * from './phases/preflight.js';
export * from './phases/apply.js';
export * from './phases/verify.js';
export * from './phases/rollback.js';

/**
 * Inputs for the top-level update orchestrator. Bundles all of the wiring
 * that the four phases (preflight / apply / verify / rollback) need plus
 * the integration hooks every caller customizes:
 *
 *   - `d1`        — the snapshot/event store. Same shape Cloudflare's
 *                   D1 binding exposes; tests pass a better-sqlite3 adapter.
 *   - `onEvent`   — caller-side event subscription. SSE forwarders and CLI
 *                   progress bars hook in here; D1 persistence is always
 *                   on regardless.
 *   - `currentWorkerBundleUrl` — pre-update Worker bundle URL that gets
 *                                stamped into the snapshot row so a later
 *                                rollback can find the old bytes.
 */
export interface RunUpdateOpts {
  ctx: UpdateContext;
  d1: D1Like;
  workerHealthUrl: string;
  adminUrl: string;
  liffUrl: string;
  onEvent?: (e: UpdateEvent) => void;
  /** URL where the *current* (pre-update) Worker bundle can be fetched
   *  for rollback. Caller uploads this before invoking runUpdate. */
  currentWorkerBundleUrl: string;
}

/**
 * Async handle returned by {@link runUpdate}. The outer promise resolves once
 * the snapshot row has been written (so callers — notably the Worker `/start`
 * route — can hand the `updateId` back to the dashboard immediately and let
 * it open `/stream/:id`). The long-running phase work continues in the
 * background and is exposed via `done` so callers who need to wait on the
 * final terminal state (or surface its error) still can.
 *
 *   - `updateId` — the snapshot row id. Always non-empty when this object
 *                  exists. Use it to look up status / stream events.
 *   - `done`     — resolves with the same `updateId` on success, rejects
 *                  with the original phase error on failure. Errors are
 *                  ALREADY captured into the snapshot row by the engine;
 *                  attach `.catch(() => undefined)` if you only need
 *                  durability and don't want an unhandled rejection.
 */
export interface UpdateHandle {
  updateId: string;
  done: Promise<string>;
}

/**
 * Top-level update orchestrator. Runs the four phases in order
 * (preflight → apply → verify) and on any failure runs rollback
 * + records the failure in the snapshot row.
 *
 * Returns an {@link UpdateHandle} so callers can split "snapshot row
 * created" (fast, ~2 Pages API calls + 1 D1 insert) from "all phases
 * finished" (slow, 30-60s). The outer Promise resolves as soon as the
 * `updateId` is known; the heavy work runs in the background and settles
 * via `handle.done`.
 *
 * Order of operations is deliberate:
 *
 *   1. Capture snapshot coordinates (current latest Pages deployments)
 *      BEFORE doing anything destructive. If this fails the update
 *      hasn't even started — no snapshot row exists and the outer
 *      Promise rejects (no handle is produced).
 *   2. createSnapshot writes the row with status='running'. From this
 *      point on every failure path updates the row. The outer Promise
 *      RESOLVES here with the handle.
 *   3. Set up the event emitter with a persist callback that appends to
 *      `update_events`. Caller's onEvent runs first (in-process subscribers)
 *      and persist runs second (durable timeline).
 *   4. runPreflight — read-only checks. Failures here mean no infra was
 *      touched but rollback still runs as a safety drill (it's cheap and
 *      gets us to a clean state on the snapshot row).
 *   5. Bundle download + parse + hash check — tamper detection. Done
 *      before runApply because uploading a tampered bundle to CF is
 *      exactly what an attacker wants.
 *   6. runApply — destructive. From here a failure REQUIRES rollback.
 *   7. runVerify — post-deploy health probes.
 *   8. On success: emit `complete`, status=success, `done` resolves with
 *      updateId.
 *
 * Error policy (inside `done`): catch every failure, write a stack trace
 * to `error`, emit `rollback running` with the original error message,
 * then run the rollback phase. If rollback succeeds → status=rolled_back.
 * If rollback throws too → record both errors and status=failed. Always
 * rethrow the ORIGINAL error via `done` so callers can observe it even
 * if rollback was clean.
 */
export async function runUpdate(opts: RunUpdateOpts): Promise<UpdateHandle> {
  const { ctx, d1, workerHealthUrl, adminUrl, liffUrl, currentWorkerBundleUrl, onEvent } = opts;

  // Step 1: snapshot the pre-update state. Both Pages projects expose
  // `getLatestDeployment` which returns the id we'd revert to. These
  // calls also serve as an early sanity check — they share the same
  // CF token as preflight, so a failure here surfaces the same auth
  // class of error before we touch the snapshot table.
  //
  // Failures here reject the OUTER promise — no snapshot row exists yet,
  // so the caller's catch is the only place that learns about the error.
  // Worker-assets installs have no LIFF Pages project (empty string) —
  // their LIFF is served by the Worker script, whose pre-update bytes are
  // already captured via currentWorkerBundleUrl.
  const [workerLatest, adminLatest, liffLatest] = await Promise.all([
    getLatestWorkerDeployment({
      creds: ctx.creds,
      scriptName: ctx.workerName,
    }),
    getLatestDeployment({ creds: ctx.creds, projectName: ctx.adminPagesProject }),
    ctx.liffPagesProject
      ? getLatestDeployment({ creds: ctx.creds, projectName: ctx.liffPagesProject })
      : Promise.resolve({ id: '' }),
  ]);

  // Step 2: create the snapshot row. From here every failure path is
  // expected to update this row's status. The outer await resolves
  // with the handle once this insert lands.
  const updateId = await createSnapshot(d1, {
    from: ctx.current.version,
    to: ctx.target.version,
    snapshotWorkerUrl: encodeWorkerSnapshot({
      bundleUrl: currentWorkerBundleUrl,
      versionId: workerLatest.versions[0].version_id,
    }),
    snapshotAdminDeployment: adminLatest.id,
    snapshotLiffDeployment: liffLatest.id,
  });

  // Step 3: build the event emitter. Subscriber fan-out is synchronous;
  // persist appends to D1 and is awaited so a crash mid-update leaves a
  // recoverable timeline.
  const ev = createEventEmitter({
    persist: async (e) => {
      await appendEvent(d1, updateId, e);
    },
  });
  if (onEvent) {
    ev.subscribe(onEvent);
  }

  // Step 4-8: run the long-running phases in the background. We do NOT
  // await this here — that's the whole point of returning a handle.
  // Callers who care about the terminal state await `handle.done`;
  // callers who only need durability attach `.catch(() => undefined)`
  // and rely on the snapshot row.
  const done = (async (): Promise<string> => {
    try {
      // Step 4: preflight (read-only checks).
      await runPreflight(ctx, ev);

      // Step 5: bundle download → parse → hash check.
      const res = await fetch(ctx.target.bundle_url);
      if (!res.ok) {
        throw new Error(
          `failed to fetch bundle from ${ctx.target.bundle_url}: HTTP ${res.status}`,
        );
      }
      if (!res.body) {
        throw new Error('bundle response has no body');
      }
      const bundle = await parseBundleStream(
        Readable.fromWeb(res.body as any),
      );
      const computed = verifyBundleHashes(bundle);
      // Byte-verify against worker_bundle_hash (detached final-artifact
      // hash). Releases without it shipped undeployable worker stubs and
      // are rejected here before any destructive step.
      verifyBundleIntegrity(computed, ctx.target);

      // Step 6: apply (destructive).
      await runApply(ctx, bundle, ev);

      // Step 7: verify (health probes).
      await runVerify(ctx, { workerHealthUrl, adminUrl, liffUrl }, ev);

      // Step 8: success path.
      await ev.emit({
        step: 'complete',
        status: 'done',
        new_version: ctx.target.version,
      });
      await updateStatus(d1, updateId, 'success');
      return updateId;
    } catch (e) {
      const original = e instanceof Error ? e : new Error(String(e));
      const originalStack = original.stack ?? String(original);
      await setError(d1, updateId, originalStack);
      await ev.emit({
        step: 'rollback',
        status: 'running',
        error: original.message,
      });
      try {
        const snap = await getSnapshot(d1, updateId);
        // snapshot_liff_deployment is intentionally NOT required — it is
        // empty for worker-assets installs, whose LIFF is restored by the
        // Worker script rollback itself.
        if (
          snap?.snapshot_worker_url &&
          snap.snapshot_admin_deployment
        ) {
          await runRollback(
            ctx,
            {
              snapshotWorkerBundleUrl: snap.snapshot_worker_url,
              snapshotAdminDeployment: snap.snapshot_admin_deployment,
              snapshotLiffDeployment: snap.snapshot_liff_deployment ?? '',
            },
            ev,
          );
          await updateStatus(d1, updateId, 'rolled_back');
        } else {
          // No snapshot coordinates → cannot roll back safely.
          await updateStatus(d1, updateId, 'failed');
        }
      } catch (rbErr) {
        const rbMessage = rbErr instanceof Error ? rbErr.message : String(rbErr);
        await setError(
          d1,
          updateId,
          `original: ${original.message}\nrollback: ${rbMessage}`,
        );
        await updateStatus(d1, updateId, 'failed');
      }
      // Rethrow original so callers learn the update failed.
      throw original;
    }
  })();

  return { updateId, done };
}
