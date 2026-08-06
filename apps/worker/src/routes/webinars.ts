// オートウェビナー (疑似ライブ) HTTP routes.
//
// LIFF:   /api/liff/webinars/:slug          (id_token verify で friend 特定)
// Assets: /webinar-assets/:token/:slug/*    (HMAC トークン、R2 から HLS 配信)
// Admin:  /api/webinars/*                   (既存 authMiddleware がカバー)
//
// 時刻の権威はサーバー。resolveSession が「現在時刻 − 開始時刻」を返し、
// クライアントは受信 offset + 単調経過時間で再生位置を維持する。
// トークンをクエリでなく URL パスに置くのは、m3u8 内の相対参照
// (variant playlist / セグメント) が同じディレクトリ配下として解決され、
// 追加の書き換えなしに全リクエストへトークンが伝播するため。
//
// See: docs/superpowers/specs/2026-07-29-auto-webinar-design.md

import { Hono, type Context } from 'hono';
import {
  getWebinars,
  getWebinarById,
  getWebinarBySlug,
  createWebinar,
  updateWebinar,
  deleteWebinar,
  getWebinarComments,
  getWebinarCtas,
  replaceWebinarCtas,
  replaceWebinarComments,
  upsertWebinarViewer,
  updateWebinarViewerPosition,
  recordWebinarCtaClick,
  insertWebinarUserComment,
  countSessionUserComments,
  getWebinarUserComments,
  getWebinarSessionStats,
  getWebinarDropoff,
  getWebinarParticipantStats,
  getWebinarAnalyticsSummary,
  getWebinarDailyStats,
  getFriendByLineUserId,
  getFriendByLineUserIdForAccount,
  getFormById,
  type Webinar,
  upsertWebinarRegistration,
  getUpcomingWebinarRegistration,
  getWebinarRegistration,
} from '@line-crm/db';
import { verifyCallerLineUserId } from '../services/liff-auth.js';
import { attachTagAndFireSideEffects } from '../services/friend-tag-attach.js';
import { resolveSession, parseScheduleRules, upcomingSessions } from '../services/webinar-schedule.js';
import { sendWebinarRegistrationConfirmation } from '../services/webinar-reminders.js';
import { dispatchLineProxyLocally } from '../services/local-line-proxy.js';
import { signWebinarToken, verifyWebinarToken } from '../lib/webinar-token.js';
import type { Env } from '../index.js';

const webinarRoutes = new Hono<Env>();

const COMMENT_MAX = 500;
const SESSION_COMMENT_LIMIT = 60;
const TOKEN_GRACE_SECONDS = 3600;
// 開始後もこの秒数までは、その回を予約して途中参加できる。
// ただし未予約者へ再生トークンは一切返さず、必ず予約を先に通す。
const CURRENT_SESSION_JOIN_GRACE_SECONDS = 5 * 60;
// 開始前「待機ルーム」を開く秒数。この窓内はサクラコメント (負の at_seconds)
// と視聴者コメントが動く。管理画面での編集余地を持たせて負方向は 1h まで許容。
const WAITING_ROOM_SECONDS = 600;
const COMMENT_MIN_AT_SECONDS = -3600;

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

// LIFF caller を認証し、webinar とそのアカウント配下の friend を解決する。
// 認証 (401) を webinar 存在確認より先に行う (existence oracle 対策)。
// friend はウェビナーのアカウント配下の行を優先する (同一プロバイダーの複数
// アカウントは line_user_id が同一のため、無指定の先頭一致だと別アカウントの
// friend 行に吸われて予約・確認プッシュ・リマインドのアカウントがズレる)。
async function resolveWebinarCaller(
  c: Context<Env>,
  slug: string,
): Promise<{ webinar: Webinar; friendId: string } | Response> {
  const lineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
  if (!lineUserId) return c.json({ error: 'unauthorized' }, 401);
  const loaded = await loadActiveWebinar(c, slug);
  if (loaded instanceof Response) return loaded;
  const friend = await getFriendByLineUserIdForAccount(
    c.env.DB, lineUserId, loaded.webinar.account_id,
  );
  if (!friend) return c.json({ error: 'friend_not_found' }, 403);
  return { webinar: loaded.webinar, friendId: friend.id };
}

async function loadActiveWebinar(
  c: Context<Env>,
  slug: string,
): Promise<{ webinar: Webinar } | Response> {
  const webinar = await getWebinarBySlug(c.env.DB, slug);
  if (!webinar || webinar.status !== 'active') {
    return c.json({ error: 'not_found' }, 404);
  }
  return { webinar };
}

