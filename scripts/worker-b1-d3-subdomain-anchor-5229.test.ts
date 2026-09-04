import { createHash } from 'node:crypto';
import {
  chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  canonical,
  parseArgs,
  parseTokenFile,
  run,
  SubdomainStop,
  validateApprovalWindow,
  validateReceiptArtifact,
  type Dependencies,
} from './worker-b1-d3-subdomain-anchor-5229.js';
import type { ExactRequest, HttpResponse } from './worker-b1-deploy-5229.js';

const RECEIVED = '2026-09-03T05:30:00.000Z';
const EXPIRES = '2026-09-03T07:30:00.000Z';
const NOW = Date.parse('2026-09-03T05:40:00.000Z');
const HEAD = '8d2bde586d0a881ec738e824b47bdf3bbd09e8cd';
const PATH = '/client/v4/accounts/67907592fdf596376bc2097e14a6563a/workers/scripts/line-harness/subdomain';
const tempDirs: string[] = [];

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

function response(result: unknown): HttpResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-encoding': 'identity' },
    body: Buffer.from(JSON.stringify({ success: true, result })),
  };
}

function fixture(responses: HttpResponse[], now: () => number = () => NOW): {
  deps: Dependencies;
  calls: ExactRequest[];
  root: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'lh-5229-b1-d3-'));
  tempDirs.push(root);
  const calls: ExactRequest[] = [];
  return {
    root,
    calls,
    deps: {
      now,
      loadToken: () => 'provider-secret-token',
      validateLocalState: (head) => head,
      outputDir: join(root, 'receipt'),
      cfRequest: async (spec) => {
        calls.push(spec);
        const next = responses.shift();
        if (!next) throw new Error('unexpected request');
        return next;
      },
    },
  };
}

function actualArgs(): string[] {
  return ['--approval-received', RECEIVED, '--approval-expires', EXPIRES,
    '--approved-harness-head', HEAD];
}

