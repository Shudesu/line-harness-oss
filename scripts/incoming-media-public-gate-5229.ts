#!/usr/bin/env tsx
/** Fail-closed B4 gate executor. No provider transport is intentionally linked. */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { argv, exit, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

export const APPROVAL_ID = '5229-B4-20260903';
export const APPROVAL_RECEIVED = '2026-09-03T05:51:46.737Z';
export const APPROVAL_EXPIRES = '2026-09-03T07:51:46.737Z';
export const SOURCE_HARNESS_HEAD = 'fb2d6bb8e32b32bca9e3b9bff29d62acc53d39ee';
export const OUTPUT_DIR = '/Users/kensmba/.line-harness-5229-B4-STOP-20260903';

const WORKTREE = '/Users/kensmba/.line-harness-wt/5229-private-incoming-media';
const EXECUTOR_FILE = `${WORKTREE}/scripts/incoming-media-public-gate-5229.ts`;
const TEST_FILE = `${WORKTREE}/scripts/incoming-media-public-gate-5229.test.ts`;
const GATE_NAME = 'INCOMING_MEDIA_PUBLIC_BLOCK_ENABLED';
const GATE_VALUE = 'true';

/**
 * The settings PATCH accepts an entire bindings array and supports `type: inherit`,
 * but exposes no strict resolution flag. Cloudflare documents the strict flag only
 * for version upload and warns that, without it, unresolved inherit bindings may be
 * silently dropped. Therefore an append-only, zero-loss settings mutation cannot be
 * made fail-closed under B4's preservation and no-auto-rollback constraints.
 */
export const SAFE_PARTIAL_SETTINGS_PATCH = false as const;
export const STOP_REASON = 'safe_partial_settings_patch_unavailable';
export const API_EVIDENCE = {
  settings_patch: 'PATCH /accounts/{account_id}/workers/scripts/{script_name}/settings',
  settings_patch_strict_inherit: false,
  version_upload_strict_inherit_only: true,
  local_wrangler_version: '4.77.0',
  local_wrangler_behavior: 'get_all_bindings_then_patch_complete_inherit_array',
} as const;

export const PINNED_CURRENT_STATE = {
  deployment_id: '89b40fb5-bfc8-48b1-a7b1-b8f3538bccf7',
  version_id: '5dab4e03-2147-4c34-b5c7-f70c105b4712',
  traffic_percentage: 100,
  script_etag: '41cc0b7544b0466426c08b7b2544c8b161ae4817925803605d68760f85659f1c',
  settings_sha256: 'cf56c8c2c0defabdd7f936915e063a5feb28444971768dea7c8e178dc28d54c8',
  binding_count: 20,
  gate_state: 'absent',
} as const;

export const PREREQUISITE_RECEIPTS = {
  b1: {
    path: '/Users/kensmba/.line-harness-5229-B1-R1-20260903/sanitized-summary.json',
    sha256: 'a3f5e2c411f5b8656427f363549d5ed0952da3937a1c47e47185ea78faa3f785',
  },
  v1: {
    path: '/Users/kensmba/.line-harness-5229-B1-V1-20260903/sanitized-summary.json',
    sha256: '5e3dcbf0a5ae7b5e883788cfa7ce87f9bb411fa1935d885ae2bb10a2f769d3a6',
  },
  b2: {
    path: '/Users/kensmba/.line-harness-5229-B2-20260901/sanitized-summary.json',
    sha256: '5f393930c545582d656c0068ee1d854a01ef8d60e66e1d04e4dca49a0beda95f',
  },
  manifest: {
    path: '/Users/kensmba/.line-harness-5229-M0-20260901/incoming-media-backfill-manifest.json',
    sha256: 'cf35a1045040a265019a5afad8c2cefb8994edba684eeaa5dd2fad0b17b1663e',
  },
  b0: {
    path: '/Users/kensmba/.line-harness-5229-B0-20260903/sanitized-summary.json',
    sha256: null,
  },
  b3: {
    path: '/Users/kensmba/.line-harness-5229-B3-20260903/sanitized-summary.json',
    sha256: null,
  },
} as const;

type OutputIdentity = { dev: number; ino: number };

export interface Dependencies {
  now: () => number;
  outputDir: string;
  validateLocalState: (approvedHarnessHead: string) => string;
}

export class GateStop extends Error {
  constructor(readonly code: string) { super(code); }
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertRealPath(path: string, kind: 'directory' | 'file', mode: number): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) ||
      (stat.mode & 0o777) !== mode) throw new GateStop(`${kind}_state`);
}

function validatePinnedFile(path: string, expectedSha256: string): Buffer {
  assertRealPath(path, 'file', 0o600);
  const bytes = readFileSync(path);
  if (sha256(bytes) !== expectedSha256) throw new GateStop('prerequisite_hash');
  return bytes;
}

export function validateKnownPrerequisites(): void {
  for (const key of ['b1', 'v1', 'b2'] as const) {
    const pin = PREREQUISITE_RECEIPTS[key];
    const directory = pin.path.slice(0, pin.path.lastIndexOf('/'));
    assertRealPath(directory, 'directory', 0o700);
    if (JSON.stringify(readdirSync(directory)) !== JSON.stringify(['sanitized-summary.json'])) {
      throw new GateStop('prerequisite_entries');
    }
    validatePinnedFile(pin.path, pin.sha256);
  }
  const manifest = validatePinnedFile(
    PREREQUISITE_RECEIPTS.manifest.path,
    PREREQUISITE_RECEIPTS.manifest.sha256,
  );
  let value: { entries?: unknown[] };
  try { value = JSON.parse(manifest.toString('utf8')) as { entries?: unknown[] }; }
  catch { throw new GateStop('manifest_json'); }
  if (!Array.isArray(value.entries) || value.entries.length !== 77) {
    throw new GateStop('manifest_count');
  }
}

