/**
 * Apply-phase behaviour that varies by install topology.
 *
 * Uses module mocks (instead of the fetch router in apply.test.ts) so the
 * assertions can inspect the exact arguments handed to the CF API layer:
 *   - admin files must be materialized (placeholder → real Worker URL)
 *   - worker-assets installs (liffPagesProject === '') skip the LIFF deploy
 *   - the Worker upload preserves assets + compatibility flags
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runApply } from '../../src/phases/apply.js';
import { createEventEmitter } from '../../src/events.js';
import { ADMIN_URL_PLACEHOLDER } from '../../src/materialize.js';
import type { ParsedBundle } from '../../src/bundle.js';
import type { UpdateContext, UpdateEvent } from '../../src/types.js';

vi.mock('../../src/cf-api/d1.js', () => ({
  executeD1Query: vi.fn(async () => ({})),
}));
vi.mock('../../src/cf-api/workers.js', () => ({
  listWorkerBindings: vi.fn(async () => [
    { type: 'd1', name: 'DB', database_id: 'd1id' },
    { type: 'assets', name: 'ASSETS' },
  ]),
  putWorkerScript: vi.fn(async () => undefined),
}));
vi.mock('../../src/cf-api/assets.js', () => ({
  uploadWorkerAssets: vi.fn(async () => 'assets-jwt'),
}));
vi.mock('../../src/cf-api/pages.js', () => ({
  deployPagesProject: vi.fn(async ({ projectName }: { projectName: string }) => ({
    deploymentId: `${projectName}-dep`,
    url: `https://${projectName}.pages.dev`,
  })),
}));

import { putWorkerScript } from '../../src/cf-api/workers.js';
import { deployPagesProject } from '../../src/cf-api/pages.js';

const WORKER_URL = 'https://w.acc.workers.dev';

function ctx(overrides: Partial<UpdateContext> = {}): UpdateContext {
  return {
    creds: { accountId: 'acc', apiToken: 'tok' },
    workerName: 'w',
    adminPagesProject: 'admin-proj',
    liffPagesProject: 'liff-proj',
    d1DatabaseId: 'd1id',
    current: { version: '0.15.0', worker_hash: '', admin_hash: '', liff_hash: '' },
    target: {
      version: '0.16.0',
      released_at: '',
      worker_hash: 'sha256:w',
      admin_hash: 'sha256:a',
      liff_hash: 'sha256:l',
      bundle_url: '',
      bundle_size_bytes: 0,
      required_secrets: [],
      new_required_secrets: [],
      migrations: [],
      changelog_url: '',
      min_from_version: '0.0.0',
    },
    manifestUrl: '',
    workerPublicUrl: WORKER_URL,
    ...overrides,
  };
}

function bundle(overrides: Partial<ParsedBundle> = {}): ParsedBundle {
  return {
    workerJs: Buffer.from('export default {}'),
    workerAssetFiles: new Map([['index.html', Buffer.from('<html>worker assets</html>')]]),
    adminFiles: new Map([
      ['chunk.js', Buffer.from(`fetch("${ADMIN_URL_PLACEHOLDER}/api")`)],
      ['logo.png', Buffer.from('binarydata')],
    ]),
    liffFiles: new Map([['index.html', Buffer.from('<html>l</html>')]]),
    migrations: new Map(),
    ...overrides,
  };
}

function emitter(): { events: UpdateEvent[]; ev: ReturnType<typeof createEventEmitter> } {
  const events: UpdateEvent[] = [];
  const ev = createEventEmitter({ persist: async (e) => void events.push(e) });
  return { events, ev };
}

beforeEach(() => {
  vi.mocked(putWorkerScript).mockClear();
  vi.mocked(deployPagesProject).mockClear();
});

describe('runApply — install topologies', () => {
  it('materializes the admin placeholder before the Pages deploy', async () => {
    const { ev } = emitter();
    await runApply(ctx(), bundle(), ev);

    const adminCall = vi
      .mocked(deployPagesProject)
      .mock.calls.find(([args]) => args.projectName === 'admin-proj');
    expect(adminCall).toBeDefined();
    const files = adminCall![0].files as Map<string, Buffer>;
    expect(files.get('chunk.js')!.toString('utf8')).toBe(`fetch("${WORKER_URL}/api")`);
    // Binary passthrough.
    expect(files.get('logo.png')!.toString('utf8')).toBe('binarydata');
  });

  it('deploys admin files as-is when workerPublicUrl is not provided (legacy ctx)', async () => {
    const { ev } = emitter();
    await runApply(ctx({ workerPublicUrl: undefined }), bundle(), ev);

    const adminCall = vi
      .mocked(deployPagesProject)
      .mock.calls.find(([args]) => args.projectName === 'admin-proj');
    const files = adminCall![0].files as Map<string, Buffer>;
    expect(files.get('chunk.js')!.toString('utf8')).toContain(ADMIN_URL_PLACEHOLDER);
  });

  it('skips the LIFF Pages deploy for worker-assets installs', async () => {
    const { events, ev } = emitter();
    const result = await runApply(ctx({ liffPagesProject: '' }), bundle(), ev);

    expect(result.liffDeploymentId).toBe('');
    expect(result.adminDeploymentId).toBe('admin-proj-dep');
    const projects = vi.mocked(deployPagesProject).mock.calls.map(([a]) => a.projectName);
    expect(projects).toEqual(['admin-proj']);
    const liffEvents = events.filter((e) => e.step === 'liff');
    expect(liffEvents).toHaveLength(1);
    expect(liffEvents[0].status).toBe('done');
  });

  it('still deploys LIFF Pages for the legacy 3-artifact topology', async () => {
    const { ev } = emitter();
    const result = await runApply(ctx(), bundle(), ev);

    expect(result.liffDeploymentId).toBe('liff-proj-dep');
    const projects = vi.mocked(deployPagesProject).mock.calls.map(([a]) => a.projectName);
    expect(projects).toEqual(['admin-proj', 'liff-proj']);
  });

  it('blocks a worker-assets install when the release omitted worker-assets/', async () => {
    const { ev } = emitter();
    await expect(
      runApply(
        ctx({ liffPagesProject: '' }),
        bundle({ workerAssetFiles: new Map() }),
        ev,
      ),
    ).rejects.toThrow(/cannot be updated safely/);
    expect(putWorkerScript).not.toHaveBeenCalled();
  });

  it('keeps old assets only for a legacy Pages install and legacy bundle', async () => {
    const { ev } = emitter();
    await runApply(ctx(), bundle({ workerAssetFiles: new Map() }), ev);

    const args = vi.mocked(putWorkerScript).mock.calls[0][0];
    expect(args.keepAssets).toBe(true);
    expect(args.assets).toBeUndefined();
  });

  it('uploads the Worker with current LIFF assets + nodejs_compat and preserved bindings', async () => {
    const { ev } = emitter();
    await runApply(ctx(), bundle(), ev);

    expect(putWorkerScript).toHaveBeenCalledTimes(1);
    const args = vi.mocked(putWorkerScript).mock.calls[0][0];
    expect(args.keepAssets).toBeUndefined();
    expect(args.assets).toEqual({
      jwt: 'assets-jwt',
      binding: 'ASSETS',
      runWorkerFirst: true,
    });
    expect(args.compatibilityFlags).toEqual(['nodejs_compat']);
    expect(args.bindings).toEqual([
      { type: 'd1', name: 'DB', database_id: 'd1id' },
      { type: 'assets', name: 'ASSETS' },
    ]);
  });
});
