#!/usr/bin/env tsx
/** Approval-bound, read-only production Worker configuration anchor for #5229. */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { argv, exit, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  DeployStop,
  exactHttpsRequest,
  getSnapshot as getB1Snapshot,
  type ExactRequest,
  type HttpResponse,
  type WorkerSnapshot,
} from './worker-b1-deploy-5229.js';

const APPROVAL_ID = '5229-B1-D2-20260903';
const TOKEN_FILE = '/Users/kensmba/.line-harness/.env.local';
const WORKTREE = '/Users/kensmba/.line-harness-wt/5229-private-incoming-media';
const BACKPORT_WORKTREE = '/Users/kensmba/.line-harness-wt/5229-b1-v019-backport';
const ACCOUNTING_WORKTREE = '/Users/kensmba/scripts-wt/5230-line-recovery';
const BACKPORT_HEAD = '9f3c6c3ac98d0777f8e7354f807a6af4ab642b18';
const ACCOUNTING_HEAD = 'ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f';
const OUTPUT_DIR = '/Users/kensmba/.line-harness-5229-B1-D2-20260903';
const D1_RECEIPT_DIR = '/Users/kensmba/.line-harness-5229-B1-D1-20260903';
const D1_RECEIPT_FILE = `${D1_RECEIPT_DIR}/sanitized-summary.json`;
const D1_RECEIPT_SHA256 = 'c2e294eae170d8a3f3b1592a43232b0c1ce2538f605464e7da3d057d44bebbd2';
const EXECUTOR_FILE = `${WORKTREE}/scripts/worker-b1-d2-config-anchor-5229.ts`;
const TEST_FILE = `${WORKTREE}/scripts/worker-b1-d2-config-anchor-5229.test.ts`;
const ACTIVE_DEPLOYMENT_ID = '7b3bb319-e618-4f57-a520-cd33f43115e5';
const ACTIVE_VERSION_ID = 'c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7';
const SCRIPT_ETAG = '1d9a88703ce2509f372740c140aa18699884b779a82108efdd863484555611b6';
const ASSET_BINDING_SHA256 = '8fcf498813511a591cb5d595bc281fee2d45f7a27a87f124257a319b543d04c6';
const ADMIN_PROJECT_NAME_SHA256 = '492123998ae432be97e93235fce10a2d5d118fd9eb8be802edd46ae8345ca9a2';
const ADMIN_DEPLOYMENT_ID = '301a632d-dc9a-4655-8368-2d77f8db3b21';
const EXPECTED_BINDING_COUNT = 20;
const EXPECTED_REQUESTS = 12;

type OutputIdentity = { dev: number; ino: number };
type SnapshotResult = { snapshot: WorkerSnapshot; cfRays: Array<string | null> };

export interface Dependencies {
  now: () => number;
  loadToken: () => string;
  validateLocalState: (approvedHead: string) => string;
  outputDir: string;
  cfRequest: (spec: ExactRequest, expiresAt: number) => Promise<HttpResponse>;
  getSnapshot: (
    token: string,
    expiresAt: number,
    requestCf: (spec: ExactRequest) => Promise<HttpResponse>,
    expectedAdminProjectNameSha256: string,
  ) => Promise<SnapshotResult>;
}

export class AnchorStop extends Error {
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

export function parseTokenFile(text: string): string {
  const values: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^CLOUDFLARE_API_TOKEN=(.*)$/.exec(line);
    if (!match) {
      if (line.startsWith('CLOUDFLARE_API_TOKEN')) throw new AnchorStop('token_format');
      continue;
    }
    let value = match[1];
    const quoted = value.startsWith('"') || value.startsWith("'") ||
      value.endsWith('"') || value.endsWith("'");
    if (quoted) {
      const valid = (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"));
      if (!valid) throw new AnchorStop('token_format');
      value = value.slice(1, -1);
    }
    if (!value || /[\0\r\n]/.test(value)) throw new AnchorStop('token_format');
    values.push(value);
  }
  if (values.length !== 1) throw new AnchorStop('token_count');
  return values[0];
}

export function loadToken(): string {
  const stat = lstatSync(TOKEN_FILE);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o777) !== 0o600) {
    throw new AnchorStop('token_file');
  }
  return parseTokenFile(readFileSync(TOKEN_FILE, 'utf8'));
}

export function validateApprovalWindow(received: string, expires: string, now: number): void {
  const start = Date.parse(received);
  const end = Date.parse(expires);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== 7_200_000) {
    throw new AnchorStop('approval_window');
  }
  if (now < start || now >= end) throw new AnchorStop('approval_inactive');
}

export function parseArgs(raw: string[]): {
  preflightOnly: boolean;
  received: string;
  expires: string;
  approvedHarnessHead: string;
} {
  if (raw.length === 3 && raw[0] === '--preflight-only' &&
      raw[1] === '--approved-harness-head' && raw[2]) {
    return { preflightOnly: true, received: '', expires: '', approvedHarnessHead: raw[2] };
  }
  if (raw.length === 6 && raw[0] === '--approval-received' && raw[2] === '--approval-expires' &&
      raw[4] === '--approved-harness-head' && raw[1] && raw[3] && raw[5]) {
    return { preflightOnly: false, received: raw[1], expires: raw[3], approvedHarnessHead: raw[5] };
  }
  throw new AnchorStop('arguments');
}

