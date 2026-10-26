#!/usr/bin/env tsx
/** Approval-bound read-only verification after B1's accepted content PUT. */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { argv, exit, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  DeployStop, exactHttpsRequest, getSnapshot, loadLegacyProbePath, loadToken,
  type ExactRequest, type HttpResponse, type WorkerSnapshot,
} from './worker-b1-deploy-5229.js';

const APPROVAL_ID = '5229-B1-V1-20260903';
const APPROVAL_RECEIVED = '2026-09-03T05:51:46.737Z';
const APPROVAL_EXPIRES = '2026-09-03T07:51:46.737Z';
const ACCOUNT_ID = '67907592fdf596376bc2097e14a6563a';
const SCRIPT_NAME = 'line-harness';
const WORKTREE = '/Users/kensmba/.line-harness-wt/5229-private-incoming-media';
const BACKPORT_WORKTREE = '/Users/kensmba/.line-harness-wt/5229-b1-v019-backport';
const ACCOUNTING_WORKTREE = '/Users/kensmba/scripts-wt/5230-line-recovery';
const BACKPORT_HEAD = '9f3c6c3ac98d0777f8e7354f807a6af4ab642b18';
const ACCOUNTING_HEAD = 'ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f';
const OUTPUT_DIR = '/Users/kensmba/.line-harness-5229-B1-V1-20260903';
const B1_RECEIPT_DIR = '/Users/kensmba/.line-harness-5229-B1-R1-20260903';
const B1_RECEIPT_FILE = `${B1_RECEIPT_DIR}/sanitized-summary.json`;
const B1_RECEIPT_SHA256 = 'a3f5e2c411f5b8656427f363549d5ed0952da3937a1c47e47185ea78faa3f785';
const MANIFEST_FILE = '/Users/kensmba/.line-harness-5229-M0-20260901/incoming-media-backfill-manifest.json';
const EXECUTOR_FILE = `${WORKTREE}/scripts/worker-b1-v1-postdeploy-readback-5229.ts`;
const TEST_FILE = `${WORKTREE}/scripts/worker-b1-v1-postdeploy-readback-5229.test.ts`;
const OLD_DEPLOYMENT_ID = '7b3bb319-e618-4f57-a520-cd33f43115e5';
const OLD_VERSION_ID = 'c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7';
const OLD_SCRIPT_ETAG = '1d9a88703ce2509f372740c140aa18699884b779a82108efdd863484555611b6';
const NEW_DEPLOYMENT_ID = '89b40fb5-bfc8-48b1-a7b1-b8f3538bccf7';
const NEW_VERSION_ID = '5dab4e03-2147-4c34-b5c7-f70c105b4712';
const NEW_SCRIPT_ETAG = '41cc0b7544b0466426c08b7b2544c8b161ae4817925803605d68760f85659f1c';
const PREVIOUS_SETTINGS_SHA256 = '107835eb17613fa3789f34a913ced66be79b9dc48fa8666276bf2feed9a51abc';
const SUBDOMAIN_SHA256 = '81d85b2e35295c30a89a15cfce655824db618966f23be5b068d6f55c545429f3';
const SCHEDULES_SHA256 = 'ba94fb8a9b24fb239e7de571c5b281dd302cc139821d28fa7f12721ef2cd1849';
const BINDING_SHAPE_SHA256 = 'cdc3ac05d11170d7d795274d4a873576358eeaf86737e0b78931c81b59dc19a4';
const ASSET_SHA256 = '8fcf498813511a591cb5d595bc281fee2d45f7a27a87f124257a319b543d04c6';
const ADMIN_NAME_SHA256 = '492123998ae432be97e93235fce10a2d5d118fd9eb8be802edd46ae8345ca9a2';
const ADMIN_DEPLOYMENT_ID = '301a632d-dc9a-4655-8368-2d77f8db3b21';
const WORKER_HOST = 'line-harness.family8office.workers.dev';
const TARGET_VERSION = '0.19.0-5229.b1.9f3c6c3';
const TARGET_WORKER_HASH = 'sha256:6420c520444baa670973197f6c336b23a511e9dcd8fdbdf24082b61ce24c2b1e';
const ZERO_HASH = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
const MAX_JSON_BYTES = 262_144;
const ALLOWED_VERSION_DELTA_PATHS = [
  '$.id', '$.number', '$.metadata', '$.annotations', '$.resources.script.etag',
  '$.resources.script.last_deployed_from',
] as const;
const EXPECTED_BINDINGS = [
  ['ADMIN_ALLOW_CROSS_SITE', 'secret_text'], ['ADMIN_ORIGIN', 'secret_text'],
  ['ADMIN_PAGES_PROJECT', 'plain_text'], ['ADMIN_PUBLIC_URL', 'plain_text'],
  ['API_KEY', 'secret_text'], ['ASSETS', 'assets'], ['CF_ACCOUNT_ID', 'plain_text'],
  ['D1_DATABASE_ID', 'plain_text'], ['DB', 'd1'], ['IMAGES', 'r2_bucket'],
  ['LIFF_PAGES_PROJECT', 'plain_text'], ['LIFF_PUBLIC_URL', 'plain_text'],
  ['LIFF_URL', 'secret_text'], ['LINE_CHANNEL_ACCESS_TOKEN', 'secret_text'],
  ['LINE_CHANNEL_SECRET', 'secret_text'], ['LINE_LOGIN_CHANNEL_ID', 'secret_text'],
  ['MANIFEST_URL', 'plain_text'], ['WORKER_NAME', 'plain_text'],
  ['WORKER_PUBLIC_URL', 'plain_text'], ['WORKER_URL', 'secret_text'],
] as const;

