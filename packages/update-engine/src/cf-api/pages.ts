import type { CfApiCreds } from '../types.js';
import { authHeader, pagesProjectApiBase, throwHttpError } from './_shared.js';
import { hashWorkerAsset } from './asset-hash.js';

/**
 * Cloudflare Pages Direct Upload API.
 *
 * The Pages deployment flow is multi-step and uses two different auth
 * tokens, which is what makes this helper finicky:
 *
 *   1. GET upload-token            → returns a short-lived JWT (account API token)
 *   2. POST check-missing          → server tells us which file hashes it lacks (JWT)
 *   3. POST upload                 → push the missing files as base64 payloads (JWT)
 *   4. POST deployments            → create the deployment with a manifest (API token)
 *
 * Step 3 is skipped entirely when the server already has every file hash —
 * common for incremental redeploys where only a handful of bundles changed.
 *
 * Pages asset keys must match Wrangler byte-for-byte: the first 32 hex
 * characters of BLAKE3(base64(file bytes) + extension). The API can accept a
 * deployment manifest containing other-looking hashes and still mark the
 * deploy stage successful, but the resulting deployment returns HTTP 500
 * because those keys do not resolve to uploaded assets.
 */

import type { Buffer as NodeBuffer } from 'node:buffer';

/**
 * Map a file path to a sensible Content-Type for upload metadata. CF uses
 * this when serving the asset, so getting it wrong means the browser sees
 * the wrong MIME on `.pages.dev`. Only common static-site extensions are
 * recognized — anything else falls back to `application/octet-stream`.
 */
function guessContentType(path: string): string {
  if (path.endsWith('.html') || path.endsWith('.htm')) return 'text/html';
  if (path.endsWith('.js') || path.endsWith('.mjs'))
    return 'application/javascript';
  if (path.endsWith('.css')) return 'text/css';
  if (path.endsWith('.json')) return 'application/json';
  if (path.endsWith('.map')) return 'application/json';
  if (path.endsWith('.png')) return 'image/png';
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
  if (path.endsWith('.gif')) return 'image/gif';
  if (path.endsWith('.webp')) return 'image/webp';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  if (path.endsWith('.ico')) return 'image/x-icon';
  if (path.endsWith('.woff2')) return 'font/woff2';
  if (path.endsWith('.woff')) return 'font/woff';
  if (path.endsWith('.ttf')) return 'font/ttf';
  if (path.endsWith('.txt')) return 'text/plain';
  if (path.endsWith('.xml')) return 'application/xml';
  if (path.endsWith('.wasm')) return 'application/wasm';
  return 'application/octet-stream';
}

/**
 * Fetch a short-lived JWT used to authenticate the check-missing and
 * upload steps. The JWT is scoped to the given project and expires
 * quickly, so we don't cache it — every deploy fetches a fresh one.
 */
async function getUploadToken(
  creds: CfApiCreds,
  projectName: string,
): Promise<string> {
  const res = await fetch(
    `${pagesProjectApiBase(creds.accountId, projectName)}/upload-token`,
    {
      method: 'GET',
      headers: authHeader(creds.apiToken),
    },
  );
  if (!res.ok) {
    await throwHttpError('GET pages upload-token failed', res);
  }
  const body = (await res.json()) as { result: { jwt: string } };
  return body.result.jwt;
}

/**
 * Ask CF which of our file hashes it does not yet have stored. Only
 * those need to be uploaded in the next step. An empty array means a
 * pure-manifest deploy with no asset uploads.
 */
async function checkMissingHashes(
  jwt: string,
  hashes: string[],
): Promise<string[]> {
  const res = await fetch(
    'https://api.cloudflare.com/client/v4/pages/assets/check-missing',
    {
      method: 'POST',
      headers: {
        ...authHeader(jwt),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ hashes }),
    },
  );
  if (!res.ok) {
    await throwHttpError('POST pages check-missing failed', res);
  }
  const body = (await res.json()) as { result: string[] };
  return body.result ?? [];
}

interface UploadEntry {
  key: string;
  value: string;
  metadata: { contentType: string };
  base64: true;
}

