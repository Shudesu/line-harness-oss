import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from './index.js';

const adminOrigin = 'https://example-admin.pages.dev';
const workerOrigin = 'https://api.example.com';

function env(overrides: Partial<Env['Bindings']> = {}): Env['Bindings'] {
  // A preflight must finish without running any database or network operation.
  return {
    ADMIN_ORIGIN: adminOrigin,
    WORKER_URL: workerOrigin,
    DB: { prepare: vi.fn(() => { throw new Error('preflight reached database'); }) },
    ...overrides,
  } as Env['Bindings'];
}

async function preflight(origin: string, path = '/api/broadcasts', bindings = env()) {
  const fetchSpy = vi.fn(() => { throw new Error('unexpected outbound request'); });
  vi.stubGlobal('fetch', fetchSpy);
  const response = await worker.fetch(new Request(`${workerOrigin}${path}`, {
    method: 'OPTIONS',
    headers: {
      Origin: origin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-csrf-token,idempotency-key',
    },
  }), bindings);
  expect(response.status).toBe(204);
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(bindings.DB.prepare).not.toHaveBeenCalled();
  return response;
}

afterEach(() => vi.unstubAllGlobals());

describe('real Worker admin broadcast CORS preflight', () => {
  it.each([adminOrigin, 'https://preview.example-admin.pages.dev'])(
    'permits the actual broadcast headers from %s', async (origin) => {
      const response = await preflight(origin);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect(response.headers.get('Access-Control-Allow-Credentials')).toBe('true');
      const allowed = response.headers.get('Access-Control-Allow-Headers')?.toLowerCase().split(',').map(x => x.trim());
      expect(allowed).toEqual(expect.arrayContaining(['content-type', 'x-csrf-token', 'idempotency-key']));
      expect(response.headers.get('Access-Control-Allow-Methods')?.split(',')).toContain('POST');
    },
  );

  it('does not grant an unrelated origin credentialed access', async () => {
    const response = await preflight('https://untrusted.example');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('does not grant admin access when the allowlist is unset', async () => {
    const response = await preflight(adminOrigin, '/api/broadcasts', env({ ADMIN_ORIGIN: undefined }));
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });

  it('keeps the public media form CORS separate from credentialed admin CORS', async () => {
    const response = await preflight('https://the-harness.com', '/api/public/media-inquiries');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://the-harness.com');
    expect(response.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    expect(response.headers.get('Access-Control-Allow-Headers')?.toLowerCase()).toBe('content-type');
  });
});