// ----------------------------------------------------------------
// LIFF: 視聴状態
// ----------------------------------------------------------------

webinarRoutes.get('/api/liff/webinars/:slug', async (c) => {
  try {
    const auth = await resolveWebinarCaller(c, c.req.param('slug'));
    if (auth instanceof Response) return auth;
    const { webinar } = auth;

    const now = nowEpoch();
    const rules = parseScheduleRules(webinar.schedule_json);
    const session = resolveSession(rules, webinar.duration_seconds, now);

    // 予約後に発行した専用リンクは sessionStartAt を含む。
    // LIFF で本人確認した上で、同じ webinar×friend×session の予約行が
    // 実在する場合だけ予約パスとして扱う。URL を転送しても他人は通らない。
    const requestedSessionRaw = c.req.query('sessionStartAt');
    const requestedSessionStartAt = requestedSessionRaw === undefined
      ? null
      : Number(requestedSessionRaw);
    const admissionReg =
      requestedSessionStartAt !== null &&
      Number.isInteger(requestedSessionStartAt) &&
      requestedSessionStartAt > 0
        ? await getWebinarRegistration(
            c.env.DB, webinar.id, auth.friendId, requestedSessionStartAt,
          )
        : null;

    // 配信終了後でも、専用リンクを持つ予約済み本人には
    // その回を先頭から再生する。アセットトークンは開くたびに再発行するため、
    // 入場リンク自体に期限を持たせない。
    if (
      admissionReg &&
      requestedSessionStartAt !== null &&
      now >= requestedSessionStartAt + webinar.duration_seconds
    ) {
      await upsertWebinarViewer(
        c.env.DB, webinar.id, auth.friendId, requestedSessionStartAt,
      );
      if (webinar.tag_on_attend) {
        c.executionCtx.waitUntil(
          Promise.resolve(
            attachTagAndFireSideEffects(c.env.DB, auth.friendId, webinar.tag_on_attend),
          ).catch((err) => console.error('webinar replay attend tag error:', err)),
        );
      }

      const exp = now + webinar.duration_seconds + TOKEN_GRACE_SECONDS;
      const token = await signWebinarToken(c.env.LINE_CHANNEL_SECRET, webinar.slug, exp);
      const [comments, ctas] = await Promise.all([
        getWebinarComments(c.env.DB, webinar.id),
        getWebinarCtas(c.env.DB, webinar.id),
      ]);
      return c.json({
        live: true,
        replay: true,
        title: webinar.title,
        durationSeconds: webinar.duration_seconds,
        sessionStartAt: requestedSessionStartAt,
        offsetSeconds: 0,
        upcoming: upcomingSessions(rules, webinar.duration_seconds, now, 48),
        registeredSessionAt: null,
        registeredForThisSession: true,
        playlistUrl: `/webinar-assets/${token}/${webinar.slug}/master.m3u8`,
        cta: webinar.cta_json ? (JSON.parse(webinar.cta_json) as unknown) : null,
        comments: comments.map((cm) => ({
          atSeconds: cm.at_seconds,
          authorName: cm.author_name,
          body: cm.body,
        })),
        ctas: ctas.map((ct) => ({
          id: ct.id,
          atSeconds: ct.at_seconds,
          kind: ct.kind,
          title: ct.title,
          body: ct.body,
          buttonLabel: ct.button_label,
          autoOpen: Boolean(ct.auto_open),
          formId: ct.form_id,
          url: ct.url,
        })),
      });
    }

    if (!session.live) {
      const reg = await getUpcomingWebinarRegistration(c.env.DB, webinar.id, auth.friendId, now);
      // 開始 WAITING_ROOM_SECONDS 前からは「待機ルーム」: 開始前サクラコメント
      // (負の at_seconds) を流すためのペイロードを返す。ハートビート・attend
      // タグ・再生トークンはライブ開始まで発行しない。未予約者は待機ルームへ
      // 直行させず、必ずセッション選択メニューを表示する。
      const next = session.nextSessionAt;
      if (
        next !== null &&
        next - now <= WAITING_ROOM_SECONDS &&
        reg?.session_start_at === next
      ) {
        const comments = await getWebinarComments(c.env.DB, webinar.id);
        return c.json({
          live: false,
          waiting: true,
          title: webinar.title,
          nextSessionAt: next,
          offsetSeconds: now - next,
          comments: comments.map((cm) => ({
            atSeconds: cm.at_seconds,
            authorName: cm.author_name,
            body: cm.body,
          })),
        });
      }
      // 30分間隔・24時間開催の1日分。クライアントは直近6件から段階表示し、
      // 48件を一度に並べて離脱を招かない。
      const upcoming = upcomingSessions(rules, webinar.duration_seconds, now, 48);
      return c.json({
        live: false,
        title: webinar.title,
        nextSessionAt: next,
        upcoming,
        registeredSessionAt: reg?.session_start_at ?? null,
      });
    }

    const [currentReg, liveReg] = await Promise.all([
      getWebinarRegistration(c.env.DB, webinar.id, auth.friendId, session.sessionStartAt!),
      getUpcomingWebinarRegistration(c.env.DB, webinar.id, auth.friendId, now),
    ]);
    const withinJoinGrace = (session.offsetSeconds ?? Infinity) <= CURRENT_SESSION_JOIN_GRACE_SECONDS;
    const liveUpcoming = upcomingSessions(rules, webinar.duration_seconds, now, 48);

    // 直リンクを含め、未予約者へは動画 URL / 再生トークンを返さない。
    // 開始5分以内だけ現在回を新規予約できる。一方、すでにこの回を
    // 予約済みの本人は、LIFF を閉じた後でも配信終了まで再入場できる。
    if (!currentReg) {
      const bookable = withinJoinGrace
        ? [session.sessionStartAt!, ...liveUpcoming].slice(0, 48)
        : liveUpcoming;
      return c.json({
        live: false,
        title: webinar.title,
        nextSessionAt: bookable[0] ?? session.nextSessionAt,
        upcoming: bookable,
        registeredSessionAt: liveReg?.session_start_at ?? null,
      });
    }

    await upsertWebinarViewer(c.env.DB, webinar.id, auth.friendId, session.sessionStartAt!);
    if (webinar.tag_on_attend) {
      c.executionCtx.waitUntil(
        Promise.resolve(
          attachTagAndFireSideEffects(c.env.DB, auth.friendId, webinar.tag_on_attend),
        ).catch((err) => console.error('webinar attend tag error:', err)),
      );
    }

    const exp = session.sessionStartAt! + webinar.duration_seconds + TOKEN_GRACE_SECONDS;
    const token = await signWebinarToken(c.env.LINE_CHANNEL_SECRET, webinar.slug, exp);
    const [comments, ctas] = await Promise.all([
      getWebinarComments(c.env.DB, webinar.id),
      getWebinarCtas(c.env.DB, webinar.id),
    ]);

    return c.json({
      live: true,
      title: webinar.title,
      durationSeconds: webinar.duration_seconds,
      sessionStartAt: session.sessionStartAt,
      offsetSeconds: session.offsetSeconds,
      upcoming: liveUpcoming,
      registeredSessionAt: liveReg?.session_start_at ?? null,
      registeredForThisSession: true,
      playlistUrl: `/webinar-assets/${token}/${webinar.slug}/master.m3u8`,
      cta: webinar.cta_json ? (JSON.parse(webinar.cta_json) as unknown) : null,
      comments: comments.map((cm) => ({
        atSeconds: cm.at_seconds,
        authorName: cm.author_name,
        body: cm.body,
      })),
      ctas: ctas.map((ct) => ({
        id: ct.id,
        atSeconds: ct.at_seconds,
        kind: ct.kind,
        title: ct.title,
        body: ct.body,
        buttonLabel: ct.button_label,
        autoOpen: Boolean(ct.auto_open),
        formId: ct.form_id,
        url: ct.url,
      })),
    });
  } catch (err) {
    console.error('GET /api/liff/webinars/:slug error:', err);
    return c.json({ error: 'internal_error' }, 500);
  }
});

