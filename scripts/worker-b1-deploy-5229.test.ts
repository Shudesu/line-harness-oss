import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  buildContentUpload,
  exactHttpsRequest,
  loadArtifact,
  loadLegacyProbePath,
  run,
  validateApprovalWindow,
  validateArtifact,
  validateD1Receipt,
  validateD2R1Receipt,
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
const ZERO_HASH = 'sha256:' + '0'.repeat(64);
const PREVIOUS_ETAG = '1d9a88703ce2509f372740c140aa18699884b779a82108efdd863484555611b6';

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
  bindings: bindingPairs.map(([name, type]) => ({
    name, type,
    ...(name === 'ADMIN_PAGES_PROJECT' ? { text: 'line-harness-admin' } : {}),
    ...(name === 'LIFF_PAGES_PROJECT' ? { text: '' } : {}),
  })),
  placement: { mode: 'smart' },
};
const subdomain = { enabled: true, previews_enabled: true };
const schedules = { schedules: [{ cron: '* * * * *' }, { cron: '0 */6 * * *' }] };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function fixtureSha(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex');
}

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

function versionResource(id: string, etag: string): HttpResponse {
  return envelope({ id, resources: { script: { etag }, bindings: [{ name: 'ASSETS', type: 'assets' }] } });
}

function adminProject(id = '301a632d-dc9a-4655-8368-2d77f8db3b21'): HttpResponse {
  return envelope({
    name: 'line-harness-admin',
    canonical_deployment: { id },
  });
}

