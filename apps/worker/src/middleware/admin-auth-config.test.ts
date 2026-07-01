import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  isCrossSite,
  parseAllowedOrigins,
  registrableDomain,
  resolveAdminAuthConfig,
  resolveCorsOrigin,
  type AdminAuthEnv,
} from './admin-auth-config.js';

const PAGES = 'https://line-crm-admin.pages.dev';
const WORKERS = 'https://line-crm-worker.line-crm-api.workers.dev';

describe('registrableDomain', () => {
  test('treats each *.pages.dev / *.workers.dev host as its own site', () => {
    expect(registrableDomain('line-crm-admin.pages.dev')).toBe('line-crm-admin.pages.dev');
    expect(registrableDomain('line-crm-worker.line-crm-api.workers.dev')).toBe(
      'line-crm-api.workers.dev',
    );
  });

  test('falls back to the last two labels for ordinary domains', () => {
    expect(registrableDomain('admin.example.com')).toBe('example.com');
    expect(registrableDomain('api.example.com')).toBe('example.com');
  });
});

describe('isCrossSite', () => {
  test('pages.dev ↔ workers.dev is cross-site', () => {
    expect(isCrossSite(PAGES, WORKERS)).toBe(true);
  });

  test('subdomains of a shared custom domain are same-site', () => {
    expect(isCrossSite('https://admin.example.com', 'https://api.example.com')).toBe(false);
  });
});

describe('parseAllowedOrigins', () => {
  test('splits, trims and normalizes a comma-separated allowlist', () => {
    const env: AdminAuthEnv = {
      ADMIN_ORIGIN: 'https://admin.example.com/ , https://staff.example.com',
    };
    expect(parseAllowedOrigins(env)).toEqual([
      'https://admin.example.com',
      'https://staff.example.com',
    ]);
  });

  test('returns [] when unset', () => {
    expect(parseAllowedOrigins({})).toEqual([]);
  });
});

describe('resolveAdminAuthConfig — topology guard', () => {
  test('cross-site without opt-in is flagged as misconfigured (the #57/#59 blocker)', () => {
    const cfg = resolveAdminAuthConfig({ ADMIN_ORIGIN: PAGES, WORKER_URL: WORKERS });
    expect(cfg.crossSite).toBe(true);
    expect(cfg.sameSite).toBe('Lax'); // would be silently dropped cross-site
    expect(cfg.misconfigured).toMatch(/cross-site/i);
  });

  test('cross-site WITH ADMIN_ALLOW_CROSS_SITE=true issues SameSite=None and is valid', () => {
    const cfg = resolveAdminAuthConfig({
      ADMIN_ORIGIN: PAGES,
      WORKER_URL: WORKERS,
      ADMIN_ALLOW_CROSS_SITE: 'true',
    });
    expect(cfg.sameSite).toBe('None');
    expect(cfg.secure).toBe(true);
    expect(cfg.misconfigured).toBeNull();
  });

  test('same-site custom domains use SameSite=Lax and are valid', () => {
    const cfg = resolveAdminAuthConfig({
      ADMIN_ORIGIN: 'https://admin.example.com',
      WORKER_URL: 'https://api.example.com',
    });
    expect(cfg.crossSite).toBe(false);
    expect(cfg.sameSite).toBe('Lax');
    expect(cfg.misconfigured).toBeNull();
  });

  test('explicit SameSite=Strict on a cross-site topology is still flagged', () => {
    const cfg = resolveAdminAuthConfig({
      ADMIN_ORIGIN: PAGES,
      WORKER_URL: WORKERS,
      ADMIN_COOKIE_SAMESITE: 'Strict',
    });
    expect(cfg.sameSite).toBe('Strict');
    expect(cfg.misconfigured).toMatch(/cross-site/i);
  });

  test('SameSite=None without an ADMIN_ORIGIN allowlist is flagged', () => {
    const cfg = resolveAdminAuthConfig({
      WORKER_URL: WORKERS,
      ADMIN_COOKIE_SAMESITE: 'None',
    });
    expect(cfg.misconfigured).toMatch(/ADMIN_ORIGIN/);
  });

  test('no admin origin (worker-served same-origin) defaults to Lax and is valid', () => {
    const cfg = resolveAdminAuthConfig({ WORKER_URL: WORKERS });
    expect(cfg.crossSite).toBe(false);
    expect(cfg.sameSite).toBe('Lax');
    expect(cfg.misconfigured).toBeNull();
  });

  test('with WORKER_URL unset, the request origin is used for cross-site detection', () => {
    // Production installer never sets WORKER_URL; the request origin is the
    // Worker's own origin and must still flag the cross-site blocker.
    const cfg = resolveAdminAuthConfig(
      { ADMIN_ORIGIN: PAGES },
      { requestOrigin: WORKERS },
    );
    expect(cfg.crossSite).toBe(true);
    expect(cfg.misconfigured).toMatch(/cross-site/i);
  });

  test('opt-in cross-site with WORKER_URL unset still issues a valid SameSite=None config', () => {
    const cfg = resolveAdminAuthConfig(
      { ADMIN_ORIGIN: PAGES, ADMIN_ALLOW_CROSS_SITE: 'true' },
      { requestOrigin: WORKERS },
    );
    expect(cfg.sameSite).toBe('None');
    expect(cfg.misconfigured).toBeNull();
  });
});