type OutputIdentity = { dev: number; ino: number };
type RuntimeVersion = {
  version: string; worker_hash: string; admin_hash: string; liff_hash: string; released_at: string;
};
type ActiveDeployment = { deploymentId: string; versionId: string; percentage: number };
type LegacyProbe = { path: string; mimeType: string; byteSize: number };
type VersionSemantic = {
  versionId: string; etag: string; resourcesSha256: string; bindingsFullSha256: string;
  scriptRuntimeSha256: string; handlerTopologySha256: string; bindingCount: number;
  topLevelKeyNamesSha256: string;
};

export interface Dependencies {
  now: () => number;
  loadToken: () => string;
  loadLegacyProbe: () => LegacyProbe;
  validateLocalState: (approvedHead: string) => string;
  outputDir: string;
  cfRequest: (spec: ExactRequest, expiresAt: number) => Promise<HttpResponse>;
  workerRequest: (spec: ExactRequest, expiresAt: number) => Promise<HttpResponse>;
  getSnapshot: typeof getSnapshot;
}

export class VerifyStop extends Error {
  constructor(readonly code: string) { super(code); }
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function assertRealPath(path: string, kind: 'directory' | 'file', mode: number): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) ||
      (stat.mode & 0o777) !== mode) throw new VerifyStop(`${kind}_state`);
}

export function validateApprovalWindow(received: string, expires: string, now: number): void {
  if (received !== APPROVAL_RECEIVED || expires !== APPROVAL_EXPIRES) {
    throw new VerifyStop('approval_identity');
  }
  const start = Date.parse(received);
  const end = Date.parse(expires);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== 7_200_000) {
    throw new VerifyStop('approval_window');
  }
  if (now < start || now >= end) throw new VerifyStop('approval_inactive');
}

export function parseArgs(raw: string[]): {
  preflightOnly: boolean; received: string; expires: string; approvedHarnessHead: string;
} {
  if (raw.length === 3 && raw[0] === '--preflight-only' &&
      raw[1] === '--approved-harness-head' && raw[2]) {
    return { preflightOnly: true, received: '', expires: '', approvedHarnessHead: raw[2] };
  }
  if (raw.length === 6 && raw[0] === '--approval-received' && raw[2] === '--approval-expires' &&
      raw[4] === '--approved-harness-head' && raw[1] && raw[3] && raw[5]) {
    return { preflightOnly: false, received: raw[1], expires: raw[3], approvedHarnessHead: raw[5] };
  }
  throw new VerifyStop('arguments');
}

