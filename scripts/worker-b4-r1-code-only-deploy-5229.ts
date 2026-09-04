#!/usr/bin/env tsx
/** Approval-bounded code-only closure of the historical #5229 public route. */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { argv, exit, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  DeployStop, exactHttpsRequest, getSnapshot, loadToken,
  type ExactRequest, type HttpResponse, type WorkerSnapshot,
} from './worker-b1-deploy-5229.js';
import {
  canonical, parseActiveDeployment, parseVersionSemantic,
} from './worker-b1-v1-postdeploy-readback-5229.js';

const APPROVAL_ID = '5229-B4-R1-20260904';
const APPROVAL_RECEIVED = '2026-09-04T00:50:00.301Z';
const APPROVAL_EXPIRES = '2026-09-04T02:50:00.301Z';
const ACCOUNT_ID = '67907592fdf596376bc2097e14a6563a';
const SCRIPT_NAME = 'line-harness';
const WORKER_HOST = 'line-harness.family8office.workers.dev';
const PLANNING_WORKTREE = '/Users/kensmba/.line-harness-wt/5229-private-incoming-media';
const BACKPORT_WORKTREE = '/Users/kensmba/.line-harness-wt/5229-b1-v019-backport';
const ACCOUNTING_WORKTREE = '/Users/kensmba/scripts-wt/5230-line-recovery-deploy';
const BACKPORT_PARENT = '9f3c6c3ac98d0777f8e7354f807a6af4ab642b18';
const BACKPORT_HEAD = 'ac104571b1a3e053f4d573ebd8d31ffb88e2d6f9';
const ACCOUNTING_HEAD = 'ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f';
const ARTIFACT_DIR = '/Users/kensmba/.line-harness-5229-B4-BUILD-20260904-final1';
const ARTIFACT_FILE = `${ARTIFACT_DIR}/index.js`;
const DOUBLE_BUILD_FILE = '/Users/kensmba/.line-harness-5229-B4-BUILD-20260904-final2/index.js';
const ARTIFACT_SHA256 = 'bc5e139610376b126bb2fc61fa1fbb6b112ac4587b4f89db87b3d6d5bad02790';
const ARTIFACT_BYTES = 1_350_017;
const TARGET_VERSION = '0.19.0-5229.b4.ac10457';
const TARGET_WORKER_HASH = 'sha256:45aa5132adffe83e1710534efd914b116cb6a4d06df0926df4b28b71f9f51bf2';
const ZERO_HASH = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
const CURRENT_DEPLOYMENT_ID = '89b40fb5-bfc8-48b1-a7b1-b8f3538bccf7';
const CURRENT_VERSION_ID = '5dab4e03-2147-4c34-b5c7-f70c105b4712';
const CURRENT_SCRIPT_ETAG = '41cc0b7544b0466426c08b7b2544c8b161ae4817925803605d68760f85659f1c';
const CURRENT_SETTINGS_SHA256 = 'cf56c8c2c0defabdd7f936915e063a5feb28444971768dea7c8e178dc28d54c8';
const SUBDOMAIN_SHA256 = '81d85b2e35295c30a89a15cfce655824db618966f23be5b068d6f55c545429f3';
const SCHEDULES_SHA256 = 'ba94fb8a9b24fb239e7de571c5b281dd302cc139821d28fa7f12721ef2cd1849';
const ASSET_SHA256 = '8fcf498813511a591cb5d595bc281fee2d45f7a27a87f124257a319b543d04c6';
const ADMIN_NAME_SHA256 = '492123998ae432be97e93235fce10a2d5d118fd9eb8be802edd46ae8345ca9a2';
const ADMIN_DEPLOYMENT_ID = '301a632d-dc9a-4655-8368-2d77f8db3b21';
const MANIFEST_DIR = '/Users/kensmba/.line-harness-5229-M0-20260901';
const MANIFEST_FILE = `${MANIFEST_DIR}/incoming-media-backfill-manifest.json`;
const MANIFEST_SHA256 = 'cf35a1045040a265019a5afad8c2cefb8994edba684eeaa5dd2fad0b17b1663e';
const ACCOUNTING_ENV = `${ACCOUNTING_WORKTREE}/260107_orchestrator/.env`;
const OUTPUT_DIR = '/Users/kensmba/.line-harness-5229-B4-R1-20260904';
const MAX_JSON_BYTES = 262_144;
const MULTIPART_BOUNDARY = '----line-harness-5229-b4-r1-code-only';
const PRIVATE_NOT_FOUND_BODY = '{"success":false,"error":"Image not found"}';