function adminVersion(target: boolean): HttpResponse {
  return json({
    version: target ? TARGET_VERSION : '0.0.0-dev',
    worker_hash: target
      ? 'sha256:6420c520444baa670973197f6c336b23a511e9dcd8fdbdf24082b61ce24c2b1e'
      : ZERO_HASH,
    admin_hash: ZERO_HASH,
    liff_hash: ZERO_HASH,
    released_at: target ? '2026-09-02T06:00:00Z' : '1970-01-01T00:00:00Z',
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
  const newVersion = '66666666-7777-4888-8999-aaaaaaaaaaaa';
  return [
    deployment(PRE_DEPLOYMENT, previousVersion), envelope(settings), versionResource(previousVersion, PREVIOUS_ETAG),
    adminProject(), envelope(subdomain), envelope(schedules),
    migrations(),
    deployment(PRE_DEPLOYMENT, previousVersion), envelope(settings), versionResource(previousVersion, PREVIOUS_ETAG),
    adminProject(), envelope(subdomain), envelope(schedules),
    envelope({ id: 'line-harness', etag: 'provider-etag-not-content-sha' }),
    deployment('11111111-2222-4333-8444-555555555555', newVersion),
    envelope(opts.postSettings ?? settings), versionResource(newVersion, '2'.repeat(64)),
    adminProject(), envelope(subdomain), envelope(schedules),
    deployment('11111111-2222-4333-8444-555555555555', newVersion),
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
    expectedAdminProjectNameSha256: createHash('sha256').update('line-harness-admin').digest('hex'),
    expectedSettingsSha256: fixtureSha(settings),
    expectedSubdomainSha256: fixtureSha(subdomain),
    expectedSchedulesSha256: fixtureSha(schedules),
    expectedBindingShapeSha256: fixtureSha(bindingPairs.map(([name, type]) => ({ name, type }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.type.localeCompare(b.type))),
  };
  return { deps, cfCalls, workerCalls };
}

describe('exact Worker code-only deploy #5229 B1-R1', () => {
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

  test('rejects a response that completes at the approval expiry boundary', async () => {
    const response = Object.assign(new EventEmitter(), {
      statusCode: 200,
      headers: {},
      read: () => null,
    });
    const requestImpl = vi.fn((_options, callback: (value: never) => void) => {
      const req = Object.assign(new EventEmitter(), {
        end: () => {
          callback(response as never);
          response.emit('end');
        },
        destroy: (error?: Error) => { if (error) req.emit('error', error); },
      });
      return req as never;
    });
    const now = vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(1_000);
    await expect(exactHttpsRequest({
      hostname: 'api.cloudflare.com', method: 'GET', path: '/test',
      headers: { 'Accept-Encoding': 'identity' }, maxBytes: 1_024,
    }, 1_000, requestImpl, now)).rejects.toThrow(/approval_expired/);
  });

  test('validates the exact sanitized D1 evidence contract', () => {
    const receipt = {
      status: 'completed', active_deployment_id: PRE_DEPLOYMENT, active_version_id: PRE_VERSION,
      stable_active_snapshot: true, legacy_build_identity: 'unstamped_unknown',
      worker_resource: {
        worker_script_etag: PREVIOUS_ETAG,
        version_asset_binding_digest: '8fcf498813511a591cb5d595bc281fee2d45f7a27a87f124257a319b543d04c6',
        asset_resource_identity_available: false,
      },
      topology: {
        liff_topology: 'worker_assets',
        settings_asset_binding_digest: '8fcf498813511a591cb5d595bc281fee2d45f7a27a87f124257a319b543d04c6',
        liff_pages: null,
        admin_pages: {
          project_name_sha256: '492123998ae432be97e93235fce10a2d5d118fd9eb8be802edd46ae8345ca9a2',
          canonical_deployment_id: '301a632d-dc9a-4655-8368-2d77f8db3b21',
        },
      },
      request_counts: { cloudflare_get: 5, provider_total: 5, retry: 0, writes: 0 },
    };
    expect(() => validateD1Receipt(receipt)).not.toThrow();
    expect(() => validateD1Receipt({ ...receipt, stable_active_snapshot: false })).toThrow(/d1_receipt_shape/);
  });

  test('validates the exact completed D2-R1 configuration anchor', () => {
    const receipt = {
      approval_id: '5229-B1-D2-R1-20260903',
      status: 'completed',
      stable_snapshot_count: 2,
      active_deployment_id: PRE_DEPLOYMENT,
      active_version_id: PRE_VERSION,
      worker_script_etag: PREVIOUS_ETAG,
      settings_sha256: '107835eb17613fa3789f34a913ced66be79b9dc48fa8666276bf2feed9a51abc',
      subdomain_sha256: '81d85b2e35295c30a89a15cfce655824db618966f23be5b068d6f55c545429f3',
      schedules_sha256: 'ba94fb8a9b24fb239e7de571c5b281dd302cc139821d28fa7f12721ef2cd1849',
      binding_shape_sha256: 'cdc3ac05d11170d7d795274d4a873576358eeaf86737e0b78931c81b59dc19a4',
      binding_count: 20,
      settings_asset_binding_sha256: '8fcf498813511a591cb5d595bc281fee2d45f7a27a87f124257a319b543d04c6',
      version_asset_binding_sha256: '8fcf498813511a591cb5d595bc281fee2d45f7a27a87f124257a319b543d04c6',
      admin_project_name_sha256: '492123998ae432be97e93235fce10a2d5d118fd9eb8be802edd46ae8345ca9a2',
      admin_deployment_id: '301a632d-dc9a-4655-8368-2d77f8db3b21',
      asset_resource_identity_count: 0,
      request_counts: {
        cloudflare_get: 12, provider_total: 12, retry: 0, redirect: 0,
        provider_write: 0, local_file_write: 1,
      },
    };
    expect(() => validateD2R1Receipt(receipt)).not.toThrow();
    expect(() => validateD2R1Receipt({ ...receipt, settings_sha256: '0'.repeat(64) }))
      .toThrow(/d2_r1_receipt_shape/);
  });

  test('stops before runtime and PUT when the full config differs from D2-R1', async () => {
    const responses = cfSequence();
    responses[1] = envelope({ ...settings, observability: { enabled: true, drift: true } });
    const fixture = dependencies(responses, []);
    await expect(run([
      '--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', APPROVED_HEAD,
    ], fixture.deps)).rejects.toThrow(/d2_r1_snapshot_drift/);
    expect(fixture.workerCalls).toHaveLength(0);
    expect(fixture.cfCalls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });

  test('preflight makes zero provider request and creates no receipt path', async () => {
    const fixture = dependencies([], []);
    const result = await run(['--preflight-only', '--approved-harness-head', APPROVED_HEAD], fixture.deps);
    expect(result).toMatchObject({
      approval_id: '5229-B1-R1-20260903', status: 'preflight_passed',
      artifact_sha256: '07dcc5ef5504bf2ae70286fad2d356444beb7626f6d64faa920ea7b3c33b19c1',
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
    ]);
    const result = await run([
      '--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', APPROVED_HEAD,
    ], fixture.deps);
    expect(result).toMatchObject({
      status: 'completed',
      deployment: { previous_deployment_id: PRE_DEPLOYMENT, previous_version_id: PRE_VERSION },
      immutable_config: {
        binding_count: 20, public_block_gate: 'absent',
        asset_identity: 'legacy_unknown',
        admin_pages_deployment_id: '301a632d-dc9a-4655-8368-2d77f8db3b21',
      },
      runtime_readback: { version: TARGET_VERSION, private_unauthenticated_head: 401 },
      request_counts: {
        cloudflare_read: 20, worker_content_put: 1, runtime_read: 3,
        runtime_version_polls: 1, provider_total: 24, retry: 0,
      },
      mutation: { stage: 'completed', outcome: 'accepted', put_attempts: 1 },
    });
    const putCalls = fixture.cfCalls.filter((call) => call.method === 'PUT');
    expect(putCalls).toHaveLength(1);
    expect(putCalls[0].path).toBe('/client/v4/accounts/67907592fdf596376bc2097e14a6563a/workers/scripts/line-harness/content');
    expect(putCalls[0].headers['Content-Type']).toMatch(/^multipart\/form-data; boundary=/);
    expect(putCalls[0].body?.length).toBe(Number(putCalls[0].headers['Content-Length']));
    expect(fixture.cfCalls.some((call) => call.path.includes('/secrets'))).toBe(false);
    expect(fixture.cfCalls.some((call) => call.path.includes('/assets'))).toBe(false);
    const base = '/client/v4/accounts/67907592fdf596376bc2097e14a6563a/workers/scripts/line-harness';
    const snapshotPaths = (version: string) => [
      `${base}/deployments`, `${base}/settings`, `${base}/versions/${version}`,
      '/client/v4/accounts/67907592fdf596376bc2097e14a6563a/pages/projects/line-harness-admin',
      `${base}/subdomain`, `${base}/schedules`,
    ];
    expect(fixture.cfCalls.filter((call) => call.method === 'GET').map((call) => call.path)).toEqual([
      ...snapshotPaths(PRE_VERSION),
      ...snapshotPaths(PRE_VERSION),
      ...snapshotPaths('66666666-7777-4888-8999-aaaaaaaaaaaa'),
      `${base}/deployments`,
    ]);
    expect(fixture.workerCalls.map((call) => `${call.method} ${call.path}`)).toEqual([
      'GET /admin/version', 'GET /admin/version',
      'HEAD /api/incoming-media/b1-probe-account/b1-probe-message',
    ]);
    expect(fixture.cfCalls.map((call) => `${call.method} ${call.path}`)).toEqual([
      ...fixture.cfCalls.slice(0, 6).map((call) => `GET ${call.path}`),
      'POST /client/v4/accounts/67907592fdf596376bc2097e14a6563a/d1/database/c19584d7-e9f1-4d46-83c5-6c0ba96561d1/query',
      ...fixture.cfCalls.slice(7, 13).map((call) => `GET ${call.path}`),
      'PUT /client/v4/accounts/67907592fdf596376bc2097e14a6563a/workers/scripts/line-harness/content',
      ...fixture.cfCalls.slice(14).map((call) => `GET ${call.path}`),
    ]);
    const d1Call = fixture.cfCalls[6];
    expect(d1Call.hostname).toBe('api.cloudflare.com');
    expect(d1Call.maxBytes).toBe(65_536);
    expect(d1Call.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(d1Call.body?.toString('utf8') ?? '')).toEqual({
      sql: 'SELECT name, checksum FROM _line_harness_migrations WHERE name IN (?, ?) ORDER BY name',
      params: ['071_incoming_media.sql', '072_incoming_media_service_credentials.sql'],
    });
    for (const call of fixture.cfCalls) {
      expect(call.hostname).toBe('api.cloudflare.com');
      expect(call.headers.Authorization).toBe('Bearer safe-test-token');
      expect(call.headers['Accept-Encoding']).toBe('identity');
      expect(call.maxBytes).toBe(call.method === 'POST' ? 65_536 : 262_144);
      const expectedHeaders = call.method === 'GET'
        ? ['Accept-Encoding', 'Authorization']
        : ['Accept-Encoding', 'Authorization', 'Content-Length', 'Content-Type'];
      expect(Object.keys(call.headers).sort()).toEqual(expectedHeaders.sort());
    }
    for (const call of fixture.workerCalls) {
      expect(call.hostname).toBe('line-harness.family8office.workers.dev');
      expect(call.headers).toEqual({ 'Accept-Encoding': 'identity' });
      expect(call.maxBytes).toBe(call.method === 'HEAD' ? 1_024 : 8_192);
    }
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

  test('records an unknown mutation outcome for a rejected content PUT response', async () => {
    const responses = cfSequence();
    responses[13] = {
      status: 500,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"success":false,"result":null}'),
    };
    const fixture = dependencies(responses, [adminVersion(false)]);
    await expect(run([
      '--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', APPROVED_HEAD,
    ], fixture.deps)).rejects.toThrow(/content_put_status/);
    const receipt = JSON.parse(readFileSync(`${fixture.deps.outputDir}/sanitized-summary.json`, 'utf8'));
    expect(receipt).toMatchObject({
      status: 'stopped', rollback_required: true, observed_post_state: null,
      mutation: { stage: 'content_put_in_flight', outcome: 'unknown', put_attempts: 1 },
    });
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

  test('stops before PUT when the active version asset binding changes', async () => {
    const responses = cfSequence();
    responses[2] = envelope({
      id: PRE_VERSION,
      resources: { script: { etag: PREVIOUS_ETAG }, bindings: [{ name: 'ASSETS', type: 'assets', version_id: 'drift' }] },
    });
    const fixture = dependencies(responses, []);
    await expect(run([
      '--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', APPROVED_HEAD,
    ], fixture.deps)).rejects.toThrow(/version_asset_drift/);
    expect(fixture.cfCalls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });

  test('stops before PUT when the prior script etag changed', async () => {
    const responses = cfSequence();
    responses[2] = versionResource(PRE_VERSION, '3'.repeat(64));
    const fixture = dependencies(responses, []);
    await expect(run([
      '--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', APPROVED_HEAD,
    ], fixture.deps)).rejects.toThrow(/previous_script_etag_drift/);
    expect(fixture.cfCalls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });

  test('stops before PUT unless all five D0 sentinel fields match', async () => {
    const wrongWorker = json({
      version: '0.0.0-dev',
      worker_hash: 'sha256:' + 'a'.repeat(64),
      admin_hash: ZERO_HASH,
      liff_hash: ZERO_HASH,
      released_at: '1970-01-01T00:00:00Z',
    });
    const fixture = dependencies(cfSequence(), [wrongWorker]);
    await expect(run([
      '--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', APPROVED_HEAD,
    ], fixture.deps)).rejects.toThrow(/pre_version_drift/);
    expect(fixture.cfCalls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });

  test('stops before PUT unless subdomain and cron state match the approved semantics', async () => {
    const subdomainResponses = cfSequence();
    subdomainResponses[4] = envelope({ enabled: true, previews_enabled: false });
    const subdomainFixture = dependencies(subdomainResponses, []);
    await expect(run([
      '--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', APPROVED_HEAD,
    ], subdomainFixture.deps)).rejects.toThrow(/subdomain_drift/);
    expect(subdomainFixture.cfCalls.filter((call) => call.method === 'PUT')).toHaveLength(0);

    const scheduleResponses = cfSequence();
    scheduleResponses[5] = envelope({ schedules: [{ cron: '* * * * *' }] });
    const scheduleFixture = dependencies(scheduleResponses, []);
    await expect(run([
      '--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', APPROVED_HEAD,
    ], scheduleFixture.deps)).rejects.toThrow(/schedules_drift/);
    expect(scheduleFixture.cfCalls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });

  test('stops before PUT if the active deployment changes after migration readback', async () => {
    const responses = cfSequence();
    const driftVersion = '11111111-2222-4333-8444-555555555555';
    responses[7] = deployment(
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      driftVersion,
    );
    responses[9] = versionResource(driftVersion, PREVIOUS_ETAG);
    const fixture = dependencies(responses, [adminVersion(false)]);
    await expect(run([
      '--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', APPROVED_HEAD,
    ], fixture.deps)).rejects.toThrow(/pre_put_snapshot_drift/);
    expect(fixture.cfCalls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });

  test('stops before PUT if settings change after migration readback', async () => {
    const responses = cfSequence();
    responses[8] = envelope({ ...settings, placement: { mode: 'off' } });
    const fixture = dependencies(responses, [adminVersion(false)]);
    await expect(run([
      '--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', APPROVED_HEAD,
    ], fixture.deps)).rejects.toThrow(/pre_put_snapshot_drift/);
    expect(fixture.cfCalls.filter((call) => call.method === 'PUT')).toHaveLength(0);
  });

  test('stops after PUT if the Admin Pages deployment changes', async () => {
    const responses = cfSequence();
    responses[17] = adminProject('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    const fixture = dependencies(responses, [adminVersion(false)]);
    await expect(run([
      '--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', APPROVED_HEAD,
    ], fixture.deps)).rejects.toThrow(/admin_pages_drift/);
    expect(fixture.cfCalls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(fixture.cfCalls.filter((call) => call.method === 'POST')).toHaveLength(1);
    expect(fixture.cfCalls.some((call) => call.path.includes('/rollback'))).toBe(false);
    const receipt = JSON.parse(readFileSync(`${fixture.deps.outputDir}/sanitized-summary.json`, 'utf8'));
    expect(receipt).toMatchObject({ status: 'stopped', rollback_required: true });
    expect(JSON.stringify(receipt)).not.toContain('safe-test-token');
    expect(JSON.stringify(receipt)).not.toContain('line-harness-admin');
  });

  test('stops after PUT if the active deployment changes after runtime readback', async () => {
    const responses = cfSequence();
    responses[20] = deployment(
      'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
      '11111111-2222-4333-8444-555555555555',
    );
    const fixture = dependencies(responses, [
      adminVersion(false), adminVersion(true),
      { status: 401, headers: {}, body: Buffer.alloc(0) },
    ]);
    await expect(run([
      '--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', APPROVED_HEAD,
    ], fixture.deps)).rejects.toThrow(/post_readback_deployment_drift/);
    expect(fixture.cfCalls.filter((call) => call.method === 'PUT')).toHaveLength(1);
    expect(fixture.cfCalls.some((call) => call.path.includes('/rollback'))).toBe(false);
    const receipt = JSON.parse(readFileSync(`${fixture.deps.outputDir}/sanitized-summary.json`, 'utf8'));
    expect(receipt).toMatchObject({
      status: 'stopped', rollback_required: true,
      mutation: { stage: 'post_write_readback', outcome: 'accepted', put_attempts: 1 },
    });
  });
});
