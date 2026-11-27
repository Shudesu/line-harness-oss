import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import {
  buildDmMessages,
  buildLoginUrl,
  connectWithToken,
  consumeOAuthState,
  createInvite,
  createOAuthState,
  findInvite,
  createRule,
  extractComments,
  getAppSettings,
  handleComment,
  handleWebhookPayload,
  listAccounts,
  listRules,
  normalizeText,
  pollComments,
  recentLog,
  resetInstagramTablesFlag,
  ruleMatchesText,
  saveAppSettings,
  updateRule,
  upsertAccount,
  validateAppInput,
  validateRuleInput,
  verifySignature,
  type IgAccount,
  type RuleInput,
} from './intern-instagram.js';

// vite が node:sqlite を読めないため require で読む
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = InstanceType<typeof DatabaseSync>;

// node:sqlite で D1 の形だけまねる
function fakeD1(sqlite: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      sql,
      bind(...a: unknown[]) { args = a; return stmt; },
      async run() { const r = sqlite.prepare(sql).run(...(args as never[])); return { meta: { changes: Number(r.changes) } }; },
      async first<T>() { return (sqlite.prepare(sql).get(...(args as never[])) ?? null) as T | null; },
      async all<T>() { return { results: sqlite.prepare(sql).all(...(args as never[])) as T[] }; },
    };
    return stmt;
  };
  const batch = async (stmts: { run: () => Promise<unknown> }[]) => {
    for (const s of stmts) await s.run();
    return [];
  };
  return { prepare, batch } as unknown as D1Database;
}

type Call = { url: string; init?: RequestInit };
function fakeFetch(handler: (url: string, init?: RequestInit) => unknown, calls: Call[] = []) {
  return async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const out = handler(url, init);
    const status = (out as { __status?: number })?.__status ?? 200;
    return new Response(JSON.stringify(out), { status });
  };
}

const ACC = 'acc-intern';
const NOW = new Date('2026-11-27T03:00:00.000Z');
let sqlite: DatabaseSync;
let db: D1Database;
let conn: IgAccount;

const baseRule: RuleInput = {
  name: 'リール：LINE',
  isActive: true,
  mediaScope: 'all',
  mediaIds: [],
  keywords: ['LINE'],
  matchMode: 'contains',
  dmText: '{ユーザー名}さん、コメントありがとうございます！\n公式LINEはこちら',
  buttonLabel: 'LINEを開く',
  linkUrl: 'https://example.com/in/abc',
  publicReplies: ['DMを送りました！'],
};

beforeEach(async () => {
  resetInstagramTablesFlag();
  sqlite = new DatabaseSync(':memory:');
  db = fakeD1(sqlite);
  conn = await upsertAccount(db, { igUserId: 'ig-me', lineAccountId: ACC, username: 'kidou_intern', accessToken: 'tok', connectedVia: 'login' }, NOW);
});

describe('言葉の判定', () => {
  it('全角・大文字・カタカナの違いをそろえて比べる', () => {
    expect(normalizeText('ＬＩＮＥ　ください！')).toBe('lineください');
    expect(ruleMatchesText({ keywords: ['line'], matchMode: 'contains' }, 'ＬＩＮＥほしいです')).toBe(true);
    expect(ruleMatchesText({ keywords: ['ほしい'], matchMode: 'contains' }, 'ホシイ')).toBe(true);
    expect(ruleMatchesText({ keywords: ['line'], matchMode: 'exact' }, 'LINE!')).toBe(true);
    expect(ruleMatchesText({ keywords: ['line'], matchMode: 'exact' }, 'LINEください')).toBe(false);
    expect(ruleMatchesText({ keywords: [], matchMode: 'any' }, 'なんでも')).toBe(true);
  });
});