// Keep batches small by count. A count cap is useful for Admin bundles with
// many tiny chunks; the byte cap below handles a few unusually large assets.
const ASSET_UPLOAD_BATCH_SIZE = 50;
// Match Wrangler's Pages uploader: a bucket contains at most 40 MiB of raw
// file data. Base64 expands this on the wire, but the API limit is defined in
// terms of the source files Wrangler buckets.
const ASSET_UPLOAD_MAX_RAW_BYTES = 40 * 1024 * 1024;
const ASSET_UPLOAD_MAX_ATTEMPTS = 5;
const ASSET_UPLOAD_RETRY_BASE_MS = 1000;
const DEPLOYMENT_VERIFY_ATTEMPTS = 3;
const DEPLOYMENT_VERIFY_DELAY_MS = 3000;

function isRetryableUploadStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Confirm that a newly-created Pages deployment actually serves files.
 *
 * The Pages deployment API can report a successful deploy stage even when
 * the manifest refers to asset keys that were never stored; that deployment
 * then returns HTTP 500 for every path. CLI callers use this before reporting
 * Admin/LIFF success to the operator.
 */
export async function verifyPagesDeploymentUrl(
  url: string,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<void> {
  const attempts = options.attempts ?? DEPLOYMENT_VERIFY_ATTEMPTS;
  const delayMs = options.delayMs ?? DEPLOYMENT_VERIFY_DELAY_MS;
  let last: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        redirect: 'follow',
        headers: { 'Cache-Control': 'no-cache' },
      });
      if (response.ok) return;
      last = new Error(`HTTP ${response.status}`);
    } catch (error) {
      last = error;
    }
    if (attempt < attempts) await delay(delayMs);
  }

  const reason = last instanceof Error ? last.message : String(last);
  throw new Error(`Pages deployment health check failed: ${reason} (${url})`);
}

/**
 * Push a batch of missing assets to CF. The payload is `key → base64
 * content` plus a small metadata blob (just the Content-Type for now).
 * Callers must skip this entirely when the missing-hashes list is
 * empty — the API errors on an empty top-level array.
 */
async function uploadAssets(
  jwt: string,
  entries: UploadEntry[],
): Promise<void> {
  for (let attempt = 1; attempt <= ASSET_UPLOAD_MAX_ATTEMPTS; attempt++) {
    const res = await fetch(
      'https://api.cloudflare.com/client/v4/pages/assets/upload',
      {
        method: 'POST',
        headers: {
          ...authHeader(jwt),
          'Content-Type': 'application/json',
        },
        // Pages expects the upload entries as the top-level JSON array.
        // `{ payload: entries }` is not the Direct Upload wire format and can
        // surface as an opaque HTTP 500 from the assets Worker.
        body: JSON.stringify(entries),
      },
    );
    if (res.ok) return;

    if (
      !isRetryableUploadStatus(res.status) ||
      attempt === ASSET_UPLOAD_MAX_ATTEMPTS
    ) {
      await throwHttpError('POST pages assets upload failed', res);
    }

    // Drain the failed response before retrying so its connection can be
    // reused. The body is only diagnostic; failure to read it is harmless.
    try {
      await res.text();
    } catch {
      /* ignore */
    }
    await delay(ASSET_UPLOAD_RETRY_BASE_MS * 2 ** (attempt - 1));
  }
}

/**
 * Deploy a static site to a Cloudflare Pages project using the Direct
 * Upload API.
 *
 * Files are keyed by relative path (no leading slash); the function
 * adds the leading `/` automatically when building the manifest since
 * CF requires that form.
 *
 * Returns the new deployment's id and primary URL.
 */
