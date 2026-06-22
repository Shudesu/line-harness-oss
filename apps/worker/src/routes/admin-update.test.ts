import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import {
  ADMIN_AUTH_COOKIE,
  CSRF_COOKIE,
  CSRF_HEADER,
  createAdminSessionToken,
  type AuthenticatedStaff,
} from '../middleware/auth.js';

// Mock the engine before importing the route. Tests exercise HTTP behavior
// only — the engine itself is covered by its own package tests, so here we
// just want deterministic return values for runUpdate / manifest / snapshot
// reads. Mocks deliberately model both vanilla + fork outcomes so the route
// can choose between 202 / 200 (already_latest) / 409 (fork) branches.
const runUpdate = vi.fn();
const fetchManifest = vi.fn();
const detectFork = vi.fn();
const findRelease = vi.fn();
const getSnapshot = vi.fn();
const listRecent = vi.fn();

vi.mock('@line-harness/update-engine', () => ({
  runUpdate: (...args: any[]) => runUpdate(...args),
  fetchManifest: (...args: any[]) => fetchManifest(...args),
  detectFork: (...args: any[]) => detectFork(...args),
  findRelease: (...args: any[]) => findRelease(...args),
  getSnapshot: (...args: any[]) => getSnapshot(...args),
  listRecent: (...args: any[]) => listRecent(...args),
}));

const baseRelease = {
  version: '0.8.0',
  released_at: '2026-05-01T00:00:00Z',
  worker_hash: 'sha256:aaaa',
  admin_hash: 'sha256:bbbb',
  liff_hash: 'sha256:cccc',
  bundle_url: 'https://example.com/bundle.tar.gz',
  bundle_size_bytes: 1000,
  required_secrets: [],
  new_required_secrets: [],
  migrations: [],
  changelog_url: '',
  min_from_version: '0.0.0',
};

const baseManifest = {
  schema_version: 1 as const,
  latest: '0.8.0',
  releases: [baseRelease],
};

// Import the route AFTER vi.mock so the engine import resolves through the
// stub. The route module is what we're testing.
async function loadRoute() {
  const mod = await import('./admin-update.js');
  return mod.default;
}

const baseEnv = {
  DB: {
    // The route never executes real SQL because every engine helper is mocked.
    // prepare() is here so any incidental call doesn't crash the test runner.
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        run: vi.fn().mockResolvedValue(undefined),
        first: vi.fn().mockResolvedValue(null),
        all: vi.fn().mockResolvedValue({ results: [] }),
      })),
    })),
  } as unknown as D1Database,
  API_KEY: 'test-api-key',
  ADMIN_API_KEY: 'test-admin-key',
  ADMIN_SESSION_SECRET: 'test-admin-session-secret',
  CF_API_TOKEN: 'cf-token',
  CF_ACCOUNT_ID: 'cf-acct',
  WORKER_NAME: 'line-harness',
  ADMIN_PAGES_PROJECT: 'line-harness-admin',
  LIFF_PAGES_PROJECT: 'line-harness-liff',
  D1_DATABASE_ID: 'd1-id',
  MANIFEST_URL: 'https://example.com/manifest.json',
  WORKER_PUBLIC_URL: 'https://worker.example.com',
  ADMIN_PUBLIC_URL: 'https://admin.example.com',
  LIFF_PUBLIC_URL: 'https://liff.example.com',
} as Record<string, unknown>;

const baseCtx = {
  // executionCtx.waitUntil runs the work async; in tests we want it to run
  // synchronously (await the promise) so we observe runUpdate side-effects.
  waitUntil: (p: Promise<unknown>) => p,
  passThroughOnException: vi.fn(),
  props: {},
} as unknown as ExecutionContext;

async function request(path: string, init?: RequestInit) {
  const app = new Hono();
  const adminUpdate = await loadRoute();
  app.route('/admin/update', adminUpdate);
  return app.request(path, init, baseEnv, baseCtx);
}

async function sessionHeaders(
  opts: { csrf?: boolean; staff?: AuthenticatedStaff } = {},
): Promise<Record<string, string>> {
  const staff = opts.staff ?? { id: 'owner', name: 'Owner', role: 'owner' as const };
  const sessionToken = await createAdminSessionToken(
    baseEnv as { ADMIN_SESSION_SECRET?: string },
    staff,
  );
  const csrf = 'csrf-test-token';
  return {
    Cookie: `${ADMIN_AUTH_COOKIE}=${encodeURIComponent(sessionToken)}; ${CSRF_COOKIE}=${csrf}`,
    ...(opts.csrf ? { [CSRF_HEADER]: csrf } : {}),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default happy-path setups; individual tests override as needed.
  fetchManifest.mockResolvedValue(baseManifest);
  detectFork.mockReturnValue({ kind: 'vanilla', matchedRelease: baseRelease });
  findRelease.mockReturnValue({ ...baseRelease, version: '0.0.0-dev' });
  // The engine now returns an UpdateHandle: outer resolves quickly with the
  // id, `done` settles later with the terminal state. Tests mock the success
  // path by default; failure cases reject either outer (setup error) or
  // `done` (phase error).
  runUpdate.mockResolvedValue({
    updateId: 'UPDATE_ID_123',
    done: Promise.resolve('UPDATE_ID_123'),
  });
  getSnapshot.mockResolvedValue(null);
  listRecent.mockResolvedValue([]);
});

