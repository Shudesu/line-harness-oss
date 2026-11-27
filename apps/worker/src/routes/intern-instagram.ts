// KIDOUインターンの Instagram 自動DM の受け口（Instagram からの知らせ・Meta のログインの戻り・管理画面）。
// 仕組みは services/intern-instagram.ts。Instagram アカウントは複数つなげ、ルール・記録・数字はアカウントごとに分ける
import { Hono, type Context } from 'hono';
import type { Env } from '../index.js';
import {
  buildDmMessages,
  buildLoginUrl,
  connectWithToken,
  consumeOAuthState,
  createInvite,
  createOAuthState,
  createRule,
  deleteAccount,
  deleteRule,
  exchangeCode,
  fetchRecentMedia,
  findInvite,
  findMatchingRule,
  getAccount,
  getAppSettings,
  getRule,
  handleWebhookPayload,
  listAccounts,
  listRules,
  noteWebhook,
  pickPublicReply,
  pollComments,
  publicAccount,
  publicApp,
  recentLog,
  ruleStats,
  saveAppSettings,
  setPollEnabled,
  updateRule,
  validateAppInput,
  validateRuleInput,
  verifySignature,
  type IgAccount,
} from '../services/intern-instagram.js';

const internInstagram = new Hono<Env>();

const igFetch = (url: string, init?: RequestInit) => fetch(url, init);

/** Meta の画面に登録した戻り先と同じでないとログインが通らないので、Worker 自身のアドレスで固定する */
const DEFAULT_WORKER_ORIGIN = 'https://line-harness.line-haraness.workers.dev';

function runInBackground(c: Context<Env>, work: Promise<unknown>) {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // テストなど executionCtx が無いとき
  }
}

function workerOrigin(c: Context<Env>): string {
  return (c.env.WORKER_URL || DEFAULT_WORKER_ORIGIN).replace(/\/$/, '');
}

function redirectUri(c: Context<Env>): string {
  return `${workerOrigin(c)}/ig/oauth/callback`;
}

function webhookUrl(c: Context<Env>): string {
  return `${workerOrigin(c)}/ig/webhook`;
}

// ── Instagram からの知らせ（Meta の画面に登録する URL）──────────

// 登録するときの確かめ。合言葉が合えば、送られてきた数字をそのまま返す
internInstagram.get('/ig/webhook', async (c) => {
  const mode = c.req.query('hub.mode');
  const token = c.req.query('hub.verify_token') ?? '';
  const challenge = c.req.query('hub.challenge') ?? '';
  if (mode !== 'subscribe' || !token) return c.text('forbidden', 403);
  const app = await getAppSettings(c.env.DB);
  if (token !== app.verifyToken) return c.text('forbidden', 403);
  return c.text(challenge, 200);
});

internInstagram.post('/ig/webhook', async (c) => {
  const raw = await c.req.text();
  let payload: { entry?: { id?: string }[] } | null = null;
  try {
    payload = JSON.parse(raw);
  } catch {
    return c.text('bad request', 400);
  }
  const igIds = [...new Set((payload?.entry ?? []).map((e) => String(e.id ?? '')).filter(Boolean))];
  // アプリの秘密の値で署名を確かめる。合わなければ何もしない
  const app = await getAppSettings(c.env.DB);
  if (!app.appSecret) {
    for (const igId of igIds) await noteWebhook(c.env.DB, igId, 'アプリの秘密の値が未登録のため、知らせを使っていません');
    return c.text('ok', 200);
  }
  if (!(await verifySignature(app.appSecret, raw, c.req.header('x-hub-signature-256')))) {
    for (const igId of igIds) await noteWebhook(c.env.DB, igId, '署名が合いません（アプリの秘密の値を確かめてください）');
    return c.text('forbidden', 403);
  }
  // 返事は先に返し（Meta は遅いと送り直してくる）、DM は裏で送る
  runInBackground(
    c,
    handleWebhookPayload(c.env.DB, igFetch, payload)
      .then(async (counts) => {
        const note = Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' ') || '対象なし';
        for (const igId of igIds) await noteWebhook(c.env.DB, igId, `受信 ${note}`);
      })
      .catch((err) => console.error('[intern-instagram] webhook failed', err)),
  );
  return c.text('ok', 200);
});

