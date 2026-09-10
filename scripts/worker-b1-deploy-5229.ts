#!/usr/bin/env tsx
/** Exact, approval-bound Worker code-only deploy executor for #5229 Packet B1-R1. */

import { createHash } from 'node:crypto';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request, type RequestOptions } from 'node:https';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { argv, exit, stdout } from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const APPROVAL_ID = '5229-B1-R1-20260903';
const ACCOUNT_ID = '67907592fdf596376bc2097e14a6563a';
const SCRIPT_NAME = 'line-harness';
const DATABASE_ID = 'c19584d7-e9f1-4d46-83c5-6c0ba96561d1';
const WORKER_HOST = 'line-harness.family8office.workers.dev';
const TOKEN_FILE = '/Users/kensmba/.line-harness/.env.local';
const ARTIFACT_DIR = '/Users/kensmba/.line-harness-5229-B1-R1-BUILD-20260903';
const ARTIFACT_FILE = `${ARTIFACT_DIR}/apps/worker/dist-release-final/index.js`;
const ARTIFACT_SHA256 = '07dcc5ef5504bf2ae70286fad2d356444beb7626f6d64faa920ea7b3c33b19c1';
const ARTIFACT_BYTES = 1_350_194;
const MANIFEST_DIR = '/Users/kensmba/.line-harness-5229-M0-20260901';
const MANIFEST_FILE = `${MANIFEST_DIR}/incoming-media-backfill-manifest.json`;
const MANIFEST_SHA256 = 'cf35a1045040a265019a5afad8c2cefb8994edba684eeaa5dd2fad0b17b1663e';
const OUTPUT_DIR = '/Users/kensmba/.line-harness-5229-B1-R1-20260903';
const PLANNING_WORKTREE = '/Users/kensmba/.line-harness-wt/5229-private-incoming-media';
const BACKPORT_WORKTREE = '/Users/kensmba/.line-harness-wt/5229-b1-v019-backport';
const ACCOUNTING_WORKTREE = '/Users/kensmba/scripts-wt/5230-line-recovery';
const BACKPORT_HEAD = '9f3c6c3ac98d0777f8e7354f807a6af4ab642b18';
const ACCOUNTING_HEAD = 'ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f';
const EXECUTOR_FILE = `${PLANNING_WORKTREE}/scripts/worker-b1-deploy-5229.ts`;
const EXECUTOR_TEST_FILE = `${PLANNING_WORKTREE}/scripts/worker-b1-deploy-5229.test.ts`;
const EXECUTOR_TEST_SHA256 = '24ac11b6129b092a0652c75d009fbe63558c1eb55650badf7146b5f585b761f1';
const ARTIFACT_BUILDER_FILE = `${PLANNING_WORKTREE}/scripts/worker-b1-r1-artifact-5229.ts`;
const ARTIFACT_BUILDER_SHA256 = 'c5d5f9dba49f8b03afeea1f6b43d07a8d26da22615c7d5e37c6b60187139fa2b';
const ARTIFACT_BUILDER_TEST_FILE = `${PLANNING_WORKTREE}/scripts/worker-b1-r1-artifact-5229.test.ts`;
const ARTIFACT_BUILDER_TEST_SHA256 = 'fe2e3a658105cedcdc499aaac1940dbdbe459fc5c9b48b003bb1feefe5853cfd';
const B2_DIR = '/Users/kensmba/.line-harness-5229-B2-20260901';
const B2_RECEIPT = `${B2_DIR}/sanitized-summary.json`;
const B2_RECEIPT_SHA256 = '5f393930c545582d656c0068ee1d854a01ef8d60e66e1d04e4dca49a0beda95f';
const D1_DIR = '/Users/kensmba/.line-harness-5229-B1-D1-20260903';
const D1_RECEIPT = `${D1_DIR}/sanitized-summary.json`;
const D1_RECEIPT_SHA256 = 'c2e294eae170d8a3f3b1592a43232b0c1ce2538f605464e7da3d057d44bebbd2';
const D2_R1_DIR = '/Users/kensmba/.line-harness-5229-B1-D2-R1-20260903';
const D2_R1_RECEIPT = `${D2_R1_DIR}/sanitized-summary.json`;
const D2_R1_RECEIPT_SHA256 = 'f3ca1426f0c3ca19175699bf1af685b4b315e1a4eb29d04c296ed2e791bbb5c2';
const PREVIOUS_DEPLOYMENT_ID = '7b3bb319-e618-4f57-a520-cd33f43115e5';
const PREVIOUS_VERSION_ID = 'c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7';
const TARGET_VERSION = '0.19.0-5229.b1.9f3c6c3';
const TARGET_WORKER_HASH = 'sha256:6420c520444baa670973197f6c336b23a511e9dcd8fdbdf24082b61ce24c2b1e';
const LEGACY_UNKNOWN_HASH = 'sha256:0000000000000000000000000000000000000000000000000000000000000000';
const LEGACY_VERSION = '0.0.0-dev';
const LEGACY_RELEASED_AT = '1970-01-01T00:00:00Z';
const ADMIN_HASH = LEGACY_UNKNOWN_HASH;
const LIFF_HASH = LEGACY_UNKNOWN_HASH;
const PREVIOUS_SCRIPT_ETAG = '1d9a88703ce2509f372740c140aa18699884b779a82108efdd863484555611b6';
const ASSET_BINDING_DIGEST = '8fcf498813511a591cb5d595bc281fee2d45f7a27a87f124257a319b543d04c6';
const ADMIN_PROJECT_NAME_SHA256 = '492123998ae432be97e93235fce10a2d5d118fd9eb8be802edd46ae8345ca9a2';
const ADMIN_DEPLOYMENT_ID = '301a632d-dc9a-4655-8368-2d77f8db3b21';
const MAX_JSON_BYTES = 262_144;
const MULTIPART_BOUNDARY = '----line-harness-5229-b1-code-only';
const EXPECTED_SUBDOMAIN = { enabled: true, previews_enabled: true } as const;
const EXPECTED_SCHEDULE_CRONS = ['* * * * *', '0 */6 * * *'] as const;
const EXPECTED_SETTINGS_SHA256 = '107835eb17613fa3789f34a913ced66be79b9dc48fa8666276bf2feed9a51abc';
const EXPECTED_SUBDOMAIN_SHA256 = '81d85b2e35295c30a89a15cfce655824db618966f23be5b068d6f55c545429f3';
const EXPECTED_SCHEDULES_SHA256 = 'ba94fb8a9b24fb239e7de571c5b281dd302cc139821d28fa7f12721ef2cd1849';
const EXPECTED_BINDING_SHAPE_SHA256 = 'cdc3ac05d11170d7d795274d4a873576358eeaf86737e0b78931c81b59dc19a4';

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

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}
export interface ExactRequest {
  hostname: string;
  method: 'GET' | 'HEAD' | 'POST' | 'PUT';
  path: string;
  headers: Record<string, string | number>;
  body?: Buffer;
  maxBytes: number;
}
export type RequestFunction = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