webinarRoutes.post('/api/liff/webinars/:slug/heartbeat', async (c) => {
  try {
    const auth = await resolveWebinarCaller(c, c.req.param('slug'));
    if (auth instanceof Response) return auth;
    const loaded = { webinar: auth.webinar };

    const body = await c.req.json<{ sessionStartAt?: unknown; positionSeconds?: unknown }>();
    const sessionStartAt = Number(body.sessionStartAt);
    const positionSeconds = Math.floor(Number(body.positionSeconds));
    if (
      !Number.isFinite(sessionStartAt) ||
      !Number.isFinite(positionSeconds) ||
      positionSeconds < 0 ||
      positionSeconds > loaded.webinar.duration_seconds + 60
    ) {
      return c.json({ error: 'invalid_body' }, 422);
    }
    await updateWebinarViewerPosition(
      c.env.DB, loaded.webinar.id, auth.friendId, sessionStartAt, positionSeconds,
    );
    return c.json({ ok: true });
  } catch (err) {
    console.error('POST heartbeat error:', err);
    return c.json({ error: 'internal_error' }, 500);
  }
});

webinarRoutes.post('/api/liff/webinars/:slug/comments', async (c) => {
  try {
    const auth = await resolveWebinarCaller(c, c.req.param('slug'));
    if (auth instanceof Response) return auth;
    const loaded = { webinar: auth.webinar };

    const body = await c.req.json<{
      sessionStartAt?: unknown; atSeconds?: unknown; body?: unknown;
    }>();
    const sessionStartAt = Number(body.sessionStartAt);
    const atSeconds = Math.floor(Number(body.atSeconds));
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (
      !Number.isFinite(sessionStartAt) || !Number.isFinite(atSeconds) ||
      atSeconds < COMMENT_MIN_AT_SECONDS || text.length === 0 || text.length > COMMENT_MAX
    ) {
      return c.json({ error: 'invalid_body' }, 422);
    }
    // sessionStartAt はクライアント申告値。サーバー側で現在のセッションを再計算し、
    // ライブ外や偽装 sessionStartAt でのコメント投稿（60件上限バイパス含む）を防ぐ。
    // 待機ルーム中 (次回開始まで WAITING_ROOM_SECONDS 以内) は次回セッション帰属で
    // 負の atSeconds を受ける。
    const session = resolveSession(
      parseScheduleRules(loaded.webinar.schedule_json),
      loaded.webinar.duration_seconds,
      nowEpoch(),
    );
    if (session.live) {
      if (sessionStartAt !== session.sessionStartAt) {
        return c.json({ error: 'not_live' }, 409);
      }
    } else {
      const next = session.nextSessionAt;
      const inWaitingRoom = next !== null && next - nowEpoch() <= WAITING_ROOM_SECONDS;
      if (!inWaitingRoom || sessionStartAt !== next) {
        return c.json({ error: 'not_live' }, 409);
      }
    }
    const count = await countSessionUserComments(
      c.env.DB, loaded.webinar.id, auth.friendId, sessionStartAt,
    );
    if (count >= SESSION_COMMENT_LIMIT) {
      return c.json({ error: 'too_many_comments' }, 429);
    }
    await insertWebinarUserComment(c.env.DB, {
      webinarId: loaded.webinar.id,
      friendId: auth.friendId,
      sessionStartAt,
      atSeconds,
      body: text,
    });
    return c.json({ ok: true });
  } catch (err) {
    console.error('POST webinar comment error:', err);
    return c.json({ error: 'internal_error' }, 500);
  }
});

