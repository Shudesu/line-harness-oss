import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  getWebinarById: vi.fn(),
  getWebinarBySlug: vi.fn(),
  updateWebinar: vi.fn(),
};
vi.mock('@line-crm/db', () => dbMocks);

const { webinarRoutes } = await import('./webinars.js');

// requireRole('owner', 'admin') on the new route reads c.get('staff'), which
// only the app-level authMiddleware (mounted in index.ts) sets in production.
// Calling webinarRoutes.request() directly — as the rest of this repo's route
// tests do — bypasses that middleware entirely, so every request 403s before
// reaching the business logic under test. Wrap webinarRoutes in a minimal app
// that seeds an owner-role staff context, matching how other role-gated
// routes are tested (see line-accounts.test.ts, rich-menu-groups.test.ts).
type TestEnv = { Variables: { staff: { id: string; role: 'owner' | 'admin' | 'staff' } } };

const authedRoutes = new Hono<TestEnv>();
authedRoutes.use('*', async (c, next) => {
  c.set('staff', { id: 'staff-1', role: 'owner' });
  await next();
});
authedRoutes.route('/', webinarRoutes);

// Builds a fresh app with a configurable staff role, following the setupApp
// pattern in line-accounts.test.ts. Needed to prove requireRole('owner',
// 'admin') actually discriminates by role — every test above hardcodes
// role: 'owner', so none of them would catch a regression that dropped or
// misconfigured the guard.
function authedRoutesAs(role: 'owner' | 'admin' | 'staff') {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.set('staff', { id: 'staff-1', role });
    await next();
  });
  app.route('/', webinarRoutes);
  return app;
}

function makeR2() {
  const store = new Map<string, ArrayBuffer>();
  return {
    store,
    put: vi.fn(async (key: string, body: ArrayBuffer) => {
      store.set(key, body);
      return { key };
    }),
    // .text() is needed by the video-promotion completeness check, which
    // parses master.m3u8 / variant .m3u8 bodies.
    get: vi.fn(async (key: string) => {
      const body = store.get(key);
      if (body === undefined) return null;
      return { key, text: async () => new TextDecoder().decode(body) };
    }),
    // Minimal R2Bucket.list(): prefix-filters store keys and pages them a
    // couple at a time so the completeness check's truncated/cursor loop is
    // actually exercised, not just given everything in one page.
    list: vi.fn(async (opts: { prefix?: string; cursor?: string } = {}) => {
      const prefix = opts.prefix ?? '';
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const pageSize = 2;
      const start = opts.cursor ? Number(opts.cursor) : 0;
      const page = keys.slice(start, start + pageSize);
      const truncated = start + pageSize < keys.length;
      return {
        objects: page.map((key) => ({ key })),
        truncated,
        cursor: truncated ? String(start + pageSize) : undefined,
      };
    }),
  };
}

const textEncoder = new TextEncoder();
/** Builds the ArrayBuffer body of an .m3u8 file from its lines. */
function m3u8Buffer(lines: string[]): ArrayBuffer {
  return textEncoder.encode(lines.join('\n')).buffer as ArrayBuffer;
}

// Seeds a fully complete 3-rendition HLS revision under `videoPrefix`,
// matching scripts/encode-webinar.sh's output layout: master.m3u8 lists
// {0,1,2}/index.m3u8, each of which lists segmentsPerRendition segments that
// actually exist as objects alongside it.
function seedCompleteRevision(
  r2: ReturnType<typeof makeR2>,
  videoPrefix: string,
  segmentsPerRendition = 3,
) {
  const renditions = ['0', '1', '2'];
  r2.store.set(
    `${videoPrefix}/master.m3u8`,
    m3u8Buffer([
      '#EXTM3U',
      ...renditions.flatMap((r) => [`#EXT-X-STREAM-INF:BANDWIDTH=1000000`, `${r}/index.m3u8`]),
    ]),
  );
  for (const r of renditions) {
    const segments = Array.from(
      { length: segmentsPerRendition },
      (_, i) => `seg_${String(i + 1).padStart(5, '0')}.ts`,
    );
    r2.store.set(
      `${videoPrefix}/${r}/index.m3u8`,
      m3u8Buffer([
        '#EXTM3U',
        '#EXT-X-TARGETDURATION:6',
        ...segments.flatMap((s) => ['#EXTINF:6.0,', s]),
        '#EXT-X-ENDLIST',
      ]),
    );
    for (const s of segments) {
      r2.store.set(`${videoPrefix}/${r}/${s}`, new ArrayBuffer(1));
    }
  }
}

