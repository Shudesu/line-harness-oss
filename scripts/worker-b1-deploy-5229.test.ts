import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  buildContentUpload,
  loadArtifact,
  loadLegacyProbePath,
  run,
  validateApprovalWindow,
  validateArtifact,
  type ExactRequest,
  type HttpResponse,
  type RunDependencies,
} from './worker-b1-deploy-5229.js';

const RECEIVED = '2026-09-02T07:00:00.000Z';
const EXPIRES = '2026-09-02T09:00:00.000Z';
const NOW = Date.parse('2026-09-02T07:10:00.000Z');
const PRE_DEPLOYMENT = '7b3bb319-e618-4f57-a520-cd33f43115e5';
const PRE_VERSION = 'c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7';
const TARGET_VERSION = '0.19.0-5229.b1.9f3c6c3';
const APPROVED_HEAD = '0123456789abcdef0123456789abcdef01234567';

const bindingPairs = [
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

const settings = {
  compatibility_date: '2024-12-01',
  compatibility_flags: ['nodejs_compat'],
  bindings: bindingPairs.map(([name, type]) => ({ name, type })),
  placement: { mode: 'smart' },
};
const subdomain = { enabled: true, previews_enabled: false };
const schedules = { schedules: [] };

function json(body: unknown, cfRay = 'ray-test'): HttpResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cf-ray': cfRay },
    body: Buffer.from(JSON.stringify(body)),
  };
}

function envelope(result: unknown): HttpResponse {
  return json({ success: true, result });
}

function deployment(id: string, versionId: string): HttpResponse {
  return envelope({ deployments: [{ id, versions: [{ version_id: versionId, percentage: 100 }] }] });
}

function adminVersion(target: boolean): HttpResponse {
  return json({
    version: target ? TARGET_VERSION : '0.19.0',
    worker_hash: target
      ? 'sha256:6420c520444baa670973197f6c336b23a511e9dcd8fdbdf24082b61ce24c2b1e'
      : 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    admin_hash: 'sha256:43e9888fa37af2db1ecdd2f135029ddb570279ebf07373b47d6cb5e62a25ac6c',
    liff_hash: 'sha256:350e651bacbede38ea9f197d0ae6e29903c5b3b219daccf4c62566310cc7ce17',
    released_at: '2026-09-02T06:00:00Z',
  });
}

function migrations(): HttpResponse {
  return json({
    success: true,
    result: [{
      success: true,
      results: [
        { name: '071_incoming_media.sql', checksum: 'sha256:c65203ce28e750b6cf612ad17029bc195fd2e6253a379cf62e642e3c5a8ae5d6' },
        { name: '072_incoming_media_service_credentials.sql', checksum: 'sha256:be4b1730fadd497d0a0d9677bda8626d174aaa08946d1c27e9e68e1549049937' },
      ],
    }],
  });
}

function cfSequence(opts: { postSettings?: unknown; previousVersion?: string } = {}): HttpResponse[] {
  const previousVersion = opts.previousVersion ?? PRE_VERSION;
  return [
    deployment(PRE_DEPLOYMENT, previousVersion), envelope(settings), envelope(subdomain), envelope(schedules),
    migrations(), envelope({ id: 'line-harness', etag: 'provider-etag-not-content-sha' }),
    deployment('11111111-2222-4333-8444-555555555555', '66666666-7777-4888-8999-aaaaaaaaaaaa'),
    envelope(opts.postSettings ?? settings), envelope(subdomain), envelope(schedules),
  ];
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

function outputPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'lh-b1-test-'));
  tempDirs.push(root);
  return join(root, 'receipt');
}