export function validateB1Receipt(bytes: Buffer, expectedSha256: string): void {
  if (sha256(bytes) !== expectedSha256) throw new VerifyStop('b1_receipt_sha256');
  let value: Record<string, unknown>;
  try { value = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>; } catch {
    throw new VerifyStop('b1_receipt_json');
  }
  const counts = value.request_counts as Record<string, unknown> | undefined;
  const mutation = value.mutation as Record<string, unknown> | undefined;
  const observed = value.observed_post_state as Record<string, unknown> | undefined;
  if (value.approval_id !== '5229-B1-R1-20260903' || value.status !== 'stopped' ||
      value.stop_reason !== 'settingsSha256_changed' || counts?.cloudflare_read !== 19 ||
      counts?.worker_content_put !== 1 || counts?.runtime_read !== 1 || counts?.provider_total !== 21 ||
      counts?.retry !== 0 || mutation?.stage !== 'post_write_readback' ||
      mutation?.outcome !== 'accepted' || mutation?.put_attempts !== 1 ||
      observed?.deployment_id !== NEW_DEPLOYMENT_ID || observed?.version_id !== NEW_VERSION_ID ||
      observed?.script_etag !== NEW_SCRIPT_ETAG || value.rollback_required !== true) {
    throw new VerifyStop('b1_receipt_state');
  }
}

export function validateLocalState(approvedHead: string): string {
  if (!/^[0-9a-f]{40}$/.test(approvedHead)) throw new VerifyStop('approved_head');
  const git = (worktree: string, args: string[]): string =>
    execFileSync('git', ['-C', worktree, ...args], { encoding: 'utf8' }).trim();
  for (const [worktree, expected] of [
    [WORKTREE, approvedHead], [BACKPORT_WORKTREE, BACKPORT_HEAD], [ACCOUNTING_WORKTREE, ACCOUNTING_HEAD],
  ] as const) {
    if (git(worktree, ['rev-parse', 'HEAD']) !== expected) throw new VerifyStop('head_drift');
    if (git(worktree, ['status', '--porcelain', '--untracked-files=all']) !== '') {
      throw new VerifyStop('worktree_dirty');
    }
  }
  for (const path of [EXECUTOR_FILE, TEST_FILE]) assertRealPath(path, 'file', 0o644);
  assertRealPath(B1_RECEIPT_DIR, 'directory', 0o700);
  if (canonical(readdirSync(B1_RECEIPT_DIR)) !== canonical(['sanitized-summary.json'])) {
    throw new VerifyStop('b1_receipt_entries');
  }
  assertRealPath(B1_RECEIPT_FILE, 'file', 0o600);
  validateB1Receipt(readFileSync(B1_RECEIPT_FILE), B1_RECEIPT_SHA256);
  return approvedHead;
}

function loadLegacyProbe(): LegacyProbe {
  const path = loadLegacyProbePath();
  const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8')) as { entries?: unknown[] };
  const first = manifest.entries?.[0] as { mime_type?: unknown; byte_size?: unknown } | undefined;
  if (!first || typeof first.mime_type !== 'string' ||
      !['image/jpeg', 'image/png', 'image/gif', 'image/webp'].includes(first.mime_type) ||
      typeof first.byte_size !== 'number' || !Number.isSafeInteger(first.byte_size) || first.byte_size <= 0) {
    throw new VerifyStop('manifest_probe_metadata');
  }
  return { path, mimeType: first.mime_type, byteSize: first.byte_size };
}

function contentType(response: HttpResponse): string {
  const value = response.headers['content-type'];
  return typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : '';
}

function parseEnvelope(response: HttpResponse, code: string): unknown {
  if (response.status !== 200 || response.body.length > MAX_JSON_BYTES ||
      contentType(response) !== 'application/json') throw new VerifyStop(`${code}_response`);
  const encoding = response.headers['content-encoding'];
  if (encoding !== undefined && encoding !== 'identity') throw new VerifyStop(`${code}_encoding`);
  let value: { success?: unknown; result?: unknown };
  try { value = JSON.parse(response.body.toString('utf8')) as typeof value; } catch {
    throw new VerifyStop(`${code}_json`);
  }
  if (value.success !== true || value.result === undefined) throw new VerifyStop(`${code}_shape`);
  return value.result;
}