const execCtx = { waitUntil: vi.fn(), passThroughOnException: vi.fn() } as unknown as ExecutionContext;

function envWith(r2: ReturnType<typeof makeR2>) {
  return {
    DB: {} as D1Database,
    IMAGES: r2 as unknown as R2Bucket,
    LINE_CHANNEL_SECRET: 'secret',
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  dbMocks.getWebinarById.mockResolvedValue({
    id: 'w1',
    slug: 'test-webinar',
    video_prefix: null,
    duration_seconds: 0,
  });
});

describe('PUT /api/webinars/:id/assets/:revision/*', () => {
  test('セグメントを revision 配下の R2 キーに置く', async () => {
    const r2 = makeR2();
    const res = await authedRoutes.request(
      '/api/webinars/w1/assets/1755830000000/0/seg_00001.ts',
      { method: 'PUT', body: new Uint8Array([1, 2, 3]) },
      envWith(r2),
      execCtx,
    );

    expect(res.status).toBe(200);
    expect(r2.put).toHaveBeenCalledTimes(1);
    expect(r2.put.mock.calls[0][0]).toBe('webinars/test-webinar/1755830000000/0/seg_00001.ts');
  });

  // 上書きされるだけで壊れないこと。中断したアップロードを頭から再実行できる根拠。
  test('同じキーへの再送は成功する(冪等)', async () => {
    const r2 = makeR2();
    const send = () =>
      authedRoutes.request(
        '/api/webinars/w1/assets/1755830000000/0/seg_00001.ts',
        { method: 'PUT', body: new Uint8Array([1]) },
        envWith(r2),
        execCtx,
      );
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
  });

  // これがリビジョン方式の隔離保証そのもの: 現在配信中のリビジョンへの
  // 再アップロードを許すと、finish 成功後のリトライや古い epoch を使い回した
  // エージェントが、視聴者が再生中のオブジェクトを黙って上書きしてしまう。
  test('現在配信中(video_prefix と一致)のリビジョンへのアップロードは拒否され、R2への書き込みは発生しない', async () => {
    const r2 = makeR2();
    dbMocks.getWebinarById.mockResolvedValue({
      id: 'w1',
      slug: 'test-webinar',
      video_prefix: 'webinars/test-webinar/1755830000000',
      duration_seconds: 7200,
    });
    const res = await authedRoutes.request(
      '/api/webinars/w1/assets/1755830000000/0/seg_00001.ts',
      { method: 'PUT', body: new Uint8Array([1, 2, 3]) },
      envWith(r2),
      execCtx,
    );

    expect(res.status).toBe(409);
    expect(r2.put).not.toHaveBeenCalled();
  });

  // 配信中のリビジョンが存在していても、別のリビジョンへのアップロードは
  // 引き続き成功すること — 上のテストが拒否条件を広げすぎていないことの証明。
  test('配信中のリビジョンとは別のリビジョンへのアップロードは成功する', async () => {
    const r2 = makeR2();
    dbMocks.getWebinarById.mockResolvedValue({
      id: 'w1',
      slug: 'test-webinar',
      video_prefix: 'webinars/test-webinar/1755830000000',
      duration_seconds: 7200,
    });
    const res = await authedRoutes.request(
      '/api/webinars/w1/assets/1755830000001/0/seg_00001.ts',
      { method: 'PUT', body: new Uint8Array([1, 2, 3]) },
      envWith(r2),
      execCtx,
    );

    expect(res.status).toBe(200);
    expect(r2.put).toHaveBeenCalledTimes(1);
  });

  // Cloudflare's edge and the Workers URL constructor both apply RFC 3986
  // dot-segment removal to incoming request paths before a Worker ever runs
  // (confirmed locally: Hono's router already sees '/api/webinars/w1/evil.ts'
  // for this input, never matching the route — so this never reaches our
  // handler at all; r2.put staying uncalled is what actually matters here).
  test('.. を含むパスは正規化されルート未一致で拒否される', async () => {
    const r2 = makeR2();
    const res = await authedRoutes.request(
      '/api/webinars/w1/assets/1755830000000/../../evil.ts',
      { method: 'PUT', body: new Uint8Array([1]) },
      envWith(r2),
      execCtx,
    );
    expect(res.status).toBe(404);
    expect(r2.put).not.toHaveBeenCalled();
  });

  // Percent-encoded traversal (../ as ..%2f) survives URL dot-segment
  // normalization and does reach the route as part of the wildcard segment;
  // decodeURIComponent() in the handler turns it back into '..', which is
  // what the handler's explicit check must catch.
  test('percent-encode された .. を拒否する', async () => {
    const r2 = makeR2();
    const res = await authedRoutes.request(
      '/api/webinars/w1/assets/1755830000000/..%2f..%2fevil.ts',
      { method: 'PUT', body: new Uint8Array([1]) },
      envWith(r2),
      execCtx,
    );
    expect(res.status).toBe(400);
    expect(r2.put).not.toHaveBeenCalled();
  });

  // %zz is not valid percent-encoding, so decodeURIComponent throws. safeDecode
  // catches that and falls back to the raw segment — which here still starts
  // with '..', proving the traversal check runs against the raw fallback too
  // (not skipped just because decoding failed). Before this fix the uncaught
  // URIError produced a generic 500 instead of this 400.
  test('不正なパーセントエンコーディングは400を返す(500にならない)', async () => {
    const r2 = makeR2();
    const res = await authedRoutes.request(
      '/api/webinars/w1/assets/1755830000000/..%zzevil.ts',
      { method: 'PUT', body: new Uint8Array([1]) },
      envWith(r2),
      execCtx,
    );
    expect(res.status).toBe(400);
    expect(r2.put).not.toHaveBeenCalled();
  });

  test('.m3u8 / .ts 以外の拡張子を拒否する', async () => {
    const r2 = makeR2();
    const res = await authedRoutes.request(
      '/api/webinars/w1/assets/1755830000000/payload.js',
      { method: 'PUT', body: new Uint8Array([1]) },
      envWith(r2),
      execCtx,
    );
    expect(res.status).toBe(400);
    expect(r2.put).not.toHaveBeenCalled();
  });

  test('20MB を超えるボディを拒否する', async () => {
    const r2 = makeR2();
    const res = await authedRoutes.request(
      '/api/webinars/w1/assets/1755830000000/0/big.ts',
      {
        method: 'PUT',
        body: new Uint8Array([1]),
        headers: { 'Content-Length': String(21 * 1024 * 1024) },
      },
      envWith(r2),
      execCtx,
    );
    expect(res.status).toBe(413);
    expect(r2.put).not.toHaveBeenCalled();
  });

  // The above test only exercises the Content-Length fast-path. A client that
  // omits (or understates) Content-Length skips straight to the real guard —
  // body.byteLength > MAX_ASSET_BYTES — which is untested unless the body
  // itself is genuinely oversized. No Content-Length header is sent here, so
  // this only passes if that second check actually rejects the body.
  test('Content-Length なしで実際に20MBを超えるボディを送ると413', async () => {
    const r2 = makeR2();
    const oversized = new Uint8Array(21 * 1024 * 1024);
    const res = await authedRoutes.request(
      '/api/webinars/w1/assets/1755830000000/0/big.ts',
      { method: 'PUT', body: oversized },
      envWith(r2),
      execCtx,
    );
    expect(res.status).toBe(413);
    expect(r2.put).not.toHaveBeenCalled();
  });

  test('存在しないウェビナーは 404', async () => {
    dbMocks.getWebinarById.mockResolvedValue(null);
    const r2 = makeR2();
    const res = await authedRoutes.request(
      '/api/webinars/nope/assets/1755830000000/0/seg_00001.ts',
      { method: 'PUT', body: new Uint8Array([1]) },
      envWith(r2),
      execCtx,
    );
    expect(res.status).toBe(404);
  });

  // revision がパス区切りを含むと、キーの構造が壊れて別階層に書ける。
  test('revision が数字以外なら拒否する', async () => {
    const r2 = makeR2();
    const res = await authedRoutes.request(
      '/api/webinars/w1/assets/not-a-revision/0/seg_00001.ts',
      { method: 'PUT', body: new Uint8Array([1]) },
      envWith(r2),
      execCtx,
    );
    expect(res.status).toBe(400);
    expect(r2.put).not.toHaveBeenCalled();
  });

  // Double-encoded dot segments (%252e%252e%2f) survive one safeDecode pass
  // as the literal "%2e%2e/" — no ".." substring, so the traversal check
  // alone would miss it. The handler additionally rejects any leftover '%'.
  test('二重エンコードされた .. (%252e%252e%2f) を拒否する', async () => {
    const r2 = makeR2();
    const res = await authedRoutes.request(
      '/api/webinars/w1/assets/1755830000000/%252e%252e%2fevil.ts',
      { method: 'PUT', body: new Uint8Array([1]) },
      envWith(r2),
      execCtx,
    );
    expect(res.status).toBe(400);
    expect(r2.put).not.toHaveBeenCalled();
  });
});