const RECEIPTS = [
  ['/Users/kensmba/.line-harness-5229-B1-V1-20260903/sanitized-summary.json', '5e3dcbf0a5ae7b5e883788cfa7ce87f9bb411fa1935d885ae2bb10a2f769d3a6'],
  ['/Users/kensmba/.line-harness-5229-B3-20260903/sanitized-summary.json', '098b0ded9bf20d16d40d5e1108c6571f2e75e24179a0fae29f7b80c27e76c660'],
  ['/Users/kensmba/.line-harness-5229-B3-R1-20260903/sanitized-summary.json', '4372dc856adbf7ac59facac24789417d61f3d282f8f47d91b92f73d4018ae991'],
  ['/Users/kensmba/.line-harness-5229-B4-STOP-20260903/sanitized-summary.json', '2eee00f58b52bdedd1fbba1b516431f4820099727f2db66a7cab280f0c2dbeff'],
] as const;

type ManifestEntry = {
  line_account_id: string;
  line_message_id: string;
  r2_key: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
};

type ManifestData = {
  accountId: string;
  legacyPaths: string[];
  privateHeadPath: string;
  privateContentPath: string;
  first: ManifestEntry;
};

type OutputIdentity = { dev: number; ino: number };
type RuntimeVersion = {
  version: string; worker_hash: string; admin_hash: string; liff_hash: string; released_at: string;
};

export interface Dependencies {
  now: () => number;
  sleep: (milliseconds: number) => Promise<void>;
  loadCloudflareToken: () => string;
  cfRequest: (spec: ExactRequest, expiresAt: number) => Promise<HttpResponse>;
  workerRequest: (spec: ExactRequest, expiresAt: number) => Promise<HttpResponse>;
  outputDir: string;
}

export class B4Stop extends Error {
  constructor(readonly code: string) { super(code); }
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function header(response: HttpResponse, name: string): string | undefined {
  const value = response.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function contentType(response: HttpResponse): string {
  return (header(response, 'content-type') ?? '').split(';', 1)[0].trim().toLowerCase();
}

function assertRealPath(path: string, kind: 'directory' | 'file', mode: number): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) ||
      (stat.mode & 0o777) !== mode) throw new B4Stop(`${kind}_state`);
}

function gitValue(worktree: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', worktree, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new B4Stop('git_anchor');
  }
}

export function validateApprovalWindow(now: number): void {
  const start = Date.parse(APPROVAL_RECEIVED);
  const end = Date.parse(APPROVAL_EXPIRES);
  if (end - start !== 7_200_000 || now < start || now >= end) throw new B4Stop('approval_inactive');
}

