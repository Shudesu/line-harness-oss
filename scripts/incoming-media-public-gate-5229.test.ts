import { mkdtempSync, readFileSync, readdirSync, rmSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  API_EVIDENCE, APPROVAL_EXPIRES, APPROVAL_RECEIVED, GateStop,
  PINNED_CURRENT_STATE, PREREQUISITE_RECEIPTS, SAFE_PARTIAL_SETTINGS_PATCH,
  STOP_REASON, parseArgs, run, validateApprovalWindow, type Dependencies,
} from './incoming-media-public-gate-5229.js';

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const NOW = Date.parse('2026-09-03T06:40:00.000Z');
const tempDirs: string[] = [];

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

function fixture(): { deps: Dependencies; root: string; validated: string[] } {
  const root = mkdtempSync(join(tmpdir(), 'lh-b4-stop-'));
  tempDirs.push(root);
  const validated: string[] = [];
  return {
    root,
    validated,
    deps: {
      now: () => NOW,
      outputDir: join(root, 'receipt'),
      validateLocalState: (head) => {
        validated.push(head);
        if (head !== HEAD) throw new GateStop('head_drift');
        return head;
      },
    },
  };
}

const approvedArgs = () => [
  '--approval-received', APPROVAL_RECEIVED,
  '--approval-expires', APPROVAL_EXPIRES,
  '--approved-harness-head', HEAD,
];

describe('B4 public incoming-media gate fail-closed executor', () => {
  test('pins the exact blanket interval, current deployed state, and known prerequisite receipts', () => {
    expect(APPROVAL_RECEIVED).toBe('2026-09-03T05:51:46.737Z');
    expect(APPROVAL_EXPIRES).toBe('2026-09-03T07:51:46.737Z');
    expect(PINNED_CURRENT_STATE).toMatchObject({
      deployment_id: '89b40fb5-bfc8-48b1-a7b1-b8f3538bccf7',
      version_id: '5dab4e03-2147-4c34-b5c7-f70c105b4712',
      traffic_percentage: 100,
      settings_sha256: 'cf56c8c2c0defabdd7f936915e063a5feb28444971768dea7c8e178dc28d54c8',
      binding_count: 20,
      gate_state: 'absent',
    });
    expect(PREREQUISITE_RECEIPTS.b1.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(PREREQUISITE_RECEIPTS.v1.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(PREREQUISITE_RECEIPTS.b2.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(PREREQUISITE_RECEIPTS.manifest.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(PREREQUISITE_RECEIPTS.b0.sha256).toBeNull();
    expect(PREREQUISITE_RECEIPTS.b3.sha256).toBeNull();
  });

  test('records why the available settings PATCH cannot satisfy fail-closed preservation', () => {
    expect(SAFE_PARTIAL_SETTINGS_PATCH).toBe(false);
    expect(API_EVIDENCE).toEqual({
      settings_patch: 'PATCH /accounts/{account_id}/workers/scripts/{script_name}/settings',
      settings_patch_strict_inherit: false,
      version_upload_strict_inherit_only: true,
      local_wrangler_version: '4.77.0',
      local_wrangler_behavior: 'get_all_bindings_then_patch_complete_inherit_array',
    });
  });

  test('preflight stops with zero provider and local writes', async () => {
    const f = fixture();
    const value = await run(['--preflight-only', '--approved-harness-head', HEAD], f.deps);
    expect(value).toMatchObject({
      status: 'stopped', stop_reason: STOP_REASON,
      request_counts: { cloudflare_get: 0, cloudflare_patch: 0, runtime_read: 0,
        provider_total: 0, provider_write: 0, local_file_write: 0 },
      mutation: { attempted: false, patch_attempts: 0, automatic_rollback: 0 },
    });
    expect(f.validated).toEqual([HEAD]);
    expect(readdirSync(f.root)).toEqual([]);
  });

  test('approved invocation writes one sanitized STOP receipt and never exposes a transport hook', async () => {
    const f = fixture();
    expect(Object.keys(f.deps).sort()).toEqual(['now', 'outputDir', 'validateLocalState']);
    const value = await run(approvedArgs(), f.deps);
    expect(value).toMatchObject({
      status: 'stopped', stop_reason: STOP_REASON,
      requested_change: { name: 'INCOMING_MEDIA_PUBLIC_BLOCK_ENABLED', value: 'true' },
      prerequisites: { pending_receipts: ['b0', 'b3'], evaluated: false },
      omitted_checks: { private_authenticated_health: true, legacy_head_404_count: 77,
        terminal_deployment_stability: true, reason: 'mutation_not_safe_to_attempt' },
      request_counts: { provider_total: 0, provider_write: 0, local_file_write: 1 },
    });
    const output = f.deps.outputDir;
    expect(readdirSync(output)).toEqual(['sanitized-summary.json']);
    expect(lstatSync(output).mode & 0o777).toBe(0o700);
    const file = join(output, 'sanitized-summary.json');
    expect(lstatSync(file).mode & 0o777).toBe(0o600);
    const text = readFileSync(file, 'utf8');
    expect(text).not.toMatch(/Bearer|api[_ -]?token|secret[_ -]?value/i);
    expect(JSON.parse(text)).toEqual(value);
  });

  test('rejects substituted or expired blanket approval before creating output', async () => {
    expect(() => validateApprovalWindow(
      '2026-09-03T05:52:00.000Z', '2026-09-03T07:52:00.000Z', NOW,
    )).toThrow(/approval_identity/);
    expect(() => validateApprovalWindow(
      APPROVAL_RECEIVED, APPROVAL_EXPIRES, Date.parse(APPROVAL_EXPIRES),
    )).toThrow(/approval_inactive/);
    const f = fixture();
    const shifted = ['--approval-received', '2026-09-03T05:52:00.000Z',
      '--approval-expires', '2026-09-03T07:52:00.000Z', '--approved-harness-head', HEAD];
    await expect(run(shifted, f.deps)).rejects.toThrow(/approval_identity/);
    expect(readdirSync(f.root)).toEqual([]);
  });

  test('rejects argument and approved-head drift without creating output', async () => {
    expect(() => parseArgs(['--preflight-only'])).toThrow(/arguments/);
    const f = fixture();
    await expect(run(['--preflight-only', '--approved-harness-head', 'f'.repeat(40)], f.deps))
      .rejects.toThrow(/head_drift/);
    expect(readdirSync(f.root)).toEqual([]);
  });

  test('refuses to overwrite an existing receipt directory', async () => {
    const f = fixture();
    const first = await run(approvedArgs(), f.deps);
    expect(first.status).toBe('stopped');
    await expect(run(approvedArgs(), f.deps)).rejects.toThrow(/output_exists/);
    expect(readdirSync(f.deps.outputDir)).toEqual(['sanitized-summary.json']);
  });
});