describe('PUT /api/webinars/:id/assets/:revision/* のロールガード', () => {
  // Every test above hardcodes role: 'owner', so none of them would catch a
  // regression that dropped or misconfigured requireRole('owner', 'admin')
  // on this security-sensitive endpoint. These vary the role explicitly.
  test('staff ロールは403で拒否され、R2への書き込みは発生しない', async () => {
    const r2 = makeR2();
    const res = await authedRoutesAs('staff').request(
      '/api/webinars/w1/assets/1755830000000/0/seg_00001.ts',
      { method: 'PUT', body: new Uint8Array([1, 2, 3]) },
      envWith(r2),
      execCtx,
    );
    expect(res.status).toBe(403);
    expect(r2.put).not.toHaveBeenCalled();
  });

  // Proves the guard admits both listed roles, not just 'owner'.
  test('admin ロールは許可される', async () => {
    const r2 = makeR2();
    const res = await authedRoutesAs('admin').request(
      '/api/webinars/w1/assets/1755830000000/0/seg_00001.ts',
      { method: 'PUT', body: new Uint8Array([1, 2, 3]) },
      envWith(r2),
      execCtx,
    );
    expect(res.status).toBe(200);
    expect(r2.put).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/webinars/:id/video', () => {
  // Uses authedRoutes (not webinarRoutes directly) for the same reason as the
  // PUT tests above: requireRole('owner', 'admin') on this route reads
  // c.get('staff'), which only the authedRoutes wrapper seeds in this test
  // file. webinarRoutes.request() alone would 403 before reaching the
  // business logic under test here.
  // beforeEach seeds getWebinarById with video_prefix: null, i.e. this is a
  // first upload — there is nobody currently watching to warn about, so the
  // response must NOT carry a `warning` field. See the sibling test below for
  // the replacement case, where video_prefix was already set.
  test('完全なリビジョン(master + 3レンディション + セグメント)なら video_prefix と duration を切り替える(初回アップロードには warning が付かない)', async () => {
    const r2 = makeR2();
    seedCompleteRevision(r2, 'webinars/test-webinar/1755830000000');
    dbMocks.updateWebinar.mockResolvedValue({ id: 'w1' });

    const res = await authedRoutes.request(
      '/api/webinars/w1/video',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: '1755830000000', durationSeconds: 7200 }),
      },
      envWith(r2),
      execCtx,
    );

    expect(res.status).toBe(200);
    expect(dbMocks.updateWebinar).toHaveBeenCalledWith(
      expect.anything(),
      'w1',
      expect.objectContaining({
        videoPrefix: 'webinars/test-webinar/1755830000000',
        durationSeconds: 7200,
      }),
    );
    const json = (await res.json()) as { success: boolean; warning?: string };
    expect(json.warning).toBeUndefined();
  });

  // The delivery route resolves video_prefix from the DB on every request
  // and the HMAC token only signs slug:expiry — nothing pins a viewer to a
  // revision (see docs/superpowers/specs/2026-08-22-webinar-video-upload-
  // design.md, "リビジョンと差し替え"). So when getWebinarById returns a
  // non-null video_prefix, this call is a replacement and must warn the
  // caller that current viewers will be switched to the new revision.
  test('既存の video_prefix がある(=差し替え)場合、成功レスポンスに warning が含まれる', async () => {
    const r2 = makeR2();
    seedCompleteRevision(r2, 'webinars/test-webinar/1755830000001');
    dbMocks.getWebinarById.mockResolvedValue({
      id: 'w1',
      slug: 'test-webinar',
      video_prefix: 'webinars/test-webinar/1755830000000',
      duration_seconds: 7200,
    });
    dbMocks.updateWebinar.mockResolvedValue({ id: 'w1' });

    const res = await authedRoutes.request(
      '/api/webinars/w1/video',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: '1755830000001', durationSeconds: 7200 }),
      },
      envWith(r2),
      execCtx,
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; warning?: string };
    expect(json.warning).toBeTruthy();
    expect(json.warning).toContain('視聴中');
  });

  // finish がタイムアウト等で呼び出し側からリトライされ、同じ revision に
  // 対して2回届いた場合: DB の video_prefix はすでにこの revision と一致して
  // いるので isReplacement 判定に引っかかるが、実際には誰も新しいリビジョンに
  // 切り替わらない(すでにそのリビジョンを配信中)。warning を出すと誤報になる
  // ため、含まれてはいけない。
  test('video_prefix が今回の revision と既に一致している(=finish の再送)場合、warning は含まれない', async () => {
    const r2 = makeR2();
    seedCompleteRevision(r2, 'webinars/test-webinar/1755830000000');
    dbMocks.getWebinarById.mockResolvedValue({
      id: 'w1',
      slug: 'test-webinar',
      video_prefix: 'webinars/test-webinar/1755830000000',
      duration_seconds: 7200,
    });
    dbMocks.updateWebinar.mockResolvedValue({ id: 'w1' });

    const res = await authedRoutes.request(
      '/api/webinars/w1/video',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: '1755830000000', durationSeconds: 7200 }),
      },
      envWith(r2),
      execCtx,
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { success: boolean; warning?: string };
    expect(json.warning).toBeUndefined();
  });

  // 揃っていないものを公開状態にしないことが、この API の存在理由。
  test('master.m3u8 が無いリビジョンは拒否し、DB を触らない', async () => {
    const r2 = makeR2();
    const res = await authedRoutes.request(
      '/api/webinars/w1/video',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: '1755830000000', durationSeconds: 7200 }),
      },
      envWith(r2),
      execCtx,
    );

    expect(res.status).toBe(400);
    expect(dbMocks.updateWebinar).not.toHaveBeenCalled();
  });

  // master.m3u8 の存在は、それが指す先の完全性については何も証明しない —
  // これが今回の Critical 修正の核心。アップロードは1リクエスト1ファイルで
  // 順序保証がないため、master.m3u8 着地後にレンディションが1つ丸ごと
  // 欠けたまま止まる、というのが実際に起き得るケース。
  test('master.m3u8 が参照する variant playlist が無ければ拒否し、DB を触らない', async () => {
    const r2 = makeR2();
    const videoPrefix = 'webinars/test-webinar/1755830000000';
    r2.store.set(
      `${videoPrefix}/master.m3u8`,
      m3u8Buffer(['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=1000000', '0/index.m3u8', '#EXT-X-STREAM-INF:BANDWIDTH=1000000', '1/index.m3u8']),
    );
    // 0/index.m3u8 とそのセグメントは完全に揃っているが、1/index.m3u8 は
    // アップロードが止まっていて存在しない。
    r2.store.set(
      `${videoPrefix}/0/index.m3u8`,
      m3u8Buffer(['#EXTM3U', '#EXTINF:6.0,', 'seg_00001.ts', '#EXT-X-ENDLIST']),
    );
    r2.store.set(`${videoPrefix}/0/seg_00001.ts`, new ArrayBuffer(1));

    const res = await authedRoutes.request(
      '/api/webinars/w1/video',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: '1755830000000', durationSeconds: 7200 }),
      },
      envWith(r2),
      execCtx,
    );

    expect(res.status).toBe(400);
    expect(dbMocks.updateWebinar).not.toHaveBeenCalled();
  });

  // variant playlist 自体は届いていても、それが参照するセグメントが全部は
  // 届いていないケース。プレイリストの存在だけを見るチェックでは通ってしまう。
  test('variant playlist が参照するセグメント数より実際のオブジェクト数が少なければ拒否し、DB を触らない', async () => {
    const r2 = makeR2();
    const videoPrefix = 'webinars/test-webinar/1755830000000';
    r2.store.set(
      `${videoPrefix}/master.m3u8`,
      m3u8Buffer(['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=1000000', '0/index.m3u8']),
    );
    // プレイリストは3セグメントを参照しているが、実際にアップロード済みなのは1つだけ。
    r2.store.set(
      `${videoPrefix}/0/index.m3u8`,
      m3u8Buffer([
        '#EXTM3U',
        '#EXTINF:6.0,',
        'seg_00001.ts',
        '#EXTINF:6.0,',
        'seg_00002.ts',
        '#EXTINF:6.0,',
        'seg_00003.ts',
        '#EXT-X-ENDLIST',
      ]),
    );
    r2.store.set(`${videoPrefix}/0/seg_00001.ts`, new ArrayBuffer(1));

    const res = await authedRoutes.request(
      '/api/webinars/w1/video',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: '1755830000000', durationSeconds: 7200 }),
      },
      envWith(r2),
      execCtx,
    );

    expect(res.status).toBe(400);
    expect(dbMocks.updateWebinar).not.toHaveBeenCalled();
  });

  // 旧実装の off-by-one が見逃していた境界: variant のディレクトリには
  // segment に加えてその variant 自身の index.m3u8 も同じ prefix の下に
  // 置かれているため、「参照される3セグメントのうち1つだけ欠ける」と
  // 「オブジェクト数(2セグメント+1プレイリスト=3) < 参照セグメント数(3)」が
  // false になり、旧実装は誤って完全とみなして昇格させていた。このテストは
  // 旧実装(カウント比較)に対して落ちることを個別に確認済み。
  test('セグメントが1個だけ欠けている場合(旧実装の off-by-one 境界)は拒否し、DB を触らない', async () => {
    const r2 = makeR2();
    const videoPrefix = 'webinars/test-webinar/1755830000000';
    r2.store.set(
      `${videoPrefix}/master.m3u8`,
      m3u8Buffer(['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=1000000', '0/index.m3u8']),
    );
    // プレイリストは3セグメントを参照しているが、seg_00003.ts だけが届いていない。
    r2.store.set(
      `${videoPrefix}/0/index.m3u8`,
      m3u8Buffer([
        '#EXTM3U',
        '#EXTINF:6.0,',
        'seg_00001.ts',
        '#EXTINF:6.0,',
        'seg_00002.ts',
        '#EXTINF:6.0,',
        'seg_00003.ts',
        '#EXT-X-ENDLIST',
      ]),
    );
    r2.store.set(`${videoPrefix}/0/seg_00001.ts`, new ArrayBuffer(1));
    r2.store.set(`${videoPrefix}/0/seg_00002.ts`, new ArrayBuffer(1));

    const res = await authedRoutes.request(
      '/api/webinars/w1/video',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: '1755830000000', durationSeconds: 7200 }),
      },
      envWith(r2),
      execCtx,
    );

    expect(res.status).toBe(400);
    expect(dbMocks.updateWebinar).not.toHaveBeenCalled();
  });

  // カウント比較では「seg_00003.ts という名前のオブジェクトが無い」ことを
  // 検出できない場合がある — プレイリストが参照する数だけオブジェクトが
  // あれば通ってしまうから。存在するオブジェクトの名前が違うだけ(打ち間違い・
  // エンコーダのバグ等)でも、実際に参照されているキーで membership を見れば
  // 検出できることを確認する。
  test('セグメントが別名で置かれている場合(名前は一致しない)は拒否し、DB を触らない', async () => {
    const r2 = makeR2();
    const videoPrefix = 'webinars/test-webinar/1755830000000';
    r2.store.set(
      `${videoPrefix}/master.m3u8`,
      m3u8Buffer(['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=1000000', '0/index.m3u8']),
    );
    r2.store.set(
      `${videoPrefix}/0/index.m3u8`,
      m3u8Buffer([
        '#EXTM3U',
        '#EXTINF:6.0,',
        'seg_00001.ts',
        '#EXTINF:6.0,',
        'seg_00002.ts',
        '#EXT-X-ENDLIST',
      ]),
    );
    r2.store.set(`${videoPrefix}/0/seg_00001.ts`, new ArrayBuffer(1));
    // seg_00002.ts ではなく別名で置かれている。オブジェクト数はプレイリストの
    // セグメント数と一致するため、カウント比較では検出できない。
    r2.store.set(`${videoPrefix}/0/seg_00002_wrong.ts`, new ArrayBuffer(1));

    const res = await authedRoutes.request(
      '/api/webinars/w1/video',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: '1755830000000', durationSeconds: 7200 }),
      },
      envWith(r2),
      execCtx,
    );

    expect(res.status).toBe(400);
    expect(dbMocks.updateWebinar).not.toHaveBeenCalled();
  });

  // master.m3u8 の zero-variant チェックと同じ穴が一段下にもある: variant
  // playlist 自体は存在するが、中断されたエンコード等でヘッダ行/コメント行
  // しか書かれておらずセグメントを1つも参照していないケース。この場合
  // missingKeys は空になる(「欠けているセグメント」が存在しないため)ので、
  // セグメント参照ゼロを個別にチェックしないと再生不能なリビジョンが
  // 昇格してしまう。
  test('variant playlist がセグメントを1つも参照していない場合は拒否し、DB を触らない', async () => {
    const r2 = makeR2();
    const videoPrefix = 'webinars/test-webinar/1755830000000';
    r2.store.set(
      `${videoPrefix}/master.m3u8`,
      m3u8Buffer(['#EXTM3U', '#EXT-X-STREAM-INF:BANDWIDTH=1000000', '0/index.m3u8']),
    );
    // ヘッダとコメントのみで、セグメントの参照が1つも無い。
    r2.store.set(
      `${videoPrefix}/0/index.m3u8`,
      m3u8Buffer(['#EXTM3U', '#EXT-X-TARGETDURATION:6']),
    );

    const res = await authedRoutes.request(
      '/api/webinars/w1/video',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: '1755830000000', durationSeconds: 7200 }),
      },
      envWith(r2),
      execCtx,
    );

    expect(res.status).toBe(400);
    const json = await res.json() as { error: string };
    expect(json.error).toContain(`${videoPrefix}/0/index.m3u8`);
    expect(dbMocks.updateWebinar).not.toHaveBeenCalled();
  });

  test('master.m3u8 が variant を1つも参照していない場合は拒否し、DB を触らない', async () => {
    const r2 = makeR2();
    const videoPrefix = 'webinars/test-webinar/1755830000000';
    r2.store.set(`${videoPrefix}/master.m3u8`, m3u8Buffer(['#EXTM3U']));

    const res = await authedRoutes.request(
      '/api/webinars/w1/video',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: '1755830000000', durationSeconds: 7200 }),
      },
      envWith(r2),
      execCtx,
    );

    expect(res.status).toBe(400);
    expect(dbMocks.updateWebinar).not.toHaveBeenCalled();
  });

  test('durationSeconds が正の数でなければ拒否する', async () => {
    const r2 = makeR2();
    r2.store.set('webinars/test-webinar/1755830000000/master.m3u8', new ArrayBuffer(1));

    const res = await authedRoutes.request(
      '/api/webinars/w1/video',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: '1755830000000', durationSeconds: 0 }),
      },
      envWith(r2),
      execCtx,
    );

    expect(res.status).toBe(400);
    expect(dbMocks.updateWebinar).not.toHaveBeenCalled();
  });

  // duration_seconds は INTEGER 列。validateWebinarBody (PATCH /api/webinars/:id)
  // と同じ Math.floor の慣習にこのエンドポイントも揃える。
  test('durationSeconds が小数のときは切り捨てて保存する', async () => {
    const r2 = makeR2();
    const videoPrefix = 'webinars/test-webinar/1755830000000';
    // 完全性チェック自体はこのテストの主眼ではないので、seedCompleteRevision で
    // 完全なリビジョンを用意して完全性チェックを通す(空の master.m3u8 は
    // 「variant を1つも参照しない master は拒否する」チェックの追加により
    // もう使えない)。
    seedCompleteRevision(r2, videoPrefix);
    dbMocks.updateWebinar.mockResolvedValue({ id: 'w1' });

    const res = await authedRoutes.request(
      '/api/webinars/w1/video',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: '1755830000000', durationSeconds: 5400.24 }),
      },
      envWith(r2),
      execCtx,
    );

    expect(res.status).toBe(200);
    expect(dbMocks.updateWebinar).toHaveBeenCalledWith(
      expect.anything(),
      'w1',
      expect.objectContaining({ durationSeconds: 5400 }),
    );
  });
});

