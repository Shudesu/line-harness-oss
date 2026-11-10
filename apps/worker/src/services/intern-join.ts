// KIDOUインターンの「経路リンク」（どこから友だち追加したかを数えるリンク）
//
// 流れ（11/10〜）：/in/ki-xxxx を押したら「この経路が押された」を時刻つきで ref_tracking に記録し
// （friend_id なし・source_url「tap:ブラウザごとの番号」）、そのまま友だち追加の画面へ送る。
// LINE ログイン（「許可する」画面）は挟まない。挟むと押した人が途中でやめてしまうため。
// 友だち追加の合図（follow）が来たら、直前 TAP_MATCH_WINDOW_MS 以内に押された、まだ誰にも付いていない
// いちばん新しい記録の経路をその人に付ける（本人は確かめられないので、時刻の近さでの推定）。
//
// 11/10 までは LIFF（/in/join）で本人を確かめて source_url「pending:LINEのユーザーID」で控えていた。
// その途中の人のために、合図のときは先に pending の控えを探す。
// INTERN_SURVEY_ACCOUNT_ID のアカウントでだけ動く。ほかのアカウントの動きは変えない。

import { addTagToFriend, getAccountSetting, getEntryRouteByRefCode, jstNow, recordRefTracking, setAccountSetting, toJstString } from '@line-crm/db';

export const JOIN_REF_PREFIX = 'ki-';
const JOIN_REF_RE = /^ki-[a-z0-9]{4,16}$/;
const PENDING_PREFIX = 'pending:';
const TAP_PREFIX = 'tap:';
const TAP_ID_RE = /^[a-z0-9]{16}$/;
/** 押した番号を覚えておくクッキー（同じブラウザで押し直した人を1人と数える） */
export const TAP_COOKIE = 'ki_tap';
export const TAP_COOKIE_MAX_AGE_SEC = 30 * 24 * 3600;
// 押してから友だち追加までをこの時間まで待つ（これより前に押された記録は付けない）
const TAP_MATCH_WINDOW_MS = 5 * 60 * 1000;
// リンクの下見に来るだけのロボット（SNS のプレビュー作り等）は押した数に入れない
const BOT_UA_RE = /bot|crawl|spider|preview|facebookexternalhit|facebot|line-poker|slack|discord|whatsapp|telegram|embedly|curl|wget|python|headless/i;
const DEFAULT_BOT_BASIC_ID = '@899hdfxg';
// この時間より前に友だちになっていた人には、経路を付けない（前からの友だちを数えない）
const NEW_FRIEND_WINDOW_MS = 30 * 60 * 1000;
// LIFF を開いてから友だち追加までの待ち時間の上限
const PENDING_WINDOW_MS = 24 * 3600 * 1000;
// 同じ人が同じリンクを開き直したときに、開いた数を二重に数えない
const REOPEN_WINDOW_MS = 10 * 60 * 1000;
// 管理画面で並べ替えた経路リンクの順番（entry_routes の id の並び）を置く account_settings のキー
export const JOIN_ORDER_KEY = 'intern_join_order';

export interface JoinConfig {
  accountId?: string;
  liffId?: string;
  loginChannelId?: string;
  botBasicId: string;
}

export function joinConfigFromEnv(env: {
  INTERN_SURVEY_ACCOUNT_ID?: string;
  INTERN_JOIN_LIFF_ID?: string;
  INTERN_JOIN_LOGIN_CHANNEL_ID?: string;
  INTERN_BOT_BASIC_ID?: string;
}): JoinConfig {
  return {
    accountId: env.INTERN_SURVEY_ACCOUNT_ID,
    liffId: env.INTERN_JOIN_LIFF_ID,
    loginChannelId: env.INTERN_JOIN_LOGIN_CHANNEL_ID,
    botBasicId: env.INTERN_BOT_BASIC_ID || DEFAULT_BOT_BASIC_ID,
  };
}

export function isJoinRef(ref: string | null | undefined): ref is string {
  return !!ref && JOIN_REF_RE.test(ref);
}