export async function deployPagesProject(opts: {
  creds: CfApiCreds;
  projectName: string;
  files: Map<string, NodeBuffer>;
  branch?: string;
}): Promise<{ deploymentId: string; url: string }> {
  const { creds, projectName, files, branch } = opts;

  if (files.size === 0) {
    throw new Error("deployPagesProject: files map is empty");
  }
  for (const path of files.keys()) {
    if (path === "" || path.split("/").includes("..")) {
      throw new Error(`deployPagesProject: invalid path ${JSON.stringify(path)}`);
    }
  }

  // Step 1: upload token (uses API token).
  const jwt = await getUploadToken(creds, projectName);

  // Step 2: hash every file and remember (hash → {path, content}) so we
  // can rebuild the upload payload from the missing-hashes list.
  const byHash = new Map<string, { path: string; content: NodeBuffer }>();
  const pathToHash = new Map<string, string>();
  for (const [path, content] of files) {
    // Pages and Workers Assets deliberately share Wrangler's asset-key
    // algorithm. The extension is part of the hash input, so the path must be
    // provided even when two files have identical bytes.
    const hash = hashWorkerAsset(path, content);
    pathToHash.set(path, hash);
    // First-write wins if two files share a hash — same content, doesn't matter which we pick.
    if (!byHash.has(hash)) {
      byHash.set(hash, { path, content });
    }
  }

  // Step 3: ask CF which hashes it doesn't already have stored.
  const allHashes = Array.from(new Set(pathToHash.values()));
  const missing = await checkMissingHashes(jwt, allHashes);

  // Step 4: upload missing assets — skip the call entirely when nothing
  // is missing. CF errors on an empty payload array, and it's a useful
  // perf win for re-deploys where only the manifest changed.
  if (missing.length > 0) {
    const entries: UploadEntry[] = [];
    for (const hash of missing) {
      const entry = byHash.get(hash);
      if (!entry) {
        // CF returned a hash we didn't send — defensive; should never happen.
        throw new Error(
          `pages upload: CF reported missing hash ${hash} not in our file set`,
        );
      }
      entries.push({
        key: hash,
        value: entry.content.toString('base64'),
        metadata: { contentType: guessContentType(entry.path) },
        base64: true,
      });
    }
    let batch: UploadEntry[] = [];
    let batchRawBytes = 0;
    for (const entry of entries) {
      // Derive the original byte count from base64 without decoding it.
      const padding = entry.value.endsWith('==') ? 2 : entry.value.endsWith('=') ? 1 : 0;
      const rawBytes = Math.floor((entry.value.length * 3) / 4) - padding;
      if (
        batch.length > 0 &&
        (batch.length >= ASSET_UPLOAD_BATCH_SIZE ||
          batchRawBytes + rawBytes > ASSET_UPLOAD_MAX_RAW_BYTES)
      ) {
        await uploadAssets(jwt, batch);
        batch = [];
        batchRawBytes = 0;
      }
      batch.push(entry);
      batchRawBytes += rawBytes;
    }
    if (batch.length > 0) {
      await uploadAssets(jwt, batch);
    }
  }

  // Step 5: create the deployment with a manifest of "/{path}" → hash
  // for every file. The leading slash is required by the CF API.
  const manifest: Record<string, string> = {};
  for (const [path, hash] of pathToHash) {
    manifest[`/${path}`] = hash;
  }

  const fd = new FormData();
  fd.set('manifest', JSON.stringify(manifest));
  if (branch !== undefined) {
    fd.set('branch', branch);
  }

  const res = await fetch(`${pagesProjectApiBase(creds.accountId, projectName)}/deployments`, {
    method: 'POST',
    headers: authHeader(creds.apiToken),
    body: fd,
  });
  if (!res.ok) {
    await throwHttpError('POST pages deployment failed', res);
  }
  const body = (await res.json()) as {
    result: { id: string; url: string };
  };
  return { deploymentId: body.result.id, url: body.result.url };
}

/**
 * Return just the most recent deployment for a Pages project. Used by
 * the update engine to grab a known-good rollback target before
 * attempting a new deploy.
 */
export async function getLatestDeployment(opts: {
  creds: CfApiCreds;
  projectName: string;
}): Promise<{ id: string }> {
  const { creds, projectName } = opts;
  const res = await fetch(
    `${pagesProjectApiBase(creds.accountId, projectName)}/deployments?per_page=1`,
    {
      method: 'GET',
      headers: authHeader(creds.apiToken),
    },
  );
  if (!res.ok) {
    await throwHttpError('GET pages deployments failed', res);
  }
  const body = (await res.json()) as { result: Array<{ id: string }> };
  const first = body.result?.[0];
  if (!first) {
    throw new Error('GET pages deployments: empty result list');
  }
  return { id: first.id };
}

/**
 * Roll back a Pages project to a previously-deployed deployment id.
 * Used when the post-deploy verify step fails on an update.
 */
export async function rollbackPagesDeployment(opts: {
  creds: CfApiCreds;
  projectName: string;
  deploymentId: string;
}): Promise<void> {
  const { creds, projectName, deploymentId } = opts;
  const res = await fetch(
    `${pagesProjectApiBase(creds.accountId, projectName)}/deployments/${deploymentId}/rollback`,
    {
      method: 'POST',
      headers: authHeader(creds.apiToken),
    },
  );
  if (!res.ok) {
    await throwHttpError('POST pages rollback failed', res);
  }
}
