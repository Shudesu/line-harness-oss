import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import type { ExactRequest, HttpResponse, WorkerSnapshot } from './worker-b1-deploy-5229.js';
import {
  parseActiveDeployment, parseVersionSemantic, run, validateApprovalWindow,
  validateB1Receipt, VerifyStop, type Dependencies,
} from './worker-b1-v1-postdeploy-readback-5229.js';

const RECEIVED = '2026-09-03T05:51:46.737Z';
const EXPIRES = '2026-09-03T07:51:46.737Z';
const NOW = Date.parse('2026-09-03T06:10:00Z');
const HEAD = '90d518576749bd63f39ba6876132f6091fe6aedd';
const OLD_DEPLOYMENT = '7b3bb319-e618-4f57-a520-cd33f43115e5';
const OLD_VERSION = 'c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7';
const OLD_ETAG = '1d9a88703ce2509f372740c140aa18699884b779a82108efdd863484555611b6';
const NEW_DEPLOYMENT = '89b40fb5-bfc8-48b1-a7b1-b8f3538bccf7';
const NEW_VERSION = '5dab4e03-2147-4c34-b5c7-f70c105b4712';
const NEW_ETAG = '41cc0b7544b0466426c08b7b2544c8b161ae4817925803605d68760f85659f1c';
const ZERO_HASH = 'sha256:' + '0'.repeat(64);
const tempDirs: string[] = [];

afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true });
});

function response(value: unknown, status = 200): HttpResponse {
  return { status, headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify(value)) };
}
function envelope(result: unknown): HttpResponse { return response({ success: true, result }); }
function deployments(id = NEW_DEPLOYMENT, versionId = NEW_VERSION): HttpResponse {
  return envelope({ deployments: [{ id, versions: [{ version_id: versionId, percentage: 100 }] }] });
}

const bindings = [
  ['ADMIN_ALLOW_CROSS_SITE', 'secret_text'], ['ADMIN_ORIGIN', 'secret_text'],
  ['ADMIN_PAGES_PROJECT', 'plain_text'], ['ADMIN_PUBLIC_URL', 'plain_text'],
  ['API_KEY', 'secret_text'], ['ASSETS', 'assets'], ['CF_ACCOUNT_ID', 'plain_text'],
  ['D1_DATABASE_ID', 'plain_text'], ['DB', 'd1'], ['IMAGES', 'r2_bucket'],
  ['LIFF_PAGES_PROJECT', 'plain_text'], ['LIFF_PUBLIC_URL', 'plain_text'],
  ['LIFF_URL', 'secret_text'], ['LINE_CHANNEL_ACCESS_TOKEN', 'secret_text'],
  ['LINE_CHANNEL_SECRET', 'secret_text'], ['LINE_LOGIN_CHANNEL_ID', 'secret_text'],
  ['MANIFEST_URL', 'plain_text'], ['WORKER_NAME', 'plain_text'],
  ['WORKER_PUBLIC_URL', 'plain_text'], ['WORKER_URL', 'secret_text'],
].map(([name, type]) => type === 'plain_text' ? { name, type, text: `${name}-value` } : { name, type });

function version(id: string, etag: string, bindingRows = bindings,
  extra: Record<string, unknown> = {}): HttpResponse {
  return envelope({ id, number: id === OLD_VERSION ? 10 : 11,
    metadata: { created_on: id, source: 'api' }, annotations: { 'workers/triggered_by': 'api' },
    resources: {
      bindings: bindingRows, script_runtime: { usage_model: 'standard' },
      script: { etag, last_deployed_from: id === OLD_VERSION ? 'wrangler' : 'api',
        handlers: ['fetch'], named_handlers: [] },
    }, ...extra });
}