describe('POST /admin/update/start', () => {
  it('rejects requests without an admin session → 401', async () => {
    const res = await request('/admin/update/start', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('rejects requests with wrong legacy key → 401', async () => {
    const res = await request('/admin/update/start', {
      method: 'POST',
      headers: { 'x-admin-api-key': 'wrong' },
    });
    expect(res.status).toBe(401);
  });

  it('rejects cookie-authenticated POSTs without CSRF → 403', async () => {
    const res = await request('/admin/update/start', {
      method: 'POST',
      headers: await sessionHeaders(),
    });
    expect(res.status).toBe(403);
    expect(runUpdate).not.toHaveBeenCalled();
  });

  it('starts an update with admin session + CSRF and returns 202 with updateId', async () => {
    const res = await request('/admin/update/start', {
      method: 'POST',
      headers: await sessionHeaders({ csrf: true }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { updateId: string };
    expect(body.updateId).toBe('UPDATE_ID_123');
    expect(runUpdate).toHaveBeenCalledTimes(1);
  });

  it('returns 200 with already_latest when target.version === current.version', async () => {
    // Force the target to match the build-time current version (0.0.0-dev).
    fetchManifest.mockResolvedValue({
      ...baseManifest,
      latest: '0.0.0-dev',
      releases: [{ ...baseRelease, version: '0.0.0-dev' }],
    });
    // detectFork returns vanilla because hashes happen to match (the engine
    // would actually compare them; we shortcut by returning vanilla here).
    detectFork.mockReturnValue({
      kind: 'vanilla',
      matchedRelease: { ...baseRelease, version: '0.0.0-dev' },
    });
    const res = await request('/admin/update/start', {
      method: 'POST',
      headers: await sessionHeaders({ csrf: true }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('already_latest');
    expect(runUpdate).not.toHaveBeenCalled();
  });

  it('returns 409 fork_detected when detectFork reports a fork', async () => {
    detectFork.mockReturnValue({
      kind: 'fork',
      reason: 'worker hash mismatch (custom build)',
    });
    const res = await request('/admin/update/start', {
      method: 'POST',
      headers: await sessionHeaders({ csrf: true }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; reason: string };
    expect(body.error).toBe('fork_detected');
    expect(body.reason).toContain('worker hash mismatch');
    expect(runUpdate).not.toHaveBeenCalled();
  });

  it('returns 500 update_failed when runUpdate rejects before snapshot creation', async () => {
    // Simulate getLatestDeployment failing inside the engine — runUpdate
    // rejects synchronously before producing a handle, so there's no
    // updateId to return. The route should surface 500 update_failed so
    // the dashboard can tell the operator the run never started.
    runUpdate.mockRejectedValueOnce(new Error('cf pages api down'));
    const res = await request('/admin/update/start', {
      method: 'POST',
      headers: await sessionHeaders({ csrf: true }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('update_failed');
    expect(body.message).toContain('cf pages api down');
  });
});

describe('GET /admin/update/status/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request('/admin/update/status/abc');
    expect(res.status).toBe(401);
  });

  it('returns 404 when no snapshot row exists', async () => {
    getSnapshot.mockResolvedValue(null);
    const res = await request('/admin/update/status/nope', {
      headers: await sessionHeaders(),
    });
    expect(res.status).toBe(404);
  });

  it('returns 200 with row + parsed events array when row exists', async () => {
    getSnapshot.mockResolvedValue({
      id: 'abc',
      status: 'success',
      events_jsonl:
        '{"step":"preflight","status":"done"}\n{"step":"complete","status":"done"}\n',
      error: null,
      from_version: '0.7.0',
      to_version: '0.8.0',
    });
    const res = await request('/admin/update/status/abc', {
      headers: await sessionHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      id: string;
      status: string;
      events: Array<{ step: string; status: string }>;
    };
    expect(body.id).toBe('abc');
    expect(body.status).toBe('success');
    expect(body.events).toHaveLength(2);
    expect(body.events[0]).toEqual({ step: 'preflight', status: 'done' });
    expect(body.events[1]).toEqual({ step: 'complete', status: 'done' });
  });
});

describe('GET /admin/update/history', () => {
  it('returns 401 without auth', async () => {
    const res = await request('/admin/update/history');
    expect(res.status).toBe(401);
  });

  it('returns 200 with history array', async () => {
    listRecent.mockResolvedValue([
      { id: 'a', status: 'success', from_version: '0.7.0', to_version: '0.8.0' },
      { id: 'b', status: 'failed', from_version: '0.6.0', to_version: '0.7.0' },
    ]);
    const res = await request('/admin/update/history', {
      headers: await sessionHeaders(),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { history: Array<{ id: string }> };
    expect(body.history).toHaveLength(2);
    expect(body.history[0].id).toBe('a');
    // listRecent should be called with limit=20
    expect(listRecent).toHaveBeenCalled();
    const callArgs = listRecent.mock.calls[0];
    expect(callArgs[1]).toBe(20);
  });
});

describe('GET /admin/update/stream/:id', () => {
  it('returns 401 without auth', async () => {
    const res = await request('/admin/update/stream/abc');
    expect(res.status).toBe(401);
  });

  it('sets correct SSE headers when authenticated', async () => {
    // Return a terminal snapshot so the stream loop exits after one tick.
    getSnapshot.mockResolvedValue({
      id: 'abc',
      status: 'success',
      events_jsonl: '{"step":"complete","status":"done"}\n',
      error: null,
      from_version: '0.7.0',
      to_version: '0.8.0',
    });
    const res = await request('/admin/update/stream/abc', {
      headers: await sessionHeaders(),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });
});