export function validateLocalState(approvedHarnessHead: string): string {
  if (!/^[0-9a-f]{40}$/.test(approvedHarnessHead)) throw new GateStop('approved_head');
  const git = (args: string[]): string =>
    execFileSync('git', ['-C', WORKTREE, ...args], { encoding: 'utf8' }).trim();
  if (git(['rev-parse', 'HEAD']) !== approvedHarnessHead) throw new GateStop('head_drift');
  try { execFileSync('git', ['-C', WORKTREE, 'merge-base', '--is-ancestor', SOURCE_HARNESS_HEAD, approvedHarnessHead]); }
  catch { throw new GateStop('head_ancestry'); }
  if (git(['status', '--porcelain', '--untracked-files=all']) !== '') throw new GateStop('worktree_dirty');
  assertRealPath(EXECUTOR_FILE, 'file', 0o644);
  assertRealPath(TEST_FILE, 'file', 0o644);
  validateKnownPrerequisites();
  return approvedHarnessHead;
}

export function validateApprovalWindow(received: string, expires: string, now: number): void {
  if (received !== APPROVAL_RECEIVED || expires !== APPROVAL_EXPIRES) {
    throw new GateStop('approval_identity');
  }
  const start = Date.parse(received);
  const end = Date.parse(expires);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== 7_200_000) {
    throw new GateStop('approval_window');
  }
  if (now < start || now >= end) throw new GateStop('approval_inactive');
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
  throw new GateStop('arguments');
}

function createOutput(path: string): OutputIdentity {
  if (existsSync(path)) throw new GateStop('output_exists');
  mkdirSync(path, { mode: 0o700 });
  assertRealPath(path, 'directory', 0o700);
  const stat = lstatSync(path);
  if (readdirSync(path).length !== 0) throw new GateStop('output_entries');
  return { dev: stat.dev, ino: stat.ino };
}

function writeSummary(path: string, identity: OutputIdentity, summary: unknown): void {
  const stat = lstatSync(path);
  if (stat.dev !== identity.dev || stat.ino !== identity.ino || readdirSync(path).length !== 0) {
    throw new GateStop('output_drift');
  }
  const file = `${path}/sanitized-summary.json`;
  writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  assertRealPath(file, 'file', 0o600);
  if (readdirSync(path).length !== 1 || readdirSync(path)[0] !== 'sanitized-summary.json') {
    throw new GateStop('output_drift');
  }
}

function stopSummary(head: string, now: number, localWrites: 0 | 1): Record<string, unknown> {
  return {
    schema_version: 1,
    approval_id: APPROVAL_ID,
    status: 'stopped',
    stop_reason: STOP_REASON,
    observed_at: new Date(now).toISOString(),
    approved_harness_head: head,
    approval_interval: { received: APPROVAL_RECEIVED, expires: APPROVAL_EXPIRES },
    requested_change: { name: GATE_NAME, value: GATE_VALUE },
    api_capability: API_EVIDENCE,
    pinned_current_state: PINNED_CURRENT_STATE,
    prerequisites: {
      pinned_receipts: ['b1', 'v1', 'b2', 'manifest'],
      pending_receipts: ['b0', 'b3'],
      evaluated: false,
    },
    omitted_checks: {
      full_settings_readback: true,
      private_authenticated_health: true,
      legacy_head_404_count: 77,
      terminal_deployment_stability: true,
      reason: 'mutation_not_safe_to_attempt',
    },
    request_counts: {
      cloudflare_get: 0, cloudflare_patch: 0, runtime_read: 0,
      provider_total: 0, provider_write: 0, retry: 0, redirect: 0,
      local_file_write: localWrites,
    },
    mutation: { attempted: false, patch_attempts: 0, automatic_rollback: 0 },
    forbidden_actions: {
      code_deploy: 0, backfill: 0, credential_change: 0, purge: 0,
      r2: 0, line_send: 0, restart: 0, pr_merge: 0,
    },
  };
}

export async function run(raw: string[], deps: Dependencies): Promise<Record<string, unknown>> {
  const args = parseArgs(raw);
  const head = deps.validateLocalState(args.approvedHarnessHead);
  if (existsSync(deps.outputDir)) throw new GateStop('output_exists');
  if (args.preflightOnly) return stopSummary(head, deps.now(), 0);
  validateApprovalWindow(args.received, args.expires, deps.now());
  const identity = createOutput(deps.outputDir);
  const summary = stopSummary(head, deps.now(), 1);
  writeSummary(deps.outputDir, identity, summary);
  return summary;
}

const defaultDeps: Dependencies = {
  now: () => Date.now(),
  outputDir: OUTPUT_DIR,
  validateLocalState,
};

const isCliEntry = (() => {
  if (!argv[1]) return false;
  try { return fileURLToPath(import.meta.url) === argv[1]; } catch { return false; }
})();

if (isCliEntry) {
  run(argv.slice(2), defaultDeps).then((result) => {
    stdout.write(`${JSON.stringify(result)}\n`);
    exit(2);
  }).catch((error: unknown) => {
    stdout.write(`${JSON.stringify({ approval_id: APPROVAL_ID, status: 'stopped',
      stop_reason: error instanceof GateStop ? error.code : 'unexpected_local_error',
      provider_requests: 0, provider_writes: 0 })}\n`);
    exit(1);
  });
}
