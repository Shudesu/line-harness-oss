#!/usr/bin/env tsx
/** Approval-bound, read-only production Worker subdomain discovery for #5229. */

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
  type ExactRequest,
  type HttpResponse,
} from './worker-b1-deploy-5229.js';

const APPROVAL_ID = '5229-B1-D3-20260903';
const TOKEN_FILE = '/Users/kensmba/.line-harness/.env.local';
const WORKTREE = '/Users/kensmba/.line-harness-wt/5229-private-incoming-media';
const BACKPORT_WORKTREE = '/Users/kensmba/.line-harness-wt/5229-b1-v019-backport';
const ACCOUNTING_WORKTREE = '/Users/kensmba/scripts-wt/5230-line-recovery';
const BACKPORT_HEAD = '9f3c6c3ac98d0777f8e7354f807a6af4ab642b18';
const ACCOUNTING_HEAD = 'ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f';
const OUTPUT_DIR = '/Users/kensmba/.line-harness-5229-B1-D3-20260903';
const D2_RECEIPT_DIR = '/Users/kensmba/.line-harness-5229-B1-D2-20260903';
const D2_RECEIPT_FILE = `${D2_RECEIPT_DIR}/sanitized-summary.json`;
const D2_RECEIPT_SHA256 = '253cebe9939a54852cbd104a74bf5523f6b3182f841e7f7e098986592abdd0a6';
const EXECUTOR_FILE = `${WORKTREE}/scripts/worker-b1-d3-subdomain-anchor-5229.ts`;
const TEST_FILE = `${WORKTREE}/scripts/worker-b1-d3-subdomain-anchor-5229.test.ts`;
const SUBDOMAIN_PATH = '/client/v4/accounts/67907592fdf596376bc2097e14a6563a/workers/scripts/line-harness/subdomain';
const MAX_RESPONSE_BYTES = 4_096;
const EXPECTED_REQUESTS = 2;

type OutputIdentity = { dev: number; ino: number };
type SubdomainState = { enabled: boolean; previews_enabled: boolean };

export interface Dependencies {
  now: () => number;
  loadToken: () => string;
  validateLocalState: (approvedHead: string) => string;
  outputDir: string;
  cfRequest: (spec: ExactRequest, expiresAt: number) => Promise<HttpResponse>;
}

export class SubdomainStop extends Error {
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
      if (line.startsWith('CLOUDFLARE_API_TOKEN')) throw new SubdomainStop('token_format');
      continue;
    }
    let value = match[1];
    const quoted = value.startsWith('"') || value.startsWith("'") ||
      value.endsWith('"') || value.endsWith("'");
    if (quoted) {
      const valid = (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"));
      if (!valid) throw new SubdomainStop('token_format');
      value = value.slice(1, -1);
    }
    if (!value || /[\0\r\n]/.test(value)) throw new SubdomainStop('token_format');
    values.push(value);
  }
  if (values.length !== 1) throw new SubdomainStop('token_count');
  return values[0];
}

export function loadToken(): string {
  assertRealPath(TOKEN_FILE, 'file', 0o600);
  return parseTokenFile(readFileSync(TOKEN_FILE, 'utf8'));
}

export function validateApprovalWindow(received: string, expires: string, now: number): void {
  const start = Date.parse(received);
  const end = Date.parse(expires);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== 7_200_000) {
    throw new SubdomainStop('approval_window');
  }
  if (now < start || now >= end) throw new SubdomainStop('approval_inactive');
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
  throw new SubdomainStop('arguments');
}

function assertRealPath(path: string, kind: 'directory' | 'file', mode: number): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) ||
      (stat.mode & 0o777) !== mode) throw new SubdomainStop(`${kind}_state`);
}

export function validateReceiptArtifact(
  directory: string,
  file: string,
  expectedSha256: string,
): void {
  assertRealPath(directory, 'directory', 0o700);
  if (canonical(readdirSync(directory)) !== canonical(['sanitized-summary.json'])) {
    throw new SubdomainStop('d2_receipt_entries');
  }
  if (file !== `${directory}/sanitized-summary.json`) throw new SubdomainStop('d2_receipt_path');
  assertRealPath(file, 'file', 0o600);
  const bytes = readFileSync(file);
  if (sha256(bytes) !== expectedSha256) throw new SubdomainStop('d2_receipt_sha256');
  let receipt: Record<string, unknown>;
  try { receipt = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>; } catch {
    throw new SubdomainStop('d2_receipt_json');
  }
  const counts = receipt.request_counts as Record<string, unknown> | undefined;
  if (receipt.approval_id !== '5229-B1-D2-20260903' || receipt.status !== 'stopped' ||
      receipt.stop_reason !== 'subdomain_drift' || receipt.approved_harness_head !==
      '8d2bde586d0a881ec738e824b47bdf3bbd09e8cd' || counts?.cloudflare_get !== 6 ||
      counts?.provider_total !== 6 || counts?.retry !== 0 || counts?.redirect !== 0 ||
      counts?.provider_write !== 0 || counts?.local_file_write !== 1) {
    throw new SubdomainStop('d2_receipt_state');
  }
}

