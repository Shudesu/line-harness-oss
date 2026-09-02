#!/usr/bin/env tsx
/** Approval-bound, read-only production asset-topology attestation for #5229. */

import { createHash } from 'node:crypto';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request, type RequestOptions } from 'node:https';
import {
  chmodSync, closeSync, existsSync, lstatSync, mkdirSync,
  openSync, readFileSync, writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { argv, exit, stderr, stdout } from 'node:process';

const APPROVAL_ID = '5229-B1-D1-20260903';
const ACCOUNT_ID = '67907592fdf596376bc2097e14a6563a';
const SCRIPT_NAME = 'line-harness';
const TOKEN_FILE = '/Users/kensmba/.line-harness/.env.local';
const OUTPUT_DIR = '/Users/kensmba/.line-harness-5229-B1-D1-20260903';
const PLANNING_WORKTREE = '/Users/kensmba/.line-harness-wt/5229-private-incoming-media';
const BACKPORT_WORKTREE = '/Users/kensmba/.line-harness-wt/5229-b1-v019-backport';
const ACCOUNTING_WORKTREE = '/Users/kensmba/scripts-wt/5230-line-recovery';
const EXECUTOR_FILE = `${PLANNING_WORKTREE}/scripts/worker-b1-d1-asset-topology-5229.ts`;
const TEST_FILE = `${PLANNING_WORKTREE}/scripts/worker-b1-d1-asset-topology-5229.test.ts`;
const BACKPORT_HEAD = '9f3c6c3ac98d0777f8e7354f807a6af4ab642b18';
const ACCOUNTING_HEAD = 'ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f';
const ACTIVE_DEPLOYMENT_ID = '7b3bb319-e618-4f57-a520-cd33f43115e5';
const ACTIVE_VERSION_ID = 'c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7';
const MAX_JSON_BYTES = 262_144;

export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}
export interface ExactRequest {
  hostname: string;
  path: string;
  headers: Record<string, string>;
  maxBytes: number;
}
export type RequestFunction = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;
export interface Dependencies {
  now: () => number;
  loadToken: () => string;
  validateLocalAnchors: (approvedHead: string) => string;
  cfRequest: (spec: ExactRequest, expiresAt: number) => Promise<HttpResponse>;
  outputDir: string;
}
export class TopologyStop extends Error {
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

export function parseTokenFile(text: string): string {
  const values: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^CLOUDFLARE_API_TOKEN=(.*)$/.exec(line);
    if (!match) {
      if (line.startsWith('CLOUDFLARE_API_TOKEN')) throw new TopologyStop('token_format');
      continue;
    }
    let value = match[1];
    const beginsQuote = value.startsWith('"') || value.startsWith("'");
    const endsQuote = value.endsWith('"') || value.endsWith("'");
    if (beginsQuote || endsQuote) {
      if (!((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'")))) throw new TopologyStop('token_format');
      value = value.slice(1, -1);
    }
    if (!value || /[\0\r\n]/.test(value)) throw new TopologyStop('token_format');
    values.push(value);
  }
  if (values.length !== 1) throw new TopologyStop('token_count');
  return values[0];
}
export function loadToken(): string {
  const stat = lstatSync(TOKEN_FILE);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o777) !== 0o600) {
    throw new TopologyStop('token_file');
  }
  return parseTokenFile(readFileSync(TOKEN_FILE, 'utf8'));
}

function git(path: string, args: string[]): string {
  return execFileSync('git', ['-C', path, ...args], { encoding: 'utf8' }).trim();
}
export function validateLocalAnchors(approvedHead: string): string {
  if (!/^[0-9a-f]{40}$/.test(approvedHead)) throw new TopologyStop('approved_head');
  for (const [path, expectedHead] of [
    [PLANNING_WORKTREE, approvedHead], [BACKPORT_WORKTREE, BACKPORT_HEAD], [ACCOUNTING_WORKTREE, ACCOUNTING_HEAD],
  ] as const) {
    if (git(path, ['rev-parse', 'HEAD']) !== expectedHead) throw new TopologyStop('head_drift');
    if (git(path, ['status', '--porcelain']) !== '') throw new TopologyStop('worktree_dirty');
  }
  for (const path of [EXECUTOR_FILE, TEST_FILE]) {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o777) !== 0o644) {
      throw new TopologyStop('executor_file');
    }
  }
  return approvedHead;
}
export function validateApprovalWindow(received: string, expires: string, now: number): void {
  const start = Date.parse(received);
  const end = Date.parse(expires);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== 7_200_000) {
    throw new TopologyStop('approval_window');
  }
  if (now < start || now >= end) throw new TopologyStop('approval_inactive');
}