// ── Meta のログインからの戻り（Meta の画面に「リダイレクトURL」として登録する URL）──

function backTo(returnTo: string, params: Record<string, string>): string {
  const u = new URL(returnTo);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

internInstagram.get('/ig/oauth/callback', async (c) => {
  const state = c.req.query('state') ?? '';
  const code = c.req.query('code') ?? '';
  const saved = await consumeOAuthState(c.env.DB, state);
  // 合言葉が無い・古いときは、どこへ戻すかも分からないので文字だけ出す
  if (!saved) return c.text('このリンクは使えません。最初のリンク（または「Instagramをつなぐ」）からやり直してください。', 400);
  if (!code) {
    const reason = c.req.query('error_description') || c.req.query('error_reason') || c.req.query('error') || 'ログインが取り消されました';
    return c.redirect(backTo(saved.returnTo, { ig_error: reason.slice(0, 200) }), 302);
  }
  const app = await getAppSettings(c.env.DB);
  if (!app.appId || !app.appSecret) return c.redirect(backTo(saved.returnTo, { ig_error: 'アプリID と app secret が未登録です' }), 302);
  const token = await exchangeCode(igFetch, app, saved.redirectUri, code);
  if (!token.ok) return c.redirect(backTo(saved.returnTo, { ig_error: `鍵を受け取れませんでした：${token.error}`.slice(0, 200) }), 302);
  const r = await connectWithToken(c.env.DB, igFetch, { token: token.data.access_token, lineAccountId: saved.lineAccountId, via: 'login' });
  if (!r.ok) return c.redirect(backTo(saved.returnTo, { ig_error: r.error.slice(0, 200) }), 302);
  return c.redirect(
    backTo(saved.returnTo, {
      ig_connected: r.accounts.map((a) => a.igUserId).join(','),
      ...(r.notes.length ? { ig_note: r.notes.join(' / ').slice(0, 200) } : {}),
    }),
    302,
  );
});

// ── 運用している本人に送る「つなぐ用リンク」（ハーネスにログインしない人が開く）──

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}

