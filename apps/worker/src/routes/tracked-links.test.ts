import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest';
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

const { trackedLinks, ACTIVE_ACCOUNT_CACHE_TTL_MS } = await import('./tracked-links.js');

const LINE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Line/14.0.0';

interface AccountRow {
  id: string;
  liff_id: string | null;
  /** Defaults to 1 (active) when omitted. */
  is_active?: number;
  channel_secret?: string;
}

interface ScenarioRow {
  id: string;
  line_account_id: string | null;
}

/** Minimal D1 mock covering the raw queries in resolveLinkAccount(). */
function makeDb(state: {
  accounts?: AccountRow[];
  scenarios?: ScenarioRow[];
  failActiveLookup?: boolean;
}): D1Database {
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
            const acc = (state.accounts ?? []).find((a) => a.id === id);
            return (acc ? { is_active: 1, channel_secret: `secret-of-${acc.id}`, ...acc } : null) as T | null;
          }
          return null as T | null;
        },
        async run() {
          return { meta: { changes: 0 } };
        },
        async all<T>() {
          if (sql.includes('FROM line_accounts') && sql.includes('is_active = 1')) {
            if (state.failActiveLookup) throw new Error('D1 unavailable');
            const limit = Number(/LIMIT (\d+)/.exec(sql)?.[1] ?? Infinity);
            const rows = (state.accounts ?? [])
              .filter((a) => (a.is_active ?? 1) === 1)
              .slice(0, limit)
              .map((a) => ({ id: a.id }));
            return { results: rows as T[] };
          }
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

  test('account without liff_id goes straight to the link, never to another account LIFF', async () => {
    // 2026-09-08 の事故の再発防止。liff_id を持たないアカウントのリンクを
    // env.LIFF_URL へ落とすと、よその事業の LINE ログイン画面がその友だちに出る。
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-x' }));
    const env = {
      DB: makeDb({
        accounts: [
          { id: 'acc-main', liff_id: '2009554425-4IMBmLQ9' },
          { id: 'acc-x', liff_id: null },
        ],
      }),
      LIFF_URL: 'https://liff.line.me/2009554425-4IMBmLQ9',
      WORKER_URL: 'https://worker.example.com',
    };
    const res = await request(env, LINE_UA);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/lp');
  });

  test('scenario account without liff_id also skips the global LIFF', async () => {
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ scenario_id: 'scn-x' }));
    const env = {
      DB: makeDb({
        scenarios: [{ id: 'scn-x', line_account_id: 'acc-y' }],
        accounts: [
          { id: 'acc-main', liff_id: '2009554425-4IMBmLQ9' },
          { id: 'acc-y', liff_id: null },
        ],
      }),
      LIFF_URL: 'https://liff.line.me/2009554425-4IMBmLQ9',
      WORKER_URL: 'https://worker.example.com',
    };
    const res = await request(env, LINE_UA);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/lp');
  });

  // ── 単一アカウント / 既定アカウントは env.LIFF_URL を使い続ける ──
  // liff_id を DB に入れず LIFF_URL だけで運用している自前環境で、本人識別が
  // 効かなくなる（クリックが全部匿名になる）退行を防ぐ。
  const GLOBAL_LIFF = 'https://liff.line.me/2009554425-4IMBmLQ9';

  test('the only active account without liff_id keeps using env.LIFF_URL', async () => {
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-solo' }));
    const env = {
      DB: makeDb({ accounts: [{ id: 'acc-solo', liff_id: null }] }),
      LIFF_URL: GLOBAL_LIFF,
      WORKER_URL: 'https://worker.example.com',
    };
    const res = await request(env, LINE_UA);
    expect(res.status).toBe(302);
    const location = res.headers.get('location')!;
    expect(location.startsWith(`${GLOBAL_LIFF}?redirect=`)).toBe(true);
    expect(location).toContain(encodeURIComponent('https://worker.example.com/t/link-1'));
  });

  test('the only active account is resolved through the scenario too', async () => {
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ scenario_id: 'scn-solo' }));
    const env = {
      DB: makeDb({
        scenarios: [{ id: 'scn-solo', line_account_id: 'acc-solo' }],
        accounts: [{ id: 'acc-solo', liff_id: null }],
      }),
      LIFF_URL: GLOBAL_LIFF,
      WORKER_URL: 'https://worker.example.com',
    };
    const res = await request(env, LINE_UA);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')!.startsWith(`${GLOBAL_LIFF}?redirect=`)).toBe(true);
  });

  test('inactive accounts do not count: one active account still uses env.LIFF_URL', async () => {
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-solo' }));
    const env = {
      DB: makeDb({
        accounts: [
          { id: 'acc-retired', liff_id: null, is_active: 0 },
          { id: 'acc-solo', liff_id: null },
        ],
      }),
      LIFF_URL: GLOBAL_LIFF,
      WORKER_URL: 'https://worker.example.com',
    };
    const res = await request(env, LINE_UA);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')!.startsWith(`${GLOBAL_LIFF}?redirect=`)).toBe(true);
  });

  test('default account (channel_secret = env.LINE_CHANNEL_SECRET) uses env.LIFF_URL among several accounts', async () => {
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-main' }));
    const env = {
      DB: makeDb({
        accounts: [
          { id: 'acc-main', liff_id: null, channel_secret: 'env-secret' },
          { id: 'acc-other', liff_id: '2009668520-YghzbHx9', channel_secret: 'other-secret' },
        ],
      }),
      LIFF_URL: GLOBAL_LIFF,
      LINE_CHANNEL_SECRET: 'env-secret',
      WORKER_URL: 'https://worker.example.com',
    };
    const res = await request(env, LINE_UA);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')!.startsWith(`${GLOBAL_LIFF}?redirect=`)).toBe(true);
  });

  test('non-default account without liff_id still skips env.LIFF_URL when a default account exists', async () => {
    // 元の不具合そのもの: 既定アカウントAの LIFF が LIFF_URL に入っていて、
    // liff_id の無いアカウントBのリンクを B の友だちが踏む。
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-b' }));
    const env = {
      DB: makeDb({
        accounts: [
          { id: 'acc-a', liff_id: null, channel_secret: 'env-secret' },
          { id: 'acc-b', liff_id: null, channel_secret: 'b-secret' },
        ],
      }),
      LIFF_URL: GLOBAL_LIFF,
      LINE_CHANNEL_SECRET: 'env-secret',
      WORKER_URL: 'https://worker.example.com',
    };
    const res = await request(env, LINE_UA);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/lp');
  });

  test('sole active account whose secret differs from a configured env.LINE_CHANNEL_SECRET skips env.LIFF_URL', async () => {
    // 主チャネルは env だけに設定され、DB には追加アカウント1件だけ、という構成。
    // LIFF_URL は主チャネルのものなので、「有効なのは1つだけ」を理由に使わない。
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-sub' }));
    const env = {
      DB: makeDb({ accounts: [{ id: 'acc-sub', liff_id: null, channel_secret: 'sub-secret' }] }),
      LIFF_URL: GLOBAL_LIFF,
      LINE_CHANNEL_SECRET: 'env-secret',
      WORKER_URL: 'https://worker.example.com',
    };
    const prepare = vi.spyOn(env.DB, 'prepare');
    const res = await request(env, LINE_UA);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/lp');
    expect(prepare.mock.calls.filter(([sql]) => sql.includes('is_active = 1')).length).toBe(0);
  });

  test('sole active account matching env.LINE_CHANNEL_SECRET uses env.LIFF_URL without the active-account read', async () => {
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-solo' }));
    const env = {
      DB: makeDb({ accounts: [{ id: 'acc-solo', liff_id: null, channel_secret: 'env-secret' }] }),
      LIFF_URL: GLOBAL_LIFF,
      LINE_CHANNEL_SECRET: 'env-secret',
      WORKER_URL: 'https://worker.example.com',
    };
    const prepare = vi.spyOn(env.DB, 'prepare');
    const res = await request(env, LINE_UA);
    expect(res.headers.get('location')!.startsWith(`${GLOBAL_LIFF}?redirect=`)).toBe(true);
    expect(prepare.mock.calls.filter(([sql]) => sql.includes('is_active = 1')).length).toBe(0);
  });

  test('inactive owner never borrows env.LIFF_URL, even when one other account is active', async () => {
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-retired' }));
    const env = {
      DB: makeDb({
        accounts: [
          { id: 'acc-retired', liff_id: null, is_active: 0, channel_secret: 'env-secret' },
          { id: 'acc-live', liff_id: null },
        ],
      }),
      LIFF_URL: GLOBAL_LIFF,
      LINE_CHANNEL_SECRET: 'env-secret',
      WORKER_URL: 'https://worker.example.com',
    };
    const res = await request(env, LINE_UA);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/lp');
  });

  test('a failed account-count lookup fails closed (straight to the link)', async () => {
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-solo' }));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = {
      DB: makeDb({ accounts: [{ id: 'acc-solo', liff_id: null }], failActiveLookup: true }),
      LIFF_URL: GLOBAL_LIFF,
      WORKER_URL: 'https://worker.example.com',
    };
    const res = await request(env, LINE_UA);
    errorSpy.mockRestore();
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/lp');
  });

  // ── 費用: 「有効なアカウントは1つだけか」をクリックごとに読まない ──
  // /t/ は公開の転送経路。line_accounts の is_active には索引が無く、LIMIT 2 を
  // 付けても読む行数は減らないので、isolate 内で DB ごとに短時間だけ覚えておく。
  describe('active-account lookup is cached per isolate, per database', () => {
    /** Counts the `is_active = 1` reads issued against this database. */
    function countActiveLookups(db: D1Database) {
      const spy = vi.spyOn(db, 'prepare');
      return () => spy.mock.calls.filter(([sql]) => sql.includes('is_active = 1')).length;
    }

    function soloEnv(state: Parameters<typeof makeDb>[0]) {
      return { DB: makeDb(state), LIFF_URL: GLOBAL_LIFF, WORKER_URL: 'https://worker.example.com' };
    }

    const toLiff = (res: Response) => res.headers.get('location')!.startsWith(`${GLOBAL_LIFF}?redirect=`);

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-11-26T00:00:00Z'));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    test('repeated clicks while the cache is warm add zero active-account reads', async () => {
      dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-solo' }));
      const env = soloEnv({ accounts: [{ id: 'acc-solo', liff_id: null }] });
      const lookups = countActiveLookups(env.DB);

      expect(toLiff(await request(env, LINE_UA))).toBe(true);
      expect(lookups()).toBe(1); // cold isolate: one read

      for (let i = 0; i < 100; i++) {
        vi.advanceTimersByTime(500); // 50s in total, still inside the TTL
        expect(toLiff(await request(env, LINE_UA))).toBe(true);
      }
      expect(lookups()).toBe(1); // 100 more clicks, 0 more reads
    });

    test('the "more than one active account" answer is cached too', async () => {
      dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-x' }));
      const env = soloEnv({
        accounts: [
          { id: 'acc-main', liff_id: '2009554425-4IMBmLQ9' },
          { id: 'acc-x', liff_id: null },
        ],
      });
      const lookups = countActiveLookups(env.DB);
      for (let i = 0; i < 50; i++) {
        const res = await request(env, LINE_UA);
        expect(res.headers.get('location')).toBe('https://example.com/lp');
      }
      expect(lookups()).toBe(1);
    });

    test('concurrent clicks on a cold isolate each read for themselves, then the answer is cached', async () => {
      // 未完了の D1 読み取りは始めたリクエストのもの。別のクリックに待たせると、
      // 最初のリクエストが切れたときに転送が返らなくなるので共有しない。
      dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-solo' }));
      const env = soloEnv({ accounts: [{ id: 'acc-solo', liff_id: null }] });
      const lookups = countActiveLookups(env.DB);
      const responses = await Promise.all(Array.from({ length: 20 }, () => request(env, LINE_UA)));
      expect(responses.every(toLiff)).toBe(true);
      const cold = lookups();
      expect(cold).toBeGreaterThanOrEqual(1);
      expect(cold).toBeLessThanOrEqual(20);

      expect(toLiff(await request(env, LINE_UA))).toBe(true);
      expect(lookups()).toBe(cold); // warm now: no further reads
    });

    test('a click does not wait on another click\'s pending read', async () => {
      dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-solo' }));
      const env = soloEnv({ accounts: [{ id: 'acc-solo', liff_id: null }] });
      // The first click's active-account read never settles (its request was cancelled).
      const realPrepare = env.DB.prepare.bind(env.DB);
      let stalled = false;
      vi.spyOn(env.DB, 'prepare').mockImplementation((sql: string) => {
        const stmt = realPrepare(sql);
        if (!stalled && sql.includes('is_active = 1')) {
          stalled = true;
          (stmt as unknown as { all: () => Promise<unknown> }).all = () => new Promise(() => {});
        }
        return stmt;
      });
      void request(env, LINE_UA); // hangs forever
      await Promise.resolve();
      expect(toLiff(await request(env, LINE_UA))).toBe(true);
    });

    test('the cache expires: after the TTL the table is read again and a change is picked up', async () => {
      dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-solo' }));
      const state: Parameters<typeof makeDb>[0] = { accounts: [{ id: 'acc-solo', liff_id: null }] };
      const env = soloEnv(state);
      const lookups = countActiveLookups(env.DB);

      expect(toLiff(await request(env, LINE_UA))).toBe(true);
      state.accounts!.push({ id: 'acc-new', liff_id: null });

      vi.advanceTimersByTime(ACTIVE_ACCOUNT_CACHE_TTL_MS - 1);
      expect(toLiff(await request(env, LINE_UA))).toBe(true); // still the cached answer
      expect(lookups()).toBe(1);

      vi.advanceTimersByTime(1);
      const res = await request(env, LINE_UA);
      expect(res.headers.get('location')).toBe('https://example.com/lp'); // two active accounts now
      expect(lookups()).toBe(2);
    });

    test('a newly activated account is never mistaken for the only one while the cache is stale', async () => {
      // 事故の向き（よその事業の LINE ログイン画面が出る）へは古いキャッシュでも倒れない。
      const state: Parameters<typeof makeDb>[0] = { accounts: [{ id: 'acc-solo', liff_id: null }] };
      const env = soloEnv(state);
      dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-solo' }));
      expect(toLiff(await request(env, LINE_UA))).toBe(true);

      state.accounts!.push({ id: 'acc-new', liff_id: null });
      dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-new' }));
      const res = await request(env, LINE_UA);
      expect(res.headers.get('location')).toBe('https://example.com/lp');
    });

    test('an owner deactivated while the cache is warm stops using env.LIFF_URL at once', async () => {
      const state: Parameters<typeof makeDb>[0] = { accounts: [{ id: 'acc-solo', liff_id: null }] };
      const env = soloEnv(state);
      dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-solo' }));
      expect(toLiff(await request(env, LINE_UA))).toBe(true);

      state.accounts![0].is_active = 0;
      const res = await request(env, LINE_UA);
      expect(res.headers.get('location')).toBe('https://example.com/lp');
    });

    test('the cache is keyed by database: another DB with the same account id gets its own answer', async () => {
      dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-solo' }));
      const single = soloEnv({ accounts: [{ id: 'acc-solo', liff_id: null }] });
      const multi = soloEnv({
        accounts: [
          { id: 'acc-solo', liff_id: null },
          { id: 'acc-other', liff_id: null },
        ],
      });
      const singleLookups = countActiveLookups(single.DB);
      const multiLookups = countActiveLookups(multi.DB);

      expect(toLiff(await request(single, LINE_UA))).toBe(true);
      expect((await request(multi, LINE_UA)).headers.get('location')).toBe('https://example.com/lp');
      expect(toLiff(await request(single, LINE_UA))).toBe(true);
      expect(singleLookups()).toBe(1);
      expect(multiLookups()).toBe(1);
    });

    test('a failed lookup is not cached: the next click reads again', async () => {
      dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-solo' }));
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const state: Parameters<typeof makeDb>[0] = {
        accounts: [{ id: 'acc-solo', liff_id: null }],
        failActiveLookup: true,
      };
      const env = soloEnv(state);
      const lookups = countActiveLookups(env.DB);

      const failed = await request(env, LINE_UA);
      expect(failed.headers.get('location')).toBe('https://example.com/lp');

      state.failActiveLookup = false;
      expect(toLiff(await request(env, LINE_UA))).toBe(true);
      errorSpy.mockRestore();
      expect(lookups()).toBe(2);
    });

    test('clicks that never needed the lookup still issue none', async () => {
      const env = soloEnv({
        accounts: [
          { id: 'acc-liff', liff_id: '2009668520-YghzbHx9' },
          { id: 'acc-other', liff_id: null },
        ],
      });
      const lookups = countActiveLookups(env.DB);
      dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-liff' }));
      await request(env, LINE_UA); // owner has its own liff_id
      dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-other' }));
      await request(env, 'Mozilla/5.0 (Macintosh) Chrome/120'); // not the LINE in-app browser
      expect(lookups()).toBe(0);
    });
  });

  test('single account without liff_id and without env.LIFF_URL goes straight to the link', async () => {
    dbMocks.getTrackedLinkByIdOrShortCode.mockResolvedValue(makeLink({ line_account_id: 'acc-solo' }));
    const env = {
      DB: makeDb({ accounts: [{ id: 'acc-solo', liff_id: null }] }),
      WORKER_URL: 'https://worker.example.com',
    };
    const res = await request(env, LINE_UA);
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://example.com/lp');
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