describe('ルールの入力', () => {
  it('言葉・文面が無いと保存させない', () => {
    expect(validateRuleInput({ ...baseRule, keywords: [] }).ok).toBe(false);
    expect(validateRuleInput({ ...baseRule, dmText: ' ' }).ok).toBe(false);
    expect(validateRuleInput({ ...baseRule, linkUrl: 'http://x' }).ok).toBe(false);
    expect(validateRuleInput({ ...baseRule, mediaScope: 'selected', mediaIds: [] }).ok).toBe(false);
    expect(validateRuleInput(baseRule).ok).toBe(true);
  });
});

describe('DM の中身', () => {
  it('ボタン付きと、断られたとき用の文だけの形を作る', () => {
    const { primary, fallback } = buildDmMessages(baseRule, 'taro');
    expect(JSON.stringify(primary)).toContain('taroさん');
    expect(JSON.stringify(primary)).toContain('"template_type":"button"');
    expect(fallback).toEqual({ text: 'taroさん、コメントありがとうございます！\n公式LINEはこちら\n\nhttps://example.com/in/abc' });
  });
  it('ボタンなしなら文の最後にリンクを付ける（{リンク} があればそこに置く）', () => {
    expect(buildDmMessages({ ...baseRule, buttonLabel: '' }, null).primary).toEqual({
      text: 'さん、コメントありがとうございます！\n公式LINEはこちら\n\nhttps://example.com/in/abc',
    });
    expect(buildDmMessages({ dmText: 'こちら→{リンク}', linkUrl: 'https://a.jp', buttonLabel: '' }, null).primary).toEqual({ text: 'こちら→https://a.jp' });
  });
});

describe('知らせの読み取りと署名', () => {
  it('comment_id / id のどちらの形でも読む', () => {
    const items = extractComments({
      object: 'instagram',
      entry: [{ id: 'ig-me', time: 1795734000, changes: [
        { field: 'comments', value: { comment_id: 'c1', text: 'LINE', from: { id: 'u1', username: 'a' }, media: { id: 'm1' } } },
        { field: 'comments', value: { id: 'c2', text: 'x', from: { id: 'u2' }, media: { id: 'm1' }, parent_id: 'c1' } },
        { field: 'messages', value: {} },
      ] }],
    });
    expect(items.map((i) => i.comment.commentId)).toEqual(['c1', 'c2']);
    expect(items[1].comment.parentId).toBe('c1');
  });
  it('アプリの秘密の値で作った署名だけ通す', async () => {
    const body = '{"a":1}';
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))].map((b) => b.toString(16).padStart(2, '0')).join('');
    expect(await verifySignature('secret', body, `sha256=${sig}`)).toBe(true);
    expect(await verifySignature('other', body, `sha256=${sig}`)).toBe(false);
    expect(await verifySignature('secret', body, null)).toBe(false);
  });
});

