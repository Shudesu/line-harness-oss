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
  replaceWebinarComments,
  upsertWebinarViewer,
  updateWebinarViewerPosition,
  recordWebinarCtaClick,
  insertWebinarUserComment,
  countSessionUserComments,
  getWebinarUserComments,
  getWebinarSessionStats,
  getWebinarDropoff,
  getFriendByLineUserId,
  type Webinar,
} from '@line-crm/db';
import { verifyCallerLineUserId } from '../services/liff-auth.js';
import { attachTagAndFireSideEffects } from '../services/friend-tag-attach.js';
import { resolveSession, parseScheduleRules } from '../services/webinar-schedule.js';
import { signWebinarToken, verifyWebinarToken } from '../lib/webinar-token.js';
import type { Env } from '../index.js';

const webinarRoutes = new Hono<Env>();

const COMMENT_MAX = 500;
const SESSION_COMMENT_LIMIT = 60;
const TOKEN_GRACE_SECONDS = 3600;

function nowEpoch(): number {
  return Math.floor(Date.now() / 1000);
}

// LIFF caller → friend を解決。失敗時は Response を返す
async function resolveLiffFriend(
  c: Context<Env>,
): Promise<{ friendId: string } | Response> {
  const lineUserId = await verifyCallerLineUserId(c.req.header('Authorization'), c.env);
  if (!lineUserId) return c.json({ error: 'unauthorized' }, 401);
  const friend = await getFriendByLineUserId(c.env.DB, lineUserId);
  if (!friend) return c.json({ error: 'friend_not_found' }, 403);
  return { friendId: friend.id };
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
    // 認証を先に確認する: loadActiveWebinar (404) を先に走らせると、未認証の
    // 呼び出し元でもステータスコードから「その slug に active な webinar が
    // 存在するか」を判別できてしまう (existence oracle)。
    const auth = await resolveLiffFriend(c);
    if (auth instanceof Response) return auth;

    const loaded = await loadActiveWebinar(c, c.req.param('slug'));
    if (loaded instanceof Response) return loaded;
    const { webinar } = loaded;

    const now = nowEpoch();
    const session = resolveSession(
      parseScheduleRules(webinar.schedule_json),
      webinar.duration_seconds,
      now,
    );

    if (!session.live) {
      return c.json({
        live: false,
        title: webinar.title,
        nextSessionAt: session.nextSessionAt,
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
    const comments = await getWebinarComments(c.env.DB, webinar.id);

    return c.json({
      live: true,
      title: webinar.title,
      durationSeconds: webinar.duration_seconds,
      sessionStartAt: session.sessionStartAt,
      offsetSeconds: session.offsetSeconds,
      playlistUrl: `/webinar-assets/${token}/${webinar.slug}/master.m3u8`,
      cta: webinar.cta_json ? (JSON.parse(webinar.cta_json) as unknown) : null,
      comments: comments.map((cm) => ({
        atSeconds: cm.at_seconds,
        authorName: cm.author_name,
        body: cm.body,
      })),
    });
  } catch (err) {
    console.error('GET /api/liff/webinars/:slug error:', err);
    return c.json({ error: 'internal_error' }, 500);
  }
});

webinarRoutes.post('/api/liff/webinars/:slug/heartbeat', async (c) => {
  try {
    // 認証を先に確認する (existence oracle 対策、GET ルートと同じ理由)。
    const auth = await resolveLiffFriend(c);
    if (auth instanceof Response) return auth;
    const loaded = await loadActiveWebinar(c, c.req.param('slug'));
    if (loaded instanceof Response) return loaded;

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
    const auth = await resolveLiffFriend(c);
    if (auth instanceof Response) return auth;
    const loaded = await loadActiveWebinar(c, c.req.param('slug'));
    if (loaded instanceof Response) return loaded;

    const body = await c.req.json<{
      sessionStartAt?: unknown; atSeconds?: unknown; body?: unknown;
    }>();
    const sessionStartAt = Number(body.sessionStartAt);
    const atSeconds = Math.floor(Number(body.atSeconds));
    const text = typeof body.body === 'string' ? body.body.trim() : '';
    if (
      !Number.isFinite(sessionStartAt) || !Number.isFinite(atSeconds) ||
      atSeconds < 0 || text.length === 0 || text.length > COMMENT_MAX
    ) {
      return c.json({ error: 'invalid_body' }, 422);
    }
    // sessionStartAt はクライアント申告値。サーバー側で現在のセッションを再計算し、
    // ライブ外や偽装 sessionStartAt でのコメント投稿（60件上限バイパス含む）を防ぐ。
    const session = resolveSession(
      parseScheduleRules(loaded.webinar.schedule_json),
      loaded.webinar.duration_seconds,
      nowEpoch(),
    );
    if (!session.live || sessionStartAt !== session.sessionStartAt) {
      return c.json({ error: 'not_live' }, 409);
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

webinarRoutes.post('/api/liff/webinars/:slug/cta-click', async (c) => {
  try {
    const auth = await resolveLiffFriend(c);
    if (auth instanceof Response) return auth;
    const loaded = await loadActiveWebinar(c, c.req.param('slug'));
    if (loaded instanceof Response) return loaded;

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
      if (
        !Number.isFinite(atSeconds) || atSeconds < 0 ||
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

webinarRoutes.get('/api/webinars/:id/analytics', async (c) => {
  try {
    const id = c.req.param('id');
    const row = await getWebinarById(c.env.DB, id);
    if (!row) return c.json({ success: false, error: 'Not found' }, 404);
    const [sessions, dropoff] = await Promise.all([
      getWebinarSessionStats(c.env.DB, id),
      getWebinarDropoff(c.env.DB, id),
    ]);
    return c.json({
      success: true,
      data: {
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
