// KIDOUインターンの「友だち追加リンク」タブと経路リンクの入口（仕組みは services/intern-join.ts）
import { Hono } from 'hono';
import { createEntryRoute, getEntryRouteById, getEntryRouteByRefCode, updateEntryRoute } from '@line-crm/db';
import type { Env } from '../index.js';
import {
  friendAddUrl,
  isJoinReady,
  joinConfigFromEnv,
  listJoinLinks,
  newJoinRef,
  recordJoinOpen,
  renderJoinPage,
  resolveJoinRedirect,
  JOIN_REF_PREFIX,
} from '../services/intern-join.js';

const internJoin = new Hono<Env>();

// LIFF の画面（LINE Developers の LIFF のエンドポイント URL をここにする）
internJoin.get('/in/join', (c) => {
  const config = joinConfigFromEnv(c.env);
  return c.html(renderJoinPage(config), 200, { 'Cache-Control': 'no-store' });
});

// SNS に貼るリンク。LIFF へ送る（準備前・止めたリンクは、ふつうの友だち追加へ）
internJoin.get('/in/:ref', async (c) => {
  const config = joinConfigFromEnv(c.env);
  const url = await resolveJoinRedirect(c.env.DB, config, c.req.param('ref')).catch(() => friendAddUrl(config));
  return c.redirect(url, 302);
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
