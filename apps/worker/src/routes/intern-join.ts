// KIDOUインターンの「友だち追加リンク」タブと経路リンクの入口（仕組みは services/intern-join.ts）
import { Hono } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import { createEntryRoute, getEntryRouteById, getEntryRouteByRefCode, updateEntryRoute } from '@line-crm/db';
import type { Env } from '../index.js';
import {
  friendAddUrl,
  isJoinReady,
  joinConfigFromEnv,
  listJoinLinks,
  newJoinRef,
  isTapId,
  newTapId,
  recordJoinOpen,
  recordJoinTap,
  renderJoinPage,
  saveJoinOrder,
  JOIN_REF_PREFIX,
  TAP_COOKIE,
  TAP_COOKIE_MAX_AGE_SEC,
} from '../services/intern-join.js';

const internJoin = new Hono<Env>();

// 11/10 までの LIFF の画面。いまの経路リンクは使わないが、開いたままの人のために残す
internJoin.get('/in/join', (c) => {
  const config = joinConfigFromEnv(c.env);
  return c.html(renderJoinPage(config), 200, { 'Cache-Control': 'no-store' });
});

// SNS に貼るリンク。押されたことを記録して、すぐ友だち追加の画面へ送る（ログインは挟まない）。
// 記録は送ったあとに裏で行う（待たせない）。止めたリンク・知らない記号も友だち追加へ（印刷したリンクも切らさない）
internJoin.get('/in/:ref', (c) => {
  const config = joinConfigFromEnv(c.env);
  const ref = c.req.param('ref');
  const fromCookie = getCookie(c, TAP_COOKIE);
  const tapId = isTapId(fromCookie) ? fromCookie : newTapId();
  if (c.req.method === 'GET') {
    setCookie(c, TAP_COOKIE, tapId, { path: '/in', maxAge: TAP_COOKIE_MAX_AGE_SEC, httpOnly: true, secure: true, sameSite: 'Lax' });
    const work = recordJoinTap(c.env.DB, config, { ref, tapId, userAgent: c.req.header('user-agent') ?? null }).catch((err) => {
      console.error('[intern-join] tap record failed', err);
    });
    try {
      c.executionCtx.waitUntil(work);
    } catch {
      // テストなど executionCtx が無いときはそのまま流す
    }
  }
  c.header('Cache-Control', 'no-store');
  return c.redirect(friendAddUrl(config), 302);
});

// LIFF の画面から。本人の確かめは LINE の ID トークンで行う（ログイン不要の受け口）
internJoin.post('/api/intern/join', async (c) => {
  const config = joinConfigFromEnv(c.env);
  const body = await c.req.json<{ idToken?: unknown; ref?: unknown }>().catch(() => null);
  const idToken = typeof body?.idToken === 'string' ? body.idToken : '';
  const ref = typeof body?.ref === 'string' ? body.ref : '';
  try {
    const result = await recordJoinOpen(c.env.DB, config, { idToken, ref, userAgent: c.req.header('user-agent') ?? null });
    const status = result === 'ok' ? 200 : result === 'unauthorized' ? 401 : result === 'not_ready' ? 503 : 400;
    return c.json({ success: result === 'ok', result }, status);
  } catch (err) {
    console.error('POST /api/intern/join error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── 管理画面 ─────────────────────────────────────────────

function publicBase(c: { req: { url: string; header: (name: string) => string | undefined } }): string {
  return new URL(c.req.url).origin;
}

internJoin.get('/api/intern/join-links', async (c) => {
  const config = joinConfigFromEnv(c.env);
  if (!config.accountId) return c.json({ success: false, error: 'KIDOUインターンのアカウントが設定されていません' }, 404);
  try {
    const data = await listJoinLinks(c.env.DB, config.accountId);
    return c.json({
      success: true,
      data: {
        ...data,
        accountId: config.accountId,
        ready: isJoinReady(config),
        botBasicId: config.botBasicId,
        friendAddUrl: friendAddUrl(config),
        linkBase: `${publicBase(c)}/in/`,
      },
    });
  } catch (err) {
    console.error('GET /api/intern/join-links error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

internJoin.post('/api/intern/join-links', async (c) => {
  const config = joinConfigFromEnv(c.env);
  if (!config.accountId) return c.json({ success: false, error: 'KIDOUインターンのアカウントが設定されていません' }, 404);
  const body = await c.req.json<{ name?: unknown; tagId?: unknown }>().catch(() => null);
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 60) : '';
  const tagId = typeof body?.tagId === 'string' && body.tagId ? body.tagId : null;
  if (!name) return c.json({ success: false, error: 'リンクの名前を入れてください' }, 400);
  try {
    let refCode = newJoinRef();
    for (let i = 0; i < 3 && (await getEntryRouteByRefCode(c.env.DB, refCode)); i++) refCode = newJoinRef();
    // アカウントのシナリオ（友だち追加時）は今までどおり動かす。紹介文・専用シナリオは付けない
    const route = await createEntryRoute(c.env.DB, { refCode, name, tagId, runAccountFriendAddScenarios: true, isActive: true });
    return c.json({ success: true, data: { id: route.id, refCode: route.ref_code } }, 201);
  } catch (err) {
    console.error('POST /api/intern/join-links error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// 経路ごとの人数の表の並び順。ids は上から順の entry_routes の id
internJoin.put('/api/intern/join-links/order', async (c) => {
  const config = joinConfigFromEnv(c.env);
  if (!config.accountId) return c.json({ success: false, error: 'KIDOUインターンのアカウントが設定されていません' }, 404);
  const body = await c.req.json<{ ids?: unknown }>().catch(() => null);
  if (!Array.isArray(body?.ids) || body.ids.length > 500 || !body.ids.every((x) => typeof x === 'string')) {
    return c.json({ success: false, error: '並び順を読み取れませんでした' }, 400);
  }
  try {
    await saveJoinOrder(c.env.DB, config.accountId, body.ids as string[]);
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /api/intern/join-links/order error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

internJoin.patch('/api/intern/join-links/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: unknown; tagId?: unknown; isActive?: unknown }>().catch(() => null);
  try {
    const route = await getEntryRouteById(c.env.DB, id);
    if (!route || !route.ref_code.startsWith(JOIN_REF_PREFIX)) return c.json({ success: false, error: 'Not found' }, 404);
    const patch: { name?: string; tagId?: string | null; isActive?: boolean } = {};
    if (typeof body?.name === 'string') {
      const name = body.name.trim().slice(0, 60);
      if (!name) return c.json({ success: false, error: 'リンクの名前を入れてください' }, 400);
      patch.name = name;
    }
    if (body?.tagId === null || typeof body?.tagId === 'string') patch.tagId = body.tagId || null;
    if (typeof body?.isActive === 'boolean') patch.isActive = body.isActive;
    await updateEntryRoute(c.env.DB, id, patch);
    return c.json({ success: true });
  } catch (err) {
    console.error('PATCH /api/intern/join-links/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { internJoin };
