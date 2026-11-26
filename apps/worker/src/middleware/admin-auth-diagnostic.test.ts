import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AdminAuthEnv, resolveCorsOrigin as CorsResolver } from './admin-auth-config.js';

const ADMIN = 'https://example-admin.pages.dev';
const WORKER = 'https://example-api.workers.dev';
let resolveCorsOrigin: typeof CorsResolver;

beforeEach(async () => {
  vi.resetModules();
  ({ resolveCorsOrigin } = await import('./admin-auth-config.js'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function diagnostic() {
  return JSON.parse(vi.mocked(console.warn).mock.calls[0][0] as string) as {
    component: string; code: string; message: string;
  };
}

describe('missing ADMIN_ORIGIN diagnostic', () => {
  test.each([
    [{}, 'admin_origin_empty'],
    [{ ADMIN_ORIGIN: '   ' }, 'admin_origin_empty'],
    [{ ADMIN_ORIGIN: 'example-admin.pages.dev' }, 'admin_origin_invalid'],
  ] as const)('explains a rejected auth request without allowing it (%j)', (env, code) => {
    expect(resolveCorsOrigin(env, ADMIN, `${WORKER}/api/auth/login`)).toBe('');
    expect(console.warn).toHaveBeenCalledOnce();
    expect(diagnostic()).toMatchObject({ component: 'admin-auth', code });
    expect(diagnostic().message).toContain('ADMIN_ORIGIN');
  });

  test('warns at most once even when calls use different environment objects', () => {
    for (let i = 0; i < 100; i++) {
      expect(resolveCorsOrigin({}, `https://probe-${i}.example`, `${WORKER}/api/auth/login`)).toBe('');
    }
    expect(console.warn).toHaveBeenCalledOnce();
  });

  test('an anonymous first probe consumes the advisory log without authorizing either origin', () => {
    const env: AdminAuthEnv = {};
    expect(resolveCorsOrigin(env, 'https://probe.example', `${WORKER}/api/auth/session`)).toBe('');
    expect(resolveCorsOrigin(env, ADMIN, `${WORKER}/api/auth/login`)).toBe('');
    expect(console.warn).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain('probe.example');
  });

  test('does not log request text, configured values, controls, or unbounded content', () => {
    const privateValue = 'not-a-url-' + '\u001b[31m\r\n' + 'secret-value-'.repeat(2000);
    expect(resolveCorsOrigin(
      { ADMIN_ORIGIN: privateValue },
      'https://untrusted.example',
      `${WORKER}/api/auth/${'long-path-'.repeat(2000)}?token=private-token`,
    )).toBe('');
    const logged = vi.mocked(console.warn).mock.calls[0][0] as string;
    expect(new TextEncoder().encode(logged).byteLength).toBeLessThan(512);
    expect(logged).not.toMatch(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/);
    expect(logged).not.toMatch(/secret-value|private-token|untrusted\.example|long-path/);
    expect(diagnostic().code).toBe('admin_origin_invalid');
  });

  test('does not consume the warning on data routes, same-origin, missing Origin, opaque Origin, or loopback', () => {
    expect(resolveCorsOrigin({}, ADMIN, `${WORKER}/api/friends`)).toBe('');
    expect(resolveCorsOrigin({}, WORKER, `${WORKER}/api/auth/login`)).toBe(WORKER);
    expect(resolveCorsOrigin({}, undefined, `${WORKER}/api/auth/session`)).toBe(WORKER);
    expect(resolveCorsOrigin({}, 'null', `${WORKER}/api/auth/login`)).toBe('');
    expect(resolveCorsOrigin({}, 'data:text/plain,opaque', `${WORKER}/api/auth/login`)).toBe('');
    expect(resolveCorsOrigin({}, 'http://localhost:3001', 'http://localhost:8787/api/auth/login')).toBe('http://localhost:3001');
    expect(console.warn).not.toHaveBeenCalled();
    expect(resolveCorsOrigin({}, ADMIN, `${WORKER}/api/auth/login`)).toBe('');
    expect(console.warn).toHaveBeenCalledOnce();
  });

  test('leaves configured allowlist and Pages preview decisions unchanged without warnings', () => {
    const env = { ADMIN_ORIGIN: ADMIN };
    expect(resolveCorsOrigin(env, ADMIN, `${WORKER}/api/auth/login`)).toBe(ADMIN);
    expect(resolveCorsOrigin(env, 'https://preview.example-admin.pages.dev', `${WORKER}/api/auth/login`)).toBe('https://preview.example-admin.pages.dev');
    expect(resolveCorsOrigin(env, 'https://other-project.pages.dev', `${WORKER}/api/auth/login`)).toBe('');
    expect(resolveCorsOrigin(env, 'https://attacker.example', `${WORKER}/api/auth/login`)).toBe('');
    expect(console.warn).not.toHaveBeenCalled();
  });
});
