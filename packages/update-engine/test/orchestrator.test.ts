import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  readFileSync,
  existsSync,
  mkdtempSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { runUpdate } from '../src/index.js';
import {
  parseBundleStream,
  verifyBundleHashes,
} from '../src/bundle.js';
import { getSnapshot, type D1Like, type SnapshotRow } from '../src/snapshot.js';
import { decodeWorkerSnapshot } from '../src/phases/rollback.js';
import type { UpdateContext, ReleaseEntry, CurrentVersion, CfApiCreds } from '../src/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');
const DB_PKG = join(REPO_ROOT, 'packages', 'db');

// ─── Constants ────────────────────────────────────────────────────────────────

const ACCOUNT_ID = 'acc';
const API_TOKEN = 'tok';
const WORKER_NAME = 'w';
const ADMIN_PROJECT = 'ap';
const LIFF_PROJECT = 'lp';
const D1_ID = 'd';
const WORKER_HEALTH_URL = 'https://worker.example.com/health';
const ADMIN_URL = 'https://admin.example.com/';
const LIFF_URL = 'https://liff.example.com/';
const BUNDLE_URL = 'https://example.com/bundle.tar.gz';
const SNAPSHOT_WORKER_URL = 'https://r2.example.com/worker-snap.js';
const OLD_ADMIN_DEPLOY = 'OLD_ADMIN_DEPLOY';
const OLD_LIFF_DEPLOY = 'OLD_LIFF_DEPLOY';
const NEW_ADMIN_DEPLOY = 'NEW_ADMIN_DEPLOY';
const NEW_LIFF_DEPLOY = 'NEW_LIFF_DEPLOY';
const D1_QUERY_SUBSTR = `/d1/database/${D1_ID}/query`;

const creds: CfApiCreds = {
  accountId: ACCOUNT_ID,
  apiToken: API_TOKEN,
};

// ─── D1 in-memory adapter ─────────────────────────────────────────────────────

function loadDb(): Database.Database {
  const db = new Database(':memory:');
  const schema = readFileSync(join(DB_PKG, 'schema.sql'), 'utf8');
  db.exec(schema);
  const migration = readFileSync(
    join(DB_PKG, 'migrations', '041_update_history.sql'),
    'utf8',
  );
  db.exec(migration);
  return db;
}

function makeD1Adapter(db: Database.Database): D1Like {
  return {
    prepare: (sql: string) => ({
      bind: (...args: any[]) => ({
        run: async () => db.prepare(sql).run(...args),
        first: async <T>() =>
          (db.prepare(sql).get(...args) as T | undefined) ?? null,
        all: async <T>() => ({
          results: db.prepare(sql).all(...args) as T[],
        }),
      }),
    }),
  };
}

// ─── Bundle fixture ───────────────────────────────────────────────────────────

interface Fixture {
  tmpDir: string;
  tarball: string;
  tarballBytes: Buffer;
  workerHash: string;
  adminHash: string;
  liffHash: string;
}

