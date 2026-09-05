import type { UpdateContext } from '../types.js';
import type { EventEmitter } from '../events.js';
import type { ParsedBundle } from '../bundle.js';
import { listWorkerBindings, putWorkerScript } from '../cf-api/workers.js';
import { uploadWorkerAssets } from '../cf-api/assets.js';
import { deployPagesProject } from '../cf-api/pages.js';
import { materializeAdminFiles } from '../materialize.js';
import { applyD1Migrations } from '../migrations.js';

/**
 * Compatibility flags the L Harness Worker requires. The script upload
 * API replaces metadata wholesale, so these must be re-sent on every PUT —
 * omitting them would strip `nodejs_compat` and break `node:*` imports.
 * Kept in lockstep with apps/worker/wrangler.toml.
 */
const WORKER_COMPATIBILITY_FLAGS = ['nodejs_compat'];

/**
 * Result of a successful apply phase.
 *
 * The two Pages deployment ids are kept so the orchestrator can pass them
 * into the verify phase (for liveness probes) and the rollback phase (so
 * we know which deployment to revert to if verify fails).
 */
export interface ApplyResult {
  adminDeploymentId: string;
  liffDeploymentId: string;
}

/**
 * Phase 1 — Apply.
 *
 * Runs the four sub-steps of an update in strict order:
 *
 *   1. Migrations — apply each SQL file from the bundle to D1, one at a
 *      time. Migrations are additive by convention (new tables/columns
 *      only) so existing Workers keep functioning until the new Worker
 *      is uploaded in step 2.
 *   2. Worker — read existing bindings (CF does NOT preserve them across
 *      script uploads) and re-PUT the new script with the same bindings
 *      attached. By this point the schema already supports the new code.
 *   3. Admin Pages — deploy the admin UI bundle. Goes after the Worker so
 *      the admin UI's API calls hit the new Worker, not the old one.
 *   4. LIFF Pages — deploy the customer-facing LIFF UI last for the same
 *      reason.
 *
 * Every step emits `{ status: 'running' }` before the side effect and
 * `{ status: 'done' }` afterward. On any failure the error is re-thrown
 * untouched — the orchestrator is responsible for emitting a `failed`
 * event and kicking off rollback. We intentionally do NOT catch + emit
 * here so retry/rollback policy stays in one place upstream.
 */
export async function runApply(
  ctx: UpdateContext,
  bundle: ParsedBundle,
  ev: EventEmitter,
): Promise<ApplyResult> {
  // Step 1: Migrations. Iterate the manifest's declared order (NOT the
  // bundle's map iteration order) so customers can rely on numeric
  // prefixes (e.g. 041_x.sql before 042_y.sql) controlling apply order
  // even if the tarball was built non-deterministically.
  await applyD1Migrations({
    creds: ctx.creds,
    databaseId: ctx.d1DatabaseId,
    names: ctx.target.migrations,
    migrations: bundle.migrations,
    onMigrationStart: (name) =>
      ev.emit({ step: 'migration', status: 'running', name }),
    onMigrationDone: (result) =>
      ev.emit({
        step: 'migration',
        status: 'done',
        name: result.alreadyApplied
          ? `${result.name} (already applied)`
          : result.adopted
            ? `${result.name} (adopted, not executed)`
            : result.name,
      }),
  });

  // Step 2: Worker. List-then-PUT preserves the customer's secret_text,
  // plain_text, D1, R2 and KV bindings — CF wipes bindings on every
  // script upload, so we have to re-supply them or the new Worker boots
  // with no env at all.
  await ev.emit({ step: 'worker', status: 'running' });
  const bindings = await listWorkerBindings({
    creds: ctx.creds,
    scriptName: ctx.workerName,
  });
  if (bundle.workerAssetFiles.size === 0 && !ctx.liffPagesProject) {
    throw new Error(
      'release bundle has no worker-assets files; worker-assets installs cannot be updated safely',
    );
  }
  const assetsJwt = bundle.workerAssetFiles.size > 0
    ? await uploadWorkerAssets({
        creds: ctx.creds,
        scriptName: ctx.workerName,
        files: bundle.workerAssetFiles,
      })
    : null;
  await putWorkerScript({
    creds: ctx.creds,
    scriptName: ctx.workerName,
    scriptContent: bundle.workerJs,
    bindings,
    compatibilityFlags: WORKER_COMPATIBILITY_FLAGS,
    ...(assetsJwt
      ? {
          assets: {
            jwt: assetsJwt,
            binding: 'ASSETS',
            runWorkerFirst: true,
          },
        }
      : { keepAssets: true }),
  });
  await ev.emit({
    step: 'worker',
    status: 'done',
    hash: ctx.target.worker_hash,
  });

  // Step 3: Admin Pages. Done before LIFF because admin is internal-only
  // and any breakage here is contained — LIFF is what customers see.
  // The bundle's admin build has `https://__LH_WORKER_URL__` baked in as
  // its API origin; rewrite it to this install's Worker URL first.
  await ev.emit({ step: 'admin', status: 'running' });
  const adminFiles = ctx.workerPublicUrl
    ? materializeAdminFiles(bundle.adminFiles, ctx.workerPublicUrl)
    : bundle.adminFiles;
  const adminResult = await deployPagesProject({
    creds: ctx.creds,
    projectName: ctx.adminPagesProject,
    files: adminFiles,
  });
  await ev.emit({
    step: 'admin',
    status: 'done',
    deployment_id: adminResult.deploymentId,
  });

  // Step 4: LIFF Pages. Last so the customer-facing UI swap only happens
  // once everything beneath it (schema + Worker + admin) is already
  // live on the new version. Skipped entirely for CLI installs
  // (liffPagesProject === ''), where the LIFF SPA is served by the Worker's
  // own assets and there is no Pages project to deploy to.
  if (!ctx.liffPagesProject) {
    await ev.emit({ step: 'liff', status: 'done', name: 'skipped (worker-assets install)' });
    return {
      adminDeploymentId: adminResult.deploymentId,
      liffDeploymentId: '',
    };
  }

  await ev.emit({ step: 'liff', status: 'running' });
  const liffResult = await deployPagesProject({
    creds: ctx.creds,
    projectName: ctx.liffPagesProject,
    files: bundle.liffFiles,
  });
  await ev.emit({
    step: 'liff',
    status: 'done',
    deployment_id: liffResult.deploymentId,
  });

  return {
    adminDeploymentId: adminResult.deploymentId,
    liffDeploymentId: liffResult.deploymentId,
  };
}