function dependencies(cfResponses: HttpResponse[], workerResponses: HttpResponse[]): {
  deps: RunDependencies;
  cfCalls: ExactRequest[];
  workerCalls: ExactRequest[];
} {
  const cfCalls: ExactRequest[] = [];
  const workerCalls: ExactRequest[] = [];
  const deps: RunDependencies = {
    now: () => NOW,
    loadArtifact,
    loadLegacyProbePath: () => '/images/incoming-safe-account-safe-message.jpg',
    loadToken: () => 'safe-test-token',
    validateLocalAnchors: (approvedHead) => {
      if (approvedHead !== null && approvedHead !== APPROVED_HEAD) throw new Error('planning_head_drift');
      return APPROVED_HEAD;
    },
    outputDir: outputPath(),
    cfRequest: async (spec) => {
      cfCalls.push(spec);
      const response = cfResponses.shift();
      if (!response) throw new Error('unexpected CF request');
      return response;
    },
    workerRequest: async (spec) => {
      workerCalls.push(spec);
      const response = workerResponses.shift();
      if (!response) throw new Error('unexpected Worker request');
      return response;
    },
    sleep: vi.fn(async () => undefined),
  };
  return { deps, cfCalls, workerCalls };
}

describe('exact Worker code-only deploy #5229 B1', () => {
  test('binds the exact artifact and protected legacy probe manifest', () => {
    const artifact = loadArtifact();
    expect(artifact.length).toBe(1_350_194);
    expect(validateArtifact(artifact)).toBe(artifact);
    expect(() => validateArtifact(Buffer.concat([artifact, Buffer.from('\n')]))).toThrow(/artifact_hash/);
    expect(loadLegacyProbePath()).toMatch(/^\/images\/incoming-[^/]+\.jpg$/);
  });

  test('builds content-only multipart without binding or asset metadata', () => {
    const artifact = loadArtifact();
    const body = buildContentUpload(artifact);
    const textPrefix = body.subarray(0, 500).toString('utf8');
    expect(textPrefix).toContain('{"main_module":"worker.js"}');
    expect(textPrefix).toContain('name="worker.js"; filename="worker.js"');
    expect(textPrefix).not.toContain('bindings');
    expect(textPrefix).not.toContain('keep_assets');
    expect(textPrefix).not.toContain('keep_bindings');
    expect(body.indexOf(artifact)).toBeGreaterThan(0);
    expect(body.indexOf(artifact, body.indexOf(artifact) + 1)).toBe(-1);
  });

  test('requires an exact active two-hour approval window', () => {
    expect(() => validateApprovalWindow(RECEIVED, EXPIRES, Date.parse(RECEIVED))).not.toThrow();
    expect(() => validateApprovalWindow(RECEIVED, EXPIRES, Date.parse(EXPIRES))).toThrow(/approval_inactive/);
    expect(() => validateApprovalWindow(RECEIVED, '2026-09-02T09:00:01.000Z', NOW)).toThrow(/approval_window/);
  });

  test('preflight makes zero provider request and creates no receipt path', async () => {
    const fixture = dependencies([], []);
    const result = await run(['--preflight-only'], fixture.deps);
    expect(result).toMatchObject({
      approval_id: '5229-B1-20260902', status: 'preflight_passed',
      artifact_sha256: '1355c7bdffc73dd20bc082fd439a1750fd8b7d5831291c1635cd71396c946de4',
      artifact_bytes: 1_350_194, token_present: true,
      planning_head: APPROVED_HEAD,
      provider_requests: 0, provider_writes: 0, local_writes: 0,
    });
    expect(fixture.cfCalls).toHaveLength(0);
    expect(fixture.workerCalls).toHaveLength(0);
  });

  test('checks the approved exact head before artifact, token, or provider access', async () => {
    const fixture = dependencies([], []);
    const artifact = vi.fn(loadArtifact);
    const token = vi.fn(() => 'safe-test-token');
    fixture.deps.loadArtifact = artifact;
    fixture.deps.loadToken = token;
    fixture.deps.validateLocalAnchors = () => { throw new Error('planning_head_drift'); };
    await expect(run([
      '--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', APPROVED_HEAD,
    ], fixture.deps)).rejects.toThrow(/planning_head_drift/);
    expect(artifact).not.toHaveBeenCalled();
    expect(token).not.toHaveBeenCalled();
    expect(fixture.cfCalls).toHaveLength(0);
    expect(fixture.workerCalls).toHaveLength(0);
  });

  test('performs one content PUT and proves config plus runtime continuity', async () => {
    const fixture = dependencies(cfSequence(), [
      adminVersion(false), adminVersion(true),
      { status: 401, headers: {}, body: Buffer.alloc(0) },
      { status: 200, headers: {}, body: Buffer.alloc(0) },
    ]);
    const result = await run([
      '--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', APPROVED_HEAD,
    ], fixture.deps);
    expect(result).toMatchObject({
      status: 'completed',
      deployment: { previous_deployment_id: PRE_DEPLOYMENT, previous_version_id: PRE_VERSION },
      immutable_config: { binding_count: 20, public_block_gate: 'absent' },
      runtime_readback: { version: TARGET_VERSION, private_unauthenticated_head: 401, legacy_public_head: 200 },
      request_counts: {
        cloudflare_read: 9, worker_content_put: 1, runtime_read: 4,
        runtime_version_polls: 1, provider_total: 14, retry: 0,
      },
    });
    const putCalls = fixture.cfCalls.filter((call) => call.method === 'PUT');
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].path).toBe('/client/v4/accounts/67907592fdf596376bc2097e14a6563a/workers/scripts/line-harness/content');
    expect(putCalls[0].headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(putCalls[0].body?.length).toBe(Number(putCalls[0].headers['Content-Length']));
    expect(fixture.cfCalls.some((call) => call.path.includes('/secrets'))).toBe(false);
    expect(fixture.cfCalls.some((call) => call.path.includes('/assets'))).toBe(false);
    expect(fixture.workerCalls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /admin/version', 'GET /admin/version',
      'HEAD /api/incoming-media/b1-probe-account/b1-probe-message',
      'HEAD /images/incoming-safe-account-safe-message.jpg',
    ]);
    const receipt = JSON.parse(readFileSync(`${fixture.deps.outputDir}/sanitized-summary.json`, 'utf8'));
    expect(receipt.status).toBe('completed');
    expect(JSON.stringify(receipt)).not.toContain('safe-test-token');
    expect(JSON.stringify(receipt)).not.toContain('incoming-safe-account');
  });

  test('stops before PUT on prior deployment drift', async () => {
    const sequence = cfSequence({ previousVersion: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff' });
    const fixture = dependencies(sequence, [adminVersion(false)]);
    await expect(run([
      '--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', APPROVED_HEAD,
    ], fixture.deps)).rejects.toThrow(/previous_deployment_drift/);
    expect(fixture.cfCalls.filter((call) => call.method === 'PUT')).toHaveLength(0);
    expect(JSON.parse(readFileSync(`${fixture.deps.outputDir}/sanitized-summary.json`, 'utf8')))
      .toMatchObject({ status: 'stopped', rollback_required: false });
  });

  test('stops after the single PUT and requests separate rollback on config drift', async () => {
    const changed = { ...settings, placement: { mode: 'off' } };
    const fixture = dependencies(cfSequence({ postSettings: changed }), [adminVersion(false)]);
    await expect(run([
      '--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', APPROVED_HEAD,
    ], fixture.deps)).rejects.toThrow(/settingsSha256_changed/);
    expect(fixture.cfCalls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(JSON.parse(readFileSync(`${fixture.deps.outputDir}/sanitized-summary.json`, 'utf8')))
      .toMatchObject({ status: 'stopped', rollback_required: true });
  });

  test('rejects a public-block gate binding before any write', async () => {
    const gated = {
      ...settings,
      bindings: [...settings.bindings, { name: 'INCOMING_MEDIA_PUBLIC_BLOCK_ENABLED', type: 'plain_text', text: 'true' }],
    };
    const responses = cfSequence();
    responses[1] = envelope(gated);
    const fixture = dependencies(responses, []);
    await expect(run([
      '--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', APPROVED_HEAD,
    ], fixture.deps)).rejects.toThrow(/binding_shape_drift|public_block_gate_drift/);
    expect(fixture.cfCalls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });
});