export interface RunDependencies {
  now: () => number;
  loadArtifact: () => Buffer;
  loadLegacyProbePath: () => string;
  loadToken: () => string;
  validateLocalAnchors: (approvedHarnessHead: string | null) => string;
  outputDir: string;
  cfRequest: (request: ExactRequest, expiresAt: number) => Promise<HttpResponse>;
  workerRequest: (request: ExactRequest, expiresAt: number) => Promise<HttpResponse>;
  sleep: (milliseconds: number) => Promise<void>;
  expectedAdminProjectNameSha256: string;
  expectedSettingsSha256: string;
  expectedSubdomainSha256: string;
  expectedSchedulesSha256: string;
  expectedBindingShapeSha256: string;
}

export interface WorkerSnapshot {
  deploymentId: string;
  versionId: string;
  settings: unknown;
  settingsSha256: string;
  subdomain: unknown;
  subdomainSha256: string;
  schedules: unknown;
  schedulesSha256: string;
  bindingShape: Array<{ name: string; type: string }>;
  scriptEtag: string;
  versionAssetBindingDigest: string;
  assetResourceIdentityAvailable: boolean;
  settingsAssetBindingDigest: string;
  adminProjectNameSha256: string;
  adminDeploymentId: string;
}

interface VersionReadback {
  version: string;
  worker_hash: string;
  admin_hash: string;
  liff_hash: string;
  released_at: string;
}

export class DeployStop extends Error {
  constructor(readonly code: string) { super(code); }
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function assertRealPath(path: string, kind: 'directory' | 'file', mode: number): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new DeployStop(`${kind}_symlink`);
  if (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) throw new DeployStop(`${kind}_type`);
  if ((stat.mode & 0o777) !== mode) throw new DeployStop(`${kind}_mode`);
}

export function validateArtifact(bytes: Buffer): Buffer {
  if (bytes.length !== ARTIFACT_BYTES || sha256(bytes) !== ARTIFACT_SHA256) {
    throw new DeployStop('artifact_hash');
  }
  for (const marker of [TARGET_VERSION, TARGET_WORKER_HASH.slice(7), ADMIN_HASH.slice(7)]) {
    if (!bytes.includes(Buffer.from(marker, 'utf8'))) throw new DeployStop('artifact_marker');
  }
  if (bytes.toString('utf8').split(LEGACY_UNKNOWN_HASH).length - 1 !== 2) {
    throw new DeployStop('artifact_legacy_unknown_count');
  }
  if (bytes.includes(Buffer.from(MULTIPART_BOUNDARY, 'utf8'))) throw new DeployStop('multipart_boundary_collision');
  return bytes;
}

export function loadArtifact(): Buffer {
  assertRealPath(ARTIFACT_DIR, 'directory', 0o700);
  for (const path of [`${ARTIFACT_DIR}/apps`, `${ARTIFACT_DIR}/apps/worker`,
    `${ARTIFACT_DIR}/apps/worker/dist-release-final`]) assertRealPath(path, 'directory', 0o700);
  assertRealPath(ARTIFACT_FILE, 'file', 0o600);
  return validateArtifact(readFileSync(ARTIFACT_FILE));
}

export function loadLegacyProbePath(): string {
  assertRealPath(MANIFEST_DIR, 'directory', 0o700);
  if (stable(readdirSync(MANIFEST_DIR).sort()) !== stable(['incoming-media-backfill-manifest.json'])) {
    throw new DeployStop('manifest_entries');
  }
  assertRealPath(MANIFEST_FILE, 'file', 0o600);
  const bytes = readFileSync(MANIFEST_FILE);
  if (sha256(bytes) !== MANIFEST_SHA256) throw new DeployStop('manifest_hash');
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString('utf8')); } catch { throw new DeployStop('manifest_json'); }
  const manifest = parsed as { verified?: unknown; entries?: unknown[] };
  if (manifest.verified !== true || !Array.isArray(manifest.entries) || manifest.entries.length !== 77) {
    throw new DeployStop('manifest_shape');
  }
  const first = manifest.entries[0] as { r2_key?: unknown } | undefined;
  if (!first || typeof first.r2_key !== 'string' ||
      !/^incoming-[A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.(?:jpe?g|png|gif|webp)$/i.test(first.r2_key)) {
    throw new DeployStop('manifest_probe');
  }
  return `/images/${encodeURIComponent(first.r2_key)}`;
}

export function parseTokenFile(text: string): string {
  const values: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^CLOUDFLARE_API_TOKEN=(.*)$/.exec(line);
    if (!match) {
      if (line.startsWith('CLOUDFLARE_API_TOKEN')) throw new DeployStop('token_format');
      continue;
    }
    let value = match[1];
    if (value.startsWith("'") || value.endsWith("'") || value.startsWith('"') || value.endsWith('"')) {
      if (!((value.startsWith("'") && value.endsWith("'")) ||
            (value.startsWith('"') && value.endsWith('"')))) throw new DeployStop('token_format');
      value = value.slice(1, -1);
    }
    if (!value || /[\r\n\0]/.test(value)) throw new DeployStop('token_format');
    values.push(value);
  }
  if (values.length !== 1) throw new DeployStop('token_count');
  return values[0];
}

export function loadToken(): string {
  assertRealPath(TOKEN_FILE, 'file', 0o600);
  return parseTokenFile(readFileSync(TOKEN_FILE, 'utf8'));
}