function buildFixture(): Fixture {
  const tmpDir = mkdtempSync(join(tmpdir(), 'update-engine-orch-'));
  const stageDir = join(tmpDir, 'stage');
  mkdirSync(stageDir);

  const workerDir = join(stageDir, 'worker');
  const adminDir = join(stageDir, 'admin');
  const liffDir = join(stageDir, 'liff');
  const migrationsDir = join(stageDir, 'migrations');
  mkdirSync(workerDir);
  mkdirSync(adminDir);
  mkdirSync(liffDir);
  mkdirSync(migrationsDir);

  const workerBytes = Buffer.from(
    'export default { fetch() { return new Response("hi"); } }\n',
  );
  const adminIndex = Buffer.from('<html>admin</html>\n');
  const liffIndex = Buffer.from('<html>liff</html>\n');
  const migration = Buffer.from('CREATE TABLE foo (id INTEGER);\n');

  writeFileSync(join(workerDir, 'index.js'), workerBytes);
  writeFileSync(join(adminDir, 'index.html'), adminIndex);
  writeFileSync(join(liffDir, 'index.html'), liffIndex);
  writeFileSync(join(migrationsDir, '041_x.sql'), migration);

  const tarball = join(tmpDir, 'bundle.tar.gz');
  execSync(`tar czf ${tarball} -C ${stageDir} worker admin liff migrations`, {
    stdio: 'pipe',
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });

  const tarballBytes = readFileSync(tarball);

  // Compute the expected hashes using the same logic as inject-version.ts.
  const workerHash = `sha256:${createHash('sha256').update(workerBytes).digest('hex')}`;
  function hashMap(map: Map<string, Buffer>): string {
    const keys = Array.from(map.keys()).sort();
    const h = createHash('sha256');
    const NUL = Buffer.from([0]);
    for (const k of keys) {
      h.update(Buffer.from(k, 'utf8'));
      h.update(NUL);
      h.update(map.get(k)!);
      h.update(NUL);
    }
    return `sha256:${h.digest('hex')}`;
  }
  const adminMap = new Map<string, Buffer>([['index.html', adminIndex]]);
  const liffMap = new Map<string, Buffer>([['index.html', liffIndex]]);

  return {
    tmpDir,
    tarball,
    tarballBytes,
    workerHash,
    adminHash: hashMap(adminMap),
    liffHash: hashMap(liffMap),
  };
}

// ─── Sample data ──────────────────────────────────────────────────────────────

const sampleRelease = (
  fixture: Fixture,
  overrides: Partial<ReleaseEntry> = {},
): ReleaseEntry => ({
  version: '0.8.0',
  released_at: '2026-05-01T00:00:00Z',
  worker_hash: fixture.workerHash,
  // In fixtures the identity hash and the final-artifact byte hash coincide
  // (no two-pass rebuild); real manifests carry distinct values.
  worker_bundle_hash: fixture.workerHash,
  admin_hash: fixture.adminHash,
  liff_hash: fixture.liffHash,
  bundle_url: BUNDLE_URL,
  bundle_size_bytes: fixture.tarballBytes.length,
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

const sampleCtx = (
  fixture: Fixture,
  overrides: Partial<UpdateContext> = {},
): UpdateContext => ({
  creds,
  workerName: WORKER_NAME,
  adminPagesProject: ADMIN_PROJECT,
  liffPagesProject: LIFF_PROJECT,
  d1DatabaseId: D1_ID,
  current: sampleCurrent(),
  target: sampleRelease(fixture),
  manifestUrl: 'https://example.com/manifest.json',
  ...overrides,
});

// ─── Fetch router ─────────────────────────────────────────────────────────────

interface RouteOverrides {
  /** Preflight: token verify. */
  tokenVerify?: { ok: boolean; status: number; body?: unknown };
  /** Preflight: worker check, Apply: bindings GET. Used uniformly. */
  workerGet?: { ok: boolean; status: number; body?: unknown };
  /** Apply + Rollback: worker PUT. */
  workerPut?: { ok: boolean; status: number; body?: unknown };
  /** Version-based Worker rollback deployment. */
  workerRollback?: { ok: boolean; status: number; body?: unknown };
  /** Preflight: admin project check, Apply: deploy & rollback. */
  adminCheck?: { ok: boolean; status: number; body?: unknown };
  /** Preflight: liff project check, Apply: deploy & rollback. */
  liffCheck?: { ok: boolean; status: number; body?: unknown };
  /** D1 query (preflight + migration + verify). */
  d1Query?: { ok: boolean; status: number; body?: unknown };
  /** Snapshot worker bundle download. */
  snapshotBundleGet?: { ok: boolean; status: number; bytes?: Buffer };
  /** Verify: Worker /health. */
  workerHealth?: { ok: boolean; status: number; body?: unknown };
  /** Verify: admin URL probe. */
  verifyAdminUrl?: { ok: boolean; status: number; body?: unknown };
  /** Verify: liff URL probe. */
  verifyLiffUrl?: { ok: boolean; status: number; body?: unknown };
  /** Bundle download. */
  bundleDownload?: { ok: boolean; status: number; bytes?: Buffer };
  /** Pages admin rollback. */
  adminRollback?: { ok: boolean; status: number; body?: unknown };
  /** Pages liff rollback. */
  liffRollback?: { ok: boolean; status: number; body?: unknown };
}

function makeResponse(cfg: {
  ok: boolean;
  status: number;
  body?: unknown;
  bytes?: Buffer;
}): Response {
  const ab = cfg.bytes
    ? cfg.bytes.buffer.slice(
        cfg.bytes.byteOffset,
        cfg.bytes.byteOffset + cfg.bytes.byteLength,
      )
    : new ArrayBuffer(0);
  return {
    ok: cfg.ok,
    status: cfg.status,
    json: async () => cfg.body ?? {},
    text: async () =>
      cfg.body === undefined ? '' : JSON.stringify(cfg.body),
    arrayBuffer: async () => ab,
    // body is a ReadableStream — used by Readable.fromWeb in the orchestrator
    // for the bundle fetch path. We build it from bytes when present.
    body: cfg.bytes
      ? new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(cfg.bytes!));
            controller.close();
          },
        })
      : null,
  } as unknown as Response;
}

