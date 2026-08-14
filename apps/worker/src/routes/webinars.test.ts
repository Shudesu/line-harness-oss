import { describe, expect, test, beforeEach, vi } from 'vitest';

const dbMocks = {
  getWebinars: vi.fn(),
  getWebinarById: vi.fn(),
  getWebinarBySlug: vi.fn(),
  createWebinar: vi.fn(),
  updateWebinar: vi.fn(),
  deleteWebinar: vi.fn(),
  getWebinarComments: vi.fn(),
  getWebinarCtas: vi.fn(),
  replaceWebinarCtas: vi.fn(),
  getFormById: vi.fn(),
  replaceWebinarComments: vi.fn(),
  upsertWebinarViewer: vi.fn(),
  updateWebinarViewerPosition: vi.fn(),
  recordWebinarCtaClick: vi.fn(),
  recordWebinarFunnelEvent: vi.fn(),
  insertWebinarUserComment: vi.fn(),
  countSessionUserComments: vi.fn(),
  getWebinarUserComments: vi.fn(),
  getWebinarSessionStats: vi.fn(),
  getWebinarDropoff: vi.fn(),
  getWebinarParticipantStats: vi.fn(),
  getWebinarAnalyticsSummary: vi.fn(),
  getWebinarDailyStats: vi.fn(),
  getWebinarFormFunnelStats: vi.fn(),
  getFriendByLineUserId: vi.fn(),
  getFriendByLineUserIdForAccount: vi.fn(),
  getFriendById: vi.fn(),
  getLineAccountById: vi.fn(),
  upsertWebinarRegistration: vi.fn(),
  getUpcomingWebinarRegistration: vi.fn(),
  getWebinarRegistration: vi.fn(),
  recordWebinarPickerOpen: vi.fn(),
  applyMileageRulesForEvent: vi.fn(),
  getDueWebinarRegistrations: vi.fn(),
  markWebinarRegistrationNotified: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const authMock = { verifyCallerLineUserId: vi.fn() };
vi.mock('../services/liff-auth.js', () => authMock);

const tagMock = { attachTagAndFireSideEffects: vi.fn() };
vi.mock('../services/friend-tag-attach.js', () => tagMock);

const localProxyMock = { dispatchLineProxyLocally: vi.fn() };
vi.mock('../services/local-line-proxy.js', () => localProxyMock);

const consultationMock = {
  getWebinarConsultationAvailability: vi.fn(),
  bookWebinarConsultation: vi.fn(),
  WebinarConsultationError: class WebinarConsultationError extends Error {
    constructor(public code: string, public status: number) {
      super(code);
    }
  },
};
vi.mock('../services/webinar-consultation-booking.js', () => consultationMock);

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

const env = {
  DB: {} as D1Database, LINE_CHANNEL_SECRET: SECRET, IMAGES: {} as R2Bucket,
  LINE_CHANNEL_ACCESS_TOKEN: 'test-token', LIFF_URL: 'https://liff.line.me/999-test',
};
const execCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

function req(path: string, init?: RequestInit) {
  return webinarRoutes.request(path, init, env, execCtx);
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.useFakeTimers();
  // ライブ開始3分後（予約済み本人が途中参加できる5分窓内）
  vi.setSystemTime(new Date((SESSION_START + 180) * 1000));
  authMock.verifyCallerLineUserId.mockResolvedValue('U123');
  dbMocks.getFriendByLineUserId.mockResolvedValue({ id: 'friend-1' });
  dbMocks.getFriendByLineUserIdForAccount.mockResolvedValue({ id: 'friend-1' });
  dbMocks.getWebinarBySlug.mockResolvedValue(makeWebinar());
  dbMocks.getWebinarComments.mockResolvedValue([
    { id: 'c1', webinar_id: 'w1', at_seconds: 10, author_name: '田中', body: '楽しみ!', created_at: 'x' },
  ]);
  dbMocks.upsertWebinarViewer.mockResolvedValue({ firstJoin: true });
  dbMocks.getWebinarCtas.mockResolvedValue([]);
  dbMocks.getUpcomingWebinarRegistration.mockResolvedValue(null);
  dbMocks.getWebinarRegistration.mockResolvedValue({
    id: 'reg-current', webinar_id: 'w1', friend_id: 'friend-1',
    session_start_at: SESSION_START, notified_at: 'x', created_at: 'x',
  });
  localProxyMock.dispatchLineProxyLocally.mockResolvedValue(new Response(null, { status: 200 }));
  dbMocks.recordWebinarPickerOpen.mockResolvedValue(undefined);
  dbMocks.upsertWebinarRegistration.mockResolvedValue(true);
  dbMocks.applyMileageRulesForEvent.mockResolvedValue({
    event: { id: 'mileage-event-1' }, granted: [],
  });
  consultationMock.getWebinarConsultationAvailability.mockResolvedValue({
    calendarReady: true,
    fallbackUrl: 'https://example.com/booking',
    menu: { id: 'menu-1', name: '個別相談', durationMinutes: 15 },
    staff: { id: 'staff-1', name: '野田' },
    slots: [{
      date: '2026-07-30', start: '10:00', end: '10:15',
      startsAt: '2026-07-30T01:00:00.000Z',
    }],
    existingBooking: null,
  });
  consultationMock.bookWebinarConsultation.mockResolvedValue({
    bookingId: 'booking-1', status: 'confirmed',
    startsAt: '2026-07-30T01:00:00.000Z', endsAt: '2026-07-30T01:15:00.000Z',
    meetUrl: 'https://meet.google.com/abc-defg-hij', externalEventId: 'event-1', created: true,
  });
});

