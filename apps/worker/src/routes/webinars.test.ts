import { describe, expect, test, beforeEach, vi } from 'vitest';

const dbMocks = {
  getWebinars: vi.fn(),
  getWebinarById: vi.fn(),
  getWebinarBySlug: vi.fn(),
  createWebinar: vi.fn(),
  updateWebinar: vi.fn(),
  deleteWebinar: vi.fn(),
  getWebinarComments: vi.fn(),
  replaceWebinarComments: vi.fn(),
  upsertWebinarViewer: vi.fn(),
  updateWebinarViewerPosition: vi.fn(),
  recordWebinarCtaClick: vi.fn(),
  insertWebinarUserComment: vi.fn(),
  countSessionUserComments: vi.fn(),
  getWebinarUserComments: vi.fn(),
  getWebinarSessionStats: vi.fn(),
  getWebinarDropoff: vi.fn(),
  getFriendByLineUserId: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const authMock = { verifyCallerLineUserId: vi.fn() };
vi.mock('../services/liff-auth.js', () => authMock);

const tagMock = { attachTagAndFireSideEffects: vi.fn() };
vi.mock('../services/friend-tag-attach.js', () => tagMock);

const { webinarRoutes } = await import('./webinars.js');
const { signWebinarToken } = await import('../lib/webinar-token.js');

const SECRET = 'channel-secret';
// 2026-07-29 20:00 JST 開始の once スケジュール
const SESSION_START = Math.floor(Date.UTC(2026, 6, 29, 11, 0) / 1000);

function makeWebinar(over: Record<string, unknown> = {}) {
  return {
    id: 'w1',
    account_id: null,
    title: 'テストウェビナー',
    slug: 'test-webinar',
    status: 'active',
    video_prefix: 'webinars/test-webinar',
    duration_seconds: 7200,
    schedule_json: '[{"type":"once","at":"2026-07-29T20:00:00+09:00"}]',
    cta_json: '{"label":"申込","url":"https://pay.example.com","showAtSeconds":5400}',
    tag_on_attend: 'tag-attend',
    tag_on_cta_click: null,
    created_at: 'x',
    updated_at: 'x',
    ...over,
  };
}

const env = { DB: {} as D1Database, LINE_CHANNEL_SECRET: SECRET, IMAGES: {} as R2Bucket };
const execCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

function req(path: string, init?: RequestInit) {
  return webinarRoutes.request(path, init, env, execCtx);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers();
  // ライブ開始30分後
  vi.setSystemTime(new Date((SESSION_START + 1800) * 1000));
  authMock.verifyCallerLineUserId.mockResolvedValue('U123');
  dbMocks.getFriendByLineUserId.mockResolvedValue({ id: 'friend-1' });
  dbMocks.getWebinarBySlug.mockResolvedValue(makeWebinar());
  dbMocks.getWebinarComments.mockResolvedValue([
    { id: 'c1', webinar_id: 'w1', at_seconds: 10, author_name: '田中', body: '楽しみ!', created_at: 'x' },
  ]);
  dbMocks.upsertWebinarViewer.mockResolvedValue({ firstJoin: true });
});