// セッション選択メニューの予約。sessionStartAt はスケジュール上の実在する
// 未来セッションに加え、開始後5分以内だけ現在回も受理。
// 冪等 (同一回の再予約は成功扱い)。
webinarRoutes.post('/api/liff/webinars/:slug/register', async (c) => {
  try {
    const auth = await resolveWebinarCaller(c, c.req.param('slug'));
    if (auth instanceof Response) return auth;
    const loaded = { webinar: auth.webinar };
    const { webinar } = loaded;

    const body = await c.req.json<{ sessionStartAt?: unknown }>();
    const sessionStartAt = Number(body.sessionStartAt);
    const rules = parseScheduleRules(webinar.schedule_json);
    const now = nowEpoch();
    const session = resolveSession(rules, webinar.duration_seconds, now);
    const upcoming = upcomingSessions(rules, webinar.duration_seconds, now, 48);
    const currentIsBookable =
      session.live &&
      session.sessionStartAt === sessionStartAt &&
      (session.offsetSeconds ?? Infinity) <= CURRENT_SESSION_JOIN_GRACE_SECONDS;
    if (
      !Number.isFinite(sessionStartAt) ||
      (!currentIsBookable && !upcoming.includes(sessionStartAt))
    ) {
      return c.json({ error: 'invalid_session' }, 400);
    }
    await upsertWebinarRegistration(c.env.DB, webinar.id, auth.friendId, sessionStartAt);
    const liffMatch = /liff\.line\.me\/([^/?]+)/.exec(c.env.LIFF_URL ?? '');
    c.executionCtx.waitUntil(
      sendWebinarRegistrationConfirmation(
        c.env.DB,
        webinar,
        auth.friendId,
        sessionStartAt,
        {
          proxyBaseUrl: new URL(c.req.url).origin,
          defaultAccessToken: c.env.LINE_CHANNEL_ACCESS_TOKEN,
          defaultLiffId: liffMatch?.[1] ?? null,
          proxyDispatch: (request) =>
            dispatchLineProxyLocally(request, c.env, c.executionCtx),
        },
      ),
    );
    return c.json({ ok: true, sessionStartAt });
  } catch (err) {
    console.error('POST webinar register error:', err);
    return c.json({ error: 'internal_error' }, 500);
  }
});