describe('POST /api/webinars/:id/video のロールガード', () => {
  // Mirrors the PUT role-guard tests: proves the guard actually discriminates
  // by role on this endpoint too, since every test above hardcodes 'owner'.
  test('staff ロールは403で拒否され、DB を触らない', async () => {
    const r2 = makeR2();
    r2.store.set('webinars/test-webinar/1755830000000/master.m3u8', new ArrayBuffer(1));

    const res = await authedRoutesAs('staff').request(
      '/api/webinars/w1/video',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: '1755830000000', durationSeconds: 7200 }),
      },
      envWith(r2),
      execCtx,
    );

    expect(res.status).toBe(403);
    expect(dbMocks.updateWebinar).not.toHaveBeenCalled();
  });

  test('admin ロールは許可される', async () => {
    const r2 = makeR2();
    // このテストの主眼はロールゲートであって完全性チェックではないので、
    // seedCompleteRevision で完全なリビジョンを用意して完全性チェックを通す
    // (空の master.m3u8 は「variant を1つも参照しない master は拒否する」
    // チェックの追加によりもう使えない)。
    seedCompleteRevision(r2, 'webinars/test-webinar/1755830000000');
    dbMocks.updateWebinar.mockResolvedValue({ id: 'w1' });

    const res = await authedRoutesAs('admin').request(
      '/api/webinars/w1/video',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: '1755830000000', durationSeconds: 7200 }),
      },
      envWith(r2),
      execCtx,
    );

    expect(res.status).toBe(200);
    expect(dbMocks.updateWebinar).toHaveBeenCalledTimes(1);
  });
});
