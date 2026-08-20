import type { CfApiCreds } from '../types.js';
import { authHeader, throwHttpError, workersApiBase } from './_shared.js';

/**
 * Cloudflare Workers binding shape used by the Workers Scripts API.
 *
 * Only the binding types we care about for the LINE Harness Worker are
 * modelled here: env-style plain text, secrets, resource bindings for
 * D1, R2, and KV, and the Workers Assets binding (CLI installs serve the
 * LIFF SPA from Worker assets). Other types (`service`, `queue`,
 * `analytics_engine`, …) are intentionally left unsupported in v1 —
 * callers should fail loudly if the deployed Worker uses an unsupported
 * binding type so we don't silently drop it on update.
 */
export interface WorkerBinding {
  type: 'plain_text' | 'secret_text' | 'secret_key' | 'd1' | 'r2_bucket' | 'kv_namespace' | 'assets';
  name: string;
  database_id?: string;
  bucket_name?: string;
  namespace_id?: string;
  text?: string;
}

const DEFAULT_COMPATIBILITY_DATE = '2024-12-01';

/**
 * Binding types whose values can never be read back via the API. They are
 * dropped from the upload's bindings array (re-sending them value-less
 * fails with error 10021) and carried across uploads with
 * `metadata.keep_bindings` instead.
 */
const SECRET_BINDING_TYPES: string[] = ['secret_text', 'secret_key'];

/**
 * Upload (create or overwrite) a Worker script via the Cloudflare API.
 *
 * Uses the multipart/form-data ES module upload format: a `metadata` JSON
 * part describing the entrypoint + bindings + compatibility_date, and a
 * `worker.js` part with the script bytes. The script part's content-type
 * is `application/javascript+module`, which is what CF expects for
 * `main_module` uploads.
 *
 * Throws on non-2xx with a body excerpt so caller logs include the API's
 * error reason.
 *
 * `keepAssets: true` sets the API's `keep_assets` flag so a script-only
 * update retains the assets of the previous version — required for CLI
 * installs, where the Worker serves the LIFF SPA via Workers Assets and the
 * release bundle carries no asset files.
 *
 * `compatibilityFlags` must include every flag the current deployment uses
 * (the upload REPLACES metadata; omitting `nodejs_compat` would strip it
 * and break every `node:*` import in the Worker).
 */
export async function putWorkerScript(opts: {
  creds: CfApiCreds;
  scriptName: string;
  scriptContent: Buffer;
  bindings: WorkerBinding[];
  compatibilityDate?: string;
  compatibilityFlags?: string[];
  keepAssets?: boolean;
  assets?: {
    jwt: string;
    binding?: string;
    runWorkerFirst?: boolean;
  };
}): Promise<void> {
  const { creds, scriptName, scriptContent, bindings } = opts;
  const compatibility_date = opts.compatibilityDate ?? DEFAULT_COMPATIBILITY_DATE;

  // Secret-typed bindings come back from GET /bindings WITHOUT their
  // values, and the upload API rejects a value-less secret binding with
  // error 10021 ("invalid or missing text property for binding <NAME>").
  // Drop them from the upload and carry the existing secrets over via
  // `keep_bindings` instead (the same mechanism wrangler uses). A
  // secret_text binding WITH a text value is a caller explicitly setting
  // a new secret — sent as-is, and it takes precedence over the
  // inherited one.
  let sendableBindings = bindings.filter(
    (b) => !SECRET_BINDING_TYPES.includes(b.type) || typeof b.text === 'string',
  );
  if (opts.assets) {
    if (opts.keepAssets) {
      throw new Error('keepAssets and assets cannot be used together');
    }
    const bindingName = opts.assets.binding ?? 'ASSETS';
    if (!sendableBindings.some((binding) => binding.type === 'assets')) {
      sendableBindings = [...sendableBindings, { type: 'assets', name: bindingName }];
    }
  }

  const metadata: Record<string, unknown> = {
    main_module: 'worker.js',
    bindings: sendableBindings,
    compatibility_date,
    keep_bindings: SECRET_BINDING_TYPES,
  };
  if (opts.compatibilityFlags && opts.compatibilityFlags.length > 0) {
    metadata.compatibility_flags = opts.compatibilityFlags;
  }
  if (opts.keepAssets) {
    metadata.keep_assets = true;
  }
  if (opts.assets) {
    metadata.assets = {
      jwt: opts.assets.jwt,
      config: {
        run_worker_first: opts.assets.runWorkerFirst ?? true,
      },
    };
  }

  const fd = new FormData();
  fd.set(
    'metadata',
    new Blob([JSON.stringify(metadata)], { type: 'application/json' }),
  );
  // Copy bytes into a fresh ArrayBuffer so Blob accepts them in both Node and
  // Workers runtimes. Slicing avoids the SharedArrayBuffer-vs-ArrayBuffer
  // type incompatibility on Node's Buffer.
  const ab = scriptContent.buffer.slice(
    scriptContent.byteOffset,
    scriptContent.byteOffset + scriptContent.byteLength,
  ) as ArrayBuffer;
  fd.set(
    'worker.js',
    new Blob([ab], { type: 'application/javascript+module' }),
    'worker.js',
  );

  const res = await fetch(`${workersApiBase(creds.accountId)}/${scriptName}`, {
    method: 'PUT',
    headers: authHeader(creds.apiToken),
    body: fd,
  });

  if (!res.ok) {
    await throwHttpError('PUT worker script failed', res);
  }
}