export function validateLocalState(approvedHead: string): string {
  if (!/^[0-9a-f]{40}$/.test(approvedHead)) throw new AnchorStop('approved_head');
  const git = (worktree: string, args: string[]): string =>
    execFileSync('git', ['-C', worktree, ...args], { encoding: 'utf8' }).trim();
  for (const [worktree, expected] of [
    [WORKTREE, approvedHead], [BACKPORT_WORKTREE, BACKPORT_HEAD], [ACCOUNTING_WORKTREE, ACCOUNTING_HEAD],
  ] as const) {
    if (git(worktree, ['rev-parse', 'HEAD']) !== expected) throw new AnchorStop('head_drift');
    if (git(worktree, ['status', '--porcelain', '--untracked-files=all']) !== '') {
      throw new AnchorStop('worktree_dirty');
    }
  }
  for (const path of [EXECUTOR_FILE, TEST_FILE]) assertRealPath(path, 'file', 0o644);
  validateReceiptArtifact(D1_RECEIPT_DIR, D1_RECEIPT_FILE, D1_RECEIPT_SHA256);
  return approvedHead;
}

function assertRealPath(path: string, kind: 'directory' | 'file', mode: number): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) ||
      (stat.mode & 0o777) !== mode) throw new AnchorStop(`${kind}_state`);
}

export function validateReceiptArtifact(
  directory: string,
  file: string,
  expectedSha256: string,
): void {
  assertRealPath(directory, 'directory', 0o700);
  if (canonical(readdirSync(directory)) !== canonical(['sanitized-summary.json'])) {
    throw new AnchorStop('d1_receipt_entries');
  }
  if (file !== `${directory}/sanitized-summary.json`) throw new AnchorStop('d1_receipt_path');
  assertRealPath(file, 'file', 0o600);
  if (sha256(readFileSync(file)) !== expectedSha256) throw new AnchorStop('d1_receipt_sha256');
}

function createOutput(path: string): OutputIdentity {
  if (existsSync(path)) throw new AnchorStop('output_exists');
  mkdirSync(path, { mode: 0o700 });
  assertRealPath(path, 'directory', 0o700);
  const stat = lstatSync(path);
  if (readdirSync(path).length !== 0) throw new AnchorStop('output_entries');
  return { dev: stat.dev, ino: stat.ino };
}

function assertPinnedOutput(path: string, identity: OutputIdentity, names: string[]): void {
  assertRealPath(path, 'directory', 0o700);
  const stat = lstatSync(path);
  if (stat.dev !== identity.dev || stat.ino !== identity.ino ||
      canonical(readdirSync(path).sort()) !== canonical([...names].sort())) {
    throw new AnchorStop('output_drift');
  }
}

function writeSummary(path: string, identity: OutputIdentity, summary: unknown): void {
  assertPinnedOutput(path, identity, []);
  const file = `${path}/sanitized-summary.json`;
  writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  assertRealPath(file, 'file', 0o600);
  assertPinnedOutput(path, identity, ['sanitized-summary.json']);
}

function validateAnchors(snapshot: WorkerSnapshot): void {
  if (snapshot.deploymentId !== ACTIVE_DEPLOYMENT_ID || snapshot.versionId !== ACTIVE_VERSION_ID) {
    throw new AnchorStop('active_deployment_drift');
  }
  if (snapshot.scriptEtag !== SCRIPT_ETAG) throw new AnchorStop('script_etag_drift');
  if (snapshot.settingsAssetBindingDigest !== ASSET_BINDING_SHA256 ||
      snapshot.versionAssetBindingDigest !== ASSET_BINDING_SHA256 ||
      snapshot.assetResourceIdentityAvailable !== false) throw new AnchorStop('asset_topology_drift');
  if (snapshot.adminProjectNameSha256 !== ADMIN_PROJECT_NAME_SHA256 ||
      snapshot.adminDeploymentId !== ADMIN_DEPLOYMENT_ID) throw new AnchorStop('admin_topology_drift');
  if (snapshot.bindingShape.length !== EXPECTED_BINDING_COUNT) throw new AnchorStop('binding_count_drift');
  if (sha256(canonical(snapshot.settings)) !== snapshot.settingsSha256 ||
      sha256(canonical(snapshot.subdomain)) !== snapshot.subdomainSha256 ||
      sha256(canonical(snapshot.schedules)) !== snapshot.schedulesSha256) {
    throw new AnchorStop('canonical_hash_mismatch');
  }
}

function assertStableSnapshots(first: WorkerSnapshot, second: WorkerSnapshot): void {
  if (canonical(first) !== canonical(second)) throw new AnchorStop('snapshot_drift');
}

function safeReason(error: unknown): string {
  if (error instanceof AnchorStop || error instanceof DeployStop) return error.code;
  return 'provider_or_local_error';
}