/** 経路を数える準備ができているか（KIDOUインターンのアカウントが設定済み） */
export function isJoinReady(config: JoinConfig): boolean {
  return !!config.accountId;
}

/** 11/10 までの LIFF の受け口が使えるか（LIFF とログインのチャネルが設定済み） */
function isLiffReady(config: JoinConfig): boolean {
  return !!(config.accountId && config.liffId && config.loginChannelId);
}

export function friendAddUrl(config: JoinConfig): string {
  return `https://line.me/R/ti/p/${encodeURIComponent(config.botBasicId)}`;
}

/** 新しい経路の記号（ki- ＋英小文字と数字8けた） */
export function newJoinRef(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return JOIN_REF_PREFIX + Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

function jstBefore(ms: number, now: Date = new Date()): string {
  return toJstString(new Date(now.getTime() - ms));
}

export function isTapId(v: string | null | undefined): v is string {
  return !!v && TAP_ID_RE.test(v);
}

export function newTapId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

export function isBotUserAgent(ua: string | null | undefined): boolean {
  return !ua || BOT_UA_RE.test(ua);
}

/**
 * /in/:ref が押されたとき。動いている経路なら「押された」を記録する（行き先はいつも友だち追加の画面）。
 * 準備前・止めたリンク・知らない記号・ロボットは記録しない。記録したら true
 */
export async function recordJoinTap(
  db: D1Database,
  config: JoinConfig,
  opts: { ref: string; tapId: string; userAgent?: string | null },
): Promise<boolean> {
  if (!isJoinReady(config) || !isJoinRef(opts.ref) || !isTapId(opts.tapId)) return false;
  if (isBotUserAgent(opts.userAgent)) return false;
  const route = await getEntryRouteByRefCode(db, opts.ref);
  if (!route || !route.is_active) return false;
  await recordRefTracking(db, {
    refCode: opts.ref,
    friendId: null,
    entryRouteId: route.id,
    sourceUrl: TAP_PREFIX + opts.tapId,
    userAgent: opts.userAgent?.slice(0, 500) ?? null,
  });
  return true;
}

async function verifyIdToken(idToken: string, channelId: string): Promise<string | null> {
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: channelId }),
  });
  if (!res.ok) return null;
  const data = await res.json<{ sub?: string }>();
  return data.sub && /^U[0-9a-f]{32}$/.test(data.sub) ? data.sub : null;
}

/** 経路を友だちに付ける（まだ経路のない友だちだけ。付けたら経路の印のタグも付ける） */
async function attachRef(db: D1Database, friendId: string, ref: string, tagId: string | null): Promise<boolean> {
  const res = await db
    .prepare("UPDATE friends SET ref_code = ?, updated_at = ? WHERE id = ? AND (ref_code IS NULL OR ref_code = '')")
    .bind(ref, jstNow(), friendId)
    .run();
  const attached = (res.meta?.changes ?? 0) > 0;
  if (attached && tagId) {
    await addTagToFriend(db, friendId, tagId).catch((err: unknown) => {
      console.error('[intern-join] tag attach failed', err);
    });
  }
  return attached;
}

export type JoinResult = 'ok' | 'invalid' | 'not_ready' | 'unauthorized';