function gitValue(worktree: string, args: string[]): string {
  try {
    return execFileSync('git', ['-C', worktree, ...args], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    throw new DeployStop('git_anchor');
  }
}

export function validateD1Receipt(d1: unknown): void {
  const value = d1 as Record<string, unknown>;
  const worker = value.worker_resource as Record<string, unknown> | undefined;
  const topology = value.topology as Record<string, unknown> | undefined;
  const admin = topology?.admin_pages as Record<string, unknown> | undefined;
  const counts = value.request_counts as Record<string, unknown> | undefined;
  if (value.status !== 'completed' || value.active_deployment_id !== PREVIOUS_DEPLOYMENT_ID ||
      value.active_version_id !== PREVIOUS_VERSION_ID || value.stable_active_snapshot !== true ||
      value.legacy_build_identity !== 'unstamped_unknown' || worker?.worker_script_etag !== PREVIOUS_SCRIPT_ETAG ||
      worker?.version_asset_binding_digest !== ASSET_BINDING_DIGEST ||
      worker?.asset_resource_identity_available !== false || topology?.liff_topology !== 'worker_assets' ||
      topology?.settings_asset_binding_digest !== ASSET_BINDING_DIGEST || topology?.liff_pages !== null ||
      admin?.project_name_sha256 !== ADMIN_PROJECT_NAME_SHA256 ||
      admin?.canonical_deployment_id !== ADMIN_DEPLOYMENT_ID ||
      stable(counts) !== stable({ cloudflare_get: 5, provider_total: 5, retry: 0, writes: 0 })) {
    throw new DeployStop('d1_receipt_shape');
  }
}

export function validateD2R1Receipt(receipt: unknown): void {
  const value = receipt as Record<string, unknown>;
  const counts = value.request_counts as Record<string, unknown> | undefined;
  if (value.approval_id !== '5229-B1-D2-R1-20260903' || value.status !== 'completed' ||
      value.stable_snapshot_count !== 2 || value.active_deployment_id !== PREVIOUS_DEPLOYMENT_ID ||
      value.active_version_id !== PREVIOUS_VERSION_ID || value.worker_script_etag !== PREVIOUS_SCRIPT_ETAG ||
      value.settings_sha256 !== EXPECTED_SETTINGS_SHA256 ||
      value.subdomain_sha256 !== EXPECTED_SUBDOMAIN_SHA256 ||
      value.schedules_sha256 !== EXPECTED_SCHEDULES_SHA256 ||
      value.binding_shape_sha256 !== EXPECTED_BINDING_SHAPE_SHA256 || value.binding_count !== 20 ||
      value.settings_asset_binding_sha256 !== ASSET_BINDING_DIGEST ||
      value.version_asset_binding_sha256 !== ASSET_BINDING_DIGEST ||
      value.admin_project_name_sha256 !== ADMIN_PROJECT_NAME_SHA256 ||
      value.admin_deployment_id !== ADMIN_DEPLOYMENT_ID || value.asset_resource_identity_count !== 0 ||
      stable(counts) !== stable({
        cloudflare_get: 12, provider_total: 12, retry: 0, redirect: 0,
        provider_write: 0, local_file_write: 1,
      })) {
    throw new DeployStop('d2_r1_receipt_shape');
  }
}

export function validateLocalAnchors(approvedHarnessHead: string | null): string {
  const planningHead = gitValue(PLANNING_WORKTREE, ['rev-parse', 'HEAD']);
  const backportHead = gitValue(BACKPORT_WORKTREE, ['rev-parse', 'HEAD']);
  const accountingHead = gitValue(ACCOUNTING_WORKTREE, ['rev-parse', 'HEAD']);
  if (approvedHarnessHead !== null && !/^[0-9a-f]{40}$/.test(approvedHarnessHead)) {
    throw new DeployStop('approved_head_format');
  }
  if (approvedHarnessHead !== null && planningHead !== approvedHarnessHead) {
    throw new DeployStop('planning_head_drift');
  }
  if (backportHead !== BACKPORT_HEAD) throw new DeployStop('backport_head_drift');
  if (accountingHead !== ACCOUNTING_HEAD) throw new DeployStop('accounting_head_drift');
  for (const [label, worktree] of [
    ['planning', PLANNING_WORKTREE], ['backport', BACKPORT_WORKTREE],
    ['accounting', ACCOUNTING_WORKTREE],
  ] as const) {
    if (gitValue(worktree, ['status', '--porcelain=v1', '--untracked-files=all']) !== '') {
      throw new DeployStop(`${label}_worktree_dirty`);
    }
  }
  assertRealPath(EXECUTOR_FILE, 'file', 0o644);
  assertRealPath(EXECUTOR_TEST_FILE, 'file', 0o644);
  if (sha256(readFileSync(EXECUTOR_TEST_FILE)) !== EXECUTOR_TEST_SHA256) {
    throw new DeployStop('executor_test_hash');
  }
  for (const [path, expected] of [
    [ARTIFACT_BUILDER_FILE, ARTIFACT_BUILDER_SHA256],
    [ARTIFACT_BUILDER_TEST_FILE, ARTIFACT_BUILDER_TEST_SHA256],
  ] as const) {
    assertRealPath(path, 'file', 0o644);
    if (sha256(readFileSync(path)) !== expected) throw new DeployStop('artifact_builder_hash');
  }
  assertRealPath(B2_DIR, 'directory', 0o700);
  if (stable(readdirSync(B2_DIR).sort()) !== stable(['sanitized-summary.json'])) {
    throw new DeployStop('b2_receipt_entries');
  }
  assertRealPath(B2_RECEIPT, 'file', 0o600);
  if (sha256(readFileSync(B2_RECEIPT)) !== B2_RECEIPT_SHA256) throw new DeployStop('b2_receipt_hash');
  assertRealPath(D1_DIR, 'directory', 0o700);
  if (stable(readdirSync(D1_DIR).sort()) !== stable(['sanitized-summary.json'])) {
    throw new DeployStop('d1_receipt_entries');
  }
  assertRealPath(D1_RECEIPT, 'file', 0o600);
  const d1Bytes = readFileSync(D1_RECEIPT);
  if (sha256(d1Bytes) !== D1_RECEIPT_SHA256) throw new DeployStop('d1_receipt_hash');
  let d1: unknown;
  try { d1 = JSON.parse(d1Bytes.toString('utf8')); } catch { throw new DeployStop('d1_receipt_json'); }
  validateD1Receipt(d1);
  assertRealPath(D2_R1_DIR, 'directory', 0o700);
  if (stable(readdirSync(D2_R1_DIR).sort()) !== stable(['sanitized-summary.json'])) {
    throw new DeployStop('d2_r1_receipt_entries');
  }
  assertRealPath(D2_R1_RECEIPT, 'file', 0o600);
  const d2R1Bytes = readFileSync(D2_R1_RECEIPT);
  if (sha256(d2R1Bytes) !== D2_R1_RECEIPT_SHA256) throw new DeployStop('d2_r1_receipt_hash');
  let d2R1: unknown;
  try { d2R1 = JSON.parse(d2R1Bytes.toString('utf8')); } catch {
    throw new DeployStop('d2_r1_receipt_json');
  }
  validateD2R1Receipt(d2R1);
  return planningHead;
}

export function validateApprovalWindow(received: string, expires: string, now: number): void {
  const start = Date.parse(received);
  const end = Date.parse(expires);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== 7_200_000) {
    throw new DeployStop('approval_window');
  }
  if (now < start || now >= end) throw new DeployStop('approval_inactive');
}