/**
 * Fetch the deployed Worker script source. Used to snapshot the current
 * Worker before applying an update so we can roll back if verify fails.
 */
export async function getWorkerScriptContent(opts: {
  creds: CfApiCreds;
  scriptName: string;
}): Promise<string> {
  const { creds, scriptName } = opts;
  const res = await fetch(`${workersApiBase(creds.accountId)}/${scriptName}`, {
    method: 'GET',
    headers: authHeader(creds.apiToken),
  });
  if (!res.ok) {
    await throwHttpError('GET worker script failed', res);
  }
  return res.text();
}

/**
 * List the current bindings on a deployed Worker. The update flow reads
 * these so it can re-attach the same D1/R2/KV/plain_text/secret_text
 * bindings when PUTting a new script — CF does not preserve bindings
 * across script uploads.
 */
export async function listWorkerBindings(opts: {
  creds: CfApiCreds;
  scriptName: string;
}): Promise<WorkerBinding[]> {
  const { creds, scriptName } = opts;
  const res = await fetch(
    `${workersApiBase(creds.accountId)}/${scriptName}/bindings`,
    {
      method: 'GET',
      headers: authHeader(creds.apiToken),
    },
  );
  if (!res.ok) {
    await throwHttpError('GET worker bindings failed', res);
  }
  const body = (await res.json()) as { result: WorkerBinding[] };
  return body.result;
}

export interface WorkerDeployment {
  id: string;
  created_on: string;
  versions: Array<{ version_id: string; percentage: number }>;
}

/** Return the active Worker's 100%-traffic version for rollback snapshots. */
export async function getLatestWorkerDeployment(opts: {
  creds: CfApiCreds;
  scriptName: string;
}): Promise<WorkerDeployment> {
  const { creds, scriptName } = opts;
  const res = await fetch(
    `${workersApiBase(creds.accountId)}/${scriptName}/deployments`,
    { headers: authHeader(creds.apiToken) },
  );
  if (!res.ok) await throwHttpError('GET worker deployments failed', res);
  const body = (await res.json()) as {
    result?: { deployments?: WorkerDeployment[] };
  };
  const deployments = body.result?.deployments ?? [];
  const latest = deployments
    .slice()
    .sort((a, b) => Date.parse(b.created_on) - Date.parse(a.created_on))[0];
  if (!latest?.versions?.[0]?.version_id) {
    throw new Error(`Worker '${scriptName}' has no deployable version snapshot`);
  }
  return {
    ...latest,
    // A gradual deployment can list multiple versions. If an update is
    // started during one, snapshot the version currently serving the most
    // traffic instead of relying on array ordering.
    versions: latest.versions.slice().sort((a, b) => b.percentage - a.percentage),
  };
}

/** Roll back code and Workers Assets together by redeploying a saved version. */
export async function deployWorkerVersion(opts: {
  creds: CfApiCreds;
  scriptName: string;
  versionId: string;
}): Promise<void> {
  const { creds, scriptName, versionId } = opts;
  const res = await fetch(
    `${workersApiBase(creds.accountId)}/${scriptName}/deployments`,
    {
      method: 'POST',
      headers: {
        ...authHeader(creds.apiToken),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        strategy: 'percentage',
        versions: [{ version_id: versionId, percentage: 100 }],
        annotations: {
          'workers/message': 'LINE Harness automatic update rollback',
          'workers/triggered_by': 'line-harness-update-engine',
        },
      }),
    },
  );
  if (!res.ok) await throwHttpError('POST worker rollback deployment failed', res);
}
