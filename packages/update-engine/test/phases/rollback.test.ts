import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  encodeWorkerSnapshot,
  runRollback,
} from '../../src/phases/rollback.js';
import type { RollbackSnapshot } from '../../src/phases/rollback.js';
import { createEventEmitter } from '../../src/events.js';
import type {
  UpdateContext,
  UpdateEvent,
  ReleaseEntry,
  CurrentVersion,
  CfApiCreds,
} from '../../src/types.js';

const ACCOUNT_ID = 'acc';
const API_TOKEN = 'tok';
const WORKER_NAME = 'w';
const ADMIN_PROJECT = 'ap';
const LIFF_PROJECT = 'lp';
const D1_ID = 'd';
const SNAPSHOT_WORKER_URL = 'https://r2.example.com/worker-snap.js';
const ADMIN_DEPLOY_ID = 'OLD_ADMIN_DEPLOY';
const LIFF_DEPLOY_ID = 'OLD_LIFF_DEPLOY';

const creds: CfApiCreds = {
  accountId: ACCOUNT_ID,
  apiToken: API_TOKEN,
};

const sampleRelease = (overrides: Partial<ReleaseEntry> = {}): ReleaseEntry => ({
  version: '0.8.0',
  released_at: '',
  worker_hash: '',
  admin_hash: '',
  liff_hash: '',
  bundle_url: '',
  bundle_size_bytes: 0,
  required_secrets: [],
  new_required_secrets: [],
  migrations: [],
  changelog_url: '',
  min_from_version: '0.0.0',
  ...overrides,
});

const sampleCurrent = (): CurrentVersion => ({
  version: '0.7.0',
  worker_hash: '',
  admin_hash: '',
  liff_hash: '',
});

const sampleCtx = (overrides: Partial<UpdateContext> = {}): UpdateContext => ({
  creds,
  workerName: WORKER_NAME,
  adminPagesProject: ADMIN_PROJECT,
  liffPagesProject: LIFF_PROJECT,
  d1DatabaseId: D1_ID,
  current: sampleCurrent(),
  target: sampleRelease(),
  manifestUrl: '',
  ...overrides,
});

const sampleSnap = (overrides: Partial<RollbackSnapshot> = {}): RollbackSnapshot => ({
  snapshotWorkerBundleUrl: SNAPSHOT_WORKER_URL,
  snapshotAdminDeployment: ADMIN_DEPLOY_ID,
  snapshotLiffDeployment: LIFF_DEPLOY_ID,
  ...overrides,
});

function collectEvents(): {
  events: UpdateEvent[];
  emitter: ReturnType<typeof createEventEmitter>;
} {
  const events: UpdateEvent[] = [];
  const emitter = createEventEmitter({
    persist: async (e) => {
      events.push(e);
    },
  });
  return { events, emitter };
}

function ok(body: unknown = {}): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function notOk(status = 500, body: unknown = { error: 'fail' }): Response {
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  } as unknown as Response;
}

function okBundle(content: string = 'old worker bundle bytes'): Response {
  const ab = new TextEncoder().encode(content).buffer;
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    text: async () => content,
    arrayBuffer: async () => ab,
  } as unknown as Response;
}