export function validateLocalState(approvedHead: string): string {
  if (!/^[0-9a-f]{40}$/.test(approvedHead)) throw new SubdomainStop('approved_head');
  const git = (worktree: string, args: string[]): string =>
    execFileSync('git', ['-C', worktree, ...args], { encoding: 'utf8' }).trim();
  for (const [worktree, expected] of [
    [WORKTREE, approvedHead], [BACKPORT_WORKTREE, BACKPORT_HEAD], [ACCOUNTING_WORKTREE, ACCOUNTING_HEAD],
  ] as const) {
    if (git(worktree, ['rev-parse', 'HEAD']) !== expected) throw new SubdomainStop('head_drift');
    if (git(worktree, ['status', '--porcelain', '--untracked-files=all']) !== '') {
      throw new SubdomainStop('worktree_dirty');
    }
  }
  for (const path of [EXECUTOR_FILE, TEST_FILE]) assertRealPath(path, 'file', 0o644);
  validateReceiptArtifact(D2_RECEIPT_DIR, D2_RECEIPT_FILE, D2_RECEIPT_SHA256);
  return approvedHead;
}

function parseSubdomain(response: HttpResponse): SubdomainState {
  if (response.status !== 200) throw new SubdomainStop('provider_status');
  const contentType = response.headers['content-type'];
  const encoding = response.headers['content-encoding'];
  if (typeof contentType !== 'string' || !/^application\/json(?:\s*;|$)/i.test(contentType) ||
      (encoding !== undefined && encoding !== 'identity') || response.body.length > MAX_RESPONSE_BYTES) {
    throw new SubdomainStop('provider_response');
  }
  let parsed: unknown;
  try { parsed = JSON.parse(response.body.toString('utf8')); } catch {
    throw new SubdomainStop('provider_json');
  }
  const envelope = parsed as { success?: unknown; result?: unknown };
  if (!envelope || typeof envelope !== 'object' || envelope.success !== true ||
      !envelope.result || typeof envelope.result !== 'object' || Array.isArray(envelope.result)) {
    throw new SubdomainStop('provider_envelope');
  }
  const result = envelope.result as Record<string, unknown>;
  if (canonical(Object.keys(result).sort()) !== canonical(['enabled', 'previews_enabled']) ||
      typeof result.enabled !== 'boolean' || typeof result.previews_enabled !== 'boolean') {
    throw new SubdomainStop('subdomain_shape');
  }
  return { enabled: result.enabled, previews_enabled: result.previews_enabled };
}

function createOutput(path: string): OutputIdentity {
  if (existsSync(path)) throw new SubdomainStop('output_exists');
  mkdirSync(path, { mode: 0o700 });
  assertRealPath(path, 'directory', 0o700);
  const stat = lstatSync(path);
  if (readdirSync(path).length !== 0) throw new SubdomainStop('output_entries');
  return { dev: stat.dev, ino: stat.ino };
}

function assertPinnedOutput(path: string, identity: OutputIdentity, names: string[]): void {
  assertRealPath(path, 'directory', 0o700);
  const stat = lstatSync(path);
  if (stat.dev !== identity.dev || stat.ino !== identity.ino ||
      canonical(readdirSync(path).sort()) !== canonical([...names].sort())) {
    throw new SubdomainStop('output_drift');
  }
}

function writeSummary(path: string, identity: OutputIdentity, summary: unknown): void {
  assertPinnedOutput(path, identity, []);
  const file = `${path}/sanitized-summary.json`;
  writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  assertRealPath(file, 'file', 0o600);
  assertPinnedOutput(path, identity, ['sanitized-summary.json']);
}

function safeReason(error: unknown): string {
  if (error instanceof SubdomainStop || error instanceof DeployStop) return error.code;
  return 'provider_or_local_error';
}

export async function run(raw: string[], deps: Dependencies): Promise<Record<string, unknown>> {
  const args = parseArgs(raw);
  const approvedHead = deps.validateLocalState(args.approvedHarnessHead);
  if (existsSync(deps.outputDir)) throw new SubdomainStop('output_exists');
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
    const request = async (): Promise<SubdomainState> => {
      validateApprovalWindow(args.received, args.expires, deps.now());
      requests += 1;
      if (requests > EXPECTED_REQUESTS) throw new SubdomainStop('request_count');
      const response = await deps.cfRequest({
        hostname: 'api.cloudflare.com',
        method: 'GET',
        path: SUBDOMAIN_PATH,
        headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'identity' },
        maxBytes: MAX_RESPONSE_BYTES,
      }, expiresAt);
      validateApprovalWindow(args.received, args.expires, deps.now());
      return parseSubdomain(response);
    };
    const first = await request();
    const second = await request();
    if (requests !== EXPECTED_REQUESTS) throw new SubdomainStop('request_count');
    if (canonical(first) !== canonical(second)) throw new SubdomainStop('subdomain_snapshot_drift');
    validateApprovalWindow(args.received, args.expires, deps.now());
    const completedAt = new Date(deps.now()).toISOString();
    const summary = {
      schema_version: 1,
      approval_id: APPROVAL_ID,
      approval_received: args.received,
      approval_expires: args.expires,
      approved_harness_head: approvedHead,
      started_at: startedAt,
      completed_at: completedAt,
      status: 'completed',
      stable_snapshot_count: 2,
      subdomain: first,
      subdomain_sha256: sha256(canonical(first)),
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
    throw new SubdomainStop(reason);
  }
}

const defaultDeps: Dependencies = {
  now: () => Date.now(),
  loadToken,
  validateLocalState,
  outputDir: OUTPUT_DIR,
  cfRequest: (spec, expiresAt) => exactHttpsRequest(spec, expiresAt),
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