describe('コメントへの対応', () => {
  const comment = (id: string, over: Record<string, unknown> = {}) => ({
    commentId: id, mediaId: 'm1', fromId: 'u1', username: 'taro', text: 'LINEください', createdAt: NOW.toISOString(), ...over,
  });

  it('合うコメントに DM とコメント返信を送り、同じコメント・同じ人には二度送らない', async () => {
    await createRule(db, conn, baseRule, new Date(NOW.getTime() - 60_000));
    const calls: Call[] = [];
    const f = fakeFetch(() => ({ recipient_id: 'u1', message_id: 'mid' }), calls);
    expect(await handleComment(db, f, conn, comment('c1'), { now: NOW })).toBe('sent');
    expect(calls.map((c) => new URL(c.url).pathname)).toEqual(['/v24.0/ig-me/messages', '/v24.0/c1/replies']);
    expect(JSON.parse(String(calls[0].init?.body)).recipient).toEqual({ comment_id: 'c1' });
    expect(await handleComment(db, f, conn, comment('c1'), { now: NOW })).toBe('duplicate');
    expect(await handleComment(db, f, conn, comment('c2'), { now: NOW })).toBe('already_sent');
    expect(calls.length).toBe(2);
  });

  it('ボタン付きが断られたら文だけで送り直す', async () => {
    await createRule(db, conn, { ...baseRule, publicReplies: [] }, new Date(NOW.getTime() - 60_000));
    let n = 0;
    const f = fakeFetch(() => (n++ === 0 ? { __status: 400, error: { message: 'template not allowed' } } : { message_id: 'ok' }));
    expect(await handleComment(db, f, conn, comment('c1'), { now: NOW })).toBe('sent_text');
    const row = sqlite.prepare('SELECT status, detail FROM ig_dm_log').get() as { status: string; detail: string };
    expect(row.status).toBe('sent_text');
    expect(row.detail).toContain('template not allowed');
  });

  it('送れなかったら失敗として残し、コメント返信もしない', async () => {
    await createRule(db, conn, { ...baseRule, buttonLabel: '' }, new Date(NOW.getTime() - 60_000));
    const calls: Call[] = [];
    const f = fakeFetch(() => ({ __status: 400, error: { message: 'no permission' } }), calls);
    expect(await handleComment(db, f, conn, comment('c1'), { now: NOW })).toBe('failed');
    expect(calls.length).toBe(1);
  });

  it('自分のコメント・返信・合わないコメント・動かす前のコメントには送らない', async () => {
    await createRule(db, conn, baseRule, NOW);
    const f = fakeFetch(() => ({}));
    expect(await handleComment(db, f, conn, comment('c1', { fromId: 'ig-me' }), { now: NOW })).toBe('own');
    expect(await handleComment(db, f, conn, comment('c2', { parentId: 'c0' }), { now: NOW })).toBe('reply');
    expect(await handleComment(db, f, conn, comment('c3', { text: 'かわいい' }), { now: NOW })).toBe('no_match');
    expect(await handleComment(db, f, conn, comment('c4', { createdAt: new Date(NOW.getTime() - 3600_000).toISOString() }), { now: NOW })).toBe('too_old');
  });

  it('止めているルール・対象外の投稿には反応しない', async () => {
    const r = await createRule(db, conn, { ...baseRule, mediaScope: 'selected', mediaIds: ['m9'] }, new Date(NOW.getTime() - 60_000));
    const f = fakeFetch(() => ({}));
    expect(await handleComment(db, f, conn, comment('c1'), { now: NOW })).toBe('no_match');
    await updateRule(db, r, { ...baseRule, isActive: false }, NOW);
    expect(await handleComment(db, f, conn, comment('c2'), { now: NOW })).toBe('no_match');
  });

  it('知らせ1回分をまとめて処理する（知らないアカウントは飛ばす）', async () => {
    await createRule(db, conn, baseRule, new Date(NOW.getTime() - 60_000));
    const f = fakeFetch(() => ({ message_id: 'ok' }));
    const counts = await handleWebhookPayload(db, f, {
      entry: [
        { id: 'ig-me', changes: [{ field: 'comments', value: { id: 'c1', text: 'line', from: { id: 'u1', username: 'a' }, media: { id: 'm1' } } }] },
        { id: 'ig-other', changes: [{ field: 'comments', value: { id: 'c2', text: 'line', from: { id: 'u2' }, media: { id: 'm1' } } }] },
      ],
    }, NOW);
    expect(counts).toEqual({ sent: 1, unknown_account: 1 });
  });
});

describe('見回り', () => {
  it('最近の投稿のコメントを見て、まだのものにだけ送る', async () => {
    await createRule(db, conn, { ...baseRule, publicReplies: [] }, new Date(NOW.getTime() - 3600_000));
    const sent: string[] = [];
    const f = fakeFetch((url, init) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/ig-me/media')) return { data: [{ id: 'm1' }] };
      if (u.pathname.endsWith('/m1/comments')) return { data: [
        { id: 'c1', text: 'LINE', timestamp: NOW.toISOString(), from: { id: 'u1', username: 'a' } },
        { id: 'c2', text: 'すてき', timestamp: NOW.toISOString(), from: { id: 'u2', username: 'b' } },
      ] };
      if (init?.method === 'POST') sent.push(JSON.parse(String(init.body)).recipient.comment_id);
      return { message_id: 'ok' };
    });
    expect(await pollComments(db, f, NOW)).toEqual({ sent: 1, no_match: 1 });
    expect(await pollComments(db, f, NOW)).toEqual({ no_match: 1 });
    expect(sent).toEqual(['c1']);
  });

  it('知らせが最近届いていれば見回りは休む', async () => {
    await createRule(db, conn, baseRule, NOW);
    sqlite.prepare('UPDATE ig_accounts SET last_webhook_at = ?').run(new Date(NOW.getTime() - 60_000).toISOString());
    const calls: Call[] = [];
    expect(await pollComments(db, fakeFetch(() => ({ data: [] }), calls), NOW)).toEqual({});
    expect(calls.length).toBe(0);
  });
});

