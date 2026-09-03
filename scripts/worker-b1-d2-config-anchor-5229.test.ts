import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { getSnapshot, type ExactRequest, type HttpResponse } from './worker-b1-deploy-5229.js';
import {
  AnchorStop,
  canonical,
  parseArgs,
  parseTokenFile,
  run,
  validateApprovalWindow,
  type Dependencies,
} from './worker-b1-d2-config-anchor-5229.js';

const RECEIVED = '2026-09-03T00:00:00.000Z';
const EXPIRES = '2026-09-03T02:00:00.000Z';
const NOW = Date.parse('2026-09-03T00:10:00.000Z');
const HEAD = '881d237873d9aa6ea90a61e60dde8f2f29c707b9';
const DEPLOYMENT = '7b3bb319-e618-4f57-a520-cd33f43115e5';
const VERSION = 'c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7';
const ETAG = '1d9a88703ce2509f372740c140aa18699884b779a82108efdd863484555611b6';
const ADMIN_DEPLOYMENT = '301a632d-dc9a-4655-8368-2d77f8db3b21';
const ADMIN_NAME_SHA256 = '492123998ae432be97e93235fce10a2d5d118fd9eb8be802edd46ae8345ca9a2';
const ACCOUNT = '67907592fdf596376bc2097e14a6563a';
const BASE = `/client/v4/accounts/${ACCOUNT}/workers/scripts/line-harness`;
const tempDirs: string[] = [];

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

function envelope(result: unknown): HttpResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json', 'content-encoding': 'identity' },
    body: Buffer.from(JSON.stringify({ success: true, result })),
  };
}

function settings(marker = 'stable'): Record<string, unknown> {
  const shapes = [
    ['ADMIN_ALLOW_CROSS_SITE', 'secret_text'], ['ADMIN_ORIGIN', 'secret_text'],
    ['ADMIN_PAGES_PROJECT', 'plain_text'], ['ADMIN_PUBLIC_URL', 'plain_text'],
    ['API_KEY', 'secret_text'], ['ASSETS', 'assets'], ['CF_ACCOUNT_ID', 'plain_text'],
    ['D1_DATABASE_ID', 'plain_text'], ['DB', 'd1'], ['IMAGES', 'r2_bucket'],
    ['LIFF_PAGES_PROJECT', 'plain_text'], ['LIFF_PUBLIC_URL', 'plain_text'],
    ['LIFF_URL', 'secret_text'], ['LINE_CHANNEL_ACCESS_TOKEN', 'secret_text'],
    ['LINE_CHANNEL_SECRET', 'secret_text'], ['LINE_LOGIN_CHANNEL_ID', 'secret_text'],
    ['MANIFEST_URL', 'plain_text'], ['WORKER_NAME', 'plain_text'],
    ['WORKER_PUBLIC_URL', 'plain_text'], ['WORKER_URL', 'secret_text'],
  ];
  return {
    compatibility_date: '2024-12-01',
    compatibility_flags: ['nodejs_compat'],
    observability: { enabled: true, marker },
    bindings: shapes.map(([name, type]) => {
      if (name === 'ADMIN_PAGES_PROJECT') return { name, type, text: 'line-harness-admin' };
      if (name === 'LIFF_PAGES_PROJECT') return { name, type, text: '' };
      return { name, type };
    }),
  };
}

function sixResponses(settingsValue = settings()): HttpResponse[] {
  return [
    envelope({ deployments: [{
      id: DEPLOYMENT,
      versions: [{ version_id: VERSION, percentage: 100 }],
    }] }),
    envelope(settingsValue),
    envelope({
      id: VERSION,
      resources: { script: { etag: ETAG }, bindings: [{ name: 'ASSETS', type: 'assets' }] },
    }),
    envelope({ name: 'line-harness-admin', canonical_deployment: { id: ADMIN_DEPLOYMENT } }),
    envelope({ enabled: true, previews_enabled: false }),
    envelope({ schedules: [
      { cron: '* * * * *', created_on: '2026-01-01T00:00:00.000Z' },
      { cron: '0 */6 * * *', modified_on: '2026-01-01T00:00:00.000Z' },
    ] }),
  ];
}