function snapshot(): WorkerSnapshot {
  return {
    deploymentId: NEW_DEPLOYMENT, versionId: NEW_VERSION,
    settings: { bindings }, settingsSha256: createHash('sha256').update('new-settings').digest('hex'),
    subdomain: { enabled: true, previews_enabled: true },
    subdomainSha256: '81d85b2e35295c30a89a15cfce655824db618966f23be5b068d6f55c545429f3',
    schedules: { schedules: [] },
    schedulesSha256: 'ba94fb8a9b24fb239e7de571c5b281dd302cc139821d28fa7f12721ef2cd1849',
    bindingShape: bindings.map(({ name, type }) => ({ name, type })), scriptEtag: NEW_ETAG,
    versionAssetBindingDigest: '8fcf498813511a591cb5d595bc281fee2d45f7a27a87f124257a319b543d04c6',
    assetResourceIdentityAvailable: false,
    settingsAssetBindingDigest: '8fcf498813511a591cb5d595bc281fee2d45f7a27a87f124257a319b543d04c6',
    adminProjectNameSha256: '492123998ae432be97e93235fce10a2d5d118fd9eb8be802edd46ae8345ca9a2',
    adminDeploymentId: '301a632d-dc9a-4655-8368-2d77f8db3b21',
  };
}

function fixture(): { deps: Dependencies; state: { cfCalls: number; workerCalls: number }; root: string } {
  const root = mkdtempSync(join(tmpdir(), 'lh-b1-v1-'));
  tempDirs.push(root);
  const state = { cfCalls: 0, workerCalls: 0 };
  const deps: Dependencies = {
    now: () => NOW, loadToken: () => 'secret-token',
    loadLegacyProbe: () => ({ path: '/images/frozen.jpg', mimeType: 'image/jpeg', byteSize: 123 }),
    validateLocalState: () => HEAD, outputDir: join(root, 'receipt'),
    cfRequest: async (spec) => {
      state.cfCalls += 1;
      if (spec.path.endsWith('/deployments')) return deployments();
      if (spec.path.endsWith(`/versions/${OLD_VERSION}`)) return version(OLD_VERSION, OLD_ETAG);
      if (spec.path.endsWith(`/versions/${NEW_VERSION}`)) return version(NEW_VERSION, NEW_ETAG);
      return envelope({});
    },
    workerRequest: async (spec) => {
      state.workerCalls += 1;
      if (spec.path === '/admin/version') return response({ version: '0.19.0-5229.b1.9f3c6c3',
        worker_hash: 'sha256:6420c520444baa670973197f6c336b23a511e9dcd8fdbdf24082b61ce24c2b1e',
        admin_hash: ZERO_HASH, liff_hash: ZERO_HASH, released_at: '2026-09-03T06:00:00Z' });
      return { status: spec.path.startsWith('/api/') ? 401 : 200,
        headers: spec.path.startsWith('/images/') ? { 'content-type': 'image/jpeg' } : {},
        body: Buffer.alloc(0) };
    },
    getSnapshot: async (_token, _expires, requestCf) => {
      for (const path of ['/deployments', '/settings', `/versions/${NEW_VERSION}`,
        '/admin', '/subdomain', '/schedules']) {
        await requestCf({ hostname: 'api.cloudflare.com', method: 'GET', path,
          headers: {}, maxBytes: 262_144 });
      }
      return { snapshot: snapshot(), cfRays: [] };
    },
  };
  return { deps, state, root };
}

function args(): string[] {
  return ['--approval-received', RECEIVED, '--approval-expires', EXPIRES,
    '--approved-harness-head', HEAD];
}