webinarRoutes.post('/api/liff/webinars/:slug/cta-click', async (c) => {
  try {
    const auth = await resolveWebinarCaller(c, c.req.param('slug'));
    if (auth instanceof Response) return auth;
    const loaded = { webinar: auth.webinar };

    const body = await c.req.json<{ sessionStartAt?: unknown }>();
    const sessionStartAt = Number(body.sessionStartAt);
    if (!Number.isFinite(sessionStartAt)) return c.json({ error: 'invalid_body' }, 422);

    await recordWebinarCtaClick(c.env.DB, loaded.webinar.id, auth.friendId, sessionStartAt);
    if (loaded.webinar.tag_on_cta_click) {
      c.executionCtx.waitUntil(
        Promise.resolve(
          attachTagAndFireSideEffects(
            c.env.DB, auth.friendId, loaded.webinar.tag_on_cta_click,
          ),
        ).catch((err) => console.error('webinar cta tag error:', err)),
      );
    }
    return c.json({ ok: true });
  } catch (err) {
    console.error('POST cta-click error:', err);
    return c.json({ error: 'internal_error' }, 500);
  }
});

// ----------------------------------------------------------------
// HLS アセット配信
// ----------------------------------------------------------------

const CONTENT_TYPES: Record<string, string> = {
  m3u8: 'application/vnd.apple.mpegurl',
  ts: 'video/mp2t',
  m4s: 'video/iso.segment',
  mp4: 'video/mp4',
  aac: 'audio/aac',
};

webinarRoutes.get('/webinar-assets/:token/:slug/*', async (c) => {
  const token = c.req.param('token');
  const slug = c.req.param('slug');

  const valid = await verifyWebinarToken(c.env.LINE_CHANNEL_SECRET, slug, token, nowEpoch());
  if (!valid) return c.json({ error: 'forbidden' }, 403);

  const webinar = await getWebinarBySlug(c.env.DB, slug);
  if (!webinar || !webinar.video_prefix) return c.json({ error: 'not_found' }, 404);

  const prefix = `/webinar-assets/${token}/${slug}/`;
  const rest = decodeURIComponent(c.req.path.slice(prefix.length));
  if (!rest || rest.includes('..') || rest.startsWith('/')) {
    return c.json({ error: 'bad_path' }, 400);
  }

  const object = await c.env.IMAGES.get(`${webinar.video_prefix}/${rest}`);
  if (!object) return c.json({ error: 'not_found' }, 404);

  const ext = rest.split('.').pop() ?? '';
  const headers = new Headers();
  headers.set('Content-Type', CONTENT_TYPES[ext] ?? 'application/octet-stream');

  // ?at=<秒> 付きプレイリストは #EXT-X-START を注入し、途中参加位置からの
  // 再生を「配信側で」宣言する。iOS native HLS (LINE in-app) はクライアント側
  // の currentTime シークが 0 に巻き戻ることがあるため、開始位置はプレイリスト
  // で示すのが確実。master 内の variant URI にも ?at= を伝播する。
  const atRaw = c.req.query('at');
  if (ext === 'm3u8' && atRaw !== undefined) {
    const at = Math.floor(Number(atRaw));
    if (!Number.isFinite(at) || at < 0 || at > webinar.duration_seconds) {
      return c.json({ error: 'bad_at' }, 400);
    }
    const text = await object.text();
    const isMaster = text.includes('#EXT-X-STREAM-INF');
    const out: string[] = [];
    for (const line of text.split('\n')) {
      out.push(
        isMaster && line.trim() !== '' && !line.startsWith('#')
          ? `${line.trim()}${line.includes('?') ? '&' : '?'}at=${at}`
          : line,
      );
      if (line.startsWith('#EXTM3U')) {
        out.push(`#EXT-X-START:TIME-OFFSET=${at},PRECISE=YES`);
      }
    }
    // 開始位置は視聴タイミング依存の動的レスポンスなのでキャッシュさせない
    headers.set('Cache-Control', 'private, no-store');
    return new Response(out.join('\n'), { headers });
  }

  headers.set(
    'Cache-Control',
    ext === 'm3u8' ? 'public, max-age=3600' : 'public, max-age=31536000, immutable',
  );
  headers.set('ETag', object.etag);
  return new Response(object.body as ReadableStream, { headers });
});

