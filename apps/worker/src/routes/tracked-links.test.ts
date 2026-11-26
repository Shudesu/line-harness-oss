import { describe, expect, test, beforeEach, vi } from 'vitest';
import { runInNewContext } from 'node:vm';

// Mock the DB package — /t/:linkId route reads the link via getTrackedLinkById
// and records clicks via recordLinkClick (fire-and-forget in waitUntil).
const dbMocks = {
  getTrackedLinks: vi.fn(),
  getTrackedLinkById: vi.fn(),
  getTrackedLinkByIdOrShortCode: vi.fn(),
  createTrackedLink: vi.fn(),
  updateTrackedLink: vi.fn(),
  deleteTrackedLink: vi.fn(),
  recordLinkClick: vi.fn(),
  getLinkClicks: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  addTagToFriend: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  getTrackedLinkBaseUrl: vi.fn(),
  getLinkBaseUrl: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const { trackedLinks } = await import('./tracked-links.js');

const LINE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Line/14.0.0';

interface AccountRow {
  id: string;
  liff_id: string | null;
}

interface ScenarioRow {
  id: string;
  line_account_id: string | null;
}

/** Minimal D1 mock covering the raw queries in resolveLinkAccount(). */
function makeDb(state: { accounts?: AccountRow[]; scenarios?: ScenarioRow[] }): D1Database {
  return {
    prepare(sql: string) {
      let bound: unknown[] = [];
      const stmt = {
        bind(...args: unknown[]) {
          bound = args;
          return stmt;
        },
        async first<T>() {
          if (sql.includes('FROM scenarios')) {
            const [id] = bound as [string];
            const sc = (state.scenarios ?? []).find((s) => s.id === id);
            return (sc ? { line_account_id: sc.line_account_id } : null) as T | null;
          }
          if (sql.includes('FROM line_accounts')) {
            const [id] = bound as [string];
            return ((state.accounts ?? []).find((a) => a.id === id) ?? null) as T | null;
          }
          return null as T | null;
        },
        async run() {
          return { meta: { changes: 0 } };
        },
        async all<T>() {
          return { results: [] as T[] };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
}

function makeLink(overrides: Record<string, unknown> = {}) {
  return {
    id: 'link-1',
    name: 'test link',
    original_url: 'https://example.com/lp',
    tag_id: null,
    scenario_id: null,
    intro_template_id: null,
    reward_template_id: null,
    line_account_id: null,
    short_code: null,
    is_active: 1,
    click_count: 0,
    og_title: null,
    og_description: null,
    og_image_url: null,
    created_at: '2026-01-01T00:00:00+09:00',
    updated_at: '2026-01-01T00:00:00+09:00',
    ...overrides,
  };
}

const executionCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

function request(env: Record<string, unknown>, ua: string, path = '/t/link-1') {
  return trackedLinks.request(
    `https://worker.example.com${path}`,
    { headers: { 'user-agent': ua }, redirect: 'manual' },
    env,
    executionCtx,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.recordLinkClick.mockResolvedValue({});
  dbMocks.getTrackedLinkBaseUrl.mockResolvedValue(null);
});

describe('tracked-link destination validation', () => {
  const invalidDestinations = [
    'javascript://instagram.com/%0ainjected=true',
    'JaVaScRiPt://instagram.com/\ninjected=true',
    'data:text/html,<script>injected=true</script>',
    'ftp://instagram.com/profile',
    '//instagram.com/profile',
    'not a URL',
    'https://',
    'https://[invalid]/',
    'https://bad host/path',
    'https://example.com:invalid/',
  ];

  function createRequest(body: unknown) {
    return trackedLinks.request('https://worker.example.com/api/tracked-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }, { DB: makeDb({}) }, executionCtx);
  }

  test.each(invalidDestinations)('POST rejects an invalid destination before writing: %s', async (originalUrl) => {
    const res = await createRequest({ name: 'link', originalUrl });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false });
    expect(dbMocks.createTrackedLink).not.toHaveBeenCalled();
  });

  test.each([null, true, 123, [], {}])('POST rejects a non-string destination: %j', async (originalUrl) => {
    const res = await createRequest({ name: 'link', originalUrl });
    expect(res.status).toBe(400);
    expect(dbMocks.createTrackedLink).not.toHaveBeenCalled();
  });

  test('POST rejects a null request body without throwing a server error', async () => {
    const res = await createRequest(null);
    expect(res.status).toBe(400);
    expect(dbMocks.createTrackedLink).not.toHaveBeenCalled();
  });

  test.each(['http', 'https', 'HTTPS'])('POST preserves a valid %s URL exactly', async (scheme) => {
    const originalUrl = `${scheme}://example.com/page?q=日本語&quote="'"&encoded=%26&literal=&quot;#section`;
    dbMocks.createTrackedLink.mockResolvedValue(makeLink({ original_url: originalUrl }));
    const res = await createRequest({ name: 'link', originalUrl });
    expect(res.status).toBe(201);
    expect(dbMocks.createTrackedLink).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ originalUrl }));
    expect(await res.json()).toMatchObject({ success: true, data: { originalUrl } });
  });

  test.each(invalidDestinations)('/t rejects invalid legacy destinations before redirect or tracking: %s', async (originalUrl) => {
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ original_url: originalUrl }));
    const waitUntil = vi.fn();
    const prepare = vi.fn();
    const res = await trackedLinks.request('https://worker.example.com/t/link-1?lu=line-user', {}, {
      DB: { prepare },
    }, { ...executionCtx, waitUntil });
    expect(res.status).toBe(400);
    expect(res.headers.get('location')).toBeNull();
    expect(await res.json()).toEqual({ success: false, error: 'Invalid link destination' });
    expect(waitUntil).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
    expect(dbMocks.getFriendByLineUserId).not.toHaveBeenCalled();
    expect(dbMocks.recordLinkClick).not.toHaveBeenCalled();
  });

  test.each([LINE_UA, 'Twitterbot/1.0'])('/t rejects unsafe legacy URLs before LIFF or OG handling for %s', async (ua) => {
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({
      original_url: 'javascript://instagram.com/%0ainjected=true',
      line_account_id: 'acc-1',
    }));
    const prepare = vi.fn();
    const res = await request({ DB: { prepare }, LIFF_URL: 'https://liff.line.me/123' }, ua);
    expect(res.status).toBe(400);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(res.headers.get('location')).toBeNull();
    expect(prepare).not.toHaveBeenCalled();
    expect(dbMocks.recordLinkClick).not.toHaveBeenCalled();
  });
});