export function parseActiveDeployment(response: HttpResponse): ActiveDeployment {
  const result = parseEnvelope(response, 'deployments') as { deployments?: unknown[] };
  if (!Array.isArray(result.deployments) || result.deployments.length < 1) {
    throw new VerifyStop('deployment_shape');
  }
  const first = result.deployments[0] as { id?: unknown; versions?: unknown[] };
  if (typeof first.id !== 'string' || !Array.isArray(first.versions) || first.versions.length !== 1) {
    throw new VerifyStop('deployment_shape');
  }
  const version = first.versions[0] as { version_id?: unknown; percentage?: unknown };
  if (typeof version.version_id !== 'string' || version.percentage !== 100) {
    throw new VerifyStop('deployment_shape');
  }
  return { deploymentId: first.id, versionId: version.version_id, percentage: 100 };
}

function sortedBindings(bindings: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(bindings)) throw new VerifyStop('version_bindings_shape');
  const rows = bindings.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new VerifyStop('version_bindings_shape');
    }
    const row = value as Record<string, unknown>;
    if (typeof row.name !== 'string' || typeof row.type !== 'string') {
      throw new VerifyStop('version_bindings_shape');
    }
    return structuredClone(row);
  }).sort((a, b) => String(a.name).localeCompare(String(b.name)) || String(a.type).localeCompare(String(b.type)));
  const shape = rows.map(({ name, type }) => [name, type]);
  if (canonical(shape) !== canonical(EXPECTED_BINDINGS)) throw new VerifyStop('version_binding_shape_drift');
  return rows;
}

export function parseVersionSemantic(
  response: HttpResponse, expectedVersionId: string, expectedEtag: string,
): VersionSemantic {
  const result = parseEnvelope(response, 'version') as Record<string, unknown>;
  if (result.id !== expectedVersionId || !result.resources || typeof result.resources !== 'object' ||
      Array.isArray(result.resources)) throw new VerifyStop('version_shape');
  const resources = structuredClone(result.resources as Record<string, unknown>);
  const bindings = sortedBindings(resources.bindings);
  const script = resources.script as Record<string, unknown> | undefined;
  if (!script || typeof script !== 'object' || Array.isArray(script) || script.etag !== expectedEtag) {
    throw new VerifyStop('version_script_shape');
  }
  const handlerTopology = { handlers: script.handlers ?? null, named_handlers: script.named_handlers ?? null };
  const comparableScript = structuredClone(script);
  delete comparableScript.etag;
  delete comparableScript.last_deployed_from;
  const comparableResources = { ...resources, bindings, script: comparableScript };
  const comparableVersion = structuredClone(result);
  delete comparableVersion.id;
  delete comparableVersion.number;
  delete comparableVersion.metadata;
  delete comparableVersion.annotations;
  comparableVersion.resources = comparableResources;
  return {
    versionId: expectedVersionId, etag: expectedEtag,
    resourcesSha256: sha256(canonical(comparableVersion)),
    bindingsFullSha256: sha256(canonical(bindings)),
    scriptRuntimeSha256: sha256(canonical(resources.script_runtime ?? null)),
    handlerTopologySha256: sha256(canonical(handlerTopology)),
    bindingCount: bindings.length,
    topLevelKeyNamesSha256: sha256(canonical(Object.keys(result).sort())),
  };
}

function validateCurrentSnapshot(snapshot: WorkerSnapshot): void {
  if (snapshot.deploymentId !== NEW_DEPLOYMENT_ID || snapshot.versionId !== NEW_VERSION_ID ||
      snapshot.scriptEtag !== NEW_SCRIPT_ETAG || snapshot.settingsSha256 === PREVIOUS_SETTINGS_SHA256 ||
      snapshot.subdomainSha256 !== SUBDOMAIN_SHA256 || snapshot.schedulesSha256 !== SCHEDULES_SHA256 ||
      sha256(canonical(snapshot.bindingShape)) !== BINDING_SHAPE_SHA256 ||
      snapshot.settingsAssetBindingDigest !== ASSET_SHA256 ||
      snapshot.versionAssetBindingDigest !== ASSET_SHA256 ||
      snapshot.assetResourceIdentityAvailable !== false ||
      snapshot.adminProjectNameSha256 !== ADMIN_NAME_SHA256 ||
      snapshot.adminDeploymentId !== ADMIN_DEPLOYMENT_ID) {
    throw new VerifyStop('current_config_anchor_drift');
  }
}