export async function exactHttpsRequest(
  spec: ExactRequest,
  expiresAt: number,
  requestImpl: RequestFunction = request,
  now: () => number = Date.now,
): Promise<HttpResponse> {
  return await new Promise<HttpResponse>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (fn: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      fn();
    };
    if (now() >= expiresAt) {
      reject(new DeployStop('approval_expired'));
      return;
    }
    const req = requestImpl({
      protocol: 'https:', hostname: spec.hostname, port: 443, method: spec.method,
      path: spec.path, headers: spec.headers, agent: false,
    }, (res) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      let stopped = false;
      res.once('error', (error) => { stopped = true; finish(() => reject(error)); });
      res.once('aborted', () => { stopped = true; finish(() => reject(new DeployStop('response_aborted'))); });
      res.on('readable', () => {
        if (stopped) return;
        let chunk: Buffer | null;
        while ((chunk = res.read(Math.min(16_384, spec.maxBytes - bytes + 1)) as Buffer | null) !== null) {
          bytes += chunk.length;
          if (bytes > spec.maxBytes) {
            stopped = true;
            req.destroy(new DeployStop('response_oversize'));
            return;
          }
          chunks.push(chunk);
        }
      });
      res.on('end', () => {
        if (stopped) return;
        if (now() >= expiresAt) {
          finish(() => reject(new DeployStop('approval_expired')));
          return;
        }
        finish(() => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      });
    });
    req.once('error', (error) => finish(() => reject(error)));
    const remaining = expiresAt - now();
    if (remaining <= 0) {
      req.destroy(new DeployStop('approval_expired'));
      return;
    }
    timer = setTimeout(() => req.destroy(new DeployStop('approval_expired')), remaining);
    req.end(spec.body);
  });
}

function contentType(response: HttpResponse): string {
  const value = response.headers['content-type'];
  return typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : '';
}

function parseJson(response: HttpResponse, code: string, expectedStatus = 200): unknown {
  if (response.status !== expectedStatus) throw new DeployStop(`${code}_status`);
  if (contentType(response) !== 'application/json') throw new DeployStop(`${code}_content_type`);
  const encoding = response.headers['content-encoding'];
  if (encoding !== undefined && encoding !== 'identity') throw new DeployStop(`${code}_content_encoding`);
  try { return JSON.parse(response.body.toString('utf8')); } catch { throw new DeployStop(`${code}_json`); }
}

function parseEnvelope(response: HttpResponse, code: string): { result: unknown; cfRay: string | null } {
  const body = parseJson(response, code) as { success?: unknown; result?: unknown };
  if (body.success !== true || body.result === undefined) throw new DeployStop(`${code}_shape`);
  const ray = response.headers['cf-ray'];
  return { result: body.result, cfRay: typeof ray === 'string' ? ray : null };
}

function activeDeployment(result: unknown): { deploymentId: string; versionId: string } {
  const deployments = (result as { deployments?: unknown[] } | null)?.deployments;
  if (!Array.isArray(deployments) || deployments.length < 1) throw new DeployStop('deployment_shape');
  const first = deployments[0] as { id?: unknown; versions?: unknown[] };
  if (typeof first.id !== 'string' || !Array.isArray(first.versions) || first.versions.length !== 1) {
    throw new DeployStop('deployment_shape');
  }
  const active = first.versions[0] as { version_id?: unknown; percentage?: unknown };
  if (typeof active.version_id !== 'string' || active.percentage !== 100) throw new DeployStop('deployment_shape');
  return { deploymentId: first.id, versionId: active.version_id };
}

function bindingShape(settings: unknown): Array<{ name: string; type: string }> {
  const bindings = (settings as { bindings?: unknown[] } | null)?.bindings;
  if (!Array.isArray(bindings)) throw new DeployStop('settings_bindings');
  const shape = bindings.map((binding) => {
    const row = binding as { name?: unknown; type?: unknown };
    if (typeof row.name !== 'string' || typeof row.type !== 'string') throw new DeployStop('settings_bindings');
    return { name: row.name, type: row.type };
  }).sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
  const expected = EXPECTED_BINDINGS.map(([name, type]) => ({ name, type }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type));
  if (stable(shape) !== stable(expected)) throw new DeployStop('binding_shape_drift');
  if (shape.some((row) => row.name === 'INCOMING_MEDIA_PUBLIC_BLOCK_ENABLED')) {
    throw new DeployStop('public_block_gate_drift');
  }
  const object = settings as { compatibility_date?: unknown; compatibility_flags?: unknown };
  if (object.compatibility_date !== '2024-12-01' ||
      stable(object.compatibility_flags) !== stable(['nodejs_compat'])) {
    throw new DeployStop('compatibility_drift');
  }
  return shape;
}