function simplePage(title: string, body: string, status: 200 | 400 = 200): Response {
  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;background:#f6f7f9;margin:0;padding:24px;color:#1f2937}
.card{max-width:460px;margin:40px auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:18px;margin:0 0 12px}p{font-size:14px;line-height:1.7;margin:8px 0}ol{font-size:14px;line-height:1.8;padding-left:20px}
a.btn{display:block;text-align:center;background:#1877f2;color:#fff;text-decoration:none;border-radius:8px;padding:12px;margin-top:16px;font-weight:600}</style></head>
<body><div class="card"><h1>${escapeHtml(title)}</h1>${body}</div></body></html>`;
  return new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

const INVITE_GONE = 'このリンクは期限が切れているか、正しくありません。送ってくれた人に、新しいリンクをお願いしてください。';

// 案内の画面。ボタンを押すと Meta のログインへ
internInstagram.get('/ig/invite/:token', async (c) => {
  const inv = await findInvite(c.env.DB, c.req.param('token'));
  if (!inv) return simplePage('リンクが使えません', `<p>${INVITE_GONE}</p>`, 400);
  return simplePage(
    'Instagram の自動DMをつなぐ',
    `<p>KIDOUインターンの自動DM（コメントした人にDMを送る仕組み）に、あなたが運用している Instagram をつなぎます。</p>
<ol><li>下のボタンを押す</li><li>その Instagram を管理している Facebook アカウントでログインする</li><li>つなぐ Instagram を選んで「許可」する</li></ol>
<p>つないだあとも、パスワードがこちらに伝わることはありません。</p>
<a class="btn" href="/ig/invite/${escapeHtml(c.req.param('token'))}/start">Meta でログインしてつなぐ</a>`,
  );
});

internInstagram.get('/ig/invite/:token/start', async (c) => {
  const inv = await findInvite(c.env.DB, c.req.param('token'));
  if (!inv) return simplePage('リンクが使えません', `<p>${INVITE_GONE}</p>`, 400);
  const app = await getAppSettings(c.env.DB);
  if (!app.appId || !app.configId || !app.appSecret) return simplePage('準備中です', '<p>送ってくれた人の設定がまだ終わっていません。少し時間をおいて開き直してください。</p>', 400);
  const uri = redirectUri(c);
  const back = `${workerOrigin(c)}/ig/invite-done`;
  const state = await createOAuthState(c.env.DB, { lineAccountId: inv.lineAccountId, redirectUri: uri, returnTo: back });
  return c.redirect(buildLoginUrl(app, uri, state), 302);
});

// ログインのあとの結果
internInstagram.get('/ig/invite-done', async (c) => {
  const err = c.req.query('ig_error');
  if (err) {
    return simplePage(
      'つなげませんでした',
      `<p>${escapeHtml(err)}</p><p>もらったリンクをもう一度開くと、やり直せます。うまくいかないときは、この画面を送ってくれた人に見せてください。</p>`,
      400,
    );
  }
  const ids = (c.req.query('ig_connected') ?? '').split(',').filter(Boolean);
  const names: string[] = [];
  for (const id of ids) {
    const acc = await getAccount(c.env.DB, id);
    if (acc) names.push(acc.username ? `@${acc.username}` : id);
  }
  return simplePage(
    'つなぎました',
    `<p>${names.length ? `${names.map(escapeHtml).join('、')} をつなぎました。` : 'つなぎました。'}</p><p>この画面は閉じてかまいません。</p>`,
  );
});

// ── 管理画面 ─────────────────────────────────────────

const NOT_READY = 'KIDOUインターンの LINE が設定されていません';
const NO_ACCOUNT = 'この Instagram アカウントはつながっていません';

function lineAccountId(c: Context<Env>): string | null {
  return c.env.INTERN_SURVEY_ACCOUNT_ID || null;
}

/** 画面で選んでいる Instagram アカウント（KIDOUインターンにつないだものだけ） */
async function pickAccount(c: Context<Env>): Promise<{ acc: IgAccount } | { error: Response }> {
  const line = lineAccountId(c);
  if (!line) return { error: c.json({ success: false, error: NOT_READY }, 404) };
  const acc = await getAccount(c.env.DB, c.req.param('igId') ?? '');
  if (!acc || acc.lineAccountId !== line) return { error: c.json({ success: false, error: NO_ACCOUNT }, 404) };
  return { acc };
}

/** ルールが、KIDOUインターンにつないだアカウントのものか */
async function pickRule(c: Context<Env>) {
  const line = lineAccountId(c);
  if (!line) return { error: c.json({ success: false, error: NOT_READY }, 404) };
  const rule = await getRule(c.env.DB, c.req.param('id') ?? '');
  if (!rule || rule.lineAccountId !== line) return { error: c.json({ success: false, error: 'ルールが見つかりません' }, 404) };
  return { rule };
}

// 全体：アプリの設定・つないだアカウントの一覧・Meta に登録する URL
internInstagram.get('/api/intern/instagram', async (c) => {
  const line = lineAccountId(c);
  if (!line) return c.json({ success: false, error: NOT_READY }, 404);
  try {
    const [app, accounts] = await Promise.all([getAppSettings(c.env.DB), listAccounts(c.env.DB, line)]);
    return c.json({
      success: true,
      data: { app: publicApp(app), accounts: accounts.map(publicAccount), redirectUri: redirectUri(c), webhookUrl: webhookUrl(c) },
    });
  } catch (err) {
    console.error('GET /api/intern/instagram error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// Meta のアプリの番号・秘密の値・ログイン設定の番号を保存する（空の欄は今のまま）
internInstagram.put('/api/intern/instagram/app', async (c) => {
  if (!lineAccountId(c)) return c.json({ success: false, error: NOT_READY }, 404);
  const v = validateAppInput(await c.req.json().catch(() => null));
  if (!v.ok) return c.json({ success: false, error: v.error }, 400);
  const app = await saveAppSettings(c.env.DB, v.value);
  return c.json({ success: true, data: publicApp(app) });
});

// 「Instagramをつなぐ」：Meta のログイン画面のリンクを作る。戻ってきたら、この画面に戻す
internInstagram.post('/api/intern/instagram/login', async (c) => {
  const line = lineAccountId(c);
  if (!line) return c.json({ success: false, error: NOT_READY }, 404);
  const app = await getAppSettings(c.env.DB);
  if (!app.appId || !app.configId || !app.appSecret) {
    return c.json({ success: false, error: '先に「Meta のアプリの設定」で アプリID・app secret・設定ID を保存してください' }, 400);
  }
  const body = await c.req.json<{ returnTo?: unknown }>().catch(() => null);
  const fallback = `${new URL(c.req.url).origin}/instagram-dm`;
  let returnTo = typeof body?.returnTo === 'string' ? body.returnTo : fallback;
  // 戻し先は、今開いている画面と同じアドレスの https だけ（よそへ飛ばされないように）
  try {
    const u = new URL(returnTo);
    if (u.protocol !== 'https:' || u.origin !== new URL(c.req.url).origin) returnTo = fallback;
  } catch {
    returnTo = fallback;
  }
  const uri = redirectUri(c);
  const state = await createOAuthState(c.env.DB, { lineAccountId: line, redirectUri: uri, returnTo });
  return c.json({ success: true, data: { url: buildLoginUrl(app, uri, state) } });
});

// 運用している本人に送る「つなぐ用リンク」を作る（7日間有効）
internInstagram.post('/api/intern/instagram/invites', async (c) => {
  const line = lineAccountId(c);
  if (!line) return c.json({ success: false, error: NOT_READY }, 404);
  const app = await getAppSettings(c.env.DB);
  if (!app.appId || !app.configId || !app.appSecret) {
    return c.json({ success: false, error: '先に「Meta のアプリの設定」で アプリID・app secret・設定ID を保存してください' }, 400);
  }
  const inv = await createInvite(c.env.DB, line);
  return c.json({ success: true, data: { url: `${workerOrigin(c)}/ig/invite/${inv.token}`, expiresAt: inv.expiresAt } });
});

// 予備：Meta の画面で作った鍵を貼ってつなぐ
internInstagram.post('/api/intern/instagram/accounts', async (c) => {
  const line = lineAccountId(c);
  if (!line) return c.json({ success: false, error: NOT_READY }, 404);
  const body = await c.req.json<{ accessToken?: unknown }>().catch(() => null);
  const token = typeof body?.accessToken === 'string' ? body.accessToken.trim() : '';
  if (!token) return c.json({ success: false, error: 'アクセストークンを入れてください' }, 400);
  const r = await connectWithToken(c.env.DB, igFetch, { token, lineAccountId: line, via: 'token' });
  if (!r.ok) return c.json({ success: false, error: r.error }, 400);
  return c.json({ success: true, data: { accounts: r.accounts.map(publicAccount), notes: r.notes } });
});

// 見回りの切り替え
internInstagram.patch('/api/intern/instagram/accounts/:igId', async (c) => {
  const p = await pickAccount(c);
  if ('error' in p) return p.error;
  const body = await c.req.json<{ pollEnabled?: unknown }>().catch(() => null);
  if (typeof body?.pollEnabled !== 'boolean') return c.json({ success: false, error: '変える項目がありません' }, 400);
  await setPollEnabled(c.env.DB, p.acc.igUserId, body.pollEnabled);
  return c.json({ success: true, data: publicAccount((await getAccount(c.env.DB, p.acc.igUserId))!) });
});

// つながりを外す（ルールと記録は残す）
internInstagram.delete('/api/intern/instagram/accounts/:igId', async (c) => {
  const p = await pickAccount(c);
  if ('error' in p) return p.error;
  await deleteAccount(c.env.DB, p.acc.igUserId);
  return c.json({ success: true });
});

// 1つのアカウントのルールと数字
internInstagram.get('/api/intern/instagram/accounts/:igId/rules', async (c) => {
  const p = await pickAccount(c);
  if ('error' in p) return p.error;
  const [rules, stats] = await Promise.all([listRules(c.env.DB, p.acc.igUserId), ruleStats(c.env.DB, p.acc.igUserId)]);
  return c.json({ success: true, data: { rules, stats } });
});

internInstagram.post('/api/intern/instagram/accounts/:igId/rules', async (c) => {
  const p = await pickAccount(c);
  if ('error' in p) return p.error;
  const v = validateRuleInput(await c.req.json().catch(() => null));
  if (!v.ok) return c.json({ success: false, error: v.error }, 400);
  const rule = await createRule(c.env.DB, p.acc, v.value);
  return c.json({ success: true, data: rule }, 201);
});

// 投稿・リールの一覧（ルールの対象を選ぶ用）
internInstagram.get('/api/intern/instagram/accounts/:igId/media', async (c) => {
  const p = await pickAccount(c);
  if ('error' in p) return p.error;
  const res = await fetchRecentMedia(igFetch, p.acc, 30);
  if (!res.ok) return c.json({ success: false, error: `投稿を取れませんでした：${res.error}` }, 502);
  return c.json({ success: true, data: res.data.data });
});

// 試し：このコメントならどのルールが反応し、どんな DM になるか（実際には送らない）
internInstagram.post('/api/intern/instagram/accounts/:igId/try', async (c) => {
  const p = await pickAccount(c);
  if ('error' in p) return p.error;
  const body = await c.req.json<{ text?: unknown; mediaId?: unknown }>().catch(() => null);
  const text = typeof body?.text === 'string' ? body.text : '';
  const mediaId = typeof body?.mediaId === 'string' ? body.mediaId : '';
  const rule = findMatchingRule(await listRules(c.env.DB, p.acc.igUserId), { text, mediaId });
  if (!rule) return c.json({ success: true, data: { matched: false } });
  const { primary, fallback } = buildDmMessages(rule, 'sample_user');
  return c.json({
    success: true,
    data: { matched: true, ruleId: rule.id, ruleName: rule.name, message: primary, fallback, publicReply: pickPublicReply(rule, 'sample_user') },
  });
});

internInstagram.get('/api/intern/instagram/accounts/:igId/log', async (c) => {
  const p = await pickAccount(c);
  if ('error' in p) return p.error;
  return c.json({ success: true, data: await recentLog(c.env.DB, p.acc.igUserId, 100) });
});

// 今すぐ見回る（1分待たずに、最近のコメントを確かめる）
internInstagram.post('/api/intern/instagram/accounts/:igId/poll', async (c) => {
  const p = await pickAccount(c);
  if ('error' in p) return p.error;
  const counts = await pollComments(c.env.DB, igFetch, new Date(), p.acc.igUserId);
  return c.json({ success: true, data: counts });
});

internInstagram.put('/api/intern/instagram/rules/:id', async (c) => {
  const p = await pickRule(c);
  if ('error' in p) return p.error;
  const v = validateRuleInput(await c.req.json().catch(() => null));
  if (!v.ok) return c.json({ success: false, error: v.error }, 400);
  return c.json({ success: true, data: await updateRule(c.env.DB, p.rule!, v.value) });
});

internInstagram.delete('/api/intern/instagram/rules/:id', async (c) => {
  const p = await pickRule(c);
  if ('error' in p) return p.error;
  await deleteRule(c.env.DB, p.rule!.id);
  return c.json({ success: true });
});

export { internInstagram };