export function validateLocalState(approvedHarnessHead: string): void {
  if (!/^[0-9a-f]{40}$/.test(approvedHarnessHead) ||
      gitValue(PLANNING_WORKTREE, ['rev-parse', 'HEAD']) !== approvedHarnessHead ||
      gitValue(BACKPORT_WORKTREE, ['rev-parse', 'HEAD']) !== BACKPORT_HEAD ||
      gitValue(ACCOUNTING_WORKTREE, ['rev-parse', 'HEAD']) !== ACCOUNTING_HEAD) {
    throw new B4Stop('head_drift');
  }
  for (const worktree of [PLANNING_WORKTREE, BACKPORT_WORKTREE, ACCOUNTING_WORKTREE]) {
    if (gitValue(worktree, ['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
      throw new B4Stop('worktree_dirty');
    }
  }
  const changed = gitValue(BACKPORT_WORKTREE, [
    'diff', '--name-only', `${BACKPORT_PARENT}..${BACKPORT_HEAD}`,
  ]).split('\n').filter(Boolean).sort();
  const expected = [
    'apps/worker/src/index.ts',
    'apps/worker/src/routes/images.test.ts',
    'apps/worker/src/routes/images.ts',
  ];
  if (canonical(changed) !== canonical(expected)) throw new B4Stop('backport_diff_scope');

  assertRealPath(ARTIFACT_DIR, 'directory', 0o700);
  if (canonical(readdirSync(ARTIFACT_DIR)) !== canonical(['index.js'])) throw new B4Stop('artifact_entries');
  assertRealPath(ARTIFACT_FILE, 'file', 0o600);
  const artifact = readFileSync(ARTIFACT_FILE);
  const second = readFileSync(DOUBLE_BUILD_FILE);
  if (artifact.length !== ARTIFACT_BYTES || sha256(artifact) !== ARTIFACT_SHA256 ||
      sha256(second) !== ARTIFACT_SHA256 || !artifact.equals(second)) throw new B4Stop('artifact_identity');
  const text = artifact.toString('utf8');
  if (!text.includes(TARGET_VERSION) || !text.includes(TARGET_WORKER_HASH.slice(7)) ||
      text.includes('INCOMING_MEDIA_PUBLIC_BLOCK_ENABLED') || text.includes(MULTIPART_BOUNDARY)) {
    throw new B4Stop('artifact_markers');
  }
  for (const [path, expectedHash] of RECEIPTS) {
    assertRealPath(path, 'file', 0o600);
    if (sha256(readFileSync(path)) !== expectedHash) throw new B4Stop('receipt_drift');
  }
  assertRealPath(MANIFEST_DIR, 'directory', 0o700);
  assertRealPath(MANIFEST_FILE, 'file', 0o600);
  if (sha256(readFileSync(MANIFEST_FILE)) !== MANIFEST_SHA256) throw new B4Stop('manifest_drift');
  assertRealPath(ACCOUNTING_ENV, 'file', 0o600);
}

export function loadManifest(): ManifestData {
  const value = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) as {
    verified?: unknown; worker_url?: unknown; entries?: unknown[];
  };
  if (value.verified !== true || value.worker_url !== `https://${WORKER_HOST}` ||
      !Array.isArray(value.entries) || value.entries.length !== 77) throw new B4Stop('manifest_shape');
  const entries = value.entries as ManifestEntry[];
  for (const row of entries) {
    if (!row || typeof row.line_account_id !== 'string' || typeof row.line_message_id !== 'string' ||
        typeof row.r2_key !== 'string' || typeof row.mime_type !== 'string' ||
        !Number.isSafeInteger(row.byte_size) || row.byte_size < 1 || !/^[0-9a-f]{64}$/.test(row.sha256) ||
        !/^incoming-[A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.(?:jpe?g|png|gif|webp)$/i.test(row.r2_key)) {
      throw new B4Stop('manifest_entry');
    }
  }
  const accountIds = [...new Set(entries.map((row) => row.line_account_id))];
  if (accountIds.length !== 1) throw new B4Stop('manifest_accounts');
  const first = entries[0];
  return {
    accountId: accountIds[0], first,
    legacyPaths: entries.map((row) => `/images/${encodeURIComponent(row.r2_key)}`),
    privateHeadPath: `/api/incoming-media/${encodeURIComponent(first.line_account_id)}/${encodeURIComponent(first.line_message_id)}`,
    privateContentPath: `/api/incoming-media/${encodeURIComponent(first.line_account_id)}/${encodeURIComponent(first.line_message_id)}/content`,
  };
}

export function loadAccountingCredential(expectedAccountId: string): string {
  const values = new Map<string, string>();
  for (const raw of readFileSync(ACCOUNTING_ENV, 'utf8').split(/\r?\n/)) {
    const match = /^(LINE_ACCOUNTING_HARNESS_(?:ACCOUNT_ID|MEDIA_READ_CREDENTIAL|MEDIA_READ_CREDENTIAL_SHA256))=(.*)$/.exec(raw);
    if (match) values.set(match[1], match[2]);
  }
  const account = values.get('LINE_ACCOUNTING_HARNESS_ACCOUNT_ID');
  const credential = values.get('LINE_ACCOUNTING_HARNESS_MEDIA_READ_CREDENTIAL');
  const fingerprint = values.get('LINE_ACCOUNTING_HARNESS_MEDIA_READ_CREDENTIAL_SHA256');
  if (account !== expectedAccountId || !credential || !/^[0-9a-f]{64}$/.test(fingerprint ?? '') ||
      sha256(credential) !== fingerprint || /[\r\n\0]/.test(credential)) throw new B4Stop('accounting_credential');
  return credential;
}

export function buildContentUpload(artifact: Buffer): Buffer {
  if (artifact.length !== ARTIFACT_BYTES || sha256(artifact) !== ARTIFACT_SHA256) {
    throw new B4Stop('artifact_identity');
  }
  const before = Buffer.from(
    `--${MULTIPART_BOUNDARY}\r\n` +
    'Content-Disposition: form-data; name="metadata"\r\n' +
    'Content-Type: application/json\r\n\r\n' +
    '{"main_module":"worker.js"}\r\n' +
    `--${MULTIPART_BOUNDARY}\r\n` +
    'Content-Disposition: form-data; name="worker.js"; filename="worker.js"\r\n' +
    'Content-Type: application/javascript+module\r\n\r\n',
    'utf8',
  );
  return Buffer.concat([before, artifact, Buffer.from(`\r\n--${MULTIPART_BOUNDARY}--\r\n`)]);
}

function parseEnvelope(response: HttpResponse, code: string): unknown {
  if (response.status !== 200 || contentType(response) !== 'application/json' ||
      (header(response, 'content-encoding') !== undefined && header(response, 'content-encoding') !== 'identity')) {
    throw new B4Stop(`${code}_response`);
  }
  let value: { success?: unknown; result?: unknown };
  try { value = JSON.parse(response.body.toString('utf8')) as typeof value; } catch { throw new B4Stop(`${code}_json`); }
  if (value.success !== true || value.result === undefined) throw new B4Stop(`${code}_shape`);
  return value.result;
}

function parseRuntime(response: HttpResponse): RuntimeVersion | null {
  if (response.status !== 200 || contentType(response) !== 'application/json') return null;
  let value: Record<string, unknown>;
  try { value = JSON.parse(response.body.toString('utf8')) as Record<string, unknown>; } catch { return null; }
  for (const key of ['version', 'worker_hash', 'admin_hash', 'liff_hash', 'released_at']) {
    if (typeof value[key] !== 'string') return null;
  }
  return value as RuntimeVersion;
}

function cacheProjection(snapshot: WorkerSnapshot): unknown {
  const settings = snapshot.settings as Record<string, unknown>;
  const cache = settings.cache_options;
  if (cache !== undefined && (!cache || typeof cache !== 'object' || Array.isArray(cache) ||
      (cache as { enabled?: unknown }).enabled !== false)) throw new B4Stop('worker_cache_enabled_or_unknown');
  return {
    compatibility_date: settings.compatibility_date,
    compatibility_flags: settings.compatibility_flags,
    cache_options: cache ?? null,
    binding_shape: snapshot.bindingShape,
    subdomain_sha256: snapshot.subdomainSha256,
    schedules_sha256: snapshot.schedulesSha256,
    version_asset_binding_sha256: snapshot.versionAssetBindingDigest,
    settings_asset_binding_sha256: snapshot.settingsAssetBindingDigest,
    admin_project_name_sha256: snapshot.adminProjectNameSha256,
    admin_deployment_id: snapshot.adminDeploymentId,
  };
}

function validateCurrent(snapshot: WorkerSnapshot): void {
  if (snapshot.deploymentId !== CURRENT_DEPLOYMENT_ID || snapshot.versionId !== CURRENT_VERSION_ID ||
      snapshot.scriptEtag !== CURRENT_SCRIPT_ETAG || snapshot.settingsSha256 !== CURRENT_SETTINGS_SHA256 ||
      snapshot.subdomainSha256 !== SUBDOMAIN_SHA256 || snapshot.schedulesSha256 !== SCHEDULES_SHA256 ||
      snapshot.bindingShape.length !== 20 || snapshot.versionAssetBindingDigest !== ASSET_SHA256 ||
      snapshot.settingsAssetBindingDigest !== ASSET_SHA256 || snapshot.assetResourceIdentityAvailable !== false ||
      snapshot.adminProjectNameSha256 !== ADMIN_NAME_SHA256 || snapshot.adminDeploymentId !== ADMIN_DEPLOYMENT_ID) {
    throw new B4Stop('current_state_drift');
  }
  void cacheProjection(snapshot);
}

function validatePrivateHead(response: HttpResponse, first: ManifestEntry): void {
  if (response.status !== 200 || response.body.length !== 0 ||
      header(response, 'cache-control') !== 'private, no-store' ||
      header(response, 'x-content-sha256') !== first.sha256 ||
      Number(header(response, 'content-length')) !== first.byte_size || contentType(response) !== first.mime_type) {
    throw new B4Stop('private_head_readback');
  }
}

function validatePrivateGet(response: HttpResponse, first: ManifestEntry): void {
  if (response.status !== 200 || response.body.length !== first.byte_size ||
      sha256(response.body) !== first.sha256 || header(response, 'cache-control') !== 'private, no-store' ||
      contentType(response) !== first.mime_type) throw new B4Stop('private_get_readback');
}

function validateLegacyClosure(response: HttpResponse): void {
  const cacheStatus = (header(response, 'cf-cache-status') ?? '').toUpperCase();
  if (response.status !== 404 || response.body.toString('utf8') !== PRIVATE_NOT_FOUND_BODY ||
      contentType(response) !== 'application/json' || header(response, 'cache-control') !== 'private, no-store' ||
      header(response, 'x-content-type-options') !== 'nosniff' || header(response, 'etag') !== undefined ||
      ['HIT', 'STALE', 'UPDATING', 'REVALIDATED'].includes(cacheStatus)) {
    throw new B4Stop('legacy_public_readback');
  }
}

function createOutput(path: string): OutputIdentity {
  if (existsSync(path)) throw new B4Stop('output_exists');
  mkdirSync(path, { mode: 0o700 });
  assertRealPath(path, 'directory', 0o700);
  const stat = lstatSync(path);
  return { dev: stat.dev, ino: stat.ino };
}

function writeSummary(path: string, identity: OutputIdentity, summary: unknown): void {
  const stat = lstatSync(path);
  if (stat.dev !== identity.dev || stat.ino !== identity.ino || readdirSync(path).length !== 0) {
    throw new B4Stop('output_drift');
  }
  const file = `${path}/sanitized-summary.json`;
  writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  assertRealPath(file, 'file', 0o600);
}

function safeReason(error: unknown): string {
  if (error instanceof B4Stop || error instanceof DeployStop) return error.code;
  return 'provider_or_local_error';
}

export async function run(raw: string[], deps: Dependencies): Promise<Record<string, unknown>> {
  const preflightOnly = raw[0] === '--preflight-only';
  const execute = raw[0] === '--execute';
  if ((!preflightOnly && !execute) || raw[1] !== '--approved-harness-head' || !raw[2] || raw.length !== 3) {
    throw new B4Stop('arguments');
  }
  validateLocalState(raw[2]);
  const manifest = loadManifest();
  const credential = loadAccountingCredential(manifest.accountId);
  const cloudflareToken = deps.loadCloudflareToken();
  const artifact = Buffer.from(readFileSync(ARTIFACT_FILE));
  const upload = buildContentUpload(artifact);
  if (preflightOnly) {
    if (existsSync(deps.outputDir)) throw new B4Stop('output_exists');
    return {
      approval_id: APPROVAL_ID, status: 'preflight_passed', approved_harness_head: raw[2],
      backport_head: BACKPORT_HEAD, artifact_sha256: ARTIFACT_SHA256, artifact_bytes: artifact.length,
      manifest_sha256: MANIFEST_SHA256, candidate_count: manifest.legacyPaths.length,
      token_present: cloudflareToken.length > 0, credential_present: credential.length > 0,
      provider_requests: 0, provider_writes: 0, local_writes: 0,
    };
  }

  validateApprovalWindow(deps.now());
  const expiresAt = Date.parse(APPROVAL_EXPIRES);
  const identity = createOutput(deps.outputDir);
  const startedAt = new Date(deps.now()).toISOString();
  let cfReads = 0;
  let runtimeReads = 0;
  let putAttempts = 0;
  let versionPolls = 0;
  let closedCount = 0;
  let mutationStage = 'pre_write_readback';
  let mutationOutcome: 'not_attempted' | 'unknown' | 'accepted' = 'not_attempted';
  let terminal: { deploymentId: string; versionId: string; percentage: number } | null = null;
  const requestCf = async (spec: ExactRequest): Promise<HttpResponse> => {
    validateApprovalWindow(deps.now());
    if (spec.method === 'PUT') putAttempts += 1;
    else if (spec.method === 'GET') cfReads += 1;
    else throw new B4Stop('cloudflare_request_scope');
    if (putAttempts > 1 || cfReads > 23) throw new B4Stop('request_ceiling');
    const response = await deps.cfRequest(spec, expiresAt);
    validateApprovalWindow(deps.now());
    return response;
  };
  const requestWorker = async (spec: ExactRequest): Promise<HttpResponse> => {
    validateApprovalWindow(deps.now());
    if (spec.method !== 'GET' && spec.method !== 'HEAD') throw new B4Stop('worker_request_scope');
    runtimeReads += 1;
    if (runtimeReads > 96) throw new B4Stop('request_ceiling');
    const response = await deps.workerRequest(spec, expiresAt);
    validateApprovalWindow(deps.now());
    return response;
  };
  const base = `/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}`;
  const auth = { Authorization: `Bearer ${cloudflareToken}`, 'Accept-Encoding': 'identity' };
  const versionRequest = (versionId: string): ExactRequest => ({
    hostname: 'api.cloudflare.com', method: 'GET', path: `${base}/versions/${versionId}`,
    headers: auth, maxBytes: MAX_JSON_BYTES,
  });
  const deploymentRequest = (): ExactRequest => ({
    hostname: 'api.cloudflare.com', method: 'GET', path: `${base}/deployments`,
    headers: auth, maxBytes: MAX_JSON_BYTES,
  });

  try {
    const before = await getSnapshot(cloudflareToken, expiresAt, requestCf, ADMIN_NAME_SHA256);
    validateCurrent(before.snapshot);
    const beforeSemantic = parseVersionSemantic(
      await requestCf(versionRequest(CURRENT_VERSION_ID)), CURRENT_VERSION_ID, CURRENT_SCRIPT_ETAG,
    );
    const preRuntime = parseRuntime(await requestWorker({
      hostname: WORKER_HOST, method: 'GET', path: '/admin/version',
      headers: { 'Accept-Encoding': 'identity' }, maxBytes: 8_192,
    }));
    if (!preRuntime || preRuntime.version !== '0.19.0-5229.b1.9f3c6c3' ||
        preRuntime.worker_hash !== 'sha256:6420c520444baa670973197f6c336b23a511e9dcd8fdbdf24082b61ce24c2b1e') {
      throw new B4Stop('pre_runtime_drift');
    }
    const privateHeaders = { Authorization: `Bearer ${credential}`, 'Accept-Encoding': 'identity' };
    const preUnauthenticated = await requestWorker({
      hostname: WORKER_HOST, method: 'HEAD', path: manifest.privateHeadPath,
      headers: { 'Accept-Encoding': 'identity' }, maxBytes: 1_024,
    });
    if (preUnauthenticated.status !== 401 || preUnauthenticated.body.length !== 0 ||
        header(preUnauthenticated, 'cache-control') !== 'private, no-store') {
      throw new B4Stop('pre_private_auth_denial');
    }
    validatePrivateHead(await requestWorker({
      hostname: WORKER_HOST, method: 'HEAD', path: manifest.privateHeadPath,
      headers: privateHeaders, maxBytes: 1_024,
    }), manifest.first);
    validatePrivateGet(await requestWorker({
      hostname: WORKER_HOST, method: 'GET', path: manifest.privateContentPath,
      headers: privateHeaders, maxBytes: manifest.first.byte_size,
    }), manifest.first);

    // Keep the second full provider snapshot immediately adjacent to the
    // mutation. The private content probes above may be comparatively slow.
    const finalPre = await getSnapshot(cloudflareToken, expiresAt, requestCf, ADMIN_NAME_SHA256);
    const finalPreSemantic = parseVersionSemantic(
      await requestCf(versionRequest(CURRENT_VERSION_ID)), CURRENT_VERSION_ID, CURRENT_SCRIPT_ETAG,
    );
    if (canonical(before.snapshot) !== canonical(finalPre.snapshot) ||
        canonical(beforeSemantic) !== canonical(finalPreSemantic)) throw new B4Stop('pre_put_snapshot_drift');

    mutationStage = 'content_put_in_flight';
    mutationOutcome = 'unknown';
    const put = await requestCf({
      hostname: 'api.cloudflare.com', method: 'PUT', path: `${base}/content`,
      headers: {
        ...auth, 'Content-Type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
        'Content-Length': upload.length,
      },
      body: upload, maxBytes: MAX_JSON_BYTES,
    });
    void parseEnvelope(put, 'content_put');
    mutationOutcome = 'accepted';
    mutationStage = 'post_write_readback';

    const after = await getSnapshot(cloudflareToken, expiresAt, requestCf, ADMIN_NAME_SHA256);
    if (after.snapshot.deploymentId === CURRENT_DEPLOYMENT_ID || after.snapshot.versionId === CURRENT_VERSION_ID ||
        after.snapshot.scriptEtag === CURRENT_SCRIPT_ETAG ||
        canonical(cacheProjection(before.snapshot)) !== canonical(cacheProjection(after.snapshot))) {
      throw new B4Stop('post_deployment_identity_or_config');
    }
    const afterSemantic = parseVersionSemantic(
      await requestCf(versionRequest(after.snapshot.versionId)), after.snapshot.versionId, after.snapshot.scriptEtag,
    );
    for (const key of ['resourcesSha256', 'bindingsFullSha256', 'scriptRuntimeSha256',
      'handlerTopologySha256', 'bindingCount', 'topLevelKeyNamesSha256'] as const) {
      if (beforeSemantic[key] !== afterSemantic[key]) throw new B4Stop('version_resource_drift');
    }

    let runtime: RuntimeVersion | null = null;
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      versionPolls = attempt;
      const observed = parseRuntime(await requestWorker({
        hostname: WORKER_HOST, method: 'GET', path: '/admin/version',
        headers: { 'Accept-Encoding': 'identity' }, maxBytes: 8_192,
      }));
      if (observed?.version === TARGET_VERSION && observed.worker_hash === TARGET_WORKER_HASH &&
          observed.admin_hash === ZERO_HASH && observed.liff_hash === ZERO_HASH &&
          Number.isFinite(Date.parse(observed.released_at))) {
        runtime = observed;
        break;
      }
      if (attempt < 12) await deps.sleep(2_000);
    }
    if (!runtime) throw new B4Stop('runtime_propagation_timeout');

    const unauthenticated = await requestWorker({
      hostname: WORKER_HOST, method: 'HEAD', path: manifest.privateHeadPath,
      headers: { 'Accept-Encoding': 'identity' }, maxBytes: 1_024,
    });
    if (unauthenticated.status !== 401 || unauthenticated.body.length !== 0 ||
        header(unauthenticated, 'cache-control') !== 'private, no-store') throw new B4Stop('private_auth_denial');
    validatePrivateHead(await requestWorker({
      hostname: WORKER_HOST, method: 'HEAD', path: manifest.privateHeadPath,
      headers: privateHeaders, maxBytes: 1_024,
    }), manifest.first);
    validatePrivateGet(await requestWorker({
      hostname: WORKER_HOST, method: 'GET', path: manifest.privateContentPath,
      headers: privateHeaders, maxBytes: manifest.first.byte_size,
    }), manifest.first);

    for (const path of manifest.legacyPaths) {
      validateLegacyClosure(await requestWorker({
        hostname: WORKER_HOST, method: 'GET', path,
        headers: { 'Accept-Encoding': 'identity', Range: 'bytes=0-0' }, maxBytes: 1_024,
      }));
      closedCount += 1;
    }
    terminal = parseActiveDeployment(await requestCf(deploymentRequest()));
    if (terminal.deploymentId !== after.snapshot.deploymentId || terminal.versionId !== after.snapshot.versionId ||
        terminal.percentage !== 100) throw new B4Stop('terminal_deployment_drift');
    mutationStage = 'completed';

    const summary = {
      schema_version: 1, approval_id: APPROVAL_ID,
      approval_received: APPROVAL_RECEIVED, approval_expires: APPROVAL_EXPIRES,
      approved_harness_head: raw[2], backport_head: BACKPORT_HEAD,
      started_at: startedAt, completed_at: new Date(deps.now()).toISOString(), status: 'completed',
      artifact: { sha256: ARTIFACT_SHA256, bytes: ARTIFACT_BYTES, version: TARGET_VERSION, worker_hash: TARGET_WORKER_HASH },
      prerequisites: { manifest_sha256: MANIFEST_SHA256, candidate_count: 77, pinned_receipts: RECEIPTS.length },
      deployment: {
        previous_deployment_id: CURRENT_DEPLOYMENT_ID, previous_version_id: CURRENT_VERSION_ID,
        new_deployment_id: after.snapshot.deploymentId, new_version_id: after.snapshot.versionId,
        terminal_active_unchanged: true, traffic_percentage: 100,
      },
      immutable_config: {
        semantic_resources_equal: true, bindings_equal: true, binding_count: afterSemantic.bindingCount,
        cache_enabled: false, subdomain_sha256: after.snapshot.subdomainSha256,
        schedules_sha256: after.snapshot.schedulesSha256, asset_binding_sha256: after.snapshot.versionAssetBindingDigest,
        admin_project_name_sha256: after.snapshot.adminProjectNameSha256,
      },
      runtime_readback: {
        version: runtime.version, worker_hash: runtime.worker_hash, version_attempts: versionPolls,
        pre_write_private_unauthenticated_head: 401, pre_write_private_authenticated_head: 200,
        pre_write_private_authenticated_get: 200, pre_write_private_content_sha256_match: true,
        private_unauthenticated_head: 401, private_authenticated_head: 200,
        private_authenticated_get: 200, private_content_sha256_match: true,
        legacy_public_get_404_count: closedCount, legacy_expected_count: 77,
        legacy_private_no_store_count: closedCount, cache_hit_count: 0,
      },
      request_counts: {
        cloudflare_get: cfReads, worker_content_put: putAttempts, runtime_read: runtimeReads,
        provider_total: cfReads + putAttempts + runtimeReads, retry: 0, redirect: 0,
      },
      mutation: { stage: mutationStage, outcome: mutationOutcome, put_attempts: putAttempts,
        reconciliation_required: false, automatic_rollback: 0 },
      forbidden_actions: {
        settings_write: 0, binding_change: 0, secret_change: 0, d1: 0, r2_direct: 0,
        purge: 0, restart: 0, line_send: 0, drive_write: 0, pr_merge: 0,
      },
    };
    writeSummary(deps.outputDir, identity, summary);
    return summary;
  } catch (error) {
    const reason = safeReason(error);
    if (putAttempts > 0 && terminal === null && deps.now() < Date.parse(APPROVAL_EXPIRES)) {
      try { terminal = parseActiveDeployment(await requestCf(deploymentRequest())); } catch { /* reconciliation remains required */ }
    }
    if (readdirSync(deps.outputDir).length === 0) writeSummary(deps.outputDir, identity, {
      schema_version: 1, approval_id: APPROVAL_ID,
      approval_received: APPROVAL_RECEIVED, approval_expires: APPROVAL_EXPIRES,
      approved_harness_head: raw[2], backport_head: BACKPORT_HEAD,
      started_at: startedAt, completed_at: new Date(deps.now()).toISOString(),
      status: 'stopped', stop_reason: reason, closed_legacy_count: closedCount,
      request_counts: { cloudflare_get: cfReads, worker_content_put: putAttempts,
        runtime_read: runtimeReads, provider_total: cfReads + putAttempts + runtimeReads, retry: 0, redirect: 0 },
      mutation: { stage: mutationStage, outcome: mutationOutcome, put_attempts: putAttempts,
        reconciliation_required: putAttempts > 0, automatic_rollback: 0 },
      observed_terminal_deployment: terminal,
    });
    throw new B4Stop(reason);
  }
}

const defaultDeps: Dependencies = {
  now: () => Date.now(), sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  loadCloudflareToken: loadToken,
  cfRequest: (spec, expiresAt) => exactHttpsRequest(spec, expiresAt),
  workerRequest: (spec, expiresAt) => exactHttpsRequest(spec, expiresAt),
  outputDir: OUTPUT_DIR,
};

const isCliEntry = (() => {
  if (!argv[1]) return false;
  try { return fileURLToPath(import.meta.url) === argv[1]; } catch { return false; }
})();

if (isCliEntry) {
  run(argv.slice(2), defaultDeps).then((result) => stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error: unknown) => {
      stdout.write(`${JSON.stringify({ approval_id: APPROVAL_ID, status: 'stopped',
        stop_reason: safeReason(error), retry: 0, automatic_rollback: 0 })}\n`);
      exit(1);
    });
}