describe('runRollback', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('happy path — fetches old bundle, restores worker (with preserved bindings), rolls back both pages', async () => {
    const existingBindings = [
      { type: 'd1', name: 'DB', database_id: D1_ID },
      { type: 'secret_text', name: 'LINE_TOKEN' },
    ];

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url === SNAPSHOT_WORKER_URL) {
        return okBundle('OLD_WORKER_CONTENT');
      }
      if (url.endsWith(`/workers/scripts/${WORKER_NAME}/bindings`)) {
        return ok({ result: existingBindings });
      }
      if (url.endsWith(`/workers/scripts/${WORKER_NAME}`) && method === 'PUT') {
        return ok({ success: true });
      }
      if (url.includes(`/pages/projects/${ADMIN_PROJECT}/deployments/${ADMIN_DEPLOY_ID}/rollback`)) {
        return ok({ success: true });
      }
      if (url.includes(`/pages/projects/${LIFF_PROJECT}/deployments/${LIFF_DEPLOY_ID}/rollback`)) {
        return ok({ success: true });
      }
      throw new Error(`unrouted: ${method} ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { events, emitter } = collectEvents();
    await runRollback(sampleCtx(), sampleSnap(), emitter);

    expect(events).toEqual([
      { step: 'rollback', status: 'running' },
      { step: 'rollback', status: 'done' },
    ]);

    // Verify the worker PUT used the preserved bindings.
    const calls = fetchMock.mock.calls as Array<[string, RequestInit?]>;
    const putCall = calls.find(
      ([url, init]) =>
        url.endsWith(`/workers/scripts/${WORKER_NAME}`) &&
        (init?.method ?? 'GET').toUpperCase() === 'PUT',
    );
    expect(putCall).toBeDefined();
    const fd = putCall![1]!.body as FormData;
    const metadataBlob = fd.get('metadata') as Blob;
    const metadata = JSON.parse(await metadataBlob.text());
    // Textless secret_text bindings can't be re-sent (CF rejects them with
    // 10021) — they're carried over via keep_bindings instead.
    expect(metadata.bindings).toEqual([
      { type: 'd1', name: 'DB', database_id: D1_ID },
    ]);
    expect(metadata.keep_bindings).toEqual(['secret_text', 'secret_key']);

    // Both Pages rollbacks were invoked.
    const adminRb = calls.find(([url]) =>
      url.includes(`/pages/projects/${ADMIN_PROJECT}/deployments/${ADMIN_DEPLOY_ID}/rollback`),
    );
    const liffRb = calls.find(([url]) =>
      url.includes(`/pages/projects/${LIFF_PROJECT}/deployments/${LIFF_DEPLOY_ID}/rollback`),
    );
    expect(adminRb).toBeDefined();
    expect(liffRb).toBeDefined();
  });

  it('restores a saved Worker version so code and assets roll back together', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (
        url.endsWith(`/workers/scripts/${WORKER_NAME}/deployments`) &&
        method === 'POST'
      ) {
        const body = JSON.parse(init?.body as string);
        expect(body.versions).toEqual([
          { version_id: 'OLD_WORKER_VERSION', percentage: 100 },
        ]);
        return ok({ success: true });
      }
      if (url.includes('/rollback')) return ok({ success: true });
      throw new Error(`unrouted: ${method} ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { emitter } = collectEvents();
    await runRollback(
      sampleCtx(),
      sampleSnap({
        snapshotWorkerBundleUrl: encodeWorkerSnapshot({
          bundleUrl: SNAPSHOT_WORKER_URL,
          versionId: 'OLD_WORKER_VERSION',
        }),
      }),
      emitter,
    );

    expect(fetchMock.mock.calls.some(([url]) => url === SNAPSHOT_WORKER_URL)).toBe(false);
  });

  it('throws when fetching snapshotWorkerBundleUrl returns non-200', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === SNAPSHOT_WORKER_URL) {
        return notOk(404, { error: 'gone' });
      }
      throw new Error(`unrouted: ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { events, emitter } = collectEvents();
    await expect(runRollback(sampleCtx(), sampleSnap(), emitter)).rejects.toThrow(
      /404|snapshot|bundle/i,
    );

    expect(events.some((e) => e.step === 'rollback' && e.status === 'running')).toBe(true);
    expect(events.some((e) => e.step === 'rollback' && e.status === 'done')).toBe(false);

    // No worker / pages calls were made.
    const calls = fetchMock.mock.calls as Array<[string]>;
    expect(calls.some(([u]) => u.includes('/workers/scripts/'))).toBe(false);
    expect(calls.some(([u]) => u.includes('/pages/projects/'))).toBe(false);
  });

  it('throws when Worker PUT fails during rollback', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url === SNAPSHOT_WORKER_URL) return okBundle();
      if (url.endsWith(`/workers/scripts/${WORKER_NAME}/bindings`)) {
        return ok({ result: [] });
      }
      if (url.endsWith(`/workers/scripts/${WORKER_NAME}`) && method === 'PUT') {
        return notOk(500, { errors: [{ message: 'boom' }] });
      }
      throw new Error(`unrouted: ${method} ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { events, emitter } = collectEvents();
    await expect(runRollback(sampleCtx(), sampleSnap(), emitter)).rejects.toThrow();

    expect(events.some((e) => e.step === 'rollback' && e.status === 'running')).toBe(true);
    expect(events.some((e) => e.step === 'rollback' && e.status === 'done')).toBe(false);

    // No pages rollback calls happened.
    const calls = fetchMock.mock.calls as Array<[string]>;
    expect(calls.some(([u]) => u.includes('/pages/projects/'))).toBe(false);
  });

  it('throws when admin Pages rollback fails — LIFF rollback NOT attempted', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url === SNAPSHOT_WORKER_URL) return okBundle();
      if (url.endsWith(`/workers/scripts/${WORKER_NAME}/bindings`)) {
        return ok({ result: [] });
      }
      if (url.endsWith(`/workers/scripts/${WORKER_NAME}`) && method === 'PUT') {
        return ok({ success: true });
      }
      if (url.includes(`/pages/projects/${ADMIN_PROJECT}/deployments/${ADMIN_DEPLOY_ID}/rollback`)) {
        return notOk(500, { errors: [{ message: 'down' }] });
      }
      throw new Error(`unrouted: ${method} ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { events, emitter } = collectEvents();
    await expect(runRollback(sampleCtx(), sampleSnap(), emitter)).rejects.toThrow();

    expect(events.some((e) => e.step === 'rollback' && e.status === 'done')).toBe(false);

    // No LIFF rollback call happened.
    const calls = fetchMock.mock.calls as Array<[string]>;
    expect(
      calls.some(([u]) =>
        u.includes(`/pages/projects/${LIFF_PROJECT}/deployments/${LIFF_DEPLOY_ID}/rollback`),
      ),
    ).toBe(false);
  });

  it('does NOT roll back D1 migrations (no D1 query call happens)', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url === SNAPSHOT_WORKER_URL) return okBundle();
      if (url.endsWith(`/workers/scripts/${WORKER_NAME}/bindings`)) {
        return ok({ result: [] });
      }
      if (url.endsWith(`/workers/scripts/${WORKER_NAME}`) && method === 'PUT') {
        return ok({ success: true });
      }
      if (url.includes('/rollback')) return ok({ success: true });
      throw new Error(`unrouted: ${method} ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { emitter } = collectEvents();
    await runRollback(sampleCtx(), sampleSnap(), emitter);

    // No fetch to D1 query endpoint should have happened.
    const calls = fetchMock.mock.calls as Array<[string]>;
    const d1Calls = calls.filter(([u]) => u.includes(`/d1/database/${D1_ID}/query`));
    expect(d1Calls.length).toBe(0);
  });

  it('order: fetches bundle → lists bindings → puts worker → admin rollback → liff rollback', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (url === SNAPSHOT_WORKER_URL) return okBundle();
      if (url.endsWith(`/workers/scripts/${WORKER_NAME}/bindings`)) {
        return ok({ result: [] });
      }
      if (url.endsWith(`/workers/scripts/${WORKER_NAME}`) && method === 'PUT') {
        return ok({ success: true });
      }
      if (url.includes('/rollback')) return ok({ success: true });
      throw new Error(`unrouted: ${method} ${url}`);
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { emitter } = collectEvents();
    await runRollback(sampleCtx(), sampleSnap(), emitter);

    const calls = fetchMock.mock.calls as Array<[string, RequestInit?]>;
    const findIdx = (predicate: (url: string, init?: RequestInit) => boolean): number =>
      calls.findIndex(([url, init]) => predicate(url, init));

    const bundleIdx = findIdx((u) => u === SNAPSHOT_WORKER_URL);
    const bindingsIdx = findIdx((u) =>
      u.endsWith(`/workers/scripts/${WORKER_NAME}/bindings`),
    );
    const putIdx = findIdx(
      (u, init) =>
        u.endsWith(`/workers/scripts/${WORKER_NAME}`) &&
        (init?.method ?? 'GET').toUpperCase() === 'PUT',
    );
    const adminIdx = findIdx((u) =>
      u.includes(`/pages/projects/${ADMIN_PROJECT}/deployments/${ADMIN_DEPLOY_ID}/rollback`),
    );
    const liffIdx = findIdx((u) =>
      u.includes(`/pages/projects/${LIFF_PROJECT}/deployments/${LIFF_DEPLOY_ID}/rollback`),
    );

    expect(bundleIdx).toBeGreaterThanOrEqual(0);
    expect(bindingsIdx).toBeGreaterThan(bundleIdx);
    expect(putIdx).toBeGreaterThan(bindingsIdx);
    expect(adminIdx).toBeGreaterThan(putIdx);
    expect(liffIdx).toBeGreaterThan(adminIdx);
  });
});
