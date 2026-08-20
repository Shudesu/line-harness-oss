import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { runApply } from '../../src/phases/apply.js';
import { createEventEmitter } from '../../src/events.js';
import type { ParsedBundle } from '../../src/bundle.js';
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

const creds: CfApiCreds = {
  accountId: ACCOUNT_ID,
  apiToken: API_TOKEN,
};

const sampleRelease = (overrides: Partial<ReleaseEntry> = {}): ReleaseEntry => ({
  version: '0.8.0',
  released_at: '',
  worker_hash: 'sha256:wt',
  admin_hash: '',
  liff_hash: '',
  bundle_url: '',
  bundle_size_bytes: 0,
  required_secrets: [],
  new_required_secrets: [],
  migrations: ['041_x.sql'],
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

const sampleBundle = (overrides: Partial<ParsedBundle> = {}): ParsedBundle => ({
  workerJs: Buffer.from("export default {fetch(){return new Response('hi')}}"),
  workerAssetFiles: new Map([['index.html', Buffer.from('<html>worker assets</html>')]]),
  adminFiles: new Map([['index.html', Buffer.from('<html>a</html>')]]),
  liffFiles: new Map([['index.html', Buffer.from('<html>l</html>')]]),
  migrations: new Map([
    ['041_x.sql', Buffer.from('CREATE TABLE foo (id INTEGER);')],
    ['042_y.sql', Buffer.from('ALTER TABLE foo ADD COLUMN bar TEXT;')],
  ]),
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

/**
 * Sequenced fetch router for apply phase. Routes by URL substring and HTTP
 * method, returning the next pre-configured response for each route. Each
 * route can supply overrides for an individual call via `overrides[i]`,
 * otherwise the `defaults` response is used.
 *
 * Designed to mirror the preflight `makeRouter` shape so each test can
 * declare only the routes it cares about.
 */
interface RouteConfig {
  ok?: boolean;
  status?: number;
  body?: unknown;
  /** Throw this error instead of resolving. */
  throws?: Error;
}

interface RouteSpec {
  defaults?: RouteConfig;
  /** Per-call overrides indexed by the route's own call counter. */
  overrides?: RouteConfig[];
}

interface RouterRoutes {
  d1?: RouteSpec;
  bindings?: RouteSpec;
  assetsSession?: RouteSpec;
  assetsUpload?: RouteSpec;
  workerPut?: RouteSpec;
  /** First Pages project (admin) — admin Pages calls. */
  adminUploadToken?: RouteSpec;
  adminCheckMissing?: RouteSpec;
  adminUpload?: RouteSpec;
  adminDeployment?: RouteSpec;
  /** Second Pages project (liff). */
  liffUploadToken?: RouteSpec;
  liffCheckMissing?: RouteSpec;
  liffUpload?: RouteSpec;
  liffDeployment?: RouteSpec;
}

function makeRouter(routes: RouterRoutes): ReturnType<typeof vi.fn> {
  const counters: Record<string, number> = {};
  const next = (key: keyof RouterRoutes): RouteConfig => {
    const spec = routes[key];
    if (!spec) {
      throw new Error(`unrouted: ${String(key)}`);
    }
    const i = counters[key] ?? 0;
    counters[key] = i + 1;
    return spec.overrides?.[i] ?? spec.defaults ?? { ok: true, status: 200 };
  };

  const respond = (cfg: RouteConfig): Response => {
    if (cfg.throws) {
      throw cfg.throws;
    }
    return {
      ok: cfg.ok ?? true,
      status: cfg.status ?? 200,
      json: async () => cfg.body ?? {},
      text: async () =>
        cfg.body === undefined ? '' : JSON.stringify(cfg.body),
    } as unknown as Response;
  };

  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();

    // D1 query (per migration call).
    if (url.includes(`/d1/database/${D1_ID}/query`)) {
      return respond(next('d1'));
    }

    // Worker bindings GET vs script PUT — same path prefix, disambiguate by
    // suffix.
    if (url.endsWith(`/workers/scripts/${WORKER_NAME}/bindings`)) {
      return respond(next('bindings'));
    }
    if (url.endsWith(`/workers/scripts/${WORKER_NAME}/assets-upload-session`)) {
      return respond(next('assetsSession'));
    }
    if (url.includes(`/accounts/${ACCOUNT_ID}/workers/assets/upload`)) {
      return respond(next('assetsUpload'));
    }
    if (url.endsWith(`/workers/scripts/${WORKER_NAME}`) && method === 'PUT') {
      return respond(next('workerPut'));
    }

    // Pages — admin vs liff distinguished by project name in URL.
    if (url.includes(`/pages/projects/${ADMIN_PROJECT}/upload-token`)) {
      return respond(next('adminUploadToken'));
    }
    if (url.includes(`/pages/projects/${LIFF_PROJECT}/upload-token`)) {
      return respond(next('liffUploadToken'));
    }
    if (url.includes(`/pages/projects/${ADMIN_PROJECT}/deployments`)) {
      return respond(next('adminDeployment'));
    }
    if (url.includes(`/pages/projects/${LIFF_PROJECT}/deployments`)) {
      return respond(next('liffDeployment'));
    }

    // Generic /pages/assets/check-missing + /pages/assets/upload routes —
    // these are shared between admin & liff. We track them per project by
    // looking at which Pages project's upload-token was last issued. To
    // keep mocks simple we use a single counter that flips after admin's
    // deployment fires.
    if (url.includes('/pages/assets/check-missing')) {
      // Admin runs first; first call goes to adminCheckMissing.
      const adminCalls = counters['adminCheckMissing'] ?? 0;
      const adminDone = counters['adminDeployment'] ?? 0;
      if (adminDone === 0) {
        return respond(next('adminCheckMissing'));
      }
      void adminCalls;
      return respond(next('liffCheckMissing'));
    }
    if (url.includes('/pages/assets/upload')) {
      const adminDone = counters['adminDeployment'] ?? 0;
      if (adminDone === 0) {
        return respond(next('adminUpload'));
      }
      return respond(next('liffUpload'));
    }

    throw new Error(`unrouted fetch: ${method} ${url}`);
  }) as unknown as ReturnType<typeof vi.fn>;
}

function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Reasonable defaults that let the entire apply phase pass. Individual
 * tests can spread + override only what they need.
 */
function defaultRoutes(bundle: ParsedBundle): RouterRoutes {
  const adminHashes = Array.from(bundle.adminFiles.values()).map(sha256Hex);
  const liffHashes = Array.from(bundle.liffFiles.values()).map(sha256Hex);
  return {
    d1: { defaults: { ok: true, status: 200, body: { success: true, result: [] } } },
    bindings: {
      defaults: {
        ok: true,
        status: 200,
        body: { success: true, result: [{ type: 'd1', name: 'DB', database_id: D1_ID }] },
      },
    },
    assetsSession: {
      defaults: {
        ok: true,
        status: 200,
        body: { result: { buckets: [], jwt: 'ASSETS_JWT' } },
      },
    },
    assetsUpload: {
      defaults: {
        ok: true,
        status: 200,
        body: { result: { jwt: 'ASSETS_COMPLETION_JWT' } },
      },
    },
    workerPut: { defaults: { ok: true, status: 200, body: { success: true } } },
    adminUploadToken: {
      defaults: { ok: true, status: 200, body: { result: { jwt: 'JWT_ADMIN' } } },
    },
    adminCheckMissing: {
      defaults: { ok: true, status: 200, body: { result: adminHashes } },
    },
    adminUpload: { defaults: { ok: true, status: 200, body: { success: true } } },
    adminDeployment: {
      defaults: {
        ok: true,
        status: 200,
        body: { result: { id: 'ADMIN_DEPLOY', url: 'https://admin.pages.dev' } },
      },
    },
    liffUploadToken: {
      defaults: { ok: true, status: 200, body: { result: { jwt: 'JWT_LIFF' } } },
    },
    liffCheckMissing: {
      defaults: { ok: true, status: 200, body: { result: liffHashes } },
    },
    liffUpload: { defaults: { ok: true, status: 200, body: { success: true } } },
    liffDeployment: {
      defaults: {
        ok: true,
        status: 200,
        body: { result: { id: 'LIFF_DEPLOY', url: 'https://liff.pages.dev' } },
      },
    },
  };
}

describe('runApply', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('happy path — runs all 4 steps, emits running+done for each, returns deployment ids', async () => {
    const bundle = sampleBundle();
    globalThis.fetch = makeRouter(defaultRoutes(bundle)) as unknown as typeof fetch;

    const { events, emitter } = collectEvents();
    const result = await runApply(sampleCtx(), bundle, emitter);

    expect(result).toEqual({
      adminDeploymentId: 'ADMIN_DEPLOY',
      liffDeploymentId: 'LIFF_DEPLOY',
    });

    // Migration events
    const migEvents = events.filter((e) => e.step === 'migration');
    expect(migEvents).toEqual([
      { step: 'migration', status: 'running', name: '041_x.sql' },
      { step: 'migration', status: 'done', name: '041_x.sql' },
    ]);

    // Worker events
    expect(events.filter((e) => e.step === 'worker')).toEqual([
      { step: 'worker', status: 'running' },
      { step: 'worker', status: 'done', hash: 'sha256:wt' },
    ]);

    // Admin events
    expect(events.filter((e) => e.step === 'admin')).toEqual([
      { step: 'admin', status: 'running' },
      { step: 'admin', status: 'done', deployment_id: 'ADMIN_DEPLOY' },
    ]);

    // LIFF events
    expect(events.filter((e) => e.step === 'liff')).toEqual([
      { step: 'liff', status: 'running' },
      { step: 'liff', status: 'done', deployment_id: 'LIFF_DEPLOY' },
    ]);
  });

  it('runs steps in strict order: migrations → worker → admin → liff', async () => {
    const bundle = sampleBundle();
    const fetchMock = makeRouter(defaultRoutes(bundle));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { emitter } = collectEvents();
    await runApply(sampleCtx(), bundle, emitter);

    // Find indices of each step's first fetch call.
    const calls = fetchMock.mock.calls as Array<[string, RequestInit?]>;
    const findIdx = (predicate: (url: string, init?: RequestInit) => boolean): number =>
      calls.findIndex(([url, init]) => predicate(url, init));

    const d1Idx = findIdx((url) => url.includes(`/d1/database/${D1_ID}/query`));
    const bindingsIdx = findIdx((url) =>
      url.endsWith(`/workers/scripts/${WORKER_NAME}/bindings`),
    );
    const workerPutIdx = findIdx(
      (url, init) =>
        url.endsWith(`/workers/scripts/${WORKER_NAME}`) &&
        (init?.method ?? 'GET').toUpperCase() === 'PUT',
    );
    const adminTokenIdx = findIdx((url) =>
      url.includes(`/pages/projects/${ADMIN_PROJECT}/upload-token`),
    );
    const adminDeployIdx = findIdx((url) =>
      url.includes(`/pages/projects/${ADMIN_PROJECT}/deployments`),
    );
    const liffTokenIdx = findIdx((url) =>
      url.includes(`/pages/projects/${LIFF_PROJECT}/upload-token`),
    );

    expect(d1Idx).toBeGreaterThanOrEqual(0);
    expect(d1Idx).toBeLessThan(bindingsIdx);
    expect(bindingsIdx).toBeLessThan(workerPutIdx);
    expect(workerPutIdx).toBeLessThan(adminTokenIdx);
    expect(adminDeployIdx).toBeLessThan(liffTokenIdx);
  });

  it('throws when a migration is missing from bundle, error mentions migration name', async () => {
    const bundle = sampleBundle({ migrations: new Map() });
    globalThis.fetch = makeRouter(defaultRoutes(bundle)) as unknown as typeof fetch;

    const ctx = sampleCtx({
      target: sampleRelease({ migrations: ['999_missing.sql'] }),
    });

    const { events, emitter } = collectEvents();
    await expect(runApply(ctx, bundle, emitter)).rejects.toThrow(
      /migration 999_missing\.sql missing in bundle/,
    );

    // No worker/admin/liff steps should have started.
    expect(events.some((e) => e.step === 'worker')).toBe(false);
    expect(events.some((e) => e.step === 'admin')).toBe(false);
    expect(events.some((e) => e.step === 'liff')).toBe(false);
  });

  it('throws when D1 query fails — Worker step NOT executed', async () => {
    const bundle = sampleBundle();
    const routes = defaultRoutes(bundle);
    routes.d1 = {
      defaults: {
        ok: false,
        status: 400,
        body: { errors: [{ message: 'syntax error' }] },
      },
    };
    const fetchMock = makeRouter(routes);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { events, emitter } = collectEvents();
    await expect(runApply(sampleCtx(), bundle, emitter)).rejects.toThrow();

    // Migration running event emitted, but never reached "done".
    expect(events.some((e) => e.step === 'migration' && e.status === 'running')).toBe(true);
    expect(events.some((e) => e.step === 'migration' && e.status === 'done')).toBe(false);

    // No worker/admin/liff steps.
    expect(events.some((e) => e.step === 'worker')).toBe(false);
    expect(events.some((e) => e.step === 'admin')).toBe(false);
    expect(events.some((e) => e.step === 'liff')).toBe(false);

    // No worker PUT was issued.
    const calls = fetchMock.mock.calls as Array<[string, RequestInit?]>;
    const workerPut = calls.find(
      ([url, init]) =>
        url.endsWith(`/workers/scripts/${WORKER_NAME}`) &&
        (init?.method ?? 'GET').toUpperCase() === 'PUT',
    );
    expect(workerPut).toBeUndefined();
  });

  it('throws when Worker upload fails — Admin step NOT executed', async () => {
    const bundle = sampleBundle();
    const routes = defaultRoutes(bundle);
    routes.workerPut = {
      defaults: { ok: false, status: 500, body: { errors: [{ message: 'boom' }] } },
    };
    const fetchMock = makeRouter(routes);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { events, emitter } = collectEvents();
    await expect(runApply(sampleCtx(), bundle, emitter)).rejects.toThrow();

    // Migration done, Worker started but not done.
    expect(events.some((e) => e.step === 'migration' && e.status === 'done')).toBe(true);
    expect(events.some((e) => e.step === 'worker' && e.status === 'running')).toBe(true);
    expect(events.some((e) => e.step === 'worker' && e.status === 'done')).toBe(false);

    // No admin/liff steps.
    expect(events.some((e) => e.step === 'admin')).toBe(false);
    expect(events.some((e) => e.step === 'liff')).toBe(false);

    // No admin Pages upload-token call.
    const calls = fetchMock.mock.calls as Array<[string, RequestInit?]>;
    const adminToken = calls.find(([url]) =>
      url.includes(`/pages/projects/${ADMIN_PROJECT}/upload-token`),
    );
    expect(adminToken).toBeUndefined();
  });

  it('throws when Admin Pages deployment fails — LIFF step NOT executed', async () => {
    const bundle = sampleBundle();
    const routes = defaultRoutes(bundle);
    routes.adminDeployment = {
      defaults: { ok: false, status: 500, body: { errors: [{ message: 'down' }] } },
    };
    const fetchMock = makeRouter(routes);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { events, emitter } = collectEvents();
    await expect(runApply(sampleCtx(), bundle, emitter)).rejects.toThrow();

    // Worker done, Admin started but not done.
    expect(events.some((e) => e.step === 'worker' && e.status === 'done')).toBe(true);
    expect(events.some((e) => e.step === 'admin' && e.status === 'running')).toBe(true);
    expect(events.some((e) => e.step === 'admin' && e.status === 'done')).toBe(false);

    // No LIFF step.
    expect(events.some((e) => e.step === 'liff')).toBe(false);

    // No LIFF Pages upload-token call.
    const calls = fetchMock.mock.calls as Array<[string, RequestInit?]>;
    const liffToken = calls.find(([url]) =>
      url.includes(`/pages/projects/${LIFF_PROJECT}/upload-token`),
    );
    expect(liffToken).toBeUndefined();
  });

  it('multiple migrations execute in order, each emits running+done', async () => {
    const bundle = sampleBundle();
    globalThis.fetch = makeRouter(defaultRoutes(bundle)) as unknown as typeof fetch;

    const ctx = sampleCtx({
      target: sampleRelease({ migrations: ['041_x.sql', '042_y.sql'] }),
    });

    const { events, emitter } = collectEvents();
    await runApply(ctx, bundle, emitter);

    const migEvents = events.filter((e) => e.step === 'migration');
    expect(migEvents).toEqual([
      { step: 'migration', status: 'running', name: '041_x.sql' },
      { step: 'migration', status: 'done', name: '041_x.sql' },
      { step: 'migration', status: 'running', name: '042_y.sql' },
      { step: 'migration', status: 'done', name: '042_y.sql' },
    ]);
  });

  it('empty migrations list — no migration events, jumps straight to Worker', async () => {
    const bundle = sampleBundle();
    globalThis.fetch = makeRouter(defaultRoutes(bundle)) as unknown as typeof fetch;

    const ctx = sampleCtx({ target: sampleRelease({ migrations: [] }) });

    const { events, emitter } = collectEvents();
    await runApply(ctx, bundle, emitter);

    expect(events.some((e) => e.step === 'migration')).toBe(false);
    // First event should be worker:running.
    expect(events[0]).toEqual({ step: 'worker', status: 'running' });
  });

  it('preserves existing Worker bindings on update', async () => {
    const bundle = sampleBundle();
    const existingBindings = [
      { type: 'd1', name: 'DB', database_id: D1_ID },
      { type: 'secret_text', name: 'SECRET' },
      { type: 'plain_text', name: 'ENV', text: 'prod' },
    ];
    const routes = defaultRoutes(bundle);
    routes.bindings = {
      defaults: { ok: true, status: 200, body: { success: true, result: existingBindings } },
    };
    const fetchMock = makeRouter(routes);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { emitter } = collectEvents();
    await runApply(sampleCtx(), bundle, emitter);

    // Find the PUT call, read the metadata JSON, verify bindings preserved.
    const calls = fetchMock.mock.calls as Array<[string, RequestInit?]>;
    const putCall = calls.find(
      ([url, init]) =>
        url.endsWith(`/workers/scripts/${WORKER_NAME}`) &&
        (init?.method ?? 'GET').toUpperCase() === 'PUT',
    );
    expect(putCall).toBeDefined();
    const fd = putCall![1]!.body as FormData;
    const metadataBlob = fd.get('metadata') as Blob;
    const metadataText = await metadataBlob.text();
    const metadata = JSON.parse(metadataText);
    // Textless secret_text bindings can't be re-sent (CF rejects them with
    // 10021) — they're carried over via keep_bindings instead.
    expect(metadata.bindings).toEqual([
      { type: 'd1', name: 'DB', database_id: D1_ID },
      { type: 'plain_text', name: 'ENV', text: 'prod' },
      { type: 'assets', name: 'ASSETS' },
    ]);
    expect(metadata.keep_bindings).toEqual(['secret_text', 'secret_key']);
  });
});