function makeFetch(
  fixture: Fixture,
  overrides: RouteOverrides = {},
): ReturnType<typeof vi.fn> {
  let pagesGetCalls = 0; // for distinguishing admin vs liff getLatestDeployment
  let adminDeploymentCalls = 0;

  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = (init?.method ?? 'GET').toUpperCase();

    // Bundle download from BUNDLE_URL — returns the tarball as a stream.
    if (url === BUNDLE_URL) {
      const o = overrides.bundleDownload ?? {
        ok: true,
        status: 200,
        bytes: fixture.tarballBytes,
      };
      return makeResponse({ ok: o.ok, status: o.status, bytes: o.bytes });
    }

    // Snapshot worker bundle fetch (rollback).
    if (url === SNAPSHOT_WORKER_URL) {
      const o = overrides.snapshotBundleGet ?? {
        ok: true,
        status: 200,
        bytes: Buffer.from('OLD_WORKER_BYTES'),
      };
      return makeResponse({ ok: o.ok, status: o.status, bytes: o.bytes });
    }

    // Verify URLs.
    if (url === WORKER_HEALTH_URL) {
      const o = overrides.workerHealth ?? { ok: true, status: 200 };
      return makeResponse(o);
    }
    if (url === ADMIN_URL) {
      const o = overrides.verifyAdminUrl ?? { ok: true, status: 200 };
      return makeResponse(o);
    }
    if (url === LIFF_URL) {
      const o = overrides.verifyLiffUrl ?? { ok: true, status: 200 };
      return makeResponse(o);
    }

    // CF API: token verify.
    if (url.includes('/user/tokens/verify')) {
      const o = overrides.tokenVerify ?? { ok: true, status: 200 };
      return makeResponse(o);
    }

    // CF API: D1 query (preflight, migration, verify).
    if (url.includes(D1_QUERY_SUBSTR)) {
      const o = overrides.d1Query ?? {
        ok: true,
        status: 200,
        body: { success: true, result: [{ results: [{ ok: 1 }] }] },
      };
      return makeResponse(o);
    }

    if (url.endsWith(`/workers/scripts/${WORKER_NAME}/deployments`)) {
      if (method === 'POST') {
        const o = overrides.workerRollback ?? {
          ok: true,
          status: 200,
          body: { success: true },
        };
        return makeResponse(o);
      }
      return makeResponse({
        ok: true,
        status: 200,
        body: {
          result: {
            deployments: [
              {
                id: 'OLD_WORKER_DEPLOYMENT',
                created_on: '2026-08-01T00:00:00Z',
                versions: [{ version_id: 'OLD_WORKER_VERSION', percentage: 100 }],
              },
            ],
          },
        },
      });
    }

    // Worker bindings GET (apply + legacy rollback).
    if (url.endsWith(`/workers/scripts/${WORKER_NAME}/bindings`)) {
      const o = overrides.workerGet ?? {
        ok: true,
        status: 200,
        body: { success: true, result: [] },
      };
      return makeResponse(o);
    }

    if (url.endsWith(`/workers/scripts/${WORKER_NAME}/assets-upload-session`)) {
      return makeResponse({
        ok: true,
        status: 200,
        body: { result: { buckets: [], jwt: 'ASSETS_JWT' } },
      });
    }
    if (url.includes(`/accounts/${ACCOUNT_ID}/workers/assets/upload`)) {
      return makeResponse({
        ok: true,
        status: 200,
        body: { result: { jwt: 'ASSETS_COMPLETION_JWT' } },
      });
    }

    // Worker script PUT (apply + rollback) and GET (preflight existence).
    if (url.endsWith(`/workers/scripts/${WORKER_NAME}`)) {
      if (method === 'PUT') {
        const o = overrides.workerPut ?? {
          ok: true,
          status: 200,
          body: { success: true },
        };
        return makeResponse(o);
      }
      // GET — preflight existence check.
      const o = overrides.workerGet ?? { ok: true, status: 200 };
      return makeResponse(o);
    }

    // Pages admin project — getLatestDeployment, deploy, rollback, preflight.
    if (url.includes(`/pages/projects/${ADMIN_PROJECT}/deployments/`) && url.endsWith('/rollback')) {
      const o = overrides.adminRollback ?? { ok: true, status: 200 };
      return makeResponse(o);
    }
    if (url.includes(`/pages/projects/${LIFF_PROJECT}/deployments/`) && url.endsWith('/rollback')) {
      const o = overrides.liffRollback ?? { ok: true, status: 200 };
      return makeResponse(o);
    }
    if (url.includes(`/pages/projects/${ADMIN_PROJECT}/deployments`)) {
      // getLatestDeployment (GET ...?per_page=1) → return OLD_ADMIN_DEPLOY first
      // POST deployments (create new) → return NEW_ADMIN_DEPLOY
      if (method === 'GET') {
        return makeResponse({
          ok: true,
          status: 200,
          body: { result: [{ id: OLD_ADMIN_DEPLOY }] },
        });
      }
      adminDeploymentCalls++;
      return makeResponse({
        ok: true,
        status: 200,
        body: {
          result: { id: NEW_ADMIN_DEPLOY, url: 'https://admin.pages.dev' },
        },
      });
    }
    if (url.includes(`/pages/projects/${LIFF_PROJECT}/deployments`)) {
      if (method === 'GET') {
        return makeResponse({
          ok: true,
          status: 200,
          body: { result: [{ id: OLD_LIFF_DEPLOY }] },
        });
      }
      return makeResponse({
        ok: true,
        status: 200,
        body: {
          result: { id: NEW_LIFF_DEPLOY, url: 'https://liff.pages.dev' },
        },
      });
    }
    if (url.includes(`/pages/projects/${ADMIN_PROJECT}/upload-token`)) {
      return makeResponse({
        ok: true,
        status: 200,
        body: { result: { jwt: 'JWT_ADMIN' } },
      });
    }
    if (url.includes(`/pages/projects/${LIFF_PROJECT}/upload-token`)) {
      return makeResponse({
        ok: true,
        status: 200,
        body: { result: { jwt: 'JWT_LIFF' } },
      });
    }
    if (url.includes('/pages/assets/check-missing')) {
      // Tell CF every hash is missing so the test mirrors a real cold deploy.
      // The list is opaque to the orchestrator, but apply.ts will then upload.
      // Returning the request body's hashes back simulates "all missing".
      const reqBody = init?.body ? JSON.parse(String(init.body)) : { hashes: [] };
      return makeResponse({
        ok: true,
        status: 200,
        body: { result: reqBody.hashes ?? [] },
      });
    }
    if (url.includes('/pages/assets/upload')) {
      return makeResponse({ ok: true, status: 200, body: { success: true } });
    }
    if (url.includes(`/pages/projects/${ADMIN_PROJECT}`)) {
      pagesGetCalls++;
      const o = overrides.adminCheck ?? { ok: true, status: 200 };
      return makeResponse(o);
    }
    if (url.includes(`/pages/projects/${LIFF_PROJECT}`)) {
      const o = overrides.liffCheck ?? { ok: true, status: 200 };
      return makeResponse(o);
    }

    throw new Error(`unrouted: ${method} ${url}`);
  }) as unknown as ReturnType<typeof vi.fn>;
}