// ----------------------------------------------------------------
// Admin API (/api/webinars/*) — 既存 authMiddleware がカバー
// ----------------------------------------------------------------

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

function serializeWebinar(row: Webinar) {
  return {
    id: row.id,
    accountId: row.account_id,
    title: row.title,
    slug: row.slug,
    status: row.status,
    videoPrefix: row.video_prefix,
    durationSeconds: row.duration_seconds,
    schedule: parseScheduleRules(row.schedule_json),
    cta: row.cta_json ? (JSON.parse(row.cta_json) as unknown) : null,
    tagOnAttend: row.tag_on_attend,
    tagOnCtaClick: row.tag_on_cta_click,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface WebinarBody {
  accountId?: string | null;
  title?: string;
  slug?: string;
  status?: string;
  videoPrefix?: string | null;
  durationSeconds?: number;
  schedule?: unknown[];
  cta?: { label?: string; url?: string; showAtSeconds?: number } | null;
  tagOnAttend?: string | null;
  tagOnCtaClick?: string | null;
}

// body → createWebinar/updateWebinar input。不正なら string (エラーコード) を返す
function validateWebinarBody(
  body: WebinarBody,
  { requireCore }: { requireCore: boolean },
): string | Record<string, unknown> {
  if (requireCore) {
    if (!body.title?.trim()) return 'title_required';
    if (!body.slug || !SLUG_RE.test(body.slug)) return 'invalid_slug';
  } else {
    if (body.title !== undefined && !body.title.trim()) return 'title_required';
    if (body.slug !== undefined && !SLUG_RE.test(body.slug)) return 'invalid_slug';
  }
  if (body.status !== undefined && !['draft', 'active', 'archived'].includes(body.status)) {
    return 'invalid_status';
  }
  if (body.durationSeconds !== undefined) {
    if (!Number.isFinite(body.durationSeconds) || body.durationSeconds < 0) {
      return 'invalid_duration';
    }
  }
  let scheduleJson: string | undefined;
  if (body.schedule !== undefined) {
    if (!Array.isArray(body.schedule)) return 'invalid_schedule';
    const parsed = parseScheduleRules(JSON.stringify(body.schedule));
    if (parsed.length !== body.schedule.length) return 'invalid_schedule';
    scheduleJson = JSON.stringify(parsed);
  }
  let ctaJson: string | null | undefined;
  if (body.cta === null) {
    ctaJson = null;
  } else if (body.cta !== undefined) {
    const { label, url, showAtSeconds } = body.cta;
    if (
      !label?.trim() || !url?.trim() || !/^https?:\/\//.test(url) ||
      !Number.isFinite(showAtSeconds) || (showAtSeconds as number) < 0
    ) {
      return 'invalid_cta';
    }
    ctaJson = JSON.stringify({ label: label.trim(), url: url.trim(), showAtSeconds });
  }
  const input: Record<string, unknown> = {};
  if (body.accountId !== undefined) input.accountId = body.accountId;
  if (body.title !== undefined) input.title = body.title.trim();
  if (body.slug !== undefined) input.slug = body.slug;
  if (body.status !== undefined) input.status = body.status;
  if (body.videoPrefix !== undefined) {
    input.videoPrefix = body.videoPrefix?.replace(/^\/+|\/+$/g, '') || null;
  }
  if (body.durationSeconds !== undefined) {
    input.durationSeconds = Math.floor(body.durationSeconds);
  }
  if (scheduleJson !== undefined) input.scheduleJson = scheduleJson;
  if (ctaJson !== undefined) input.ctaJson = ctaJson;
  if (body.tagOnAttend !== undefined) input.tagOnAttend = body.tagOnAttend;
  if (body.tagOnCtaClick !== undefined) input.tagOnCtaClick = body.tagOnCtaClick;
  return input;
}

webinarRoutes.get('/api/webinars', async (c) => {
  try {
    const items = await getWebinars(c.env.DB);
    return c.json({ success: true, data: items.map(serializeWebinar) });
  } catch (err) {
    console.error('GET /api/webinars error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.post('/api/webinars', async (c) => {
  try {
    const body = await c.req.json<WebinarBody>();
    const input = validateWebinarBody(body, { requireCore: true });
    if (typeof input === 'string') return c.json({ success: false, error: input }, 400);
    const existing = await getWebinarBySlug(c.env.DB, body.slug!);
    if (existing) return c.json({ success: false, error: 'slug_taken' }, 409);
    const created = await createWebinar(
      c.env.DB, input as unknown as Parameters<typeof createWebinar>[1],
    );
    return c.json({ success: true, data: serializeWebinar(created) });
  } catch (err) {
    console.error('POST /api/webinars error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.get('/api/webinars/:id', async (c) => {
  try {
    const row = await getWebinarById(c.env.DB, c.req.param('id'));
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serializeWebinar(row) });
  } catch (err) {
    console.error('GET /api/webinars/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.put('/api/webinars/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<WebinarBody>();
    const input = validateWebinarBody(body, { requireCore: false });
    if (typeof input === 'string') return c.json({ success: false, error: input }, 400);
    if (body.slug && body.slug !== row.slug) {
      const dupe = await getWebinarBySlug(c.env.DB, body.slug);
      if (dupe) return c.json({ success: false, error: 'slug_taken' }, 409);
    }
    const updated = await updateWebinar(c.env.DB, id, input as Parameters<typeof updateWebinar>[2]);
    return c.json({ success: true, data: serializeWebinar(updated!) });
  } catch (err) {
    console.error('PUT /api/webinars/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.delete('/api/webinars/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    await deleteWebinar(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/webinars/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.get('/api/webinars/:id/comments', async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const comments = await getWebinarComments(c.env.DB, id);
    return c.json({
      success: true,
      data: comments.map((cm) => ({
        id: cm.id, atSeconds: cm.at_seconds, authorName: cm.author_name, body: cm.body,
      })),
    });
  } catch (err) {
    console.error('GET /api/webinars/:id/comments error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.put('/api/webinars/:id/comments', async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{ comments?: unknown }>();
    if (!Array.isArray(body.comments)) {
      return c.json({ success: false, error: 'comments_required' }, 400);
    }
    const cleaned: Array<{ atSeconds: number; authorName: string; body: string }> = [];
    for (const raw of body.comments as Array<Record<string, unknown>>) {
      const atSeconds = Math.floor(Number(raw?.atSeconds));
      const authorName = typeof raw?.authorName === 'string' ? raw.authorName.trim() : '';
      const text = typeof raw?.body === 'string' ? raw.body.trim() : '';
      // 負の atSeconds = 開始前 (待機ルーム) コメント。-1h まで許容
      if (
        !Number.isFinite(atSeconds) || atSeconds < COMMENT_MIN_AT_SECONDS ||
        !authorName || authorName.length > 50 ||
        !text || text.length > COMMENT_MAX
      ) {
        return c.json({ success: false, error: 'invalid_comment' }, 400);
      }
      cleaned.push({ atSeconds, authorName, body: text });
    }
    const count = await replaceWebinarComments(c.env.DB, id, cleaned);
    return c.json({ success: true, data: { count } });
  } catch (err) {
    console.error('PUT /api/webinars/:id/comments error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.get('/api/webinars/:id/ctas', async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const ctas = await getWebinarCtas(c.env.DB, id);
    return c.json({
      success: true,
      data: ctas.map((ct) => ({
        id: ct.id,
        atSeconds: ct.at_seconds,
        kind: ct.kind,
        title: ct.title,
        body: ct.body,
        buttonLabel: ct.button_label,
        autoOpen: Boolean(ct.auto_open),
        formId: ct.form_id,
        url: ct.url,
      })),
    });
  } catch (err) {
    console.error('GET /api/webinars/:id/ctas error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// CTA カード一括置換。kind='form' は forms 実在チェック、kind='url' は https? 必須。
// 全要素検証 → 不正が1件でもあれば何も書かない (comments と同じ all-or-nothing)。
webinarRoutes.put('/api/webinars/:id/ctas', async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const body = await c.req.json<{ ctas?: unknown }>();
    if (!Array.isArray(body.ctas)) {
      return c.json({ success: false, error: 'ctas_required' }, 400);
    }
    if (body.ctas.length > 20) {
      return c.json({ success: false, error: 'too_many_ctas' }, 400);
    }
    const cleaned: Array<{
      atSeconds: number; kind: 'form' | 'url'; title: string; body: string | null;
      buttonLabel: string; autoOpen: boolean; formId: string | null; url: string | null;
    }> = [];
    const formIdsToCheck = new Set<string>();
    for (const raw of body.ctas as Array<Record<string, unknown>>) {
      const atSeconds = Math.floor(Number(raw?.atSeconds));
      const kind = raw?.kind;
      const title = typeof raw?.title === 'string' ? raw.title.trim() : '';
      const bodyText = typeof raw?.body === 'string' ? raw.body.trim() : '';
      const buttonLabel = typeof raw?.buttonLabel === 'string' ? raw.buttonLabel.trim() : '';
      const formId = typeof raw?.formId === 'string' && raw.formId ? raw.formId : null;
      const url = typeof raw?.url === 'string' && raw.url ? raw.url.trim() : null;
      if (
        !Number.isFinite(atSeconds) || atSeconds < 0 ||
        (kind !== 'form' && kind !== 'url') ||
        !title || title.length > 100 ||
        bodyText.length > 300 ||
        !buttonLabel || buttonLabel.length > 50
      ) {
        return c.json({ success: false, error: 'invalid_cta' }, 400);
      }
      if (kind === 'form') {
        if (!formId) return c.json({ success: false, error: 'form_id_required' }, 400);
        formIdsToCheck.add(formId);
      } else if (!url || !/^https?:\/\//.test(url)) {
        return c.json({ success: false, error: 'invalid_url' }, 400);
      }
      cleaned.push({
        atSeconds, kind, title, body: bodyText || null, buttonLabel,
        autoOpen: Boolean(raw?.autoOpen),
        formId: kind === 'form' ? formId : null,
        url: kind === 'url' ? url : null,
      });
    }
    const forms = await Promise.all(
      [...formIdsToCheck].map((fid) => getFormById(c.env.DB, fid)),
    );
    if (forms.some((f) => !f)) {
      return c.json({ success: false, error: 'form_not_found' }, 400);
    }
    if (forms.some((f) => f && !f.is_active)) {
      return c.json({ success: false, error: 'form_inactive' }, 400);
    }
    const count = await replaceWebinarCtas(c.env.DB, id, cleaned);
    return c.json({ success: true, data: { count } });
  } catch (err) {
    console.error('PUT /api/webinars/:id/ctas error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.get('/api/webinars/:id/analytics', async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const completionThreshold = Math.max(1, Math.floor(row.duration_seconds * 0.9));
    const [sessions, dropoff, participants, summary, daily] = await Promise.all([
      getWebinarSessionStats(c.env.DB, id),
      getWebinarDropoff(c.env.DB, id),
      getWebinarParticipantStats(c.env.DB, id, 200),
      getWebinarAnalyticsSummary(c.env.DB, id, completionThreshold),
      getWebinarDailyStats(c.env.DB, id),
    ]);
    return c.json({
      success: true,
      data: {
        summary: {
          reservations: summary.reservations,
          viewers: summary.viewers,
          registeredAndJoined: summary.registered_and_joined,
          watched5m: summary.watched_5m,
          watched15m: summary.watched_15m,
          completed: summary.completed,
          avgWatchedSeconds: summary.avg_watched_seconds,
          ctaClicks: summary.cta_clicks,
          formSubmissions: summary.form_submissions,
        },
        daily: daily.map((d) => ({
          date: d.stat_date,
          reservations: d.reservations,
          viewers: d.viewers,
          ctaClicks: d.cta_clicks,
          formSubmissions: d.form_submissions,
        })),
        participants: participants.map((p) => ({
          friendId: p.friend_id,
          friendName: p.friend_name,
          pictureUrl: p.picture_url,
          sessions: p.sessions,
          firstJoinedAt: p.first_joined_at,
          latestJoinedAt: p.latest_joined_at,
          maxWatchedSeconds: p.max_watched_seconds,
          ctaClickedAt: p.cta_clicked_at,
          registered: Boolean(p.registered),
          formSubmittedAt: p.form_submitted_at,
        })),
        sessions: sessions.map((s) => ({
          sessionStartAt: s.session_start_at,
          viewers: s.viewers,
          avgWatchedSeconds: s.avg_watched_seconds,
          ctaClicks: s.cta_clicks,
        })),
        dropoff: dropoff.map((d) => ({ bucketStart: d.bucket_start, viewers: d.viewers })),
      },
    });
  } catch (err) {
    console.error('GET /api/webinars/:id/analytics error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

webinarRoutes.get('/api/webinars/:id/user-comments', async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const items = await getWebinarUserComments(c.env.DB, id);
    return c.json({
      success: true,
      data: items.map((cm) => ({
        id: cm.id,
        friendId: cm.friend_id,
        friendName: cm.friend_name ?? null,
        pictureUrl: cm.picture_url ?? null,
        sessionStartAt: cm.session_start_at,
        atSeconds: cm.at_seconds,
        body: cm.body,
        createdAt: cm.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/webinars/:id/user-comments error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { webinarRoutes };