export async function run(raw: string[], deps: Dependencies): Promise<Record<string, unknown>> {
  const args = parseArgs(raw);
  const approvedHead = deps.validateLocalState(args.approvedHarnessHead);
  if (existsSync(deps.outputDir)) throw new AnchorStop('output_exists');
  if (!args.preflightOnly) validateApprovalWindow(args.received, args.expires, deps.now());
  const token = deps.loadToken();
  if (args.preflightOnly) return {
    approval_id: APPROVAL_ID,
    status: 'preflight_passed',
    planning_head: approvedHead,
    token_present: token.length > 0,
    provider_requests: 0,
    provider_writes: 0,
    local_writes: 0,
  };

  validateApprovalWindow(args.received, args.expires, deps.now());
  const identity = createOutput(deps.outputDir);
  const startedAt = new Date(deps.now()).toISOString();
  const expiresAt = Date.parse(args.expires);
  let requests = 0;
  try {
    const requestCf = async (spec: ExactRequest): Promise<HttpResponse> => {
      validateApprovalWindow(args.received, args.expires, deps.now());
      if (spec.method !== 'GET' || spec.hostname !== 'api.cloudflare.com' || spec.body !== undefined) {
        throw new AnchorStop('request_scope');
      }
      requests += 1;
      if (requests > EXPECTED_REQUESTS) throw new AnchorStop('request_count');
      const response = await deps.cfRequest(spec, expiresAt);
      validateApprovalWindow(args.received, args.expires, deps.now());
      return response;
    };
    const first = (await deps.getSnapshot(
      token, expiresAt, requestCf, ADMIN_PROJECT_NAME_SHA256,
    )).snapshot;
    validateAnchors(first);
    const second = (await deps.getSnapshot(
      token, expiresAt, requestCf, ADMIN_PROJECT_NAME_SHA256,
    )).snapshot;
    validateAnchors(second);
    if (requests !== EXPECTED_REQUESTS) throw new AnchorStop('request_count');
    assertStableSnapshots(first, second);
    validateApprovalWindow(args.received, args.expires, deps.now());

    const summary = {
      schema_version: 1,
      approval_id: APPROVAL_ID,
      approval_received: args.received,
      approval_expires: args.expires,
      approved_harness_head: approvedHead,
      started_at: startedAt,
      completed_at: new Date(deps.now()).toISOString(),
      status: 'completed',
      stable_snapshot_count: 2,
      active_deployment_id: first.deploymentId,
      active_version_id: first.versionId,
      worker_script_etag: first.scriptEtag,
      settings_sha256: first.settingsSha256,
      subdomain_sha256: first.subdomainSha256,
      schedules_sha256: first.schedulesSha256,
      binding_shape_sha256: sha256(canonical(first.bindingShape)),
      binding_count: first.bindingShape.length,
      settings_asset_binding_sha256: first.settingsAssetBindingDigest,
      version_asset_binding_sha256: first.versionAssetBindingDigest,
      admin_project_name_sha256: first.adminProjectNameSha256,
      admin_deployment_id: first.adminDeploymentId,
      asset_resource_identity_count: first.assetResourceIdentityAvailable ? 1 : 0,
      request_counts: {
        cloudflare_get: requests,
        provider_total: requests,
        retry: 0,
        redirect: 0,
        provider_write: 0,
        local_file_write: 1,
      },
    };
    writeSummary(deps.outputDir, identity, summary);
    return summary;
  } catch (error) {
    const reason = safeReason(error);
    try {
      assertPinnedOutput(deps.outputDir, identity, []);
      writeSummary(deps.outputDir, identity, {
        schema_version: 1,
        approval_id: APPROVAL_ID,
        approval_received: args.received,
        approval_expires: args.expires,
        approved_harness_head: approvedHead,
        started_at: startedAt,
        completed_at: new Date(deps.now()).toISOString(),
        status: 'stopped',
        stop_reason: reason,
        stable_snapshot_count: 0,
        request_counts: {
          cloudflare_get: requests,
          provider_total: requests,
          retry: 0,
          redirect: 0,
          provider_write: 0,
          local_file_write: 1,
        },
      });
    } catch { /* A replaced or contaminated output is never repaired or overwritten. */ }
    throw new AnchorStop(reason);
  }
}

const defaultDeps: Dependencies = {
  now: () => Date.now(),
  loadToken,
  validateLocalState,
  outputDir: OUTPUT_DIR,
  cfRequest: (spec, expiresAt) => exactHttpsRequest(spec, expiresAt),
  getSnapshot: getB1Snapshot,
};

const isCliEntry = (() => {
  if (!argv[1]) return false;
  try { return fileURLToPath(import.meta.url) === argv[1]; } catch { return false; }
})();

if (isCliEntry) {
  run(argv.slice(2), defaultDeps).then((result) => {
    stdout.write(`${JSON.stringify(result)}\n`);
  }).catch((error: unknown) => {
    stdout.write(`${JSON.stringify({
      approval_id: APPROVAL_ID,
      status: 'stopped',
      stop_reason: safeReason(error),
      retry: 0,
      redirect: 0,
      provider_writes: 0,
    })}\n`);
    exit(1);
  });
}