// ─── Suite ────────────────────────────────────────────────────────────────────

describe('runUpdate orchestrator', () => {
  const originalFetch = globalThis.fetch;
  let fixture: Fixture;

  beforeAll(() => {
    fixture = buildFixture();
  });

  afterAll(() => {
    if (fixture && existsSync(fixture.tmpDir)) {
      rmSync(fixture.tmpDir, { recursive: true, force: true });
    }
  });

  let rawDb: Database.Database;
  let d1: D1Like;

  beforeEach(() => {
    rawDb = loadDb();
    d1 = makeD1Adapter(rawDb);
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('happy path — all phases succeed, returns updateId, snapshot status = success', async () => {
    globalThis.fetch = makeFetch(fixture) as unknown as typeof fetch;

    const events: any[] = [];
    const handle = await runUpdate({
      ctx: sampleCtx(fixture),
      d1,
      workerHealthUrl: WORKER_HEALTH_URL,
      adminUrl: ADMIN_URL,
      liffUrl: LIFF_URL,
      currentWorkerBundleUrl: SNAPSHOT_WORKER_URL,
      onEvent: (e) => events.push(e),
    });
    expect(handle.updateId).toMatch(/^[A-Z0-9]+$/);
    const updateId = await handle.done;
    expect(updateId).toBe(handle.updateId);

    const row = (await getSnapshot(d1, updateId)) as SnapshotRow;
    expect(row).not.toBeNull();
    expect(row.status).toBe('success');
    expect(row.from_version).toBe('0.7.0');
    expect(row.to_version).toBe('0.8.0');
    expect(row.snapshot_admin_deployment).toBe(OLD_ADMIN_DEPLOY);
    expect(row.snapshot_liff_deployment).toBe(OLD_LIFF_DEPLOY);
    expect(decodeWorkerSnapshot(row.snapshot_worker_url)).toEqual({
      bundleUrl: SNAPSHOT_WORKER_URL,
      versionId: 'OLD_WORKER_VERSION',
    });
    expect(row.completed_at).not.toBeNull();
    expect(row.error).toBeNull();

    // onEvent subscriber should have been called.
    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.step === 'preflight' && e.status === 'running')).toBe(true);
    expect(events.some((e) => e.step === 'complete' && e.status === 'done')).toBe(true);
    const completeEvent = events.find((e) => e.step === 'complete');
    expect(completeEvent.new_version).toBe('0.8.0');

    // All events should also be persisted to D1.
    const lines = row.events_jsonl.split('\n').filter((l) => l.length > 0);
    expect(lines.length).toBe(events.length);
  });

  it('preflight fails (token 403) → rollback runs, status = rolled_back', async () => {
    globalThis.fetch = makeFetch(fixture, {
      tokenVerify: { ok: false, status: 403, body: { error: 'bad token' } },
    }) as unknown as typeof fetch;

    const events: any[] = [];
    // Outer await still succeeds: the snapshot row is created BEFORE the
    // phase work runs. The phase failure surfaces via `done`.
    const handle = await runUpdate({
      ctx: sampleCtx(fixture),
      d1,
      workerHealthUrl: WORKER_HEALTH_URL,
      adminUrl: ADMIN_URL,
      liffUrl: LIFF_URL,
      currentWorkerBundleUrl: SNAPSHOT_WORKER_URL,
      onEvent: (e) => events.push(e),
    });
    expect(handle.updateId).toMatch(/^[A-Z0-9]+$/);
    await expect(handle.done).rejects.toThrow();

    // Find the most recent snapshot row.
    const rows = rawDb.prepare('SELECT id FROM update_history').all() as Array<{ id: string }>;
    expect(rows.length).toBe(1);
    const row = (await getSnapshot(d1, rows[0].id)) as SnapshotRow;
    expect(row.status).toBe('rolled_back');
    expect(row.error).not.toBeNull();

    // Rollback events emitted.
    expect(events.some((e) => e.step === 'rollback' && e.status === 'running')).toBe(true);
    expect(events.some((e) => e.step === 'rollback' && e.status === 'done')).toBe(true);
    const rollbackRun = events.find(
      (e) => e.step === 'rollback' && e.status === 'running',
    );
    expect(rollbackRun.error).toBeDefined();
  });

  it('apply fails (D1 migration error) → rollback runs, status = rolled_back', async () => {
    // Make ALL D1 queries fail. But preflight does a SELECT 1 first — so we
    // need preflight's D1 to succeed but the migration's D1 to fail. Use a
    // call counter via fetch internals.
    let d1Calls = 0;
    const baseFetch = makeFetch(fixture);
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes(D1_QUERY_SUBSTR)) {
        d1Calls++;
        if (d1Calls === 1) {
          // preflight SELECT 1
          return {
            ok: true,
            status: 200,
            json: async () => ({ success: true, result: [{ results: [{ ok: 1 }] }] }),
            text: async () => '{}',
            arrayBuffer: async () => new ArrayBuffer(0),
            body: null,
          } as unknown as Response;
        }
        // migration → fail
        return {
          ok: false,
          status: 400,
          json: async () => ({ errors: [{ message: 'syntax' }] }),
          text: async () => JSON.stringify({ errors: [{ message: 'syntax' }] }),
          arrayBuffer: async () => new ArrayBuffer(0),
          body: null,
        } as unknown as Response;
      }
      return baseFetch(url, init);
    }) as unknown as typeof fetch;

    const events: any[] = [];
    const handle = await runUpdate({
      ctx: sampleCtx(fixture),
      d1,
      workerHealthUrl: WORKER_HEALTH_URL,
      adminUrl: ADMIN_URL,
      liffUrl: LIFF_URL,
      currentWorkerBundleUrl: SNAPSHOT_WORKER_URL,
      onEvent: (e) => events.push(e),
    });
    await expect(handle.done).rejects.toThrow();

    const rows = rawDb.prepare('SELECT id FROM update_history').all() as Array<{ id: string }>;
    const row = (await getSnapshot(d1, rows[0].id)) as SnapshotRow;
    expect(row.status).toBe('rolled_back');
    expect(events.some((e) => e.step === 'rollback' && e.status === 'done')).toBe(true);
    // Preflight + migration:running, but migration:done should NOT have fired.
    expect(events.some((e) => e.step === 'migration' && e.status === 'running')).toBe(true);
    expect(events.some((e) => e.step === 'migration' && e.status === 'done')).toBe(false);
  });

  it('apply succeeds, verify fails (admin 500) → rollback runs, status = rolled_back', async () => {
    globalThis.fetch = makeFetch(fixture, {
      verifyAdminUrl: { ok: false, status: 500 },
    }) as unknown as typeof fetch;

    const events: any[] = [];
    const handle = await runUpdate({
      ctx: sampleCtx(fixture),
      d1,
      workerHealthUrl: WORKER_HEALTH_URL,
      adminUrl: ADMIN_URL,
      liffUrl: LIFF_URL,
      currentWorkerBundleUrl: SNAPSHOT_WORKER_URL,
      onEvent: (e) => events.push(e),
    });
    await expect(handle.done).rejects.toThrow();

    const rows = rawDb.prepare('SELECT id FROM update_history').all() as Array<{ id: string }>;
    const row = (await getSnapshot(d1, rows[0].id)) as SnapshotRow;
    expect(row.status).toBe('rolled_back');

    // verify:running emitted, verify:done NOT emitted.
    expect(events.some((e) => e.step === 'verify' && e.status === 'running')).toBe(true);
    expect(events.some((e) => e.step === 'verify' && e.status === 'done')).toBe(false);

    // Rollback ran to completion.
    expect(events.some((e) => e.step === 'rollback' && e.status === 'done')).toBe(true);
  }, 30000);

  it('rollback fails after primary failure → status = failed, error captures both', async () => {
    // Apply Worker PUT fails, then the version-based rollback also fails.
    globalThis.fetch = makeFetch(fixture, {
      workerPut: { ok: false, status: 500, body: { error: 'put failed' } },
      workerRollback: { ok: false, status: 500, body: { error: 'rollback failed' } },
    }) as unknown as typeof fetch;

    const events: any[] = [];
    const handle = await runUpdate({
      ctx: sampleCtx(fixture),
      d1,
      workerHealthUrl: WORKER_HEALTH_URL,
      adminUrl: ADMIN_URL,
      liffUrl: LIFF_URL,
      currentWorkerBundleUrl: SNAPSHOT_WORKER_URL,
      onEvent: (e) => events.push(e),
    });
    await expect(handle.done).rejects.toThrow();

    const rows = rawDb.prepare('SELECT id FROM update_history').all() as Array<{ id: string }>;
    const row = (await getSnapshot(d1, rows[0].id)) as SnapshotRow;
    expect(row.status).toBe('failed');
    expect(row.error).toMatch(/original:/);
    expect(row.error).toMatch(/rollback:/);
  });

  it('bundle hash mismatch (tampered) → throws via verifyBundleIntegrity, rollback runs', async () => {
    // Build a release with a WRONG byte hash — verifyBundleIntegrity should reject.
    globalThis.fetch = makeFetch(fixture) as unknown as typeof fetch;

    const ctx = sampleCtx(fixture, {
      target: sampleRelease(fixture, {
        worker_bundle_hash: 'sha256:tampered',
      }),
    });

    const events: any[] = [];
    const handle = await runUpdate({
      ctx,
      d1,
      workerHealthUrl: WORKER_HEALTH_URL,
      adminUrl: ADMIN_URL,
      liffUrl: LIFF_URL,
      currentWorkerBundleUrl: SNAPSHOT_WORKER_URL,
      onEvent: (e) => events.push(e),
    });
    await expect(handle.done).rejects.toThrow(
      /bundle worker hash mismatch|tampered/i,
    );

    const rows = rawDb.prepare('SELECT id FROM update_history').all() as Array<{ id: string }>;
    const row = (await getSnapshot(d1, rows[0].id)) as SnapshotRow;
    expect(row.status).toBe('rolled_back');
    // Rollback ran (and succeeded).
    expect(events.some((e) => e.step === 'rollback' && e.status === 'done')).toBe(true);
  });

  it('getLatestDeployment fails (snapshot never created) → outer await rejects, no row', async () => {
    // Make BOTH pages project lookups return non-OK. getLatestDeployment is
    // invoked in parallel before createSnapshot, so a failure here should
    // reject the outer Promise and never reach the handle stage.
    const baseFetch = makeFetch(fixture);
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      const method = (init?.method ?? 'GET').toUpperCase();
      if (
        method === 'GET' &&
        (url.includes(`/pages/projects/${ADMIN_PROJECT}/deployments`) ||
          url.includes(`/pages/projects/${LIFF_PROJECT}/deployments`))
      ) {
        return makeResponse({
          ok: false,
          status: 500,
          body: { error: 'pages api down' },
        });
      }
      return baseFetch(url, init);
    }) as unknown as typeof fetch;

    await expect(
      runUpdate({
        ctx: sampleCtx(fixture),
        d1,
        workerHealthUrl: WORKER_HEALTH_URL,
        adminUrl: ADMIN_URL,
        liffUrl: LIFF_URL,
        currentWorkerBundleUrl: SNAPSHOT_WORKER_URL,
      }),
    ).rejects.toThrow();

    // No snapshot row should exist — failure happened before createSnapshot.
    const rows = rawDb.prepare('SELECT id FROM update_history').all() as Array<{ id: string }>;
    expect(rows.length).toBe(0);
  });
});