describe('GET /t/:linkId — per-account LIFF resolution', () => {
  test('link owned by an account redirects LINE in-app clicks to that account LIFF', async () => {
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-1b' }));
    const env = {
      DB: makeDb({ accounts: [{ id: 'acc-1b', liff_id: '2009668520-YghzbHx9' }] }),
      LIFF_URL: 'https://liff.line.me/2009554425-4IMBmLQ9',
      WORKER_URL: 'https://worker.example.com',
    };
    const res = await request(env, LINE_UA);
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location.startsWith('https://liff.line.me/2009668520-YghzbHx9?redirect=')).toBe(true);
    expect(location).toContain(encodeURIComponent('https://worker.example.com/t/link-1'));
  });

  test('falls back to scenario account when link has no line_account_id', async () => {
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ scenario_id: 'scn-1' }));
    const env = {
      DB: makeDb({
        scenarios: [{ id: 'scn-1', line_account_id: 'acc-2' }],
        accounts: [{ id: 'acc-2', liff_id: '2009590922-I2FwUvxr' }],
      }),
      LIFF_URL: 'https://liff.line.me/2009554425-4IMBmLQ9',
      WORKER_URL: 'https://worker.example.com',
    };
    const res = await request(env, LINE_UA);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')!.startsWith('https://liff.line.me/2009590922-I2FwUvxr?redirect=')).toBe(true);
  });

  test('falls back to env.LIFF_URL when no owning account is resolvable', async () => {
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink());
    const env = {
      DB: makeDb({}),
      LIFF_URL: 'https://liff.line.me/2009554425-4IMBmLQ9',
      WORKER_URL: 'https://worker.example.com',
    };
    const res = await request(env, LINE_UA);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')!.startsWith('https://liff.line.me/2009554425-4IMBmLQ9?redirect=')).toBe(true);
  });

  test('account without liff_id falls back to env.LIFF_URL', async () => {
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-x' }));
    const env = {
      DB: makeDb({ accounts: [{ id: 'acc-x', liff_id: null }] }),
      LIFF_URL: 'https://liff.line.me/2009554425-4IMBmLQ9',
      WORKER_URL: 'https://worker.example.com',
    };
    const res = await request(env, LINE_UA);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')!.startsWith('https://liff.line.me/2009554425-4IMBmLQ9?redirect=')).toBe(true);
  });

  test('non-LINE browsers redirect straight to the original URL', async () => {
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-1b' }));
    const env = {
      DB: makeDb({ accounts: [{ id: 'acc-1b', liff_id: '2009668520-YghzbHx9' }] }),
      LIFF_URL: 'https://liff.line.me/2009554425-4IMBmLQ9',
      WORKER_URL: 'https://worker.example.com',
    };
    const res = await request(env, 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/lp');
  });
});

