import { describe, expect, test, beforeEach, vi } from 'vitest';

const dbMocks = {
  createTrackedLink: vi.fn(),
  getTrackedLinkBaseUrl: vi.fn(),
  getLinkBaseUrl: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const { appendFriendToTrackedLinks } = await import('./auto-track.js');

const DB = {} as D1Database;
const WORKER = 'https://worker.example.com';
const SHORT = 'https://go.example.com';
const FRIEND = 'friend-uuid-1';

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getTrackedLinkBaseUrl.mockResolvedValue(SHORT);
});

describe('appendFriendToTrackedLinks', () => {
  test('appends f= to short-domain /t links in flex JSON', async () => {
    const content = `{"type":"uri","uri":"${SHORT}/t/Ab3xY9k"}`;
    const out = await appendFriendToTrackedLinks(DB, content, WORKER, FRIEND);
    expect(out).toBe(`{"type":"uri","uri":"${SHORT}/t/Ab3xY9k?f=${FRIEND}"}`);
  });

  test('appends with & when the link already has a query', async () => {
    const content = `${SHORT}/t/Ab3xY9k?openExternalBrowser=1`;
    const out = await appendFriendToTrackedLinks(DB, content, WORKER, FRIEND);
    expect(out).toBe(`${SHORT}/t/Ab3xY9k?openExternalBrowser=1&f=${FRIEND}`);
  });

  test('appends to worker-domain legacy UUID links too', async () => {
    const content = `${WORKER}/t/415bbb13-97bc-4a3c-a5bb-e5138af42737`;
    const out = await appendFriendToTrackedLinks(DB, content, WORKER, FRIEND);
    expect(out).toBe(`${WORKER}/t/415bbb13-97bc-4a3c-a5bb-e5138af42737?f=${FRIEND}`);
  });

  test('does not touch non-tracked URLs or existing f= params', async () => {
    const content = `https://example.com/lp と ${SHORT}/t/abc1234?f=other`;
    const out = await appendFriendToTrackedLinks(DB, content, WORKER, FRIEND);
    expect(out).toBe(content);
  });

  test('keeps sentence punctuation outside the appended query', async () => {
    const content = `詳しくはこちら ${SHORT}/t/Ab3xY9k。続きは ${SHORT}/t/xYz9876.`;
    const out = await appendFriendToTrackedLinks(DB, content, WORKER, FRIEND);
    expect(out).toBe(
      `詳しくはこちら ${SHORT}/t/Ab3xY9k?f=${FRIEND}。続きは ${SHORT}/t/xYz9876?f=${FRIEND}.`,
    );
  });

  test('no-op when friendId is missing', async () => {
    const content = `${SHORT}/t/Ab3xY9k`;
    expect(await appendFriendToTrackedLinks(DB, content, WORKER, null)).toBe(content);
    expect(dbMocks.getTrackedLinkBaseUrl).not.toHaveBeenCalled();
  });

  test('falls back to worker base when no short domain is configured', async () => {
    dbMocks.getTrackedLinkBaseUrl.mockResolvedValue(null);
    const content = `${WORKER}/t/Ab3xY9k`;
    const out = await appendFriendToTrackedLinks(DB, content, WORKER, FRIEND);
    expect(out).toBe(`${WORKER}/t/Ab3xY9k?f=${FRIEND}`);
  });
});
