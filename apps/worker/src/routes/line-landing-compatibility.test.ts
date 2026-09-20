import { describe, it, expect, vi, beforeEach } from 'vitest';

// Freeze the landing pages before extracting their presentation helpers.

const dbMocks = {
  // eager module-load deps
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  // route deps
  getFriendByLineUserId: vi.fn(),
  upsertFriend: vi.fn(),
  createUser: vi.fn().mockResolvedValue({ id: 'U-uuid' }),
  getUserByEmail: vi.fn().mockResolvedValue(null),
  linkFriendToUser: vi.fn().mockResolvedValue(undefined),
  getEntryRouteByRefCode: vi.fn().mockResolvedValue(null),
  recordRefTracking: vi.fn().mockResolvedValue(undefined),
  getTrackedLinkById: vi.fn().mockResolvedValue(null),
  getMessageTemplateById: vi.fn().mockResolvedValue(null),
  getAffiliateLinkByRefCode: vi.fn().mockResolvedValue(null),
  getAffiliateOfferById: vi.fn().mockResolvedValue(null),
  getAffiliateById: vi.fn().mockResolvedValue(null),
  addTagToFriend: vi.fn().mockResolvedValue(undefined),
  getLineAccountByChannelId: vi.fn().mockResolvedValue(null),
  getLineAccountById: vi.fn().mockResolvedValue(null),
  getScenarios: vi.fn().mockResolvedValue([]),
  enrollFriendInScenario: vi.fn().mockResolvedValue(null),
  getTrafficPoolBySlug: vi.fn().mockResolvedValue(null),
  getTrafficPoolById: vi.fn().mockResolvedValue(null),
  getRandomPoolAccount: vi.fn().mockResolvedValue(null),
  getPoolAccounts: vi.fn().mockResolvedValue([]),
  incrementAffiliateLinkClick: vi.fn().mockResolvedValue(undefined),
  jstNow: () => '2026-08-20 00:00:00',
};
vi.mock('@line-crm/db', () => dbMocks);

const pushImmediateFirstStep = vi.fn().mockResolvedValue(true);
vi.mock('../services/immediate-first-step.js', () => ({ pushImmediateFirstStep }));

const worker = (await import('../index.js')).default;

const DB = {
  prepare: () => ({
    bind: () => ({
      run: async () => ({ meta: { changes: 0 } }),
      first: async () => null,
      all: async () => ({ results: [] }),
    }),
  }),
} as unknown as D1Database;

const env = {
  DB,
  WORKER_URL: 'https://worker.example.com',
  LINE_CHANNEL_ACCESS_TOKEN: 'env-token',
  LIFF_URL: 'https://liff.line.me/1000000000-DefaultAA',
  LINE_LOGIN_CHANNEL_ID: '2000000000',
  LINE_LOGIN_CHANNEL_SECRET: 'login-secret',
} as unknown as import('../index.js').Env['Bindings'];

const MOBILE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';

function get(path: string, ua = MOBILE_UA) {
  return worker.fetch(
    new Request(`https://worker.example.com${path}`, {
      headers: { 'user-agent': ua },
      redirect: 'manual',
    }),
    env,
    { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext,
  );
}

// Capture the pre-extraction HTML. Only insignificant indentation and the
// equivalent viewport number are normalized for the /auth/line template.
const normalized = (html: string) => html.split('\n').map((line) => line.trim()).join('\n')
  .replace('width=device-width, initial-scale=1.0', 'width=device-width,initial-scale=1');

describe('landing HTML compatibility', () => {
  it.each([
    ['/r/campaign', DESKTOP_UA],
    ['/r/campaign', MOBILE_UA],
    ['/r/campaign', 'Android Mobile'],
    ['/o?liffId=1234567890-AbCdEfGh&page=event&id=42', DESKTOP_UA],
    ['/o?liffId=1234567890-AbCdEfGh&page=event&id=42', MOBILE_UA],
    ['/o?liffId=1234567890-AbCdEfGh&page=event&id=42', 'Android Mobile'],
    ['/auth/line?ref=campaign', DESKTOP_UA],
    ['/r/campaign/help?t=https%3A%2F%2Fliff.line.me%2F1234-Test', MOBILE_UA],
    ['/r/campaign/help', 'Android Mobile'],
    ['/r/campaign/help', DESKTOP_UA],
  ])('preserves %s (%s)', async (path, ua) => {
    const res = await get(path, ua);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(path.startsWith('/auth/') ? normalized(html) : html).toMatchSnapshot();
  });
});