describe('resolveCorsOrigin — allowed / blocked', () => {
  const env: AdminAuthEnv = {
    ADMIN_ORIGIN: PAGES,
    WORKER_URL: WORKERS,
    ADMIN_ALLOW_CROSS_SITE: 'true',
  };
  const requestUrl = `${WORKERS}/api/friends`;

  test('echoes an allowlisted admin origin', () => {
    expect(resolveCorsOrigin(env, PAGES, requestUrl)).toBe(PAGES);
  });

  test('blocks an unknown origin (empty string → no ACAO header)', () => {
    expect(resolveCorsOrigin(env, 'https://evil.example.com', requestUrl)).toBe('');
  });

  test('always allows same-origin requests', () => {
    expect(resolveCorsOrigin(env, WORKERS, requestUrl)).toBe(WORKERS);
  });

  test('permits no-Origin (non-browser / SDK) callers', () => {
    expect(resolveCorsOrigin(env, undefined, requestUrl)).toBe(WORKERS);
  });
});

describe('resolveCorsOrigin — empty-allowlist diagnostic (#179)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('warns on an admin-auth route when ADMIN_ORIGIN is empty', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // ADMIN_ORIGIN unset (setup aborted before the admin-auth step) → the admin
    // Pages origin is not allowlisted → CORS blocks it with an opaque error.
    // A fresh env object each call = a fresh isolate for the once-per-isolate latch.
    const result = resolveCorsOrigin({}, PAGES, `${WORKERS}/api/auth/login`);
    expect(result).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/ADMIN_ORIGIN is empty/);
  });

  test('does NOT warn when the allowlist is set but the origin is unknown', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A configured allowlist that simply does not contain this origin is an
    // ordinary block, not the missing-config signal — stay quiet.
    const result = resolveCorsOrigin(
      { ADMIN_ORIGIN: PAGES },
      'https://evil.example.com',
      `${WORKERS}/api/auth/login`,
    );
    expect(result).toBe('');
    expect(warn).not.toHaveBeenCalled();
  });

  test('does NOT warn for an allowed same-origin request', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(resolveCorsOrigin({}, WORKERS, `${WORKERS}/api/auth/session`)).toBe(WORKERS);
    expect(warn).not.toHaveBeenCalled();
  });

  test('does NOT warn for a stray cross-origin hit on a non-auth data route', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A scanner probing /api/friends with a random Origin is not the operator's
    // missing-ADMIN_ORIGIN symptom — restricting to /api/auth/* avoids log spam
    // and false advice in the valid worker-served-same-origin topology.
    expect(resolveCorsOrigin({}, 'https://scanner.example.com', `${WORKERS}/api/friends`)).toBe('');
    expect(warn).not.toHaveBeenCalled();
  });

  test('warns at most once per isolate (env) despite repeated rejections', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const env: AdminAuthEnv = {};
    resolveCorsOrigin(env, PAGES, `${WORKERS}/api/auth/login`);
    resolveCorsOrigin(env, 'https://another.example.com', `${WORKERS}/api/auth/session`);
    resolveCorsOrigin(env, PAGES, `${WORKERS}/api/auth/login`);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('resolveCorsOrigin — local development', () => {
  test('allows a loopback admin origin when the Worker runs on loopback', () => {
    // `pnpm dev:web` (localhost:3001) → `wrangler dev` (localhost:8787),
    // with no ADMIN_ORIGIN configured.
    expect(
      resolveCorsOrigin({}, 'http://localhost:3001', 'http://localhost:8787/api/friends'),
    ).toBe('http://localhost:3001');
  });

  test('does NOT allow loopback origins when the Worker is deployed (production)', () => {
    expect(
      resolveCorsOrigin({ ADMIN_ORIGIN: PAGES }, 'http://localhost:3001', `${WORKERS}/api/friends`),
    ).toBe('');
  });
});