/** LIFF の画面から呼ばれる。本人を確かめて「この経路から開いた」を記録する */
export async function recordJoinOpen(
  db: D1Database,
  config: JoinConfig,
  opts: { idToken: string; ref: string; userAgent?: string | null },
  verify: (idToken: string, channelId: string) => Promise<string | null> = verifyIdToken,
): Promise<JoinResult> {
  if (!isLiffReady(config)) return 'not_ready';
  if (!isJoinRef(opts.ref) || !opts.idToken) return 'invalid';
  const route = await getEntryRouteByRefCode(db, opts.ref);
  if (!route || !route.is_active) return 'invalid';
  const lineUserId = await verify(opts.idToken, config.loginChannelId!);
  if (!lineUserId) return 'unauthorized';

  const friend = await db
    .prepare('SELECT id, created_at FROM friends WHERE line_user_id = ? AND line_account_id = ?')
    .bind(lineUserId, config.accountId)
    .first<{ id: string; created_at: string }>();
  const pendingKey = PENDING_PREFIX + lineUserId;

  // 開き直しは数えない
  const recent = await db
    .prepare(
      `SELECT id FROM ref_tracking WHERE ref_code = ? AND created_at > ?
         AND (source_url = ? OR (? IS NOT NULL AND friend_id = ?)) LIMIT 1`,
    )
    .bind(opts.ref, jstBefore(REOPEN_WINDOW_MS), pendingKey, friend?.id ?? null, friend?.id ?? null)
    .first<{ id: string }>();

  if (friend) {
    if (!recent) {
      await recordRefTracking(db, { refCode: opts.ref, friendId: friend.id, entryRouteId: route.id, sourceUrl: pendingKey, userAgent: opts.userAgent ?? null });
    }
    // LINE ログインの画面で一緒に友だち追加した人は、ここより先に追加の合図が届いていることがある。
    // 今さっき友だちになった人だけ経路を付ける（前からの友だちが開いても、その経路の人数には入れない）
    if (friend.created_at > jstBefore(NEW_FRIEND_WINDOW_MS)) {
      await attachRef(db, friend.id, opts.ref, route.tag_id);
    }
    return 'ok';
  }

  if (!recent) {
    await recordRefTracking(db, { refCode: opts.ref, friendId: null, entryRouteId: route.id, sourceUrl: pendingKey, userAgent: opts.userAgent ?? null });
  }
  return 'ok';
}