function parseArgs(raw: string[]): { received: string; expires: string; approvedHead: string; preflight: boolean } {
  const values = new Map<string, string>();
  let preflight = false;
  for (let i = 0; i < raw.length; i += 1) {
    const key = raw[i];
    if (key === '--preflight-only') { preflight = true; continue; }
    if (!key.startsWith('--') || !raw[i + 1] || raw[i + 1].startsWith('--') || values.has(key)) {
      throw new TopologyStop('arguments');
    }
    values.set(key, raw[++i]);
  }
  const received = values.get('--approval-received') ?? '';
  const expires = values.get('--approval-expires') ?? '';
  const approvedHead = values.get('--approved-harness-head') ?? '';
  const expectedKeys = preflight ? new Set(['--approved-harness-head']) :
    new Set(['--approval-received', '--approval-expires', '--approved-harness-head']);
  if ([...values.keys()].some((key) => !expectedKeys.has(key)) || values.size !== expectedKeys.size ||
      !approvedHead || (!preflight && (!received || !expires))) throw new TopologyStop('arguments');
  return { received, expires, approvedHead, preflight };
}

function envelope(response: HttpResponse, code: string): unknown {
  const type = String(response.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  const encoding = String(response.headers['content-encoding'] ?? '').trim().toLowerCase();
  if (response.status !== 200 || type !== 'application/json' || (encoding !== '' && encoding !== 'identity')) {
    throw new TopologyStop(code);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(response.body.toString('utf8')); } catch { throw new TopologyStop(code); }
  const value = parsed as { success?: unknown; result?: unknown };
  if (value.success !== true || value.result === undefined) throw new TopologyStop(code);
  return value.result;
}

export function parseActiveDeployment(response: HttpResponse): { deployment_id: string; version_id: string } {
  const result = envelope(response, 'deployment_response') as {
    deployments?: Array<{ id?: unknown; versions?: Array<{ version_id?: unknown; percentage?: unknown }> }>;
  };
  const deployment = result.deployments?.[0];
  const versions = deployment?.versions;
  if (!Array.isArray(result.deployments) || result.deployments.length < 1 || typeof deployment?.id !== 'string' ||
      !Array.isArray(versions) || versions.length !== 1 || typeof versions[0]?.version_id !== 'string' ||
      versions[0]?.percentage !== 100) throw new TopologyStop('deployment_shape');
  return { deployment_id: deployment.id, version_id: versions[0].version_id };
}

interface Topology {
  admin_project: string;
  liff_project: string | null;
  liff_topology: 'pages' | 'worker_assets';
  settings_asset_binding_digest: string;
}
export function parseTopology(response: HttpResponse): Topology {
  const result = envelope(response, 'settings_response') as { bindings?: unknown };
  if (!Array.isArray(result.bindings)) throw new TopologyStop('settings_shape');
  const bindings = result.bindings as Array<Record<string, unknown>>;
  const exact = (name: string): Record<string, unknown> => {
    const found = bindings.filter((binding) => binding.name === name);
    if (found.length !== 1) throw new TopologyStop('settings_binding');
    return found[0];
  };
  const admin = exact('ADMIN_PAGES_PROJECT');
  const liff = exact('LIFF_PAGES_PROJECT');
  const assets = exact('ASSETS');
  if (admin.type !== 'plain_text' || liff.type !== 'plain_text' || assets.type !== 'assets' ||
      typeof admin.text !== 'string' || typeof liff.text !== 'string') throw new TopologyStop('settings_binding');
  const project = /^[a-z0-9](?:[a-z0-9-]{0,56}[a-z0-9])?$/;
  if (!project.test(admin.text) || (liff.text !== '' && !project.test(liff.text))) throw new TopologyStop('project_name');
  return {
    admin_project: admin.text,
    liff_project: liff.text || null,
    liff_topology: liff.text ? 'pages' : 'worker_assets',
    settings_asset_binding_digest: sha256(stable(assets)),
  };
}

export function parseVersionResource(response: HttpResponse): {
  worker_script_etag: string;
  version_asset_binding_digest: string;
  asset_resource_identity_available: boolean;
} {
  const result = envelope(response, 'version_response') as {
    id?: unknown;
    resources?: { script?: { etag?: unknown }; bindings?: unknown };
  };
  if (result.id !== ACTIVE_VERSION_ID || typeof result.resources?.script?.etag !== 'string' ||
      !/^[0-9a-f]{64}$/.test(result.resources.script.etag) || !Array.isArray(result.resources.bindings)) {
    throw new TopologyStop('version_shape');
  }
  const assets = (result.resources.bindings as Array<Record<string, unknown>>)
    .filter((binding) => binding.name === 'ASSETS' && binding.type === 'assets');
  if (assets.length !== 1) throw new TopologyStop('version_asset_binding');
  const keys = Object.keys(assets[0]).sort();
  return {
    worker_script_etag: result.resources.script.etag,
    version_asset_binding_digest: sha256(stable(assets[0])),
    asset_resource_identity_available: keys.some((key) => !['name', 'type'].includes(key)),
  };
}

export function parseProject(response: HttpResponse, expectedName: string): {
  project_name_sha256: string;
  canonical_deployment_id: string;
} {
  const result = envelope(response, 'pages_project_response') as {
    name?: unknown;
    canonical_deployment?: { id?: unknown };
  };
  if (result.name !== expectedName || typeof result.canonical_deployment?.id !== 'string' ||
      !/^[0-9a-f-]{36}$/.test(result.canonical_deployment.id)) throw new TopologyStop('pages_project_shape');
  return { project_name_sha256: sha256(expectedName), canonical_deployment_id: result.canonical_deployment.id };
}

function writeSummary(outputDir: string, value: unknown): void {
  if (existsSync(outputDir)) throw new TopologyStop('output_exists');
  mkdirSync(outputDir, { mode: 0o700 });
  chmodSync(outputDir, 0o700);
  const path = `${outputDir}/sanitized-summary.json`;
  const fd = openSync(path, 'wx', 0o600);
  try { writeFileSync(fd, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); } finally { closeSync(fd); }
  chmodSync(path, 0o600);
}

export async function run(raw: string[], deps: Dependencies): Promise<Record<string, unknown>> {
  const args = parseArgs(raw);
  const planningHead = deps.validateLocalAnchors(args.approvedHead);
  const token = deps.loadToken();
  if (args.preflight) return {
    approval_id: APPROVAL_ID, status: 'preflight_passed', planning_head: planningHead,
    token_present: token.length > 0, provider_requests: 0, provider_writes: 0, local_writes: 0,
  };
  validateApprovalWindow(args.received, args.expires, deps.now());
  const expiresAt = Date.parse(args.expires);
  const startedAt = new Date(deps.now()).toISOString();
  let requests = 0;
  const get = async (path: string): Promise<HttpResponse> => {
    validateApprovalWindow(args.received, args.expires, deps.now());
    requests += 1;
    return deps.cfRequest({ hostname: 'api.cloudflare.com', path,
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Accept-Encoding': 'identity' },
      maxBytes: MAX_JSON_BYTES }, expiresAt);
  };
  const workerBase = `/client/v4/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT_NAME}`;
  const before = parseActiveDeployment(await get(`${workerBase}/deployments`));
  if (before.deployment_id !== ACTIVE_DEPLOYMENT_ID || before.version_id !== ACTIVE_VERSION_ID) {
    throw new TopologyStop('active_deployment_drift');
  }
  const resource = parseVersionResource(await get(`${workerBase}/versions/${ACTIVE_VERSION_ID}`));
  const topology = parseTopology(await get(`${workerBase}/settings`));
  const admin = parseProject(await get(
    `/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${encodeURIComponent(topology.admin_project)}`,
  ), topology.admin_project);
  const liff = topology.liff_project ? parseProject(await get(
    `/client/v4/accounts/${ACCOUNT_ID}/pages/projects/${encodeURIComponent(topology.liff_project)}`,
  ), topology.liff_project) : null;
  const after = parseActiveDeployment(await get(`${workerBase}/deployments`));
  if (stable(before) !== stable(after)) throw new TopologyStop('deployment_changed_during_read');
  validateApprovalWindow(args.received, args.expires, deps.now());
  const summary = {
    schema_version: 1, approval_id: APPROVAL_ID, status: 'completed',
    approval_received: args.received, approval_expires: args.expires,
    started_at: startedAt, completed_at: new Date(deps.now()).toISOString(), planning_head: planningHead,
    active_deployment_id: before.deployment_id, active_version_id: before.version_id,
    stable_active_snapshot: true, legacy_build_identity: 'unstamped_unknown',
    worker_resource: resource,
    topology: {
      liff_topology: topology.liff_topology,
      settings_asset_binding_digest: topology.settings_asset_binding_digest,
      admin_pages: admin,
      liff_pages: liff,
    },
    request_counts: { cloudflare_get: requests, provider_total: requests, retry: 0, writes: 0 },
    forbidden_actions: {
      worker_content_get: 0, deploy: 0, migration: 0, backfill: 0, credential_change: 0,
      secret_change: 0, r2: 0, pages_asset_get: 0, purge: 0, restart: 0,
      feature_enablement: 0, drive_write: 0, line_send: 0, pr_merge: 0,
    },
  };
  writeSummary(deps.outputDir, summary);
  return summary;
}

export function exactRequest(spec: ExactRequest, expiresAt: number, requester: RequestFunction = request): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const remainingApprovalMs = expiresAt - Date.now();
    if (remainingApprovalMs <= 0) return reject(new TopologyStop('approval_inactive'));
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(totalTimer);
      callback();
    };
    const req = requester({ protocol: 'https:', hostname: spec.hostname, port: 443, method: 'GET',
      path: spec.path, headers: spec.headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > spec.maxBytes) req.destroy(new TopologyStop('body_too_large'));
        else chunks.push(chunk);
      });
      res.on('end', () => finish(() => resolve({
        status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks),
      })));
    });
    const absoluteLimitMs = Math.min(20_000, remainingApprovalMs);
    const totalTimer = setTimeout(
      () => req.destroy(new TopologyStop(absoluteLimitMs === remainingApprovalMs ? 'approval_inactive' : 'request_timeout')),
      absoluteLimitMs,
    );
    req.on('socket', (socket) => {
      if (!socket.connecting) return;
      socket.setTimeout(10_000, () => req.destroy(new TopologyStop('connect_timeout')));
      socket.once('secureConnect', () => socket.setTimeout(0));
    });
    req.on('error', (error) => finish(() => reject(error)));
    req.end();
  });
}

const isCliEntry = (() => {
  if (!argv[1]) return false;
  try { return fileURLToPath(import.meta.url) === argv[1]; } catch { return false; }
})();
if (isCliEntry) {
  run(argv.slice(2), { now: () => Date.now(), loadToken, validateLocalAnchors,
    cfRequest: exactRequest, outputDir: OUTPUT_DIR })
    .then((value) => stdout.write(`${JSON.stringify(value)}\n`))
    .catch((error) => {
      const code = error instanceof TopologyStop ? error.code : 'unexpected_local_error';
      stderr.write(`STOP:${code}\n`);
      exit(1);
    });
}