function assetTopology(settings: unknown, expectedAdminProjectNameSha256: string): {
  adminProject: string;
  settingsAssetBindingDigest: string;
} {
  const bindings = (settings as { bindings?: unknown[] } | null)?.bindings;
  if (!Array.isArray(bindings)) throw new DeployStop('settings_topology');
  const exact = (name: string): Record<string, unknown> => {
    const matches = bindings.filter((binding) => (binding as { name?: unknown }).name === name);
    if (matches.length !== 1) throw new DeployStop('settings_topology');
    return matches[0] as Record<string, unknown>;
  };
  const admin = exact('ADMIN_PAGES_PROJECT');
  const liff = exact('LIFF_PAGES_PROJECT');
  const assets = exact('ASSETS');
  if (admin.type !== 'plain_text' || typeof admin.text !== 'string' ||
      !/^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/.test(admin.text) ||
      liff.type !== 'plain_text' || liff.text !== '' || assets.type !== 'assets') {
    throw new DeployStop('settings_topology');
  }
  const digest = sha256(stable(assets));
  if (sha256(admin.text) !== expectedAdminProjectNameSha256 || digest !== ASSET_BINDING_DIGEST) {
    throw new DeployStop('settings_asset_drift');
  }
  return { adminProject: admin.text, settingsAssetBindingDigest: digest };
}

function versionResource(result: unknown, expectedVersionId: string): {
  scriptEtag: string;
  versionAssetBindingDigest: string;
  assetResourceIdentityAvailable: boolean;
} {
  const value = result as {
    id?: unknown;
    resources?: { script?: { etag?: unknown }; bindings?: unknown };
  };
  if (value.id !== expectedVersionId || typeof value.resources?.script?.etag !== 'string' ||
      !/^[0-9a-f]{64}$/.test(value.resources.script.etag) || !Array.isArray(value.resources.bindings)) {
    throw new DeployStop('version_resource_shape');
  }
  const assets = (value.resources.bindings as Array<Record<string, unknown>>)
    .filter((binding) => binding.name === 'ASSETS' && binding.type === 'assets');
  if (assets.length !== 1) throw new DeployStop('version_asset_binding');
  const digest = sha256(stable(assets[0]));
  const identityAvailable = Object.keys(assets[0]).some((key) => !['name', 'type'].includes(key));
  if (digest !== ASSET_BINDING_DIGEST || identityAvailable) throw new DeployStop('version_asset_drift');
  return {
    scriptEtag: value.resources.script.etag,
    versionAssetBindingDigest: digest,
    assetResourceIdentityAvailable: identityAvailable,
  };
}

function adminProject(result: unknown, expectedProject: string, expectedAdminProjectNameSha256: string): {
  adminProjectNameSha256: string;
  adminDeploymentId: string;
} {
  const value = result as { name?: unknown; canonical_deployment?: { id?: unknown } };
  if (value.name !== expectedProject || typeof value.canonical_deployment?.id !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(value.canonical_deployment.id) ||
      sha256(expectedProject) !== expectedAdminProjectNameSha256 ||
      value.canonical_deployment.id !== ADMIN_DEPLOYMENT_ID) throw new DeployStop('admin_pages_drift');
  return { adminProjectNameSha256: sha256(expectedProject), adminDeploymentId: value.canonical_deployment.id };
}

function validateSubdomain(result: unknown): void {
  if (stable(result) !== stable(EXPECTED_SUBDOMAIN)) throw new DeployStop('subdomain_drift');
}

function validateSchedules(result: unknown): void {
  const value = result as { schedules?: unknown } | null;
  if (!value || stable(Object.keys(value).sort()) !== stable(['schedules']) || !Array.isArray(value.schedules)) {
    throw new DeployStop('schedules_drift');
  }
  const crons = value.schedules.map((raw) => {
    const row = raw as Record<string, unknown>;
    if (!row || typeof row !== 'object' || typeof row.cron !== 'string' ||
        Object.keys(row).some((key) => !['cron', 'created_on', 'modified_on'].includes(key)) ||
        (row.created_on !== undefined && (typeof row.created_on !== 'string' || !Number.isFinite(Date.parse(row.created_on)))) ||
        (row.modified_on !== undefined && (typeof row.modified_on !== 'string' || !Number.isFinite(Date.parse(row.modified_on))))) {
      throw new DeployStop('schedules_drift');
    }
    return row.cron;
  }).sort();
  if (stable(crons) !== stable([...EXPECTED_SCHEDULE_CRONS].sort())) throw new DeployStop('schedules_drift');
}

function versionReadback(response: HttpResponse): VersionReadback {
  const parsed = parseJson(response, 'admin_version') as Record<string, unknown>;
  for (const key of ['version', 'worker_hash', 'admin_hash', 'liff_hash', 'released_at']) {
    if (typeof parsed[key] !== 'string') throw new DeployStop('admin_version_shape');
  }
  return parsed as unknown as VersionReadback;
}

export function buildContentUpload(artifact: Buffer): Buffer {
  validateArtifact(artifact);
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
  const after = Buffer.from(`\r\n--${MULTIPART_BOUNDARY}--\r\n`, 'utf8');
  return Buffer.concat([before, artifact, after]);
}

function createOutput(path: string): { dev: number; ino: number } {
  if (existsSync(path)) throw new DeployStop('output_exists');
  mkdirSync(path, { mode: 0o700 });
  assertRealPath(path, 'directory', 0o700);
  const stat = lstatSync(path);
  if (readdirSync(path).length !== 0) throw new DeployStop('output_entries');
  return { dev: stat.dev, ino: stat.ino };
}

function assertPinnedOutput(path: string, identity: { dev: number; ino: number }, names: string[]): void {
  assertRealPath(path, 'directory', 0o700);
  const stat = lstatSync(path);
  if (stat.dev !== identity.dev || stat.ino !== identity.ino ||
      stable(readdirSync(path).sort()) !== stable([...names].sort())) throw new DeployStop('output_drift');
}

