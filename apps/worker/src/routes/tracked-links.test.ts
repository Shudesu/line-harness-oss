import { describe, expect, test, beforeEach, vi } from 'vitest';

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