describe('GET /api/liff/webinars/:slug', () => {
  test('ライブ中は offset とプレイリスト URL とコメントを返す', async () => {
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer token' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(true);
    expect(body.offsetSeconds).toBe(180);
    expect(body.sessionStartAt).toBe(SESSION_START);
    expect(body.playlistUrl).toMatch(
      /^\/webinar-assets\/\d+\.[A-Za-z0-9_-]+\/test-webinar\/master\.m3u8$/,
    );
    expect(body.comments).toEqual([{ atSeconds: 10, authorName: '田中', body: '楽しみ!' }]);
    // 予約済み本人だけが動画 URL を受け取る
    expect(body.upcoming).toEqual([]);
    expect(body.registeredSessionAt).toBeNull();
    expect(body.registeredForThisSession).toBe(true);
    expect(dbMocks.upsertWebinarViewer).toHaveBeenCalledWith({}, 'w1', 'friend-1', SESSION_START);
  });

  test('friend はウェビナーのアカウント配下の行を優先解決する', async () => {
    dbMocks.getWebinarBySlug.mockResolvedValue(makeWebinar({ account_id: 'acc-b' }));
    await req('/api/liff/webinars/test-webinar', { headers: { Authorization: 'Bearer t' } });
    expect(dbMocks.getFriendByLineUserIdForAccount).toHaveBeenCalledWith(
      expect.anything(), 'U123', 'acc-b',
    );
  });

  test('この回を予約済みの本人には registeredForThisSession=true を返す', async () => {
    dbMocks.getWebinarRegistration.mockResolvedValue({
      id: 'reg-1', webinar_id: 'w1', friend_id: 'friend-1',
      session_start_at: SESSION_START, notified_at: 'x', created_at: 'x',
    });
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.registeredForThisSession).toBe(true);
    expect(dbMocks.getWebinarRegistration).toHaveBeenCalledWith(
      expect.anything(), 'w1', 'friend-1', SESSION_START,
    );
  });

  test('開始ぴったりでも未予約者には動画URLを返さず、現在回を予約候補にする', async () => {
    vi.setSystemTime(new Date(SESSION_START * 1000));
    dbMocks.getWebinarRegistration.mockResolvedValue(null);
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(false);
    expect(body.upcoming).toEqual([SESSION_START]);
    expect(body.playlistUrl).toBeUndefined();
    expect(dbMocks.upsertWebinarViewer).not.toHaveBeenCalled();
    expect(execCtx.waitUntil).not.toHaveBeenCalled();
    expect(dbMocks.recordWebinarPickerOpen).toHaveBeenCalledWith(
      expect.anything(), 'w1', 'friend-1',
    );
  });

  test('開始5分ちょうどまでは、未予約者に現在回を予約候補として出す', async () => {
    vi.setSystemTime(new Date((SESSION_START + 300) * 1000));
    dbMocks.getWebinarRegistration.mockResolvedValue(null);
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(false);
    expect(body.upcoming).toEqual([SESSION_START]);
    expect(body.playlistUrl).toBeUndefined();
  });

  test('開始5分を過ぎても、その回の予約済み本人は再入場できる', async () => {
    vi.setSystemTime(new Date((SESSION_START + 301) * 1000));
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(true);
    expect(body.sessionStartAt).toBe(SESSION_START);
    expect(body.offsetSeconds).toBe(301);
    expect(body.registeredForThisSession).toBe(true);
    expect(body.playlistUrl).toBeDefined();
    expect(dbMocks.upsertWebinarViewer).toHaveBeenCalledWith(
      expect.anything(), 'w1', 'friend-1', SESSION_START,
    );
  });

  test('開始5分を過ぎた未予約者は、現在回に入れず次回選択に戻る', async () => {
    vi.setSystemTime(new Date((SESSION_START + 301) * 1000));
    dbMocks.getWebinarRegistration.mockResolvedValue(null);
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(false);
    expect(body.upcoming).toEqual([]);
    expect(body.playlistUrl).toBeUndefined();
    expect(dbMocks.upsertWebinarViewer).not.toHaveBeenCalled();
  });

  test('専用入場リンクは配信終了後も予約した回を再生できる', async () => {
    vi.setSystemTime(new Date((SESSION_START + 7200 + 3600) * 1000));
    dbMocks.getWebinarRegistration.mockResolvedValue({
      id: 'reg-past', webinar_id: 'w1', friend_id: 'friend-1',
      session_start_at: SESSION_START, notified_at: 'x', created_at: 'x',
    });
    const res = await req(
      `/api/liff/webinars/test-webinar?sessionStartAt=${SESSION_START}`,
      { headers: { Authorization: 'Bearer t' } },
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(true);
    expect(body.replay).toBe(true);
    expect(body.sessionStartAt).toBe(SESSION_START);
    expect(body.offsetSeconds).toBe(0);
    expect(body.registeredForThisSession).toBe(true);
    expect(body.playlistUrl).toBeDefined();
    expect(dbMocks.upsertWebinarViewer).toHaveBeenCalledWith(
      expect.anything(), 'w1', 'friend-1', SESSION_START,
    );
  });

  test('専用リンクの時刻を推測しても、本人の予約がなければ再生できない', async () => {
    vi.setSystemTime(new Date((SESSION_START + 7200 + 3600) * 1000));
    dbMocks.getWebinarRegistration.mockResolvedValue(null);
    const res = await req(
      `/api/liff/webinars/test-webinar?sessionStartAt=${SESSION_START}`,
      { headers: { Authorization: 'Bearer t' } },
    );
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(false);
    expect(body.replay).toBeUndefined();
    expect(body.playlistUrl).toBeUndefined();
    expect(dbMocks.upsertWebinarViewer).not.toHaveBeenCalled();
  });

  test('tag_on_attend が waitUntil 経由で付与される', async () => {
    await req('/api/liff/webinars/test-webinar', { headers: { Authorization: 'Bearer t' } });
    expect(execCtx.waitUntil).toHaveBeenCalled();
  });

  test('開始10分より前は live:false と nextSessionAt のみ (待機ルームなし)', async () => {
    vi.setSystemTime(new Date((SESSION_START - 3600) * 1000));
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(false);
    expect(body.waiting).toBeUndefined();
    expect(body.nextSessionAt).toBe(SESSION_START);
    expect(body.upcoming).toEqual([SESSION_START]);
    expect(body.registeredSessionAt).toBeNull();
    expect(dbMocks.upsertWebinarViewer).not.toHaveBeenCalled();
    expect(dbMocks.recordWebinarPickerOpen).toHaveBeenCalledWith(
      expect.anything(), 'w1', 'friend-1',
    );
  });

  test('すでに未来回を予約済みなら予約画面の離脱として記録しない', async () => {
    vi.setSystemTime(new Date((SESSION_START - 3600) * 1000));
    dbMocks.getUpcomingWebinarRegistration.mockResolvedValue({
      id: 'reg-future', webinar_id: 'w1', friend_id: 'friend-1',
      session_start_at: SESSION_START, notified_at: null, created_at: 'x',
    });
    await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer token' },
    });
    expect(dbMocks.recordWebinarPickerOpen).not.toHaveBeenCalled();
  });

  test('開始10分前でも未予約者は待機ルームへ直行せず、予約画面を出す', async () => {
    vi.setSystemTime(new Date((SESSION_START - 300) * 1000));
    dbMocks.getUpcomingWebinarRegistration.mockResolvedValue(null);
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(false);
    expect(body.waiting).toBeUndefined();
    expect(body.upcoming).toEqual([SESSION_START]);
  });

  test('開始10分前から予約済み本人だけ待機ルームに入る', async () => {
    vi.setSystemTime(new Date((SESSION_START - 300) * 1000));
    dbMocks.getUpcomingWebinarRegistration.mockResolvedValue({
      id: 'reg-next', webinar_id: 'w1', friend_id: 'friend-1',
      session_start_at: SESSION_START, notified_at: null, created_at: 'x',
    });
    dbMocks.getWebinarComments.mockResolvedValue([
      { id: 'c0', webinar_id: 'w1', at_seconds: -120, author_name: 'みお', body: '楽しみ', created_at: 'x' },
    ]);
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.live).toBe(false);
    expect(body.waiting).toBe(true);
    expect(body.offsetSeconds).toBe(-300);
    expect(body.nextSessionAt).toBe(SESSION_START);
    expect(body.comments).toEqual([{ atSeconds: -120, authorName: 'みお', body: '楽しみ' }]);
    expect(body.playlistUrl).toBeUndefined();
    // 待機中は視聴ログを作らない
    expect(dbMocks.upsertWebinarViewer).not.toHaveBeenCalled();
    expect(execCtx.waitUntil).not.toHaveBeenCalled();
  });

  test('待機窓の境界 (ちょうど600秒前) は待機ルーム', async () => {
    vi.setSystemTime(new Date((SESSION_START - 600) * 1000));
    dbMocks.getUpcomingWebinarRegistration.mockResolvedValue({
      id: 'reg-next', webinar_id: 'w1', friend_id: 'friend-1',
      session_start_at: SESSION_START, notified_at: null, created_at: 'x',
    });
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.waiting).toBe(true);
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
    dbMocks.getFriendByLineUserIdForAccount.mockResolvedValue(null);
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
          ? {
              body: objects[key], etag: 'etag1', httpMetadata: {},
              text: async () => objects[key],
            }
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

  test('?at= 付き master は EXT-X-START 注入 + variant URI へ at 伝播 + no-store', async () => {
    const master = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-STREAM-INF:BANDWIDTH=3506325\n0/index.m3u8\n\n#EXT-X-STREAM-INF:BANDWIDTH=1842400\n1/index.m3u8\n';
    const r2 = makeR2({ 'webinars/test-webinar/master.m3u8': master });
    const token = await signWebinarToken(SECRET, 'test-webinar', SESSION_START + 99999);
    const res = await webinarRoutes.request(
      `/webinar-assets/${token}/test-webinar/master.m3u8?at=571`,
      undefined, { ...env, IMAGES: r2 as unknown as R2Bucket }, execCtx,
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('#EXT-X-START:TIME-OFFSET=571,PRECISE=YES');
    expect(body).toContain('0/index.m3u8?at=571');
    expect(body).toContain('1/index.m3u8?at=571');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
  });

  test('?at= 付き variant (media playlist) はタグ注入のみでセグメント URI は不変', async () => {
    const media = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:6.0,\nseg_00000.ts\n#EXT-X-ENDLIST\n';
    const r2 = makeR2({ 'webinars/test-webinar/0/index.m3u8': media });
    const token = await signWebinarToken(SECRET, 'test-webinar', SESSION_START + 99999);
    const res = await webinarRoutes.request(
      `/webinar-assets/${token}/test-webinar/0/index.m3u8?at=571`,
      undefined, { ...env, IMAGES: r2 as unknown as R2Bucket }, execCtx,
    );
    const body = await res.text();
    expect(body).toContain('#EXT-X-START:TIME-OFFSET=571,PRECISE=YES');
    expect(body).toContain('\nseg_00000.ts\n');
    expect(body).not.toContain('seg_00000.ts?at');
  });

  test('?at= が範囲外 (負・動画長超) は 400、セグメントの at は無視', async () => {
    const r2 = makeR2({
      'webinars/test-webinar/master.m3u8': '#EXTM3U',
      'webinars/test-webinar/0/seg_0001.ts': 'DATA',
    });
    const token = await signWebinarToken(SECRET, 'test-webinar', SESSION_START + 99999);
    const over = await webinarRoutes.request(
      `/webinar-assets/${token}/test-webinar/master.m3u8?at=999999`,
      undefined, { ...env, IMAGES: r2 as unknown as R2Bucket }, execCtx,
    );
    expect(over.status).toBe(400);
    const neg = await webinarRoutes.request(
      `/webinar-assets/${token}/test-webinar/master.m3u8?at=-5`,
      undefined, { ...env, IMAGES: r2 as unknown as R2Bucket }, execCtx,
    );
    expect(neg.status).toBe(400);
    const seg = await webinarRoutes.request(
      `/webinar-assets/${token}/test-webinar/0/seg_0001.ts?at=571`,
      undefined, { ...env, IMAGES: r2 as unknown as R2Bucket }, execCtx,
    );
    expect(seg.status).toBe(200);
    expect(await seg.text()).toBe('DATA');
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

  test('待機窓より前の投稿は 409', async () => {
    vi.setSystemTime(new Date((SESSION_START - 3600) * 1000));
    const res = await postJson('/api/liff/webinars/test-webinar/comments', {
      sessionStartAt: SESSION_START, atSeconds: 1, body: 'x',
    });
    expect(res.status).toBe(409);
    expect(dbMocks.insertWebinarUserComment).not.toHaveBeenCalled();
  });

  test('待機ルーム中は次回セッション帰属で負の atSeconds を保存する', async () => {
    vi.setSystemTime(new Date((SESSION_START - 300) * 1000));
    const res = await postJson('/api/liff/webinars/test-webinar/comments', {
      sessionStartAt: SESSION_START, atSeconds: -300, body: '待機中です',
    });
    expect(res.status).toBe(200);
    expect(dbMocks.insertWebinarUserComment).toHaveBeenCalledWith(expect.anything(), {
      webinarId: 'w1', friendId: 'friend-1', sessionStartAt: SESSION_START,
      atSeconds: -300, body: '待機中です',
    });
  });

  test('待機ルーム中でも偽 sessionStartAt は 409', async () => {
    vi.setSystemTime(new Date((SESSION_START - 300) * 1000));
    const res = await postJson('/api/liff/webinars/test-webinar/comments', {
      sessionStartAt: SESSION_START - 86400, atSeconds: -300, body: 'x',
    });
    expect(res.status).toBe(409);
  });

  test('-3600 を下回る atSeconds は 422', async () => {
    const res = await postJson('/api/liff/webinars/test-webinar/comments', {
      sessionStartAt: SESSION_START, atSeconds: -4000, body: 'x',
    });
    expect(res.status).toBe(422);
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
    expect(dbMocks.recordWebinarFunnelEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        webinarId: 'w1', friendId: 'friend-1', sessionStartAt: SESSION_START,
        eventType: 'cta_click',
      }),
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

describe('POST /api/liff/webinars/:slug/funnel-event', () => {
  test('予約済み本人のフォーム段階を記録する', async () => {
    dbMocks.getWebinarCtas.mockResolvedValue([{ id: 'cta-1', form_id: 'form-1' }]);
    const res = await postJson('/api/liff/webinars/test-webinar/funnel-event', {
      sessionStartAt: SESSION_START,
      eventType: 'field_complete',
      ctaId: 'cta-1',
      formId: 'form-1',
      fieldName: 'annual_revenue',
    });
    expect(res.status).toBe(200);
    expect(dbMocks.recordWebinarFunnelEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        webinarId: 'w1', friendId: 'friend-1', eventType: 'field_complete',
        fieldName: 'annual_revenue',
      }),
    );
  });

  test('未予約セッションは記録しない', async () => {
    dbMocks.getWebinarRegistration.mockResolvedValue(null);
    const res = await postJson('/api/liff/webinars/test-webinar/funnel-event', {
      sessionStartAt: SESSION_START,
      eventType: 'form_start',
    });
    expect(res.status).toBe(409);
    expect(dbMocks.recordWebinarFunnelEvent).not.toHaveBeenCalled();
  });
});

describe('POST /api/liff/webinars/:slug/register', () => {
  test('実在する未来セッションを予約し確認プッシュを waitUntil で送る', async () => {
    vi.setSystemTime(new Date((SESSION_START - 3600) * 1000));
    const res = await postJson('/api/liff/webinars/test-webinar/register', {
      sessionStartAt: SESSION_START,
    });
    expect(res.status).toBe(200);
    expect(dbMocks.upsertWebinarRegistration).toHaveBeenCalledWith(
      expect.anything(), 'w1', 'friend-1', SESSION_START,
    );
    expect(execCtx.waitUntil).toHaveBeenCalled();
  });

  test('同じセッションの重複予約では受付確認を再送しない', async () => {
    vi.setSystemTime(new Date((SESSION_START - 3600) * 1000));
    dbMocks.upsertWebinarRegistration.mockResolvedValue(false);
    const res = await postJson('/api/liff/webinars/test-webinar/register', {
      sessionStartAt: SESSION_START,
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, sessionStartAt: SESSION_START, created: false });
    expect(execCtx.waitUntil).not.toHaveBeenCalled();
  });

  test('スケジュール上に存在しない時刻は 400', async () => {
    vi.setSystemTime(new Date((SESSION_START - 3600) * 1000));
    const res = await postJson('/api/liff/webinars/test-webinar/register', {
      sessionStartAt: SESSION_START + 123,
    });
    expect(res.status).toBe(400);
    expect(dbMocks.upsertWebinarRegistration).not.toHaveBeenCalled();
  });

  test('開始5分ちょうどまでは現在セッションを予約できる', async () => {
    vi.setSystemTime(new Date((SESSION_START + 300) * 1000));
    const res = await postJson('/api/liff/webinars/test-webinar/register', {
      sessionStartAt: SESSION_START,
    });
    expect(res.status).toBe(200);
  });

  test('開始5分を1秒でも過ぎた現在セッションは 400', async () => {
    vi.setSystemTime(new Date((SESSION_START + 301) * 1000));
    const res = await postJson('/api/liff/webinars/test-webinar/register', {
      sessionStartAt: SESSION_START,
    });
    expect(res.status).toBe(400);
  });
});

describe('webinar consultation booking', () => {
  test('フォーム送信後の空き枠を認証済みfriendに返す', async () => {
    const res = await req('/api/liff/webinars/test-webinar/consultation-slots', {
      headers: { Authorization: 'Bearer t' },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      data: { calendarReady: true, slots: [{ start: '10:00' }] },
    });
    expect(consultationMock.getWebinarConsultationAvailability).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ webinarId: 'w1', friendId: 'friend-1' }),
    );
  });

  test('枠選択でMeet付き相談を即時確定する', async () => {
    const res = await postJson('/api/liff/webinars/test-webinar/consultation-book', {
      startsAt: '2026-07-30T01:00:00.000Z',
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toMatchObject({
      ok: true,
      data: { status: 'confirmed', meetUrl: 'https://meet.google.com/abc-defg-hij' },
    });
    expect(consultationMock.bookWebinarConsultation).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        webinarId: 'w1', webinarTitle: 'テストウェビナー', friendId: 'friend-1',
        startsAt: '2026-07-30T01:00:00.000Z',
      }),
    );
  });

  test('Googleカレンダー未接続は503で安全にフォールバックできる', async () => {
    consultationMock.bookWebinarConsultation.mockRejectedValue(
      new consultationMock.WebinarConsultationError('calendar_not_configured', 503),
    );
    const res = await postJson('/api/liff/webinars/test-webinar/consultation-book', {
      startsAt: '2026-07-30T01:00:00.000Z',
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, error: 'calendar_not_configured' });
  });

  test('日時欠落は422で予約処理を呼ばない', async () => {
    const res = await postJson('/api/liff/webinars/test-webinar/consultation-book', {});
    expect(res.status).toBe(422);
    expect(consultationMock.bookWebinarConsultation).not.toHaveBeenCalled();
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

  test('PUT comments — 負の atSeconds (待機ルーム) は -3600 まで許容', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    dbMocks.replaceWebinarComments.mockResolvedValue(1);
    const ok = await req('/api/webinars/w1/comments', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comments: [{ atSeconds: -300, authorName: 'みお', body: '楽しみです' }],
      }),
    });
    expect(ok.status).toBe(200);
    expect(dbMocks.replaceWebinarComments).toHaveBeenCalledWith(expect.anything(), 'w1', [
      { atSeconds: -300, authorName: 'みお', body: '楽しみです' },
    ]);
    const tooEarly = await req('/api/webinars/w1/comments', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        comments: [{ atSeconds: -4000, authorName: 'みお', body: 'x' }],
      }),
    });
    expect(tooEarly.status).toBe(400);
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

  test('GET /api/webinars/:id/analytics — summary + trend + participants', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    dbMocks.getWebinarSessionStats.mockResolvedValue([
      { session_start_at: SESSION_START, viewers: 10, avg_watched_seconds: 3600, cta_clicks: 3 },
    ]);
    dbMocks.getWebinarDropoff.mockResolvedValue([{ bucket_start: 0, viewers: 4 }]);
    dbMocks.getWebinarAnalyticsSummary.mockResolvedValue({
      reservations: 12,
      viewers: 2,
      registered_and_joined: 1,
      watched_5m: 2,
      watched_15m: 1,
      completed: 1,
      avg_watched_seconds: 3550,
      cta_clicks: 1,
      form_submissions: 1,
    });
    dbMocks.getWebinarParticipantStats.mockResolvedValue([
      {
        friend_id: 'friend-1', friend_name: '山田太郎', picture_url: 'https://example.com/u.jpg',
        sessions: 2, first_joined_at: '2026-08-05T10:00:00+09:00',
        latest_joined_at: '2026-08-06T10:00:00+09:00', latest_watched_seconds: 6500,
        cta_clicked_at: '2026-08-06T11:00:00+09:00', registered: 1,
        form_submitted_at: '2026-08-06T11:01:00+09:00',
      },
      {
        friend_id: 'friend-2', friend_name: '佐藤花子', picture_url: null,
        sessions: 1, first_joined_at: '2026-08-06T10:00:00+09:00',
        latest_joined_at: '2026-08-06T10:00:00+09:00', latest_watched_seconds: 600,
        cta_clicked_at: null, registered: 0, form_submitted_at: null,
      },
    ]);
    dbMocks.getWebinarDailyStats.mockResolvedValue([
      { stat_date: '2026-08-06', reservations: 5, viewers: 4, cta_clicks: 2, form_submissions: 1 },
    ]);
    dbMocks.getWebinarFormFunnelStats.mockResolvedValue({
      cta_impressions: 10,
      cta_clicks: 8,
      form_opens: 7,
      form_starts: 6,
      submit_attempts: 5,
      submit_successes: 4,
      submit_errors: 1,
      field_completions: [{ field_name: 'annual_revenue', users: 6 }],
    });
    const res = await req('/api/webinars/w1/analytics');
    const body = (await res.json()) as {
      data: {
        sessions: unknown;
        dropoff: unknown;
        summary: unknown;
        daily: unknown;
        participants: Array<Record<string, unknown>>;
        formFunnel: Record<string, unknown>;
      };
    };
    expect(body.data.sessions).toEqual([
      { sessionStartAt: SESSION_START, viewers: 10, avgWatchedSeconds: 3600, ctaClicks: 3 },
    ]);
    expect(body.data.dropoff).toEqual([{ bucketStart: 0, viewers: 4 }]);
    expect(body.data.summary).toEqual({
      reservations: 12,
      viewers: 2,
      registeredAndJoined: 1,
      watched5m: 2,
      watched15m: 1,
      completed: 1,
      avgWatchedSeconds: 3550,
      ctaClicks: 1,
      formSubmissions: 1,
    });
    expect(body.data.daily).toEqual([
      { date: '2026-08-06', reservations: 5, viewers: 4, ctaClicks: 2, formSubmissions: 1 },
    ]);
    expect(body.data.participants).toHaveLength(2);
    expect(body.data.participants[0]).toMatchObject({
      friendId: 'friend-1', friendName: '山田太郎', registered: true,
      pictureUrl: 'https://example.com/u.jpg', formSubmittedAt: '2026-08-06T11:01:00+09:00',
      latestWatchedSeconds: 6500, maxWatchedSeconds: 6500,
    });
    expect(body.data.formFunnel).toEqual({
      ctaImpressions: 10,
      ctaClicks: 8,
      formOpens: 7,
      formStarts: 6,
      submitAttempts: 5,
      submitSuccesses: 4,
      submitErrors: 1,
      fieldCompletions: [{ fieldName: 'annual_revenue', users: 6 }],
    });
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


describe('webinar CTA cards', () => {
  const CTA_ROW = {
    id: 'cta1', webinar_id: 'w1', at_seconds: 300, kind: 'form',
    title: '個別導入診断', body: '限定枠です', button_label: '診断を受ける',
    auto_open: 1, form_id: 'form-1', url: null, created_at: 'x', updated_at: 'x',
  };

  test('LIFF state に ctas が camelCase で含まれる', async () => {
    dbMocks.getWebinarCtas.mockResolvedValue([CTA_ROW]);
    const res = await req('/api/liff/webinars/test-webinar', {
      headers: { Authorization: 'Bearer t' },
    });
    const body = (await res.json()) as { ctas: unknown[] };
    expect(body.ctas).toEqual([{
      id: 'cta1', atSeconds: 300, kind: 'form', title: '個別導入診断',
      body: '限定枠です', buttonLabel: '診断を受ける', autoOpen: true, formId: 'form-1', url: null,
    }]);
  });

  test('PUT /api/webinars/:id/ctas — form kind は forms 実在チェック後に置換', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    dbMocks.getFormById.mockResolvedValue({ id: 'form-1', is_active: 1 });
    dbMocks.replaceWebinarCtas.mockResolvedValue(1);
    const res = await req('/api/webinars/w1/ctas', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ctas: [{
        atSeconds: 300, kind: 'form', title: '個別導入診断',
        body: '限定枠です', buttonLabel: '診断を受ける', autoOpen: true, formId: 'form-1',
      }] }),
    });
    expect(res.status).toBe(200);
    expect(dbMocks.replaceWebinarCtas).toHaveBeenCalledWith(expect.anything(), 'w1', [{
      atSeconds: 300, kind: 'form', title: '個別導入診断', body: '限定枠です',
      buttonLabel: '診断を受ける', autoOpen: true, formId: 'form-1', url: null,
    }]);
  });

  test('PUT ctas — 存在しない form は 400 で何も書かない', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    dbMocks.getFormById.mockResolvedValue(null);
    const res = await req('/api/webinars/w1/ctas', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ctas: [{
        atSeconds: 0, kind: 'form', title: 't', buttonLabel: 'b', formId: 'nope',
      }] }),
    });
    expect(res.status).toBe(400);
    expect(dbMocks.replaceWebinarCtas).not.toHaveBeenCalled();
  });

  test('PUT ctas — url kind は https 必須', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    const bad = await req('/api/webinars/w1/ctas', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ctas: [{
        atSeconds: 0, kind: 'url', title: 't', buttonLabel: 'b', url: 'javascript:alert(1)',
      }] }),
    });
    expect(bad.status).toBe(400);
    dbMocks.replaceWebinarCtas.mockResolvedValue(1);
    const ok = await req('/api/webinars/w1/ctas', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ctas: [{
        atSeconds: 0, kind: 'url', title: 't', buttonLabel: 'b', url: 'https://example.com/pay',
      }] }),
    });
    expect(ok.status).toBe(200);
  });

  test('PUT ctas — 無効化されたフォームは 400', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    dbMocks.getFormById.mockResolvedValue({ id: 'form-1', is_active: 0 });
    const res = await req('/api/webinars/w1/ctas', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ctas: [{
        atSeconds: 0, kind: 'form', title: 't', buttonLabel: 'b', formId: 'form-1',
      }] }),
    });
    expect(res.status).toBe(400);
    expect(dbMocks.replaceWebinarCtas).not.toHaveBeenCalled();
  });

  test('GET /api/webinars/:id/ctas — serialize して返す', async () => {
    dbMocks.getWebinarById.mockResolvedValue(makeWebinar());
    dbMocks.getWebinarCtas.mockResolvedValue([CTA_ROW]);
    const res = await req('/api/webinars/w1/ctas');
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([{
      id: 'cta1', atSeconds: 300, kind: 'form', title: '個別導入診断',
      body: '限定枠です', buttonLabel: '診断を受ける', autoOpen: true, formId: 'form-1', url: null,
    }]);
  });
});