function parseRuntime(response: HttpResponse): RuntimeVersion | null {
  if (response.status !== 200 || response.body.length > 8_192 || contentType(response) !== 'application/json') {
    return null;
  }
  const encoding = response.headers['content-encoding'];
  if (encoding !== undefined && encoding !== 'identity') return null;
  let value: Record<string, unknown>;
  try { value = JSON.parse(response.body.toString('utf8')) as Record<string, unknown>; } catch { return null; }
  for (const key of ['version', 'worker_hash', 'admin_hash', 'liff_hash', 'released_at']) {
    if (typeof value[key] !== 'string') return null;
  }
  const result = value as unknown as RuntimeVersion;
  if (result.version !== TARGET_VERSION || result.worker_hash !== TARGET_WORKER_HASH ||
      result.admin_hash !== ZERO_HASH || result.liff_hash !== ZERO_HASH ||
      !Number.isFinite(Date.parse(result.released_at))) return null;
  return result;
}

function createOutput(path: string): OutputIdentity {
  if (existsSync(path)) throw new VerifyStop('output_exists');
  mkdirSync(path, { mode: 0o700 });
  assertRealPath(path, 'directory', 0o700);
  const stat = lstatSync(path);
  return { dev: stat.dev, ino: stat.ino };
}

function writeSummary(path: string, identity: OutputIdentity, summary: unknown): void {
  const stat = lstatSync(path);
  if (stat.dev !== identity.dev || stat.ino !== identity.ino || readdirSync(path).length !== 0) {
    throw new VerifyStop('output_drift');
  }
  const file = `${path}/sanitized-summary.json`;
  writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  assertRealPath(file, 'file', 0o600);
  const after = lstatSync(path);
  if (after.dev !== identity.dev || after.ino !== identity.ino ||
      canonical(readdirSync(path)) !== canonical(['sanitized-summary.json'])) {
    throw new VerifyStop('output_drift');
  }
}

function safeReason(error: unknown): string {
  if (error instanceof VerifyStop || error instanceof DeployStop) return error.code;
  return 'provider_or_local_error';
}

function dispositionFor(reason: string): 'external_drift' | 'inconclusive' {
  if (reason === 'external_deployment_drift') return 'external_drift';
  return 'inconclusive';
}

