import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  parseTopology, parseVersionResource, run,
  type Dependencies, type ExactRequest, type HttpResponse,
} from './worker-b1-d1-asset-topology-5229.js';

const RECEIVED = '2026-09-03T00:00:00.000Z';
const EXPIRES = '2026-09-03T02:00:00.000Z';
const NOW = Date.parse('2026-09-03T00:10:00.000Z');
const HEAD = '0123456789abcdef0123456789abcdef01234567';
const DEPLOYMENT = '7b3bb319-e618-4f57-a520-cd33f43115e5';
const VERSION = 'c87a5ad8-9bfc-48a5-8fe8-0448cac34fb7';
const tempDirs: string[] = [];
afterEach(() => { for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true }); });

function json(result: unknown): HttpResponse {
  return { status: 200, headers: { 'content-type': 'application/json' },
    body: Buffer.from(JSON.stringify({ success: true, result })) };
}
function deployments(version = VERSION): HttpResponse {
  return json({ deployments: [
    { id: DEPLOYMENT, versions: [{ version_id: version, percentage: 100 }] },
    { id: '99999999-8888-4777-8666-555555555555', versions: [{ version_id: '44444444-3333-4222-8111-000000000000', percentage: 100 }] },
  ] });
}
function version(): HttpResponse {
  return json({ id: VERSION, resources: { script: { etag: '1'.repeat(64) }, bindings: [{ name: 'ASSETS', type: 'assets' }] } });
}
function settings(liff = ''): HttpResponse {
  return json({ bindings: [
    { name: 'ADMIN_PAGES_PROJECT', type: 'plain_text', text: 'line-harness-admin' },
    { name: 'LIFF_PAGES_PROJECT', type: 'plain_text', text: liff },
    { name: 'ASSETS', type: 'assets' },
  ] });
}
function project(name: string, id: string): HttpResponse {
  return json({ name, canonical_deployment: { id } });
}
function fixture(responses: HttpResponse[]): { deps: Dependencies; calls: ExactRequest[] } {
  const root = mkdtempSync(join(tmpdir(), 'lh-5229-d1-test-'));
  tempDirs.push(root);
  const calls: ExactRequest[] = [];
  return { calls, deps: {
    now: () => NOW, loadToken: () => 'test-token', validateLocalAnchors: (head) => head,
    outputDir: join(root, 'receipt'),
    cfRequest: async (spec) => { calls.push(spec); const next = responses.shift();
      if (!next) throw new Error('unexpected request'); return next; },
  } };
}

describe('Worker B1-D1 asset topology', () => {
  test('records Worker Assets plus Admin Pages with five stable read-only requests', async () => {
    const adminId = '11111111-2222-4333-8444-555555555555';
    const f = fixture([deployments(), version(), settings(), project('line-harness-admin', adminId), deployments()]);
    const result = await run(['--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', HEAD], f.deps);
    expect(result).toMatchObject({
      status: 'completed', legacy_build_identity: 'unstamped_unknown',
      topology: { liff_topology: 'worker_assets', admin_pages: { canonical_deployment_id: adminId }, liff_pages: null },
      request_counts: { cloudflare_get: 5, provider_total: 5, retry: 0, writes: 0 },
    });
    expect(f.calls.every((call) => call.headers.Authorization === 'Bearer test-token')).toBe(true);
    const receipt = readFileSync(`${f.deps.outputDir}/sanitized-summary.json`, 'utf8');
    expect(receipt).not.toContain('test-token');
    expect(receipt).not.toContain('line-harness-admin');
  });

  test('reads an optional LIFF Pages project exactly once', async () => {
    const f = fixture([
      deployments(), version(), settings('line-harness-liff'),
      project('line-harness-admin', '11111111-2222-4333-8444-555555555555'),
      project('line-harness-liff', 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'), deployments(),
    ]);
    const result = await run(['--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', HEAD], f.deps);
    expect(result).toMatchObject({ topology: { liff_topology: 'pages', liff_pages: {
      canonical_deployment_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee' } },
      request_counts: { provider_total: 6 } });
  });

  test('fails closed on a partial or missing topology', () => {
    expect(() => parseTopology(settings('bad/name'))).toThrow(/project_name/);
    expect(() => parseVersionResource(json({ id: VERSION, resources: { script: { etag: '1'.repeat(64) }, bindings: [] } })))
      .toThrow(/version_asset_binding/);
  });

  test('stops if the active deployment changes during discovery', async () => {
    const f = fixture([deployments(), version(), settings(),
      project('line-harness-admin', '11111111-2222-4333-8444-555555555555'),
      deployments('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')]);
    await expect(run(['--approval-received', RECEIVED, '--approval-expires', EXPIRES,
      '--approved-harness-head', HEAD], f.deps)).rejects.toThrow(/deployment_changed_during_read/);
  });

  test('preflight makes no provider request or local write', async () => {
    const f = fixture([]);
    const result = await run(['--preflight-only', '--approved-harness-head', HEAD], f.deps);
    expect(result).toMatchObject({ status: 'preflight_passed', provider_requests: 0, provider_writes: 0, local_writes: 0 });
    expect(f.calls).toHaveLength(0);
  });
});