describe('B1 V1 post-deploy readback', () => {
  test('validates accepted-mutation receipt and strict active deployment', () => {
    const receipt = {
      approval_id: '5229-B1-R1-20260903', status: 'stopped', stop_reason: 'settingsSha256_changed',
      request_counts: { cloudflare_read: 19, worker_content_put: 1, runtime_read: 1,
        provider_total: 21, retry: 0 },
      mutation: { stage: 'post_write_readback', outcome: 'accepted', put_attempts: 1 },
      observed_post_state: { deployment_id: NEW_DEPLOYMENT, version_id: NEW_VERSION,
        script_etag: NEW_ETAG }, rollback_required: true,
    };
    const bytes = Buffer.from(JSON.stringify(receipt));
    expect(() => validateB1Receipt(bytes, createHash('sha256').update(bytes).digest('hex'))).not.toThrow();
    expect(parseActiveDeployment(deployments())).toEqual({ deploymentId: NEW_DEPLOYMENT,
      versionId: NEW_VERSION, percentage: 100 });
  });

  test('compares all version resources while allowing only version audit fields and script etag/source', () => {
    const oldValue = parseVersionSemantic(version(OLD_VERSION, OLD_ETAG), OLD_VERSION, OLD_ETAG);
    const newValue = parseVersionSemantic(version(NEW_VERSION, NEW_ETAG), NEW_VERSION, NEW_ETAG);
    expect(oldValue.resourcesSha256).toBe(newValue.resourcesSha256);
    const changed = bindings.map((row) => row.name === 'D1_DATABASE_ID' ? { ...row, text: 'changed' } : row);
    const drift = parseVersionSemantic(version(NEW_VERSION, NEW_ETAG, changed), NEW_VERSION, NEW_ETAG);
    expect(drift.resourcesSha256).not.toBe(oldValue.resourcesSha256);
    const unknownTopLevel = parseVersionSemantic(
      version(NEW_VERSION, NEW_ETAG, bindings, { unexpected: true }), NEW_VERSION, NEW_ETAG);
    expect(unknownTopLevel.resourcesSha256).not.toBe(oldValue.resourcesSha256);
  });

  test('preflight has zero provider and local writes', async () => {
    const f = fixture();
    const result = await run(['--preflight-only', '--approved-harness-head', HEAD], f.deps);
    expect(result).toMatchObject({ status: 'preflight_passed', provider_requests: 0,
      provider_writes: 0, local_writes: 0, legacy_probe_ready: true });
    expect(f.state).toEqual({ cfCalls: 0, workerCalls: 0 });
    expect(readdirSync(f.root)).toEqual([]);
  });

  test('accepts version-resource equality and both runtime HEAD probes without writes', async () => {
    const f = fixture();
    const result = await run(args(), f.deps);
    expect(result).toMatchObject({ status: 'completed', disposition: 'accept_deployment_no_rollback',
      request_counts: { cloudflare_get: 8, runtime_read: 3, provider_total: 11,
        provider_write: 0, transport_retry: 0, redirect: 0 } });
    expect(f.state).toEqual({ cfCalls: 8, workerCalls: 3 });
    const receipt = readFileSync(join(f.deps.outputDir, 'sanitized-summary.json'), 'utf8');
    expect(receipt).not.toContain('secret-token');
    expect(receipt).not.toContain('/images/frozen.jpg');
  });

  test('retries runtime identity once, then classifies a persistent mismatch as rollback candidate', async () => {
    const f = fixture();
    f.deps.workerRequest = async (spec: ExactRequest) => spec.path === '/admin/version'
      ? response({ version: 'wrong' })
      : { status: 200, headers: {}, body: Buffer.alloc(0) };
    await expect(run(args(), f.deps)).rejects.toThrow(/runtime_identity/);
    const receipt = JSON.parse(readFileSync(join(f.deps.outputDir, 'sanitized-summary.json'), 'utf8'));
    expect(receipt.disposition).toBe('rollback_candidate');
    expect(receipt.request_counts).toMatchObject({ cloudflare_get: 7, runtime_read: 2, provider_write: 0 });
  });

  test('stops as external drift and enforces approval boundary before output', async () => {
    expect(() => validateApprovalWindow(RECEIVED, EXPIRES, Date.parse(EXPIRES)))
      .toThrow(/approval_inactive/);
    const f = fixture();
    const original = f.deps.cfRequest;
    let deploymentReads = 0;
    f.deps.cfRequest = async (spec, expires) => {
      if (spec.path.endsWith('/deployments')) {
        deploymentReads += 1;
        if (deploymentReads === 2) return deployments(OLD_DEPLOYMENT, OLD_VERSION);
      }
      return original(spec, expires);
    };
    await expect(run(args(), f.deps)).rejects.toThrow(/external_deployment_drift/);
    const receipt = JSON.parse(readFileSync(join(f.deps.outputDir, 'sanitized-summary.json'), 'utf8'));
    expect(receipt.disposition).toBe('external_drift');
  });

  test('rejects head drift before output and provider access', async () => {
    const f = fixture();
    f.deps.validateLocalState = () => { throw new VerifyStop('head_drift'); };
    await expect(run(args(), f.deps)).rejects.toThrow(/head_drift/);
    expect(readdirSync(f.root)).toEqual([]);
    expect(f.state).toEqual({ cfCalls: 0, workerCalls: 0 });
  });
});