describe('GET /api/liff/webinars/:slug', () => {
  test('ライブ中は offset とプレイリスト URL とコメントを返す', async () => {
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer token' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(true);
    expect(body.offsetSeconds).toBe(1800);
    expect(body.sessionStartAt).toBe(SESSION_START);
    expect(body.playlistUrl).toMatch(
      /^\/webinar-assets\/\d+\.[A-Za-z0-9_-]+\/test-webinar\/master\.m3u8$/,
    );
    expect(body.comments).toEqual([{ atSeconds: 10, authorName: '田中', body: '楽しみ!' }]);
    expect(dbMocks.upsertWebinarViewer).toHaveBeenCalledWith({}, 'w1', 'friend-1', SESSION_START);
  });

  test('tag_on_attend が waitUntil 経由で付与される', async () => {
    await req('/api/liff/webinars/test-webinar', { headers: { Authorization: 'Bearer t' } });
    expect(execCtx.waitUntil).toHaveBeenCalled();
  });

  test('時間外は live:false と nextSessionAt', async () => {
    vi.setSystemTime(new Date((SESSION_START - 600) * 1000));
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(false);
    expect(body.nextSessionAt).toBe(SESSION_START);
    expect(dbMocks.upsertWebinarViewer).not.toHaveBeenCalled();
  });

  test('id_token 検証失敗は 401', async () => {
    authMock.verifyCallerLineUserId.mockResolvedValue(null);
    const res = await req('/api/liff/webinars/test-webinar');
    expect(res.status).toBe(401);
  });

  test('未認証の場合、webinar が存在しなくても 401 が返る(存在オラクル防止)', async () => {
    authMock.verifyCallerLineUserId.mockResolvedValue(null);
    dbMocks.getWebinarBySlug.mockResolvedValue(null);
    const res = await req('/api/liff/webinars/does-not-exist');
    expect(res.status).toBe(401);
    expect(dbMocks.getWebinarBySlug).not.toHaveBeenCalled();
  });

  test('friend 未登録は 403', async () => {
    dbMocks.getFriendByLineUserId.mockResolvedValue(null);
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    expect(res.status).toBe(403);
  });

  test('draft ウェビナーは 404', async () => {
    dbMocks.getWebinarBySlug.mockResolvedValue(makeWebinar({ status: 'draft' }));
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    expect(res.status).toBe(404);
  });
});

