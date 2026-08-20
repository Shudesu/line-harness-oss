import { describe, expect, test, beforeEach, vi } from 'vitest';

const dbMocks = {
  getOrCreateAutoTrackedLink: vi.fn(),
  getTrackedLinkBaseUrl: vi.fn(),
  getLinkBaseUrl: vi.fn(),
  getLineAccountById: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const { appendFriendToTrackedLinks, autoTrackContent, decorateForFriendPush } = await import(
  './auto-track.js'
);

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

  test("skips the settings read when content contains no '/t/' (URL-free welcome fast path)", async () => {
    const content = 'こんにちは！ようこそ。https://example.com/lp もどうぞ';
    expect(await appendFriendToTrackedLinks(DB, content, WORKER, FRIEND)).toBe(content);
    expect(dbMocks.getTrackedLinkBaseUrl).not.toHaveBeenCalled();
  });

  test('falls back to worker base when no short domain is configured', async () => {
    dbMocks.getTrackedLinkBaseUrl.mockResolvedValue(null);
    const content = `${WORKER}/t/Ab3xY9k`;
    const out = await appendFriendToTrackedLinks(DB, content, WORKER, FRIEND);
    expect(out).toBe(`${WORKER}/t/Ab3xY9k?f=${FRIEND}`);
  });
});

describe('autoTrackContent (flex)', () => {
  beforeEach(() => {
    let n = 0;
    dbMocks.getOrCreateAutoTrackedLink.mockImplementation(async () => {
      n += 1;
      return { id: `id-${n}`, short_code: `Code${n}` };
    });
  });

  const flex = (obj: unknown) => JSON.stringify(obj);

  test('rewrites action uri but never the image url (blank-image bug)', async () => {
    const content = flex({
      type: 'bubble',
      hero: {
        type: 'image',
        url: 'https://cdn.example.com/hero.png',
        action: { type: 'uri', uri: 'https://example.com/lp' },
      },
    });
    const out = await autoTrackContent(DB, 'flex', content, WORKER);
    const tree = JSON.parse(out.content);
    expect(tree.hero.url).toBe('https://cdn.example.com/hero.png');
    expect(tree.hero.action.uri).toBe(`${SHORT}/t/Code1`);
  });

  test('rewrites defaultAction and altUri.desktop', async () => {
    const content = flex({
      type: 'box',
      defaultAction: {
        type: 'uri',
        uri: 'https://example.com/a',
        altUri: { desktop: 'https://example.com/a' },
      },
    });
    const out = await autoTrackContent(DB, 'flex', content, WORKER);
    const tree = JSON.parse(out.content);
    expect(tree.defaultAction.uri).toBe(`${SHORT}/t/Code1`);
    expect(tree.defaultAction.altUri.desktop).toBe(`${SHORT}/t/Code1`);
  });

  test('adds openExternalBrowser=1 for app-link domains in actions', async () => {
    const content = flex({
      type: 'button',
      action: { type: 'uri', uri: 'https://youtube.com/watch?v=abc' },
    });
    const out = await autoTrackContent(DB, 'flex', content, WORKER);
    const tree = JSON.parse(out.content);
    expect(tree.action.uri).toBe(`${SHORT}/t/Code1?openExternalBrowser=1`);
  });

  test('skips LIFF, tel: and already-tracked action uris', async () => {
    const content = flex({
      type: 'box',
      contents: [
        { type: 'button', action: { type: 'uri', uri: 'https://liff.line.me/123-abc' } },
        { type: 'button', action: { type: 'uri', uri: 'tel:0312345678' } },
        { type: 'button', action: { type: 'uri', uri: `${SHORT}/t/Existing1` } },
      ],
    });
    const out = await autoTrackContent(DB, 'flex', content, WORKER);
    expect(out.content).toBe(content);
    expect(dbMocks.getOrCreateAutoTrackedLink).not.toHaveBeenCalled();
  });

  test('malformed action uris are skipped instead of crashing the delivery', async () => {
    const content = flex({
      type: 'box',
      contents: [
        { type: 'button', action: { type: 'uri', uri: 'https://' } },
        { type: 'button', action: { type: 'uri', uri: 'https://exa mple.com/lp' } },
        { type: 'button', action: { type: 'uri', uri: 'https://example.com/ok' } },
      ],
    });
    const out = await autoTrackContent(DB, 'flex', content, WORKER);
    const tree = JSON.parse(out.content);
    expect(tree.contents[0].action.uri).toBe('https://');
    expect(tree.contents[1].action.uri).toBe('https://exa mple.com/lp');
    expect(tree.contents[2].action.uri).toBe(`${SHORT}/t/Code1`);
    expect(dbMocks.getOrCreateAutoTrackedLink).toHaveBeenCalledTimes(1);
  });

  test('leaves invalid flex JSON untouched instead of corrupting it', async () => {
    const content = 'not-json https://example.com/lp';
    const out = await autoTrackContent(DB, 'flex', content, WORKER);
    expect(out.content).toBe(content);
    expect(dbMocks.getOrCreateAutoTrackedLink).not.toHaveBeenCalled();
  });

  test('passes lineAccountId through to created links', async () => {
    const content = flex({
      type: 'button',
      action: { type: 'uri', uri: 'https://example.com/lp' },
    });
    await autoTrackContent(DB, 'flex', content, WORKER, { lineAccountId: 'acc-1' });
    expect(dbMocks.getOrCreateAutoTrackedLink).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({ lineAccountId: 'acc-1' }),
    );
  });
});