describe('複数のアカウント', () => {
  const comment = (id: string) => ({ commentId: id, mediaId: 'm1', fromId: 'u1', username: 'taro', text: 'LINEください', createdAt: NOW.toISOString() });

  it('ルール・記録はアカウントごとに分かれ、ほかのアカウントのルールでは送らない', async () => {
    const other = await upsertAccount(db, { igUserId: 'ig-2', lineAccountId: ACC, username: 'second', accessToken: 'tok2', connectedVia: 'login' }, NOW);
    await createRule(db, conn, baseRule, new Date(NOW.getTime() - 60_000));
    const calls: Call[] = [];
    const f = fakeFetch(() => ({ message_id: 'ok' }), calls);
    expect(await handleComment(db, f, other, comment('c1'), { now: NOW })).toBe('no_match');
    expect(await handleComment(db, f, conn, comment('c2'), { now: NOW })).toBe('sent');
    expect(String(calls[0].init?.headers && (calls[0].init.headers as Record<string, string>).Authorization)).toBe('Bearer tok');
    expect((await listRules(db, 'ig-2')).length).toBe(0);
    expect((await recentLog(db, 'ig-me')).map((r) => r.commentId)).toEqual(['c2']);
    expect(await recentLog(db, 'ig-2')).toEqual([]);
  });

  it('知らせはアカウントの番号で振り分け、それぞれの鍵で送る', async () => {
    const other = await upsertAccount(db, { igUserId: 'ig-2', lineAccountId: ACC, username: 'second', accessToken: 'tok2', connectedVia: 'login' }, NOW);
    await createRule(db, conn, baseRule, new Date(NOW.getTime() - 60_000));
    await createRule(db, other, { ...baseRule, publicReplies: [] }, new Date(NOW.getTime() - 60_000));
    const calls: Call[] = [];
    const f = fakeFetch(() => ({ message_id: 'ok' }), calls);
    const counts = await handleWebhookPayload(db, f, {
      entry: [{ id: 'ig-2', changes: [{ field: 'comments', value: { id: 'c9', text: 'line', from: { id: 'u5' }, media: { id: 'm1' } } }] }],
    }, NOW);
    expect(counts).toEqual({ sent: 1 });
    expect(new URL(calls[0].url).pathname).toBe('/v24.0/ig-2/messages');
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer tok2');
  });
});