describe('GET /webinar-assets/:token/:slug/*', () => {
  function makeR2(objects: Record<string, string>) {
    return {
      get: vi.fn(async (key: string) =>
        objects[key] !== undefined
          ? { body: objects[key], etag: 'etag1', httpMetadata: {} }
          : null,
      ),
    };
  }

  test('有効トークンでセグメント配信・content-type/cache 設定', async () => {
    const r2 = makeR2({ 'webinars/test-webinar/0/seg_0001.ts': 'DATA' });
    const token = await signWebinarToken(SECRET, 'test-webinar', SESSION_START + 99999);
    const res = await webinarRoutes.request(
      `/webinar-assets/${token}/test-webinar/0/seg_0001.ts`,
      undefined,
      { ...env, IMAGES: r2 as unknown as R2Bucket },
      execCtx,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('video/mp2t');
    expect(res.headers.get('Cache-Control')).toContain('immutable');
  });

  test('m3u8 は mpegurl・短キャッシュ', async () => {
    const r2 = makeR2({ 'webinars/test-webinar/master.m3u8': '#EXTM3U' });
    const token = await signWebinarToken(SECRET, 'test-webinar', SESSION_START + 99999);
    const res = await webinarRoutes.request(
      `/webinar-assets/${token}/test-webinar/master.m3u8`,
      undefined,
      { ...env, IMAGES: r2 as unknown as R2Bucket },
      execCtx,
    );
    expect(res.headers.get('Content-Type')).toBe('application/vnd.apple.mpegurl');
    expect(res.headers.get('Cache-Control')).toContain('max-age=3600');
  });

  test('不正トークンは 403、存在しないキーは 404、パストラバーサルは 400', async () => {
    const r2 = makeR2({});
    const token = await signWebinarToken(SECRET, 'test-webinar', SESSION_START + 99999);
    const bad = await webinarRoutes.request(
      `/webinar-assets/badtoken/test-webinar/master.m3u8`,
      undefined, { ...env, IMAGES: r2 as unknown as R2Bucket }, execCtx,
    );
    expect(bad.status).toBe(403);
    const missing = await webinarRoutes.request(
      `/webinar-assets/${token}/test-webinar/nope.ts`,
      undefined, { ...env, IMAGES: r2 as unknown as R2Bucket }, execCtx,
    );
    expect(missing.status).toBe(404);
    const traversal = await webinarRoutes.request(
      `/webinar-assets/${token}/test-webinar/..%2Fsecret.txt`,
      undefined, { ...env, IMAGES: r2 as unknown as R2Bucket }, execCtx,
    );
    expect(traversal.status).toBe(400);
  });
});

function postJson(path: string, body: unknown) {
  return req(path, {
    method: 'POST',
    headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/liff/webinars/:slug/heartbeat', () => {
  test('位置を記録する', async () => {
    const res = await postJson('/api/liff/webinars/test-webinar/heartbeat', {
      sessionStartAt: SESSION_START,
      positionSeconds: 1234,
    });
    expect(res.status).toBe(200);
    expect(dbMocks.updateWebinarViewerPosition).toHaveBeenCalledWith(
      expect.anything(), 'w1', 'friend-1', SESSION_START, 1234,
    );
  });

  test('動画長+60秒を超える位置は 422', async () => {
    const res = await postJson('/api/liff/webinars/test-webinar/heartbeat', {
      sessionStartAt: SESSION_START,
      positionSeconds: 7261,
    });
    expect(res.status).toBe(422);
  });

  test('数値でない body は 422', async () => {
    const res = await postJson('/api/liff/webinars/test-webinar/heartbeat', {
      sessionStartAt: 'x', positionSeconds: 'y',
    });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/liff/webinars/:slug/comments', () => {
  beforeEach(() => {
    dbMocks.countSessionUserComments.mockResolvedValue(0);
  });

  test('コメントを保存する', async () => {
    const res = await postJson('/api/liff/webinars/test-webinar/comments', {
      sessionStartAt: SESSION_START, atSeconds: 100, body: 'こんにちは',
    });
    expect(res.status).toBe(200);
    expect(dbMocks.insertWebinarUserComment).toHaveBeenCalledWith(expect.anything(), {
      webinarId: 'w1', friendId: 'friend-1', sessionStartAt: SESSION_START,
      atSeconds: 100, body: 'こんにちは',
    });
  });

  test('空文字・500字超は 422', async () => {
    const empty = await postJson('/api/liff/webinars/test-webinar/comments', {
      sessionStartAt: SESSION_START, atSeconds: 1, body: '  ',
    });
    expect(empty.status).toBe(422);
    const long = await postJson('/api/liff/webinars/test-webinar/comments', {
      sessionStartAt: SESSION_START, atSeconds: 1, body: 'あ'.repeat(501),
    });
    expect(long.status).toBe(422);
  });

  test('セッション60件超は 429', async () => {
    dbMocks.countSessionUserComments.mockResolvedValue(60);
    const res = await postJson('/api/liff/webinars/test-webinar/comments', {
      sessionStartAt: SESSION_START, atSeconds: 1, body: 'x',
    });
    expect(res.status).toBe(429);
  });

  test('ライブ外・偽セッションの投稿は 409', async () => {
    // ライブ時間外（開始前）にサーバー時刻をセットし、sessionStartAt を偽装しても弾かれることを確認
    vi.setSystemTime(new Date((SESSION_START - 600) * 1000));
    const res = await postJson('/api/liff/webinars/test-webinar/comments', {
      sessionStartAt: SESSION_START, atSeconds: 1, body: 'x',
    });
    expect(res.status).toBe(409);
    expect(dbMocks.insertWebinarUserComment).not.toHaveBeenCalled();
  });
});

describe('POST /api/liff/webinars/:slug/cta-click', () => {
  test('クリックを記録する', async () => {
    const res = await postJson('/api/liff/webinars/test-webinar/cta-click', {
      sessionStartAt: SESSION_START,
    });
    expect(res.status).toBe(200);
    expect(dbMocks.recordWebinarCtaClick).toHaveBeenCalledWith(
      expect.anything(), 'w1', 'friend-1', SESSION_START,
    );
  });

  test('tag_on_cta_click 設定時はタグ付与が waitUntil で走る', async () => {
    dbMocks.getWebinarBySlug.mockResolvedValue(makeWebinar({ tag_on_cta_click: 'tag-cta' }));
    (execCtx.waitUntil as ReturnType<typeof vi.fn>).mockClear();
    await postJson('/api/liff/webinars/test-webinar/cta-click', {
      sessionStartAt: SESSION_START,
    });
    expect(execCtx.waitUntil).toHaveBeenCalled();
  });
});

describe('admin CRUD', () => {
  test('POST /api/webinars — 作成して serialize して返す', async () => {
    // beforeEach は slug 既存の mock を入れているので、新規作成用に null に戻す
    dbMocks.getWebinarBySlug.mockResolvedValue(null);
    dbMocks.createWebinar.mockResolvedValue(makeWebinar());
    const res = await req('/api/webinars', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: 'テストウェビナー',
        slug: 'test-webinar',
        durationSeconds: 7200,
        schedule: [{ type: 'once', at: '2026-07-29T20:00:00+09:00' }],
        cta: { label: '申込', url: 'https://pay.example.com', showAtSeconds: 5400 },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: Record<string, unknown> };
    expect(body.success).toBe(true);
    expect(body.data.slug).toBe('test-webinar');
    expect(body.data.cta).toEqual({ label: '申込', url: 'https://pay.example.com', showAtSeconds: 5400 });
    expect(body.data.schedule).toEqual([{ type: 'once', at: '2026-07-29T20:00:00+09:00' }]);
  });

  test('POST — title/slug 欠落・slug 形式違反は 400', async () => {
    dbMocks.getWebinarBySlug.mockResolvedValue(null);
    const noTitle = await req('/api/webinars', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ slug: 'x' }),
    });
    expect(noTitle.status).toBe(400);
    const badSlug = await req('/api/webinars', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 't', slug: 'Bad Slug!' }),
    });
    expect(badSlug.status).toBe(400);
  });

  test('PUT /api/webinars/:id/comments — 一括置換', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    dbMocks.replaceWebinarComments.mockResolvedValue(2);
    const res = await req('/api/webinars/w1/comments', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comments: [
          { atSeconds: 10, authorName: '田中', body: 'こんばんは!' },
          { atSeconds: 30, authorName: '鈴木', body: '楽しみです' },
        ],
      }),
    });
    expect(res.status).toBe(200);
    expect(dbMocks.replaceWebinarComments).toHaveBeenCalledWith(expect.anything(), 'w1', [
      { atSeconds: 10, authorName: '田中', body: 'こんばんは!' },
      { atSeconds: 30, authorName: '鈴木', body: '楽しみです' },
    ]);
  });

  test('PUT comments — 不正要素があれば 400 で何も書かない', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    const res = await req('/api/webinars/w1/comments', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ comments: [{ atSeconds: -1, authorName: '', body: '' }] }),
    });
    expect(res.status).toBe(400);
    expect(dbMocks.replaceWebinarComments).not.toHaveBeenCalled();
  });

  test('GET /api/webinars/:id/analytics — sessions + dropoff', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    dbMocks.getWebinarSessionStats.mockResolvedValue([
      { session_start_at: SESSION_START, viewers: 10, avg_watched_seconds: 3600, cta_clicks: 3 },
    ]);
    dbMocks.getWebinarDropoff.mockResolvedValue([{ bucket_start: 0, viewers: 4 }]);
    const res = await req('/api/webinars/w1/analytics');
    const body = (await res.json()) as { data: Record<string, unknown> };
    expect(body.data.sessions).toEqual([
      { sessionStartAt: SESSION_START, viewers: 10, avgWatchedSeconds: 3600, ctaClicks: 3 },
    ]);
    expect(body.data.dropoff).toEqual([{ bucketStart: 0, viewers: 4 }]);
  });

  test('DELETE /api/webinars/:id', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    const res = await req('/api/webinars/w1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(dbMocks.deleteWebinar).toHaveBeenCalledWith(expect.anything(), 'w1');
  });

  test('PUT /api/webinars/:id — 空 title は 400 で updateWebinar が呼ばれない', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    const res = await req('/api/webinars/w1', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '  ' }),
    });
    expect(res.status).toBe(400);
    expect(dbMocks.updateWebinar).not.toHaveBeenCalled();
  });
});