describe('decorateForFriendPush — shared cron/instant pipeline', () => {
  test('returns input unchanged and touches no DB when workerUrl is not configured', async () => {
    const content = '詳細は https://example.com/lp へ';
    const out = await decorateForFriendPush(DB, 'text', content, undefined, {
      lineAccountId: 'acc-1',
      friendId: FRIEND,
    });
    expect(out).toEqual({ messageType: 'text', content });
    expect(dbMocks.getOrCreateAutoTrackedLink).not.toHaveBeenCalled();
    expect(dbMocks.getTrackedLinkBaseUrl).not.toHaveBeenCalled();
  });

  test('wraps raw URLs into tracked links owned by lineAccountId, then bakes f=<friendId>', async () => {
    dbMocks.getOrCreateAutoTrackedLink.mockResolvedValue({ id: 'tl-1', short_code: 'Ab3xY9k' });
    const out = await decorateForFriendPush(DB, 'text', '詳細は https://example.com/lp へ', WORKER, {
      lineAccountId: 'acc-1',
      friendId: FRIEND,
    });
    expect(dbMocks.getOrCreateAutoTrackedLink).toHaveBeenCalledWith(
      DB,
      expect.objectContaining({ originalUrl: 'https://example.com/lp', lineAccountId: 'acc-1' }),
    );
    expect(out.messageType).toBe('text');
    expect(out.content).toBe(`詳細は ${SHORT}/t/Ab3xY9k?f=${FRIEND} へ`);
  });

  test('appends f= to pre-existing /t links even when nothing needs auto-tracking', async () => {
    const content = `${SHORT}/t/xYz9876`;
    const out = await decorateForFriendPush(DB, 'text', content, WORKER, {
      lineAccountId: null,
      friendId: FRIEND,
    });
    expect(dbMocks.getOrCreateAutoTrackedLink).not.toHaveBeenCalled();
    expect(out.content).toBe(`${SHORT}/t/xYz9876?f=${FRIEND}`);
  });

  test("substitutes {{liff_id}} with the delivering account's LIFF (multi-account form URLs)", async () => {
    dbMocks.getLineAccountById.mockResolvedValue({ id: 'acc-1b', liff_id: '2009668520-YghzbHx9' });
    const content = 'フォーム: https://liff.line.me/{{liff_id}}?page=form&id=f-1&liffId={{liff_id}}';
    const out = await decorateForFriendPush(DB, 'text', content, WORKER, {
      lineAccountId: 'acc-1b',
      friendId: FRIEND,
    });
    expect(dbMocks.getLineAccountById).toHaveBeenCalledWith(DB, 'acc-1b');
    expect(out.content).toBe(
      'フォーム: https://liff.line.me/2009668520-YghzbHx9?page=form&id=f-1&liffId=2009668520-YghzbHx9',
    );
  });

  test('{{liff_id}} with no resolvable account is left unresolved (logged), content otherwise intact', async () => {
    const content = 'https://liff.line.me/{{liff_id}}?page=form';
    const out = await decorateForFriendPush(DB, 'text', content, WORKER, {
      lineAccountId: null,
      friendId: FRIEND,
    });
    expect(dbMocks.getLineAccountById).not.toHaveBeenCalled();
    expect(out.content).toContain('{{liff_id}}');
  });
});