describe('GET /t/:linkId — short codes', () => {
  test('short-code URLs resolve and record the click against the link UUID', async () => {
    const waits: Promise<unknown>[] = [];
    const collectingCtx = {
      waitUntil: (p: Promise<unknown>) => waits.push(p),
      passThroughOnException: () => {},
    } as unknown as ExecutionContext;
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(
      makeLink({ id: 'uuid-link-1', short_code: 'Ab3xY9k' }),
    );
    const env = {
      DB: makeDb({}),
      LIFF_URL: 'https://liff.line.me/2009554425-4IMBmLQ9',
      WORKER_URL: 'https://worker.example.com',
    };
    const res = await trackedLinks.request(
      'https://worker.example.com/t/Ab3xY9k',
      { headers: { 'user-agent': 'Mozilla/5.0 Safari/605.1.15' }, redirect: 'manual' },
      env,
      collectingCtx,
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/lp');
    expect(dbMocks.getTrackedLinkByIdOrShortCode).toHaveBeenCalledWith(env.DB, 'Ab3xY9k');
    await Promise.allSettled(waits);
    // Click must be recorded against the UUID, not the short code
    expect(dbMocks.recordLinkClick).toHaveBeenCalledWith(env.DB, 'uuid-link-1', null);
  });

  test('LINE in-app LIFF round-trip keeps the same /t identifier', async () => {
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(
      makeLink({ id: 'uuid-link-1', short_code: 'Ab3xY9k', line_account_id: 'acc-1b' }),
    );
    const env = {
      DB: makeDb({ accounts: [{ id: 'acc-1b', liff_id: '2009668520-YghzbHx9' }] }),
      LIFF_URL: 'https://liff.line.me/2009554425-4IMBmLQ9',
      WORKER_URL: 'https://worker.example.com',
    };
    const res = await request(env, LINE_UA, '/t/Ab3xY9k');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toContain(
      encodeURIComponent('https://worker.example.com/t/Ab3xY9k'),
    );
  });
});

describe('GET /t/:linkId — app redirect output escaping', () => {
  const safariUa = 'Mozilla/5.0 (iPhone) Safari/605.1.15';
  const androidUa = 'Mozilla/5.0 (Linux; Android 14) Chrome/120.0.0.0';

  async function redirectHtml(destination: string) {
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ original_url: destination }));
    const res = await request({ DB: makeDb({}) }, safariUa);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    return res.text();
  }

  function executeRedirect(html: string, userAgent: string): string {
    // Check HTML delimiters before executing: JS parsing alone would miss a
    // literal </script> terminating the element inside a quoted JS string.
    expect(html.match(/<script\b/gi)).toHaveLength(1);
    expect(html.match(/<\/script\s*>/gi)).toHaveLength(1);
    const script = html.match(/<script>([\s\S]*?)<\/script>/i)?.[1];
    expect(script).toBeDefined();
    expect(script).not.toContain('<');
    const sandbox = { navigator: { userAgent }, window: { location: { href: '' } }, injected: false };
    runInNewContext(script!, sandbox, { timeout: 1000 });
    expect(sandbox.injected).toBe(false);
    return sandbox.window.location.href;
  }

  test.each([safariUa, androidUa])('keeps script-closing payloads inside URL strings for %s', async (ua) => {
    const destination = 'https://x.com/search?q=</ScRiPt><img src=x onerror="injected=true"><script>injected=true;//';
    const html = await redirectHtml(destination);
    expect(html).not.toMatch(/<img\b/i);
    const redirect = executeRedirect(html, ua);
    if (ua === androidUa) {
      expect(redirect).toBe(`intent://x.com/search?q=</ScRiPt><img src=x onerror="injected=true"><script>injected=true;//#Intent;scheme=https;package=com.twitter.android;S.browser_fallback_url=${encodeURIComponent(destination)};end`);
    } else {
      expect(redirect).toBe(destination);
    }
  });

  test.each([safariUa, androidUa])('preserves quotes, ampersands, backslashes and Unicode for %s', async (ua) => {
    const destination = 'https://www.youtube.com/watch?v=abc&label="日本語"&quote=\'single\'&slash=\\path&encoded=%26&literal=&quot;&line=\u2028\u2029';
    const html = await redirectHtml(destination);
    const redirect = executeRedirect(html, ua);
    if (ua === androidUa) {
      expect(redirect).toBe(`intent://www.youtube.com/watch?v=abc&label="日本語"&quote='single'&slash=\\path&encoded=%26&literal=&quot;&line=\u2028\u2029#Intent;scheme=https;package=com.google.android.youtube;S.browser_fallback_url=${encodeURIComponent(destination)};end`);
      const fallback = redirect.match(/;S\.browser_fallback_url=(.*);end$/)?.[1];
      expect(decodeURIComponent(fallback!)).toBe(destination);
    } else {
      expect(redirect).toBe(destination);
    }
  });

  test('encodes the noscript refresh URL as one HTML attribute without changing its value', async () => {
    const destination = 'https://x.com/search?q="/><img src=x onerror=alert(1)>&tag=\'日本語\'&literal=&quot;';
    const html = await redirectHtml(destination);
    const noscript = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1];
    expect(noscript).toBe('<meta http-equiv="refresh" content="0;url=https://x.com/search?q=&quot;/&gt;&lt;img src=x onerror=alert(1)&gt;&amp;tag=&#39;日本語&#39;&amp;literal=&amp;quot;">');
    expect(html).not.toMatch(/<img\b/i);
    expect(executeRedirect(html, safariUa)).toBe(destination);
  });

  test.each(['http', 'https'])('keeps normal %s non-app links as redirects with query parameters intact', async (scheme) => {
    const destination = `${scheme}://example.com/page?first=one&second=two%20words#section`;
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ original_url: destination }));
    const res = await request({ DB: makeDb({}) }, safariUa);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe(destination);
  });

  test.each(['http', 'https', 'HTTPS'])('preserves a %s app URL and its Android fallback', async (scheme) => {
    const destination = `${scheme}://instagram.com/profile?first=one&second=two%20words`;
    const html = await redirectHtml(destination);
    expect(executeRedirect(html, safariUa)).toBe(destination);
    expect(executeRedirect(html, androidUa)).toBe(`intent://instagram.com/profile?first=one&second=two%20words#Intent;scheme=https;package=com.instagram.android;S.browser_fallback_url=${encodeURIComponent(destination)};end`);
  });
});