function writeSummary(path: string, identity: { dev: number; ino: number }, summary: unknown): void {
  assertPinnedOutput(path, identity, []);
  const target = `${path}/sanitized-summary.json`;
  writeFileSync(target, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  assertRealPath(target, 'file', 0o600);
  assertPinnedOutput(path, identity, ['sanitized-summary.json']);
}

export function parseArgs(raw: string[]): {
  preflightOnly: boolean; received: string; expires: string; approvedHarnessHead: string | null;
} {
  if (raw.length === 3 && raw[0] === '--preflight-only' && raw[1] === '--approved-harness-head') {
    return { preflightOnly: true, received: '', expires: '', approvedHarnessHead: raw[2] };
  }
  if (raw.length === 6 && raw[0] === '--approval-received' && raw[2] === '--approval-expires' &&
      raw[4] === '--approved-harness-head') {
    return { preflightOnly: false, received: raw[1], expires: raw[3], approvedHarnessHead: raw[5] };
  }
  throw new DeployStop('arguments');
}

export async function getSnapshot(
  token: string,
  expiresAt: number,
  requestCf: (spec: ExactRequest) => Promise<HttpResponse>,
  expectedAdminProjectNameSha256: string,
): Promise<{ snapshot: WorkerSnapshot; cfRays: Array<string | null> }> {
  const base = `/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}`;
  const auth = { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'identity' };
  const deploymentResponse = parseEnvelope(await requestCf({ hostname: 'api.cloudflare.com', method: 'GET', path: `${base}/deployments`, headers: auth, maxBytes: MAX_JSON_BYTES }), 'deployments');
  const active = activeDeployment(deploymentResponse.result);
  const settingsResponse = parseEnvelope(await requestCf({ hostname: 'api.cloudflare.com', method: 'GET', path: `${base}/settings`, headers: auth, maxBytes: MAX_JSON_BYTES }), 'settings');
  const shape = bindingShape(settingsResponse.result);
  const topology = assetTopology(settingsResponse.result, expectedAdminProjectNameSha256);
  const versionResponse = parseEnvelope(await requestCf({ hostname: 'api.cloudflare.com', method: 'GET', path: `${base}/versions/${active.versionId}`, headers: auth, maxBytes: MAX_JSON_BYTES }), 'version_resource');
  const resource = versionResource(versionResponse.result, active.versionId);
  const adminResponse = parseEnvelope(await requestCf({ hostname: 'api.cloudflare.com', method: 'GET', path: `/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${encodeURIComponent(topology.adminProject)}`, headers: auth, maxBytes: MAX_JSON_BYTES }), 'admin_pages');
  const admin = adminProject(adminResponse.result, topology.adminProject, expectedAdminProjectNameSha256);
  const subdomainResponse = parseEnvelope(await requestCf({ hostname: 'api.cloudflare.com', method: 'GET', path: `${base}/subdomain`, headers: auth, maxBytes: MAX_JSON_BYTES }), 'subdomain');
  const schedulesResponse = parseEnvelope(await requestCf({ hostname: 'api.cloudflare.com', method: 'GET', path: `${base}/schedules`, headers: auth, maxBytes: MAX_JSON_BYTES }), 'schedules');
  void expiresAt;
  validateSubdomain(subdomainResponse.result);
  validateSchedules(schedulesResponse.result);
  return {
    snapshot: {
      ...active,
      settings: settingsResponse.result,
      settingsSha256: sha256(stable(settingsResponse.result)),
      subdomain: subdomainResponse.result,
      subdomainSha256: sha256(stable(subdomainResponse.result)),
      schedules: schedulesResponse.result,
      schedulesSha256: sha256(stable(schedulesResponse.result)),
      bindingShape: shape,
      ...resource,
      settingsAssetBindingDigest: topology.settingsAssetBindingDigest,
      ...admin,
    },
    cfRays: [deploymentResponse.cfRay, settingsResponse.cfRay, versionResponse.cfRay,
      adminResponse.cfRay, subdomainResponse.cfRay, schedulesResponse.cfRay],
  };
}

function validateMigrations(response: HttpResponse): string | null {
  const envelope = parseJson(response, 'migration_readback') as {
    success?: unknown; result?: Array<{ success?: unknown; results?: unknown[] }>;
  };
  const rows = envelope.result?.[0]?.results as Array<{ name?: unknown; checksum?: unknown }> | undefined;
  const expected = [
    { name: '071_incoming_media.sql', checksum: 'sha256:c65203ce28e750b6cf612ad17029bc195fd2e6253a379cf62e642e3c5a8ae5d6' },
    { name: '072_incoming_media_service_credentials.sql', checksum: 'sha256:be4b1730fadd497d0a0d9677bda8626d174aaa08946d1c27e9e68e1549049937' },
  ];
  if (envelope.success !== true || envelope.result?.length !== 1 || envelope.result[0]?.success !== true ||
      !Array.isArray(rows) || stable(rows) !== stable(expected)) throw new DeployStop('migration_readback_shape');
  const ray = response.headers['cf-ray'];
  return typeof ray === 'string' ? ray : null;
}

function sameSnapshotConfig(before: WorkerSnapshot, after: WorkerSnapshot): void {
  for (const key of ['settingsSha256', 'subdomainSha256', 'schedulesSha256',
    'versionAssetBindingDigest', 'settingsAssetBindingDigest', 'adminProjectNameSha256',
    'adminDeploymentId', 'assetResourceIdentityAvailable'] as const) {
    if (before[key] !== after[key]) throw new DeployStop(`${key}_changed`);
  }
  if (stable(before.bindingShape) !== stable(after.bindingShape)) throw new DeployStop('binding_shape_changed');
  if (before.scriptEtag !== PREVIOUS_SCRIPT_ETAG || after.scriptEtag === before.scriptEtag) {
    throw new DeployStop('script_etag_transition');
  }
}

function samePreWriteSnapshot(before: WorkerSnapshot, current: WorkerSnapshot): void {
  if (stable(before) !== stable(current)) throw new DeployStop('pre_put_snapshot_drift');
}

function validateSnapshotAnchors(snapshot: WorkerSnapshot, deps: RunDependencies): void {
  if (snapshot.settingsSha256 !== deps.expectedSettingsSha256 ||
      snapshot.subdomainSha256 !== deps.expectedSubdomainSha256 ||
      snapshot.schedulesSha256 !== deps.expectedSchedulesSha256 ||
      sha256(stable(snapshot.bindingShape)) !== deps.expectedBindingShapeSha256) {
    throw new DeployStop('d2_r1_snapshot_drift');
  }
}

function validateTargetVersion(value: VersionReadback): void {
  if (value.version !== TARGET_VERSION || value.worker_hash !== TARGET_WORKER_HASH ||
      value.admin_hash !== ADMIN_HASH || value.liff_hash !== LIFF_HASH ||
      !Number.isFinite(Date.parse(value.released_at))) throw new DeployStop('target_version_mismatch');
}

export async function run(raw: string[], deps: RunDependencies): Promise<Record<string, unknown>> {
  const args = parseArgs(raw);
  const planningHead = deps.validateLocalAnchors(args.approvedHarnessHead);
  const artifact = validateArtifact(deps.loadArtifact());
  void deps.loadLegacyProbePath();
  const token = deps.loadToken();
  const upload = buildContentUpload(artifact);
  if (args.preflightOnly) {
    if (existsSync(deps.outputDir)) throw new DeployStop('output_exists');
    return {
      approval_id: APPROVAL_ID, status: 'preflight_passed', artifact_sha256: ARTIFACT_SHA256,
      artifact_bytes: artifact.length, planning_head: planningHead, token_present: token.length > 0,
      provider_requests: 0, provider_writes: 0, local_writes: 0,
    };
  }

  validateApprovalWindow(args.received, args.expires, deps.now());
  const expiresAt = Date.parse(args.expires);
  const identity = createOutput(deps.outputDir);
  const startedAt = new Date(deps.now()).toISOString();
  let cfReads = 0;
  let runtimeReads = 0;
  let contentWrites = 0;
  let versionPolls = 0;
  let mutationStage = 'pre_write_readback';
  let mutationOutcome: 'not_attempted' | 'unknown' | 'accepted' = 'not_attempted';
  let observedPostState: { deployment_id: string; version_id: string; script_etag: string } | null = null;
  const cfRays: Array<string | null> = [];
  const requestCf = async (spec: ExactRequest): Promise<HttpResponse> => {
    validateApprovalWindow(args.received, args.expires, deps.now());
    cfReads += spec.method === 'GET' || spec.method === 'POST' ? 1 : 0;
    contentWrites += spec.method === 'PUT' ? 1 : 0;
    return deps.cfRequest(spec, expiresAt);
  };
  const requestWorker = async (spec: ExactRequest): Promise<HttpResponse> => {
    validateApprovalWindow(args.received, args.expires, deps.now());
    runtimeReads += 1;
    return deps.workerRequest(spec, expiresAt);
  };

  try {
    const before = await getSnapshot(token, expiresAt, requestCf, deps.expectedAdminProjectNameSha256);
    cfRays.push(...before.cfRays);
    if (before.snapshot.deploymentId !== PREVIOUS_DEPLOYMENT_ID || before.snapshot.versionId !== PREVIOUS_VERSION_ID) {
      throw new DeployStop('previous_deployment_drift');
    }
    if (before.snapshot.scriptEtag !== PREVIOUS_SCRIPT_ETAG) throw new DeployStop('previous_script_etag_drift');
    validateSnapshotAnchors(before.snapshot, deps);
    const preVersion = versionReadback(await requestWorker({
      hostname: WORKER_HOST, method: 'GET', path: '/admin/version',
      headers: { 'Accept-Encoding': 'identity' }, maxBytes: 8_192,
    }));
    if (preVersion.version !== LEGACY_VERSION || preVersion.worker_hash !== LEGACY_UNKNOWN_HASH ||
        preVersion.admin_hash !== LEGACY_UNKNOWN_HASH || preVersion.liff_hash !== LEGACY_UNKNOWN_HASH ||
        preVersion.released_at !== LEGACY_RELEASED_AT) {
      throw new DeployStop('pre_version_drift');
    }

    const migrationBody = Buffer.from(JSON.stringify({
      sql: 'SELECT name, checksum FROM _line_harness_migrations WHERE name IN (?, ?) ORDER BY name',
      params: ['071_incoming_media.sql', '072_incoming_media_service_credentials.sql'],
    }), 'utf8');
    const migrationResponse = await requestCf({
      hostname: 'api.cloudflare.com', method: 'POST',
      path: `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
      headers: {
        Authorization: `Bearer ${token}`, 'Accept-Encoding': 'identity',
        'Content-Type': 'application/json', 'Content-Length': migrationBody.length,
      },
      body: migrationBody, maxBytes: 65_536,
    });
    cfRays.push(validateMigrations(migrationResponse));

    const finalPrePut = await getSnapshot(token, expiresAt, requestCf, deps.expectedAdminProjectNameSha256);
    cfRays.push(...finalPrePut.cfRays);
    samePreWriteSnapshot(before.snapshot, finalPrePut.snapshot);

    mutationStage = 'content_put_in_flight';
    mutationOutcome = 'unknown';
    const putResponse = parseEnvelope(await requestCf({
      hostname: 'api.cloudflare.com', method: 'PUT',
      path: `/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}/content`,
      headers: {
        Authorization: `Bearer ${token}`, 'Accept-Encoding': 'identity',
        'Content-Type': `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
        'Content-Length': upload.length,
      },
      body: upload, maxBytes: MAX_JSON_BYTES,
    }), 'content_put');
    mutationOutcome = 'accepted';
    mutationStage = 'post_write_readback';
    cfRays.push(putResponse.cfRay);
    validateApprovalWindow(args.received, args.expires, deps.now());

    const after = await getSnapshot(token, expiresAt, requestCf, deps.expectedAdminProjectNameSha256);
    cfRays.push(...after.cfRays);
    observedPostState = {
      deployment_id: after.snapshot.deploymentId,
      version_id: after.snapshot.versionId,
      script_etag: after.snapshot.scriptEtag,
    };
    if (after.snapshot.deploymentId === before.snapshot.deploymentId ||
        after.snapshot.versionId === before.snapshot.versionId) throw new DeployStop('deployment_not_advanced');
    sameSnapshotConfig(before.snapshot, after.snapshot);

    let target: VersionReadback | null = null;
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      versionPolls = attempt;
      const observed = versionReadback(await requestWorker({
        hostname: WORKER_HOST, method: 'GET', path: '/admin/version',
        headers: { 'Accept-Encoding': 'identity' }, maxBytes: 8_192,
      }));
      if (observed.version === TARGET_VERSION && observed.worker_hash === TARGET_WORKER_HASH &&
          observed.admin_hash === ADMIN_HASH && observed.liff_hash === LIFF_HASH) {
        target = observed;
        break;
      }
      if (attempt < 12) await deps.sleep(2_000);
    }
    if (!target) throw new DeployStop('runtime_propagation_timeout');
    validateTargetVersion(target);

    const privateProbe = await requestWorker({
      hostname: WORKER_HOST, method: 'HEAD',
      path: '/api/incoming-media/b1-probe-account/b1-probe-message',
      headers: { 'Accept-Encoding': 'identity' }, maxBytes: 1_024,
    });
    if (privateProbe.status !== 401 || privateProbe.body.length !== 0) throw new DeployStop('private_unauthorized_probe');

    const finalPostReadbackDeployment = parseEnvelope(await requestCf({
      hostname: 'api.cloudflare.com', method: 'GET',
      path: `/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}/deployments`,
      headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'identity' },
      maxBytes: MAX_JSON_BYTES,
    }), 'final_post_readback_deployment');
    cfRays.push(finalPostReadbackDeployment.cfRay);
    const finalPostReadbackActive = activeDeployment(finalPostReadbackDeployment.result);
    if (finalPostReadbackActive.deploymentId !== after.snapshot.deploymentId ||
        finalPostReadbackActive.versionId !== after.snapshot.versionId) {
      throw new DeployStop('post_readback_deployment_drift');
    }
    validateApprovalWindow(args.received, args.expires, deps.now());
    mutationStage = 'completed';

    const summary = {
      schema_version: 1, approval_id: APPROVAL_ID, approval_received: args.received,
      approval_expires: args.expires, started_at: startedAt,
      completed_at: new Date(deps.now()).toISOString(), status: 'completed',
      artifact: { sha256: ARTIFACT_SHA256, bytes: artifact.length, version: TARGET_VERSION, worker_hash: TARGET_WORKER_HASH },
      deployment: {
        previous_deployment_id: before.snapshot.deploymentId,
        previous_version_id: before.snapshot.versionId,
        new_deployment_id: after.snapshot.deploymentId,
        new_version_id: after.snapshot.versionId,
      },
      immutable_config: {
        settings_sha256: after.snapshot.settingsSha256,
        subdomain_sha256: after.snapshot.subdomainSha256,
        schedules_sha256: after.snapshot.schedulesSha256,
        binding_count: after.snapshot.bindingShape.length,
        public_block_gate: 'absent',
        asset_identity: 'legacy_unknown',
        version_asset_binding_digest: after.snapshot.versionAssetBindingDigest,
        settings_asset_binding_digest: after.snapshot.settingsAssetBindingDigest,
        asset_resource_identity_available: after.snapshot.assetResourceIdentityAvailable,
        admin_project_name_sha256: after.snapshot.adminProjectNameSha256,
        admin_pages_deployment_id: after.snapshot.adminDeploymentId,
        previous_script_etag: before.snapshot.scriptEtag,
        deployed_script_etag: after.snapshot.scriptEtag,
      },
      runtime_readback: {
        version: target.version, worker_hash: target.worker_hash,
        admin_hash: target.admin_hash, liff_hash: target.liff_hash,
        private_unauthenticated_head: 401,
      },
      request_counts: {
        cloudflare_read: cfReads, worker_content_put: contentWrites,
        runtime_read: runtimeReads, runtime_version_polls: versionPolls,
        provider_total: cfReads + contentWrites + runtimeReads, retry: 0,
      },
      mutation: { stage: mutationStage, outcome: mutationOutcome, put_attempts: contentWrites },
      cf_rays: cfRays,
      forbidden_actions: {
        d1_write: 0, binding_change: 0, secret_change: 0, asset_endpoint_write: 0,
        routes_change: 0, schedules_change: 0, gate_change: 0, r2: 0,
        purge: 0, restart: 0, feature_enablement: 0, drive_write: 0,
        line_send: 0, pr_merge: 0, automatic_rollback: 0,
      },
    };
    writeSummary(deps.outputDir, identity, summary);
    return summary;
  } catch (error) {
    const reason = error instanceof DeployStop ? error.code : 'unexpected_local_error';
    if (readdirSync(deps.outputDir).length === 0) {
      writeSummary(deps.outputDir, identity, {
        schema_version: 1, approval_id: APPROVAL_ID, approval_received: args.received,
        approval_expires: args.expires, started_at: startedAt,
        completed_at: new Date(deps.now()).toISOString(), status: 'stopped', stop_reason: reason,
        request_counts: {
          cloudflare_read: cfReads, worker_content_put: contentWrites,
          runtime_read: runtimeReads, runtime_version_polls: versionPolls,
          provider_total: cfReads + contentWrites + runtimeReads, retry: 0,
        },
        mutation: { stage: mutationStage, outcome: mutationOutcome, put_attempts: contentWrites },
        observed_post_state: observedPostState,
        rollback_required: contentWrites === 1,
      });
    }
    throw new DeployStop(reason);
  }
}