describe('Worker B1-D3 subdomain discovery', () => {
  test('requires exact CLI forms, token assignment, and half-open two-hour approval', () => {
    expect(parseArgs(['--preflight-only', '--approved-harness-head', HEAD]))
      .toMatchObject({ preflightOnly: true, approvedHarnessHead: HEAD });
    expect(() => parseArgs(['--preflight-only'])).toThrow(/arguments/);
    expect(parseTokenFile("CLOUDFLARE_API_TOKEN='secret'\n")).toBe('secret');
    expect(() => parseTokenFile('CLOUDFLARE_API_TOKEN=a\nCLOUDFLARE_API_TOKEN=b\n'))
      .toThrow(/token_count/);
    expect(() => validateApprovalWindow(RECEIVED, EXPIRES, Date.parse(RECEIVED))).not.toThrow();
    expect(() => validateApprovalWindow(RECEIVED, EXPIRES, Date.parse(EXPIRES)))
      .toThrow(/approval_inactive/);
  });

  test('validates the immutable D2 STOP receipt before provider access', () => {
    const root = mkdtempSync(join(tmpdir(), 'lh-5229-b1-d2-receipt-'));
    tempDirs.push(root);
    const directory = join(root, 'receipt');
    const file = join(directory, 'sanitized-summary.json');
    mkdirSync(directory, { mode: 0o700 });
    const receipt = JSON.stringify({
      approval_id: '5229-B1-D2-20260903',
      approved_harness_head: HEAD,
      status: 'stopped',
      stop_reason: 'subdomain_drift',
      request_counts: {
        cloudflare_get: 6, provider_total: 6, retry: 0, redirect: 0,
        provider_write: 0, local_file_write: 1,
      },
    });
    writeFileSync(file, receipt, { mode: 0o600 });
    const digest = createHash('sha256').update(receipt).digest('hex');
    expect(() => validateReceiptArtifact(directory, file, digest)).not.toThrow();
    writeFileSync(file, `${receipt}\n`);
    expect(() => validateReceiptArtifact(directory, file, digest)).toThrow(/d2_receipt_sha256/);
    writeFileSync(file, receipt);
    chmodSync(file, 0o644);
    expect(() => validateReceiptArtifact(directory, file, digest)).toThrow(/file_state/);
    chmodSync(file, 0o600);
    writeFileSync(join(directory, 'extra'), 'x', { mode: 0o600 });
    expect(() => validateReceiptArtifact(directory, file, digest)).toThrow(/d2_receipt_entries/);
    rmSync(join(directory, 'extra'));
    rmSync(file);
    symlinkSync('/dev/null', file);
    expect(() => validateReceiptArtifact(directory, file, digest)).toThrow(/file_state/);
  });

  test('preflight checks token presence with zero provider and local writes', async () => {
    const f = fixture([]);
    let checks = 0;
    f.deps.validateLocalState = (head) => { checks += 1; return head; };
    const result = await run(['--preflight-only', '--approved-harness-head', HEAD], f.deps);
    expect(result).toMatchObject({
      status: 'preflight_passed', planning_head: HEAD, token_present: true,
      provider_requests: 0, provider_writes: 0, local_writes: 0,
    });
    expect(checks).toBe(1);
    expect(f.calls).toHaveLength(0);
    expect(readdirSync(f.root)).toEqual([]);
  });

  test.each([
    { enabled: true, previews_enabled: true },
    { enabled: true, previews_enabled: false },
    { enabled: false, previews_enabled: false },
  ])('discovers two stable schema-valid states: %j', async (state) => {
    const f = fixture([response(state), response(state)]);
    const result = await run(actualArgs(), f.deps);
    expect(f.calls).toHaveLength(2);
    expect(f.calls.every((call) => call.hostname === 'api.cloudflare.com' &&
      call.method === 'GET' && call.path === PATH && call.body === undefined &&
      call.headers.Authorization === 'Bearer provider-secret-token' &&
      call.headers['Accept-Encoding'] === 'identity')).toBe(true);
    expect(result).toMatchObject({
      status: 'completed', stable_snapshot_count: 2, subdomain: state,
      request_counts: {
        cloudflare_get: 2, provider_total: 2, retry: 0, redirect: 0,
        provider_write: 0, local_file_write: 1,
      },
    });
    expect(result.subdomain_sha256).toBe(
      createHash('sha256').update(canonical(state)).digest('hex'));
    const output = f.deps.outputDir;
    expect((lstatSync(output).mode & 0o777)).toBe(0o700);
    expect(readdirSync(output)).toEqual(['sanitized-summary.json']);
    const receiptPath = join(output, 'sanitized-summary.json');
    expect((lstatSync(receiptPath).mode & 0o777)).toBe(0o600);
    const receipt = readFileSync(receiptPath, 'utf8');
    expect(receipt).not.toContain('provider-secret-token');
    expect(receipt).not.toContain('Authorization');
  });

  test('stops when the two subdomain snapshots differ', async () => {
    const f = fixture([
      response({ enabled: true, previews_enabled: false }),
      response({ enabled: true, previews_enabled: true }),
    ]);
    await expect(run(actualArgs(), f.deps)).rejects.toThrow(/subdomain_snapshot_drift/);
    expect(f.calls).toHaveLength(2);
    const receipt = JSON.parse(readFileSync(
      join(f.deps.outputDir, 'sanitized-summary.json'), 'utf8')) as Record<string, unknown>;
    expect(receipt).toMatchObject({
      status: 'stopped', stop_reason: 'subdomain_snapshot_drift',
      request_counts: { cloudflare_get: 2, provider_write: 0 },
    });
    expect(receipt).not.toHaveProperty('subdomain');
  });

  test.each([
    {},
    { enabled: true },
    { enabled: true, previews_enabled: false, extra: false },
    { enabled: 'true', previews_enabled: false },
  ])('rejects malformed subdomain state without retry: %j', async (state) => {
    const f = fixture([response(state)]);
    await expect(run(actualArgs(), f.deps)).rejects.toThrow(/subdomain_shape/);
    expect(f.calls).toHaveLength(1);
  });

  test('provider failure stops once and never writes private error data', async () => {
    const f = fixture([]);
    f.deps.cfRequest = async (spec) => {
      f.calls.push(spec);
      throw new Error('private provider response');
    };
    await expect(run(actualArgs(), f.deps)).rejects.toThrow(/provider_or_local_error/);
    expect(f.calls).toHaveLength(1);
    const receipt = readFileSync(join(f.deps.outputDir, 'sanitized-summary.json'), 'utf8');
    expect(receipt).toContain('provider_or_local_error');
    expect(receipt).not.toContain('private provider response');
  });

  test('checks approval after a response and rejects head drift before output', async () => {
    let current = NOW;
    const f = fixture([response({ enabled: true, previews_enabled: false })], () => current);
    f.deps.cfRequest = async (spec) => {
      f.calls.push(spec);
      current = Date.parse(EXPIRES);
      return response({ enabled: true, previews_enabled: false });
    };
    await expect(run(actualArgs(), f.deps)).rejects.toThrow(/approval_inactive/);
    expect(f.calls).toHaveLength(1);

    const rejected = fixture([]);
    rejected.deps.validateLocalState = () => { throw new SubdomainStop('head_drift'); };
    await expect(run(actualArgs(), rejected.deps)).rejects.toThrow(/head_drift/);
    expect(rejected.calls).toHaveLength(0);
    expect(readdirSync(rejected.root)).toEqual([]);
  });
});
