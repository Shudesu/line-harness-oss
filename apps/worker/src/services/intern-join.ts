// KIDOUインターンの「経路リンク」（どこから友だち追加したかを数えるリンク）
//
// 流れ：/in/ki-xxxx → LIFF（LINE の中の小さな画面 /in/join）→ 本人を確かめて「この人はこの経路から来た」を記録
// → 友だち追加の画面へ。友だち追加の合図（follow）が来たときに、記録しておいた経路を友だちに付ける。
// LIFF を開いた時点ではまだ友だちでないことが多いので、友だちの記録がない人は ref_tracking に
// friend_id なし・source_url「pending:LINEのユーザーID」で控えておき、追加の合図で付け替える。
// INTERN_SURVEY_ACCOUNT_ID のアカウントでだけ動く。ほかのアカウントの動きは変えない。

import { addTagToFriend, getAccountSetting, getEntryRouteByRefCode, jstNow, recordRefTracking, setAccountSetting, toJstString } from '@line-crm/db';

export const JOIN_REF_PREFIX = 'ki-';
const JOIN_REF_RE = /^ki-[a-z0-9]{4,16}$/;
const PENDING_PREFIX = 'pending:';
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

/** 経路を数える準備ができているか（LIFF とログインのチャネルが設定済み） */
export function isJoinReady(config: JoinConfig): boolean {
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

/** /in/:ref の行き先。準備前・止めたリンク・知らない記号は、ふつうの友だち追加へ（印刷したリンクも切らさない） */
export async function resolveJoinRedirect(db: D1Database, config: JoinConfig, ref: string): Promise<string> {
  if (!isJoinReady(config) || !isJoinRef(ref)) return friendAddUrl(config);
  const route = await getEntryRouteByRefCode(db, ref);
  if (!route || !route.is_active) return friendAddUrl(config);
  return `https://liff.line.me/${config.liffId}?ref=${encodeURIComponent(ref)}`;
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
  if (!isJoinReady(config)) return 'not_ready';
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

/** 友だち追加の合図のとき。LIFF で控えておいた経路があれば、新しい友だちに付ける */
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
  if (!pending) return null;

  // 控えをこの友だちに付け替える（開いた数の記録として残す）
  await db
    .prepare('UPDATE ref_tracking SET friend_id = ? WHERE source_url = ? AND friend_id IS NULL')
    .bind(opts.friendId, pendingKey)
    .run();

  const friend = await db
    .prepare('SELECT created_at FROM friends WHERE id = ?')
    .bind(opts.friendId)
    .first<{ created_at: string }>();
  // ブロック解除で戻ってきた前からの友だちには付けない
  if (!friend || friend.created_at <= jstBefore(NEW_FRIEND_WINDOW_MS)) return null;
  const route = await getEntryRouteByRefCode(db, pending.ref_code);
  const attached = await attachRef(db, opts.friendId, pending.ref_code, route?.tag_id ?? null);
  return attached ? pending.ref_code : null;
}

// ── 管理画面の一覧 ─────────────────────────────────────────────

export interface JoinLinkStats {
  id: string;
  refCode: string;
  name: string;
  tagId: string | null;
  isActive: boolean;
  createdAt: string;
  /** リンクを開いて LINE の画面まで来た人（同じ人は1回） */
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