export async function run(raw: string[], deps: Dependencies): Promise<Record<string, unknown>> {
  const args = parseArgs(raw);
  const head = deps.validateLocalState(args.approvedHarnessHead);
  const legacy = deps.loadLegacyProbe();
  if (existsSync(deps.outputDir)) throw new VerifyStop('output_exists');
  if (!args.preflightOnly) validateApprovalWindow(args.received, args.expires, deps.now());
  const token = deps.loadToken();
  if (args.preflightOnly) return {
    approval_id: APPROVAL_ID, status: 'preflight_passed', planning_head: head,
    token_present: token.length > 0, legacy_probe_ready: true,
    provider_requests: 0, provider_writes: 0, local_writes: 0,
  };
  validateApprovalWindow(args.received, args.expires, deps.now());
  const identity = createOutput(deps.outputDir);
  const startedAt = new Date(deps.now()).toISOString();
  const expiresAt = Date.parse(args.expires);
  let cfReads = 0;
  let runtimeReads = 0;
  let runtimeVersionAttempts = 0;
  try {
    let capturedCurrentVersion: HttpResponse | null = null;
    const requestCf = async (spec: ExactRequest): Promise<HttpResponse> => {
      validateApprovalWindow(args.received, args.expires, deps.now());
      if (spec.method !== 'GET') throw new VerifyStop('request_scope');
      cfReads += 1;
      const response = await deps.cfRequest(spec, expiresAt);
      if (spec.path.endsWith(`/versions/${NEW_VERSION_ID}`)) {
        capturedCurrentVersion = { ...response, body: Buffer.from(response.body) };
      }
      validateApprovalWindow(args.received, args.expires, deps.now());
      return response;
    };
    const requestWorker = async (spec: ExactRequest): Promise<HttpResponse> => {
      validateApprovalWindow(args.received, args.expires, deps.now());
      if (spec.method !== 'GET' && spec.method !== 'HEAD') throw new VerifyStop('request_scope');
      runtimeReads += 1;
      const response = await deps.workerRequest(spec, expiresAt);
      validateApprovalWindow(args.received, args.expires, deps.now());
      return response;
    };
    const base = `/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}`;
    const auth = { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'identity' };
    const deploymentRequest = (): ExactRequest => ({
      hostname: 'api.cloudflare.com', method: 'GET', path: `${base}/deployments`,
      headers: auth, maxBytes: MAX_JSON_BYTES,
    });
    const current = await deps.getSnapshot(token, expiresAt, requestCf, ADMIN_NAME_SHA256);
    validateCurrentSnapshot(current.snapshot);
    if (!capturedCurrentVersion) throw new VerifyStop('current_version_not_captured');
    const oldVersion = parseVersionSemantic(await requestCf({
      hostname: 'api.cloudflare.com', method: 'GET', path: `${base}/versions/${OLD_VERSION_ID}`,
      headers: auth, maxBytes: MAX_JSON_BYTES,
    }), OLD_VERSION_ID, OLD_SCRIPT_ETAG);
    const newVersion = parseVersionSemantic(capturedCurrentVersion, NEW_VERSION_ID, NEW_SCRIPT_ETAG);
    if (oldVersion.resourcesSha256 !== newVersion.resourcesSha256 ||
        oldVersion.bindingsFullSha256 !== newVersion.bindingsFullSha256 ||
        oldVersion.scriptRuntimeSha256 !== newVersion.scriptRuntimeSha256 ||
        oldVersion.handlerTopologySha256 !== newVersion.handlerTopologySha256 ||
        oldVersion.bindingCount !== newVersion.bindingCount) {
      throw new VerifyStop('version_resources_changed');
    }
    const runtimeSpec: ExactRequest = {
      hostname: WORKER_HOST, method: 'GET', path: '/admin/version',
      headers: { 'Accept-Encoding': 'identity' }, maxBytes: 8_192,
    };
    runtimeVersionAttempts += 1;
    let runtime = parseRuntime(await requestWorker(runtimeSpec));
    if (!runtime) {
      runtimeVersionAttempts += 1;
      runtime = parseRuntime(await requestWorker(runtimeSpec));
    }
    if (!runtime) throw new VerifyStop('runtime_identity');
    const privateHead = await requestWorker({
      hostname: WORKER_HOST, method: 'HEAD',
      path: '/api/incoming-media/b1-probe-account/b1-probe-message',
      headers: { 'Accept-Encoding': 'identity' }, maxBytes: 1_024,
    });
    if (privateHead.status !== 401 || privateHead.body.length !== 0) throw new VerifyStop('private_probe');
    const legacyHead = await requestWorker({
      hostname: WORKER_HOST, method: 'HEAD', path: legacy.path,
      headers: { 'Accept-Encoding': 'identity' }, maxBytes: 1_024,
    });
    if (legacyHead.status !== 200 || legacyHead.body.length !== 0 ||
        contentType(legacyHead) !== legacy.mimeType) throw new VerifyStop('legacy_probe');
    const terminal = parseActiveDeployment(await requestCf(deploymentRequest()));
    const initial = { deploymentId: current.snapshot.deploymentId,
      versionId: current.snapshot.versionId, percentage: 100 };
    if (canonical(terminal) !== canonical(initial)) throw new VerifyStop('external_deployment_drift');
    if (cfReads !== 8 || runtimeReads < 3 || runtimeReads > 4) throw new VerifyStop('request_count');
    const summary = {
      schema_version: 1, approval_id: APPROVAL_ID,
      approval_received: args.received, approval_expires: args.expires,
      approved_harness_head: head, started_at: startedAt,
      completed_at: new Date(deps.now()).toISOString(), status: 'completed',
      prior_stop_receipt_sha256: B1_RECEIPT_SHA256,
      deployment: {
        prior_deployment_id: OLD_DEPLOYMENT_ID, prior_version_id: OLD_VERSION_ID,
        current_deployment_id: initial.deploymentId, current_version_id: initial.versionId,
        traffic_percentage: initial.percentage, terminal_active_unchanged: true,
      },
      settings_context: {
        pre_put_raw_settings_sha256: PREVIOUS_SETTINGS_SHA256,
        post_put_raw_settings_changed: true,
        current_raw_settings_sha256: current.snapshot.settingsSha256,
        classification: 'bounded_current_config_anchors_and_version_resources_equal',
      },
      version_semantics: {
        old_resources_sha256: oldVersion.resourcesSha256,
        new_resources_sha256: newVersion.resourcesSha256, resources_equal: true,
        old_bindings_full_sha256: oldVersion.bindingsFullSha256,
        new_bindings_full_sha256: newVersion.bindingsFullSha256, bindings_equal: true,
        script_runtime_sha256: newVersion.scriptRuntimeSha256,
        handler_topology_sha256: newVersion.handlerTopologySha256,
        binding_count: newVersion.bindingCount,
        old_script_etag: oldVersion.etag, new_script_etag: newVersion.etag,
        excluded_field_allowlist_sha256: sha256(canonical(ALLOWED_VERSION_DELTA_PATHS)),
        old_top_level_key_names_sha256: oldVersion.topLevelKeyNamesSha256,
        new_top_level_key_names_sha256: newVersion.topLevelKeyNamesSha256,
      },
      runtime: {
        version: runtime.version, worker_hash: runtime.worker_hash,
        admin_hash: runtime.admin_hash, liff_hash: runtime.liff_hash,
        version_attempts: runtimeVersionAttempts,
        private_unauthenticated_head: 401, private_empty_body: true,
        legacy_public_head: 200, legacy_empty_body: true,
        legacy_mime_sha256: sha256(legacy.mimeType), legacy_byte_size: legacy.byteSize,
      },
      request_counts: {
        cloudflare_get: cfReads, runtime_read: runtimeReads,
        provider_total: cfReads + runtimeReads, provider_write: 0,
        transport_retry: 0, redirect: 0, local_file_write: 1,
      },
      disposition: 'accept_candidate_no_rollback', automatic_rollback: 0,
    };
    writeSummary(deps.outputDir, identity, summary);
    return summary;
  } catch (error) {
    const reason = safeReason(error);
    if (readdirSync(deps.outputDir).length === 0) writeSummary(deps.outputDir, identity, {
      schema_version: 1, approval_id: APPROVAL_ID, approval_received: args.received,
      approval_expires: args.expires, approved_harness_head: head, started_at: startedAt,
      completed_at: new Date(deps.now()).toISOString(), status: 'stopped', stop_reason: reason,
      request_counts: { cloudflare_get: cfReads, runtime_read: runtimeReads,
        provider_total: cfReads + runtimeReads, provider_write: 0, transport_retry: 0, redirect: 0,
        local_file_write: 1 },
      disposition: dispositionFor(reason), automatic_rollback: 0,
    });
    throw new VerifyStop(reason);
  }
}

const defaultDeps: Dependencies = {
  now: () => Date.now(), loadToken, loadLegacyProbe, validateLocalState, outputDir: OUTPUT_DIR,
  cfRequest: (spec, expiresAt) => exactHttpsRequest(spec, expiresAt),
  workerRequest: (spec, expiresAt) => exactHttpsRequest(spec, expiresAt),
  getSnapshot,
};

const isCliEntry = (() => {
  if (!argv[1]) return false;
  try { return fileURLToPath(import.meta.url) === argv[1]; } catch { return false; }
})();

if (isCliEntry) {
  run(argv.slice(2), defaultDeps).then((result) => stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error: unknown) => {
      stdout.write(`${JSON.stringify({ approval_id: APPROVAL_ID, status: 'stopped',
        stop_reason: safeReason(error), retry: 0, provider_writes: 0 })}\n`);
      exit(1);
    });
}