const defaultDeps: RunDependencies = {
  now: () => Date.now(), loadArtifact, loadLegacyProbePath, loadToken, validateLocalAnchors,
  outputDir: OUTPUT_DIR,
  cfRequest: (spec, expiresAt) => exactHttpsRequest(spec, expiresAt),
  workerRequest: (spec, expiresAt) => exactHttpsRequest(spec, expiresAt),
  sleep: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  expectedAdminProjectNameSha256: ADMIN_PROJECT_NAME_SHA256,
  expectedSettingsSha256: EXPECTED_SETTINGS_SHA256,
  expectedSubdomainSha256: EXPECTED_SUBDOMAIN_SHA256,
  expectedSchedulesSha256: EXPECTED_SCHEDULES_SHA256,
  expectedBindingShapeSha256: EXPECTED_BINDING_SHAPE_SHA256,
};

const isCliEntry = (() => {
  if (!argv[1]) return false;
  try { return fileURLToPath(import.meta.url) === argv[1]; } catch { return false; }
})();

if (isCliEntry) {
  run(argv.slice(2), defaultDeps).then((result) => stdout.write(`${JSON.stringify(result)}\n`)).catch((error: unknown) => {
    const reason = error instanceof DeployStop ? error.code : 'unexpected_local_error';
    stdout.write(`${JSON.stringify({ approval_id: APPROVAL_ID, status: 'stopped', stop_reason: reason, retry: 0 })}\n`);
    exit(1);
  });
}