describe('つなぎ方', () => {
  it('鍵で使えるアカウントをすべて保存し、それぞれ知らせを申し込む（つなぎ直しでもルールは残る）', async () => {
    await createRule(db, conn, baseRule, NOW);
    const calls: Call[] = [];
    const f = fakeFetch((url) => {
      const u = new URL(url);
      if (u.pathname === '/v24.0/me/assigned_instagram_accounts') return { data: [{ id: 'ig-me', username: 'kidou_new' }, { id: 'ig-2', username: 'second' }] };
      return { success: true };
    }, calls);
    const r = await connectWithToken(db, f, { token: 'eaa', lineAccountId: ACC, via: 'login' }, NOW);
    expect(r.ok).toBe(true);
    const accs = await listAccounts(db, ACC);
    expect(accs.map((a) => [a.igUserId, a.username, a.accessToken]).sort()).toEqual([['ig-2', 'second', 'eaa'], ['ig-me', 'kidou_new', 'eaa']]);
    expect(new URL(calls[0].url).origin).toBe('https://graph.facebook.com');
    expect(calls.filter((c) => c.init?.method === 'POST').map((c) => new URL(c.url).pathname).sort()).toEqual(['/v24.0/ig-2/subscribed_apps', '/v24.0/ig-me/subscribed_apps']);
    expect((await listRules(db, 'ig-me')).length).toBe(1);
  });

  it('使えるアカウントが無い鍵・確かめられない鍵ではつながない', async () => {
    expect((await connectWithToken(db, fakeFetch(() => ({ data: [] })), { token: 'x', lineAccountId: ACC, via: 'token' }, NOW)).ok).toBe(false);
    const r = await connectWithToken(db, fakeFetch(() => ({ __status: 400, error: { message: 'Invalid OAuth access token' } })), { token: 'x', lineAccountId: ACC, via: 'token' }, NOW);
    expect(r.ok).toBe(false);
  });

  it('ログインの合言葉は1回だけ・15分まで使える', async () => {
    const s1 = await createOAuthState(db, { lineAccountId: ACC, redirectUri: 'https://w.dev/ig/oauth/callback', returnTo: 'https://h.jp/instagram-dm' }, NOW);
    expect(await consumeOAuthState(db, s1, new Date(NOW.getTime() + 60_000))).toEqual({
      lineAccountId: ACC, redirectUri: 'https://w.dev/ig/oauth/callback', returnTo: 'https://h.jp/instagram-dm',
    });
    expect(await consumeOAuthState(db, s1, NOW)).toBeNull();
    const s2 = await createOAuthState(db, { lineAccountId: ACC, redirectUri: 'r', returnTo: 'https://h.jp' }, NOW);
    expect(await consumeOAuthState(db, s2, new Date(NOW.getTime() + 16 * 60_000))).toBeNull();
    expect(await consumeOAuthState(db, 'nope', NOW)).toBeNull();
  });

  it('本人に送るリンクは7日間・何度でも使え、期限切れや知らない値は使えない', async () => {
    const inv = await createInvite(db, ACC, NOW);
    expect(inv.token).toMatch(/^[0-9a-f]{48}$/);
    expect(await findInvite(db, inv.token, new Date(NOW.getTime() + 60_000))).toEqual({ lineAccountId: ACC });
    expect(await findInvite(db, inv.token, new Date(NOW.getTime() + 6 * 24 * 60 * 60_000))).toEqual({ lineAccountId: ACC });
    expect(await findInvite(db, inv.token, new Date(NOW.getTime() + 8 * 24 * 60 * 60_000))).toBeNull();
    expect(await findInvite(db, 'nope', NOW)).toBeNull();
  });

  it('ログイン画面のリンクに アプリ・設定・戻り先・合言葉が入る', () => {
    const u = new URL(buildLoginUrl({ appId: '123', configId: '456' }, 'https://w.dev/ig/oauth/callback', 'st'));
    expect(u.origin + u.pathname).toBe('https://www.facebook.com/dialog/oauth');
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: '123', config_id: '456', redirect_uri: 'https://w.dev/ig/oauth/callback', response_type: 'code', state: 'st', prompt: 'login',
    });
  });

  it('アプリの設定は確認トークンを自動で決め、空の欄は今のまま残す', async () => {
    const first = await getAppSettings(db);
    expect(first.verifyToken).toMatch(/^kidou_ig_/);
    await saveAppSettings(db, { appId: '111', appSecret: 'abcdef0123456789', configId: '222' }, NOW);
    const next = await saveAppSettings(db, { configId: '333' }, NOW);
    expect([next.appId, next.appSecret, next.configId, next.verifyToken]).toEqual(['111', 'abcdef0123456789', '333', first.verifyToken]);
    expect(validateAppInput({ appId: '12a' }).ok).toBe(false);
    expect(validateAppInput({ appSecret: 'short' }).ok).toBe(false);
    expect(validateAppInput({ appId: ' 1234567890 ', appSecret: '' }).ok).toBe(true);
  });
});