/** 友だち追加の合図のとき。控えておいた経路（LIFF の控え、なければ直前に押された記録）を新しい友だちに付ける */
export async function attachPendingJoinRef(
  db: D1Database,
  accountId: string | undefined,
  opts: { friendId: string; lineUserId: string; lineAccountId: string | null },
): Promise<string | null> {
  if (!accountId || opts.lineAccountId !== accountId) return null;
  const pendingKey = PENDING_PREFIX + opts.lineUserId;
  const pending = await db
    .prepare(
      `SELECT ref_code FROM ref_tracking WHERE source_url = ? AND friend_id IS NULL AND created_at > ?
       ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(pendingKey, jstBefore(PENDING_WINDOW_MS))
    .first<{ ref_code: string }>();

  const friend = await db
    .prepare('SELECT created_at FROM friends WHERE id = ?')
    .bind(opts.friendId)
    .first<{ created_at: string }>();
  // ブロック解除で戻ってきた前からの友だちには付けない
  const isNewFriend = !!friend && friend.created_at > jstBefore(NEW_FRIEND_WINDOW_MS);

  let ref: string;
  if (pending) {
    ref = pending.ref_code;
    // 控えをこの友だちに付け替える（開いた数の記録として残す）
    await db
      .prepare('UPDATE ref_tracking SET friend_id = ? WHERE source_url = ? AND friend_id IS NULL')
      .bind(opts.friendId, pendingKey)
      .run();
  } else {
    // 押した記録は本人を確かめられないので、前からの友だちには使わない
    // （押さずにブロック解除しただけの人が、直前に押した新しい人の記録を取らないように）
    if (!isNewFriend) return null;
    const tapRef = await claimRecentTap(db, opts.friendId);
    if (!tapRef) return null;
    ref = tapRef;
  }

  if (!isNewFriend) return null;
  const route = await getEntryRouteByRefCode(db, ref);
  const attached = await attachRef(db, opts.friendId, ref, route?.tag_id ?? null);
  return attached ? ref : null;
}

/**
 * 直前に押された、まだ誰にも付いていないいちばん新しい記録をこの友だちのものにする。
 * 古い順でなく新しい順にするのは、押しただけで追加しなかった人の記録を後の人に付けにくくするため。
 * 同じブラウザで押した記録（同じ tap: の番号・クッキーの有効期間内）もまとめて付ける。ほかの合図と取り合ったら次を探す
 */
async function claimRecentTap(db: D1Database, friendId: string): Promise<string | null> {
  const since = jstBefore(TAP_MATCH_WINDOW_MS);
  for (let attempt = 0; attempt < 3; attempt++) {
    const tap = await db
      .prepare(
        `SELECT id, ref_code, source_url FROM ref_tracking
         WHERE source_url LIKE 'tap:%' AND ref_code LIKE 'ki-%' AND friend_id IS NULL AND created_at > ?
         ORDER BY created_at DESC LIMIT 1`,
      )
      .bind(since)
      .first<{ id: string; ref_code: string; source_url: string }>();
    if (!tap) return null;
    const res = await db
      .prepare('UPDATE ref_tracking SET friend_id = ? WHERE id = ? AND friend_id IS NULL')
      .bind(friendId, tap.id)
      .run();
    if ((res.meta?.changes ?? 0) === 0) continue;
    await db
      .prepare('UPDATE ref_tracking SET friend_id = ? WHERE source_url = ? AND friend_id IS NULL AND created_at > ?')
      .bind(friendId, tap.source_url, jstBefore(TAP_COOKIE_MAX_AGE_SEC * 1000))
      .run();
    return tap.ref_code;
  }
  return null;
}

// ── 管理画面の一覧 ─────────────────────────────────────────────

export interface JoinLinkStats {
  id: string;
  refCode: string;
  name: string;
  tagId: string | null;
  isActive: boolean;
  createdAt: string;
  /** リンクを押した人（同じ人・同じブラウザは1回。11/10 までは LINE の許可画面まで進んだ人） */
  openedCount: number;
  /** このリンクから友だちになった人 */
  friendCount: number;
  /** そのうち今も友だちの人（ブロックしていない） */
  followingCount: number;
  /** アンケートを最後まで答えた人 */
  surveyDoneCount: number;
  latestFriendAt: string | null;
}

export async function listJoinLinks(db: D1Database, accountId: string): Promise<{
  links: JoinLinkStats[];
  totalFriends: number;
  friendsWithoutLink: number;
}> {
  const rows = await db
    .prepare(
      `SELECT er.id, er.ref_code, er.name, er.tag_id, er.is_active, er.created_at,
         (SELECT COUNT(DISTINCT COALESCE(rt.friend_id, rt.source_url)) FROM ref_tracking rt WHERE rt.ref_code = er.ref_code) AS opened_count,
         (SELECT COUNT(*) FROM friends f WHERE f.ref_code = er.ref_code AND f.line_account_id = ?) AS friend_count,
         (SELECT COUNT(*) FROM friends f WHERE f.ref_code = er.ref_code AND f.line_account_id = ? AND f.is_following = 1) AS following_count,
         (SELECT COUNT(*) FROM friends f WHERE f.ref_code = er.ref_code AND f.line_account_id = ? AND json_extract(f.metadata, '$.survey_step') = 'done') AS survey_done_count,
         (SELECT MAX(f.created_at) FROM friends f WHERE f.ref_code = er.ref_code AND f.line_account_id = ?) AS latest_friend_at
       FROM entry_routes er
       WHERE er.ref_code LIKE 'ki-%'
       ORDER BY er.created_at DESC`,
    )
    .bind(accountId, accountId, accountId, accountId)
    .all<{
      id: string; ref_code: string; name: string; tag_id: string | null; is_active: number; created_at: string;
      opened_count: number; friend_count: number; following_count: number; survey_done_count: number; latest_friend_at: string | null;
    }>();
  const totals = await db
    .prepare(
      `SELECT COUNT(*) AS total,
         SUM(CASE WHEN ref_code IS NULL OR ref_code NOT LIKE 'ki-%' THEN 1 ELSE 0 END) AS without_link
       FROM friends WHERE line_account_id = ?`,
    )
    .bind(accountId)
    .first<{ total: number; without_link: number | null }>();
  const order = await getJoinOrder(db, accountId);
  const rank = new Map(order.map((id, i) => [id, i]));
  // 並べ替えたあとに作ったリンク（順番の控えにないもの）は、今までどおり新しい順で上に出す
  const sorted = [...(rows.results ?? [])].sort((a, b) => {
    const ra = rank.get(a.id);
    const rb = rank.get(b.id);
    if (ra === undefined && rb === undefined) return 0;
    if (ra === undefined) return -1;
    if (rb === undefined) return 1;
    return ra - rb;
  });
  return {
    links: sorted.map((r) => ({
      id: r.id,
      refCode: r.ref_code,
      name: r.name,
      tagId: r.tag_id,
      isActive: !!r.is_active,
      createdAt: r.created_at,
      openedCount: r.opened_count ?? 0,
      friendCount: r.friend_count ?? 0,
      followingCount: r.following_count ?? 0,
      surveyDoneCount: r.survey_done_count ?? 0,
      latestFriendAt: r.latest_friend_at,
    })),
    totalFriends: totals?.total ?? 0,
    friendsWithoutLink: totals?.without_link ?? 0,
  };
}

// ── LIFF の画面 ─────────────────────────────────────────────

export function renderJoinPage(config: JoinConfig): string {
  const liffId = JSON.stringify(config.liffId ?? '');
  const addUrl = JSON.stringify(friendAddUrl(config));
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>KIDOUインターン</title>
<style>
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans",sans-serif;background:#f6f1e7;color:#3a3a3a;display:flex;min-height:100vh;align-items:center;justify-content:center}
.box{text-align:center;padding:24px}
p{font-size:15px;line-height:1.7;margin:0 0 20px}
a{display:none;background:#06c755;color:#fff;text-decoration:none;font-weight:bold;padding:14px 28px;border-radius:999px}
</style>
<script charset="utf-8" src="https://static.line-scdn.net/liff/edge/2/sdk.js"></script>
</head><body><div class="box"><p id="msg">LINEを開いています。</p><a id="btn">友だち追加する</a></div>
<script>
(function(){
  var LIFF_ID=${liffId}, ADD_URL=${addUrl};
  var btn=document.getElementById('btn'); btn.href=ADD_URL;
  function go(){ btn.style.display='inline-block'; window.location.replace(ADD_URL); }
  function showButton(){ document.getElementById('msg').textContent='下のボタンから友だち追加してください。'; btn.style.display='inline-block'; }
  var params=new URLSearchParams(window.location.search); var ref=params.get('ref')||'';
  if(!window.liff||!LIFF_ID){ go(); return; }
  setTimeout(showButton, 6000);
  liff.init({liffId:LIFF_ID}).then(function(){
    if(!liff.isLoggedIn()){ liff.login({redirectUri:window.location.href}); return; }
    var idToken=liff.getIDToken();
    var send=(idToken&&ref)?fetch('/api/intern/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:idToken,ref:ref})}).catch(function(){}):Promise.resolve();
    var timeout=new Promise(function(r){setTimeout(r,3000)});
    Promise.race([send,timeout]).then(go);
  }).catch(go);
})();
</script></body></html>`;
}

async function getJoinOrder(db: D1Database, accountId: string): Promise<string[]> {
  // 読めなくても一覧は新しい順で出す
  const raw = await getAccountSetting(db, accountId, JOIN_ORDER_KEY).catch((err) => {
    console.error('getJoinOrder error:', err);
    return null;
  });
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// 経路リンクの並び順を保存する。経路リンク（ki-）でない id・重複は捨てる
export async function saveJoinOrder(db: D1Database, accountId: string, ids: string[]): Promise<void> {
  const rows = await db
    .prepare(`SELECT id FROM entry_routes WHERE ref_code LIKE 'ki-%'`)
    .all<{ id: string }>();
  const known = new Set((rows.results ?? []).map((r) => r.id));
  const order = [...new Set(ids)].filter((id) => known.has(id));
  await setAccountSetting(db, accountId, JOIN_ORDER_KEY, JSON.stringify(order));
}