function fixture(responses: HttpResponse[], now: () => number = () => NOW): {
  deps: Dependencies;
  calls: ExactRequest[];
  root: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'lh-5229-b1-d2-'));
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
        const response = responses.shift();
        if (!response) throw new Error('unexpected request');
        return response;
      },
      getSnapshot: async (token, expiresAt, requestCf) => {
        const fixtureNameHash = createHash('sha256').update('line-harness-admin').digest('hex');
        const result = await getSnapshot(token, expiresAt, requestCf, fixtureNameHash);
        // Production stores only the fixed name hash; the private name itself is not a fixture value.
        result.snapshot.adminProjectNameSha256 = ADMIN_NAME_SHA256;
        return result;
      },
    },
  };
}

function actualArgs(): string[] {
  return ['--approval-received', RECEIVED, '--approval-expires', EXPIRES,
    '--approved-harness-head', HEAD];
}

describe('Worker B1-D2 stable configuration anchor', () => {
  test('token parser accepts exactly one assignment and never needs to emit it', () => {
    expect(parseTokenFile("# local\nCLOUDFLARE_API_TOKEN='secret'\nOTHER=value\n")).toBe('secret');
    expect(() => parseTokenFile('CLOUDFLARE_API_TOKEN=a\nCLOUDFLARE_API_TOKEN=b\n'))
      .toThrow(/token_count/);
    expect(() => parseTokenFile('CLOUDFLARE_API_TOKEN =bad\n')).toThrow(/token_format/);
  });

  test('requires the exact CLI forms and a half-open two-hour approval', () => {
    expect(parseArgs(['--preflight-only', '--approved-harness-head', HEAD]))
      .toMatchObject({ preflightOnly: true, approvedHarnessHead: HEAD });
    expect(() => parseArgs(['--preflight-only'])).toThrow(/arguments/);
    expect(() => validateApprovalWindow(RECEIVED, EXPIRES, Date.parse(RECEIVED))).not.toThrow();
    expect(() => validateApprovalWindow(RECEIVED, EXPIRES, Date.parse(EXPIRES))).toThrow(/approval_inactive/);
    expect(() => validateApprovalWindow(RECEIVED, '2026-09-03T01:59:59.999Z', NOW))
      .toThrow(/approval_window/);
  });

  test('preflight checks only token presence with zero provider and local writes', async () => {
    const f = fixture([]);
    let localChecks = 0;
    f.deps.validateLocalState = () => { localChecks += 1; return HEAD; };
    const result = await run(['--preflight-only', '--approved-harness-head', HEAD], f.deps);
    expect(result).toMatchObject({
      status: 'preflight_passed', token_present: true,
      planning_head: HEAD,
      provider_requests: 0, provider_writes: 0, local_writes: 0,
    });
    expect(localChecks).toBe(1);
    expect(f.calls).toHaveLength(0);
    expect(readdirSync(f.root)).toEqual([]);
  });

  test('takes two identical full snapshots in the exact six-GET order and writes hashes/IDs/counts only', async () => {
    const f = fixture([...sixResponses(), ...sixResponses()]);
    const result = await run(actualArgs(), f.deps);
    const onePass = [
      `${BASE}/deployments`, `${BASE}/settings`, `${BASE}/versions/${VERSION}`,
      `/client/v4/accounts/${ACCOUNT}/pages/projects/line-harness-admin`,
      `${BASE}/subdomain`, `${BASE}/schedules`,
    ];
    expect(f.calls.map((call) => call.path)).toEqual([...onePass, ...onePass]);
    expect(f.calls).toHaveLength(12);
    expect(f.calls.every((call) => call.method === 'GET' && call.hostname === 'api.cloudflare.com' &&
      call.body === undefined && call.headers.Authorization === 'Bearer provider-secret-token' &&
      call.headers['Accept-Encoding'] === 'identity')).toBe(true);
    expect(result).toMatchObject({
      status: 'completed', stable_snapshot_count: 2,
      active_deployment_id: DEPLOYMENT, active_version_id: VERSION, worker_script_etag: ETAG,
      binding_count: 20, admin_deployment_id: ADMIN_DEPLOYMENT,
      asset_resource_identity_count: 0,
      request_counts: {
        cloudflare_get: 12, provider_total: 12, retry: 0, redirect: 0,
        provider_write: 0, local_file_write: 1,
      },
    });
    for (const key of ['settings_sha256', 'subdomain_sha256', 'schedules_sha256',
      'binding_shape_sha256', 'settings_asset_binding_sha256', 'version_asset_binding_sha256',
      'admin_project_name_sha256']) {
      expect(result[key]).toMatch(/^[0-9a-f]{64}$/);
    }
    const output = f.deps.outputDir;
    expect((lstatSync(output).mode & 0o777)).toBe(0o700);
    expect(readdirSync(output)).toEqual(['sanitized-summary.json']);
    expect((lstatSync(join(output, 'sanitized-summary.json')).mode & 0o777)).toBe(0o600);
    const receipt = readFileSync(join(output, 'sanitized-summary.json'), 'utf8');
    expect(receipt).not.toContain('provider-secret-token');
    expect(receipt).not.toContain('line-harness-admin');
    expect(receipt).not.toContain('LINE_CHANNEL_ACCESS_TOKEN');
    expect(receipt).not.toContain('created_on');
  });

  test('canonical hashing is independent of object key insertion order', () => {
    const left = { b: [{ y: 2, x: 1 }], a: true };
    const right = { a: true, b: [{ x: 1, y: 2 }] };
    expect(canonical(left)).toBe(canonical(right));
    expect(createHash('sha256').update(canonical(left)).digest('hex')).toMatch(/^[0-9a-f]{64}$/);
  });

  test('full-snapshot drift makes all 12 reads but leaves one owner-only STOP receipt', async () => {
    const f = fixture([...sixResponses(), ...sixResponses(settings('changed'))]);
    await expect(run(actualArgs(), f.deps)).rejects.toThrow(/snapshot_drift/);
    expect(f.calls).toHaveLength(12);
    expect(readdirSync(f.deps.outputDir)).toEqual(['sanitized-summary.json']);
    const receiptPath = join(f.deps.outputDir, 'sanitized-summary.json');
    expect((lstatSync(receiptPath).mode & 0o777)).toBe(0o600);
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as Record<string, unknown>;
    expect(receipt).toMatchObject({
      status: 'stopped', stop_reason: 'snapshot_drift',
      request_counts: { cloudflare_get: 12, retry: 0, redirect: 0, provider_write: 0 },
    });
  });

  test('provider failure stops immediately without retry and never writes response data', async () => {
    const f = fixture(sixResponses());
    let attempts = 0;
    f.deps.cfRequest = async (spec) => {
      f.calls.push(spec);
      attempts += 1;
      throw new Error('private provider response');
    };
    await expect(run(actualArgs(), f.deps)).rejects.toThrow(/provider_or_local_error/);
    expect(attempts).toBe(1);
    const receipt = readFileSync(join(f.deps.outputDir, 'sanitized-summary.json'), 'utf8');
    expect(receipt).toContain('provider_or_local_error');
    expect(receipt).not.toContain('private provider response');
  });

  test('checks approval again after every response and stops at the half-open end', async () => {
    let current = NOW;
    const f = fixture(sixResponses(), () => current);
    f.deps.cfRequest = async (spec) => {
      f.calls.push(spec);
      current = Date.parse(EXPIRES);
      return sixResponses()[0];
    };
    await expect(run(actualArgs(), f.deps)).rejects.toThrow(/approval_inactive/);
    expect(f.calls).toHaveLength(1);
    const receipt = JSON.parse(readFileSync(
      join(f.deps.outputDir, 'sanitized-summary.json'), 'utf8')) as Record<string, unknown>;
    expect(receipt).toMatchObject({ status: 'stopped', stop_reason: 'approval_inactive' });
  });

  test('rejects invalid approved heads before any output or provider request', async () => {
    const f = fixture([]);
    f.deps.validateLocalState = () => { throw new AnchorStop('head_drift'); };
    await expect(run(actualArgs(), f.deps)).rejects.toThrow(/head_drift/);
    expect(f.calls).toHaveLength(0);
    expect(readdirSync(f.root)).toEqual([]);
  });
});
