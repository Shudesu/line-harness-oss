import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { runVerify } from '../../src/phases/verify.js';
import type { VerifyUrls } from '../../src/phases/verify.js';
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

const WORKER_HEALTH_URL = 'https://worker.example.com/health';
const ADMIN_URL = 'https://admin.example.com/';
const LIFF_URL = 'https://liff.example.com/';
const D1_QUERY_SUBSTR = `/d1/database/${D1_ID}/query`;

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

const sampleUrls = (overrides: Partial<VerifyUrls> = {}): VerifyUrls => ({
  workerHealthUrl: WORKER_HEALTH_URL,
  adminUrl: ADMIN_URL,
  liffUrl: LIFF_URL,
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
  } as unknown as Response;
}

function notOk(status = 500, body: unknown = { error: 'fail' }): Response {
  return {
    ok: false,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

const RETRY_DELAY_MS = 3000;

describe('runVerify', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('happy path — all 3 fetches succeed first try, D1 ping succeeds, emits running then done', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(D1_QUERY_SUBSTR)) {
        return ok({ success: true, result: [{ results: [{ ok: 1 }] }] });
      }
      return ok({ healthy: true });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { events, emitter } = collectEvents();
    await runVerify(sampleCtx(), sampleUrls(), emitter);

    expect(events).toEqual([
      { step: 'verify', status: 'running' },
      { step: 'verify', status: 'done' },
    ]);

    // 1 worker + 1 D1 + 1 admin + 1 liff
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('Worker /health succeeds after 2 retries (fail-fail-pass) — done event emitted', async () => {
    let workerCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === WORKER_HEALTH_URL) {
        workerCalls++;
        if (workerCalls <= 2) return notOk(503);
        return ok({ healthy: true });
      }
      if (url.includes(D1_QUERY_SUBSTR)) {
        return ok({ success: true, result: [] });
      }
      return ok();
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { events, emitter } = collectEvents();
    const promise = runVerify(sampleCtx(), sampleUrls(), emitter);

    // First worker fetch happens synchronously. Advance through 2 retry delays.
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await promise;

    expect(workerCalls).toBe(3);
    expect(events).toEqual([
      { step: 'verify', status: 'running' },
      { step: 'verify', status: 'done' },
    ]);
    // 3 worker + 1 D1 + 1 admin + 1 liff
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  // Regression: worker bundles released before the public /api/health
  // route existed answer 401 (auth middleware) or 404 to the health probe.
  // Any response below 500 proves the Worker booted and is routing — it
  // must NOT fail verify (which would trigger a pointless rollback).
  it.each([401, 404])(
    'Worker health %i (pre-health-route bundle) — treated as alive, verify proceeds',
    async (status) => {
      const fetchMock = vi.fn(async (url: string) => {
        if (url === WORKER_HEALTH_URL) return notOk(status);
        if (url.includes(D1_QUERY_SUBSTR)) return ok({ success: true, result: [] });
        return ok();
      });
      globalThis.fetch = fetchMock as unknown as typeof fetch;

      const { events, emitter } = collectEvents();
      await runVerify(sampleCtx(), sampleUrls(), emitter);

      expect(events).toEqual([
        { step: 'verify', status: 'running' },
        { step: 'verify', status: 'done' },
      ]);
      // No retries: the first sub-500 response settles the worker probe.
      const callUrls = (fetchMock.mock.calls as Array<[string]>).map(([u]) => u);
      expect(callUrls.filter((u) => u === WORKER_HEALTH_URL).length).toBe(1);
    },
  );

  it('Admin URL 401 still fails — permissive check applies to the worker probe only', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === WORKER_HEALTH_URL) return ok();
      if (url.includes(D1_QUERY_SUBSTR)) return ok({ success: true, result: [] });
      if (url === ADMIN_URL) return notOk(401);
      return ok();
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { emitter } = collectEvents();
    const promise = runVerify(sampleCtx(), sampleUrls(), emitter);
    const settled = promise.catch((e) => e);

    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

    const err = (await settled) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/Admin/);
  });

  it('Worker /health fails after 3 retries — throws, done event NOT emitted', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === WORKER_HEALTH_URL) return notOk(500);
      if (url.includes(D1_QUERY_SUBSTR)) return ok({ success: true, result: [] });
      return ok();
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { events, emitter } = collectEvents();
    const promise = runVerify(sampleCtx(), sampleUrls(), emitter);
    // Catch unhandled rejection — promise resolves after timers advance.
    const settled = promise.catch((e) => e);

    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

    const err = (await settled) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/Worker \/health failed/);

    // running emitted, done NOT emitted.
    expect(events).toEqual([{ step: 'verify', status: 'running' }]);
    // No D1, admin or liff calls.
    const callUrls = (fetchMock.mock.calls as Array<[string]>).map(
      ([u]) => u,
    );
    expect(callUrls.filter((u) => u === WORKER_HEALTH_URL).length).toBe(3);
    expect(callUrls.some((u) => u.includes(D1_QUERY_SUBSTR))).toBe(false);
    expect(callUrls.some((u) => u === ADMIN_URL)).toBe(false);
    expect(callUrls.some((u) => u === LIFF_URL)).toBe(false);
  });

  it('D1 ping fails — throws (via executeD1Query), done NOT emitted', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === WORKER_HEALTH_URL) return ok({ healthy: true });
      if (url.includes(D1_QUERY_SUBSTR)) return notOk(400, { errors: [{ message: 'no' }] });
      return ok();
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { events, emitter } = collectEvents();
    await expect(runVerify(sampleCtx(), sampleUrls(), emitter)).rejects.toThrow();

    expect(events).toEqual([{ step: 'verify', status: 'running' }]);
    const callUrls = (fetchMock.mock.calls as Array<[string]>).map(
      ([u]) => u,
    );
    // Worker called once (ok), D1 called once (failed), no admin/liff.
    expect(callUrls.filter((u) => u === WORKER_HEALTH_URL).length).toBe(1);
    expect(callUrls.some((u) => u === ADMIN_URL)).toBe(false);
    expect(callUrls.some((u) => u === LIFF_URL)).toBe(false);
  });

  it('Admin URL fails after 3 retries — throws, error names admin URL', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === WORKER_HEALTH_URL) return ok();
      if (url.includes(D1_QUERY_SUBSTR)) return ok({ success: true, result: [] });
      if (url === ADMIN_URL) return notOk(502);
      return ok();
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { events, emitter } = collectEvents();
    const promise = runVerify(sampleCtx(), sampleUrls(), emitter);
    const settled = promise.catch((e) => e);

    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

    const err = (await settled) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/Admin/);
    expect(err.message).toContain(ADMIN_URL);

    expect(events).toEqual([{ step: 'verify', status: 'running' }]);
    const callUrls = (fetchMock.mock.calls as Array<[string]>).map(
      ([u]) => u,
    );
    expect(callUrls.filter((u) => u === ADMIN_URL).length).toBe(3);
    expect(callUrls.some((u) => u === LIFF_URL)).toBe(false);
  });

  it('LIFF URL fails after 3 retries — throws, error names LIFF URL', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === WORKER_HEALTH_URL) return ok();
      if (url.includes(D1_QUERY_SUBSTR)) return ok({ success: true, result: [] });
      if (url === ADMIN_URL) return ok();
      if (url === LIFF_URL) return notOk(503);
      return ok();
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { events, emitter } = collectEvents();
    const promise = runVerify(sampleCtx(), sampleUrls(), emitter);
    const settled = promise.catch((e) => e);

    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

    const err = (await settled) as Error;
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/LIFF/);
    expect(err.message).toContain(LIFF_URL);

    expect(events).toEqual([{ step: 'verify', status: 'running' }]);
    const callUrls = (fetchMock.mock.calls as Array<[string]>).map(
      ([u]) => u,
    );
    expect(callUrls.filter((u) => u === LIFF_URL).length).toBe(3);
  });

  it('Worker fetch network error (rejected promise) — handled by retry', async () => {
    let workerCalls = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === WORKER_HEALTH_URL) {
        workerCalls++;
        if (workerCalls <= 2) throw new Error('ECONNREFUSED');
        return ok({ healthy: true });
      }
      if (url.includes(D1_QUERY_SUBSTR)) return ok({ success: true, result: [] });
      return ok();
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { events, emitter } = collectEvents();
    const promise = runVerify(sampleCtx(), sampleUrls(), emitter);

    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);
    await promise;

    expect(workerCalls).toBe(3);
    expect(events).toEqual([
      { step: 'verify', status: 'running' },
      { step: 'verify', status: 'done' },
    ]);
  });

  it('order verification: Worker /health called before D1, D1 before Admin, Admin before LIFF', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes(D1_QUERY_SUBSTR)) return ok({ success: true, result: [] });
      return ok({ healthy: true });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { emitter } = collectEvents();
    await runVerify(sampleCtx(), sampleUrls(), emitter);

    const calls = (fetchMock.mock.calls as Array<[string]>).map(([u]) => u);
    const workerIdx = calls.findIndex((u) => u === WORKER_HEALTH_URL);
    const d1Idx = calls.findIndex((u) => u.includes(D1_QUERY_SUBSTR));
    const adminIdx = calls.findIndex((u) => u === ADMIN_URL);
    const liffIdx = calls.findIndex((u) => u === LIFF_URL);

    expect(workerIdx).toBeGreaterThanOrEqual(0);
    expect(d1Idx).toBeGreaterThanOrEqual(0);
    expect(adminIdx).toBeGreaterThanOrEqual(0);
    expect(liffIdx).toBeGreaterThanOrEqual(0);
    expect(workerIdx).toBeLessThan(d1Idx);
    expect(d1Idx).toBeLessThan(adminIdx);
    expect(adminIdx).toBeLessThan(liffIdx);
  });
});
