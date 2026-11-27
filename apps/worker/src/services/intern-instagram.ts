// KIDOUインターンの Instagram 自動DM（iステップのような「コメントした人に DM を送る」仕組み）。
//
// 流れ：リール・投稿に決めた言葉のコメントが付く → Instagram の知らせ（Webhook）がハーネスに届く
//       → 合うルールを探す → コメントした人に DM（Instagram の「非公開の返信」）を1通送る → 記録を残す。
// 知らせは Meta の審査を通ってアプリを公開するまで届かないため、1分ごとに最近の投稿のコメントも見に行く（同じコメントには二度送らない）。
//
// 使うのは Meta の無料の API だけ（Instagram API with Unified login）。お金のかかる外部サービスは使わない。
// Instagram アカウントは複数つなげる。ルール・記録・数字はアカウントごとに分け、案内先はどれも KIDOUインターンの公式LINE。
// つなぎ方：ハーネスの画面の「Instagramをつなぐ」→ Meta のログイン画面 → 戻り先（/ig/oauth/callback）で鍵を受け取る。
//           鍵は「システムユーザーの鍵」で期限がない（延長の仕組みはいらない）。
// 置き場はハーネスの DB。表は使うときに無ければ作る（D1 の移行を待たずに動かすため）。
//   ig_app_settings … Meta のアプリの番号・秘密の値・ログイン設定の番号（アプリは1つ）
//   ig_accounts     … つないだ Instagram アカウント（鍵は画面に返さない）
//   ig_oauth_states … ログインの途中の合言葉（なりすまし防止・15分で無効）
//   ig_invites      … 運用している本人に送る「つなぐ用リンク」（7日で無効・期限内は何度でも使える）
//   ig_dm_rules     … ルール（どのアカウントの・どの投稿の・どの言葉に・何を送るか）
//   ig_dm_log       … 受け取ったコメントと、送った結果（同じコメントに二度送らないための覚えも兼ねる）
// ※ 1つのアカウントしかつなげなかった最初の版の表（ig_connections / ig_rules / ig_comment_log）は使わない（中身は空）

export const IG_GRAPH = 'https://graph.facebook.com';
export const IG_API_VERSION = 'v24.0'; // 2028-02 まで使える版
export const FB_LOGIN_DIALOG = 'https://www.facebook.com/dialog/oauth';

/** DM を送れるのはコメントから7日以内（Instagram の決まり）。少し余裕を見て6日半までにする */
export const PRIVATE_REPLY_WINDOW_MS = 6.5 * 24 * 60 * 60_000;
/** ログインの途中の合言葉が使える時間 */
const OAUTH_STATE_TTL_MS = 15 * 60_000;
/** 本人に送る「つなぐ用リンク」が使える時間 */
export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
/** 見回りで見る投稿の数（新しい順） */
const POLL_MEDIA_LIMIT = 5;

// ── 型 ─────────────────────────────────────────────

export interface IgAppSettings {
  appId: string;
  appSecret: string;
  configId: string;
  verifyToken: string;
  updatedAt: string;
}

export interface IgAccount {
  igUserId: string;
  lineAccountId: string;
  username: string;
  accessToken: string;
  pollEnabled: boolean;
  lastPolledAt: string | null;
  lastWebhookAt?: string | null;
  lastWebhookNote?: string | null;
  connectedVia: 'login' | 'token';
  connectedAt: string;
  updatedAt: string;
}

export type MatchMode = 'contains' | 'exact' | 'any';
export type MediaScope = 'all' | 'selected';

export interface IgRule {
  id: string;
  igUserId: string;
  lineAccountId: string;
  name: string;
  isActive: boolean;
  mediaScope: MediaScope;
  mediaIds: string[];
  keywords: string[];
  matchMode: MatchMode;
  dmText: string;
  buttonLabel: string;
  linkUrl: string;
  publicReplies: string[];
  sortOrder: number;
  activatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface IncomingComment {
  commentId: string;
  mediaId: string;
  mediaProductType?: string | null;
  fromId: string | null;
  username: string | null;
  text: string;
  parentId?: string | null;
  /** コメントの日時（ISO）。分からなければ受け取った時刻 */
  createdAt?: string | null;
}

/** Instagram に問い合わせる部分（テストでは差し替える） */
export type IgFetch = (url: string, init?: RequestInit) => Promise<Response>;

// ── 表 ─────────────────────────────────────────────

let tablesReady = false;

export function resetInstagramTablesFlag(): void {
  tablesReady = false;
}

export async function ensureInstagramTables(db: D1Database): Promise<void> {
  if (tablesReady) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS ig_app_settings (
        id TEXT PRIMARY KEY,
        app_id TEXT NOT NULL DEFAULT '',
        app_secret TEXT NOT NULL DEFAULT '',
        config_id TEXT NOT NULL DEFAULT '',
        verify_token TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS ig_accounts (
        ig_user_id TEXT PRIMARY KEY,
        line_account_id TEXT NOT NULL,
        username TEXT NOT NULL DEFAULT '',
        access_token TEXT NOT NULL,
        poll_enabled INTEGER NOT NULL DEFAULT 1,
        last_polled_at TEXT,
        last_webhook_at TEXT,
        last_webhook_note TEXT,
        connected_via TEXT NOT NULL DEFAULT 'login',
        connected_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS ig_oauth_states (
        state TEXT PRIMARY KEY,
        line_account_id TEXT NOT NULL,
        redirect_uri TEXT NOT NULL,
        return_to TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS ig_invites (
        token TEXT PRIMARY KEY,
        line_account_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS ig_dm_rules (
        id TEXT PRIMARY KEY,
        ig_user_id TEXT NOT NULL,
        line_account_id TEXT NOT NULL,
        name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 0,
        media_scope TEXT NOT NULL DEFAULT 'all',
        media_ids TEXT NOT NULL DEFAULT '[]',
        keywords TEXT NOT NULL DEFAULT '[]',
        match_mode TEXT NOT NULL DEFAULT 'contains',
        dm_text TEXT NOT NULL DEFAULT '',
        button_label TEXT NOT NULL DEFAULT '',
        link_url TEXT NOT NULL DEFAULT '',
        public_replies TEXT NOT NULL DEFAULT '[]',
        sort_order INTEGER NOT NULL DEFAULT 0,
        activated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS ig_dm_log (
        comment_id TEXT PRIMARY KEY,
        ig_user_id TEXT NOT NULL,
        line_account_id TEXT NOT NULL,
        rule_id TEXT,
        media_id TEXT NOT NULL DEFAULT '',
        from_id TEXT,
        username TEXT,
        text TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL,
        detail TEXT,
        public_reply_status TEXT,
        via TEXT NOT NULL DEFAULT 'webhook',
        commented_at TEXT,
        created_at TEXT NOT NULL
      )`,
    ),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_ig_dm_rules_account ON ig_dm_rules (ig_user_id, sort_order)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_ig_dm_log_account ON ig_dm_log (ig_user_id, created_at)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_ig_dm_log_rule_from ON ig_dm_log (rule_id, from_id, status)'),
  ]);
  tablesReady = true;
}

// ── アプリの設定（Meta のアプリは1つ）───────────────

type AppRow = { app_id: string; app_secret: string; config_id: string; verify_token: string; updated_at: string };

export async function getAppSettings(db: D1Database): Promise<IgAppSettings> {
  await ensureInstagramTables(db);
  const r = await db.prepare(`SELECT * FROM ig_app_settings WHERE id = 'app'`).first<AppRow>();
  if (r) return { appId: r.app_id, appSecret: r.app_secret, configId: r.config_id, verifyToken: r.verify_token, updatedAt: r.updated_at };
  // まだ無ければ、Webhook の確認トークンだけ先に決めて残す
  const now = new Date().toISOString();
  const verifyToken = newVerifyToken();
  await db
    .prepare(`INSERT OR IGNORE INTO ig_app_settings (id, verify_token, updated_at) VALUES ('app', ?, ?)`)
    .bind(verifyToken, now)
    .run();
  return getAppSettings(db);
}

export async function saveAppSettings(db: D1Database, input: { appId?: string; appSecret?: string; configId?: string }, now = new Date()): Promise<IgAppSettings> {
  const cur = await getAppSettings(db);
  const next = {
    appId: input.appId ?? cur.appId,
    appSecret: input.appSecret ?? cur.appSecret,
    configId: input.configId ?? cur.configId,
  };
  await db
    .prepare(`UPDATE ig_app_settings SET app_id = ?, app_secret = ?, config_id = ?, updated_at = ? WHERE id = 'app'`)
    .bind(next.appId, next.appSecret, next.configId, now.toISOString())
    .run();
  return getAppSettings(db);
}

/** 画面から来たアプリの設定を確かめる。番号は数字だけ・秘密の値は英数字だけ */
export function validateAppInput(body: unknown): { ok: true; value: { appId?: string; appSecret?: string; configId?: string } } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const pick = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
  const value = { appId: pick(b.appId), appSecret: pick(b.appSecret), configId: pick(b.configId) };
  if (value.appId && !/^\d{5,30}$/.test(value.appId)) return { ok: false, error: 'アプリID は数字だけで入れてください' };
  if (value.configId && !/^\d{5,30}$/.test(value.configId)) return { ok: false, error: '設定ID は数字だけで入れてください' };
  if (value.appSecret && !/^[0-9a-zA-Z]{16,64}$/.test(value.appSecret)) return { ok: false, error: 'app secret は英数字だけで入れてください' };
  return { ok: true, value };
}

// ── つないだアカウント ─────────────────────────────

type AccountRow = {
  ig_user_id: string; line_account_id: string; username: string; access_token: string; poll_enabled: number;
  last_polled_at: string | null; last_webhook_at: string | null; last_webhook_note: string | null;
  connected_via: string; connected_at: string; updated_at: string;
};

function toAccount(r: AccountRow): IgAccount {
  return {
    igUserId: r.ig_user_id,
    lineAccountId: r.line_account_id,
    username: r.username,
    accessToken: r.access_token,
    pollEnabled: r.poll_enabled === 1,
    lastPolledAt: r.last_polled_at,
    lastWebhookAt: r.last_webhook_at,
    lastWebhookNote: r.last_webhook_note,
    connectedVia: r.connected_via === 'token' ? 'token' : 'login',
    connectedAt: r.connected_at,
    updatedAt: r.updated_at,
  };
}

/** 知らせが届いた時刻と結果を残す（画面で「知らせが届いているか」を見るため） */
export async function noteWebhook(db: D1Database, igUserId: string, note: string, now = new Date()): Promise<void> {
  await ensureInstagramTables(db);
  await db
    .prepare('UPDATE ig_accounts SET last_webhook_at = ?, last_webhook_note = ? WHERE ig_user_id = ?')
    .bind(now.toISOString(), note.slice(0, 200), igUserId)
    .run();
}

export async function getAccount(db: D1Database, igUserId: string): Promise<IgAccount | null> {
  await ensureInstagramTables(db);
  const r = await db.prepare('SELECT * FROM ig_accounts WHERE ig_user_id = ?').bind(igUserId).first<AccountRow>();
  return r ? toAccount(r) : null;
}

/** lineAccountId を渡すと、その公式LINEにつないだアカウントだけ（つないだ順） */
export async function listAccounts(db: D1Database, lineAccountId?: string): Promise<IgAccount[]> {
  await ensureInstagramTables(db);
  const rows = lineAccountId
    ? await db.prepare('SELECT * FROM ig_accounts WHERE line_account_id = ? ORDER BY connected_at ASC').bind(lineAccountId).all<AccountRow>()
    : await db.prepare('SELECT * FROM ig_accounts ORDER BY connected_at ASC').all<AccountRow>();
  return rows.results.map(toAccount);
}

/** つなぐ・つなぎ直す（同じアカウントなら鍵と名前だけ入れ替え、ルール・記録・見回りの設定はそのまま） */
export async function upsertAccount(
  db: D1Database,
  input: { igUserId: string; lineAccountId: string; username: string; accessToken: string; connectedVia: 'login' | 'token' },
  now = new Date(),
): Promise<IgAccount> {
  await ensureInstagramTables(db);
  const iso = now.toISOString();
  await db
    .prepare(
      `INSERT INTO ig_accounts (ig_user_id, line_account_id, username, access_token, connected_via, connected_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(ig_user_id) DO UPDATE SET
         line_account_id = excluded.line_account_id, username = excluded.username, access_token = excluded.access_token,
         connected_via = excluded.connected_via, updated_at = excluded.updated_at`,
    )
    .bind(input.igUserId, input.lineAccountId, input.username, input.accessToken, input.connectedVia, iso, iso)
    .run();
  return (await getAccount(db, input.igUserId))!;
}

export async function setPollEnabled(db: D1Database, igUserId: string, enabled: boolean, now = new Date()): Promise<void> {
  await ensureInstagramTables(db);
  await db.prepare('UPDATE ig_accounts SET poll_enabled = ?, updated_at = ? WHERE ig_user_id = ?').bind(enabled ? 1 : 0, now.toISOString(), igUserId).run();
}

/** つながりを外す（ルールと記録は残す。つなぎ直せばそのまま使える） */
export async function deleteAccount(db: D1Database, igUserId: string): Promise<void> {
  await ensureInstagramTables(db);
  await db.prepare('DELETE FROM ig_accounts WHERE ig_user_id = ?').bind(igUserId).run();
}

// ── ログインの途中の合言葉 ─────────────────────────

export async function createOAuthState(db: D1Database, input: { lineAccountId: string; redirectUri: string; returnTo: string }, now = new Date()): Promise<string> {
  await ensureInstagramTables(db);
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const state = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  // 古いものはついでに片付ける
  await db.prepare('DELETE FROM ig_oauth_states WHERE created_at < ?').bind(new Date(now.getTime() - OAUTH_STATE_TTL_MS).toISOString()).run();
  await db
    .prepare('INSERT INTO ig_oauth_states (state, line_account_id, redirect_uri, return_to, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(state, input.lineAccountId, input.redirectUri, input.returnTo, now.toISOString())
    .run();
  return state;
}

// ── 本人に送る「つなぐ用リンク」──────────────────────

function randomHex(bytes: number): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function createInvite(db: D1Database, lineAccountId: string, now = new Date()): Promise<{ token: string; expiresAt: string }> {
  await ensureInstagramTables(db);
  const token = randomHex(24);
  const expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString();
  await db.prepare('DELETE FROM ig_invites WHERE expires_at < ?').bind(now.toISOString()).run();
  await db
    .prepare('INSERT INTO ig_invites (token, line_account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(token, lineAccountId, now.toISOString(), expiresAt)
    .run();
  return { token, expiresAt };
}

/** 期限内のリンクなら、どの LINE につなぐかを返す（ログインのやり直しに備えて、使っても消さない） */
export async function findInvite(db: D1Database, token: string, now = new Date()): Promise<{ lineAccountId: string } | null> {
  await ensureInstagramTables(db);
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  const r = await db.prepare('SELECT line_account_id, expires_at FROM ig_invites WHERE token = ?').bind(token).first<{ line_account_id: string; expires_at: string }>();
  if (!r || new Date(r.expires_at).getTime() < now.getTime()) return null;
  return { lineAccountId: r.line_account_id };
}

/** 合言葉を1回だけ使う（使ったら消す）。古い・知らないものは null */
export async function consumeOAuthState(db: D1Database, state: string, now = new Date()): Promise<{ lineAccountId: string; redirectUri: string; returnTo: string } | null> {
  await ensureInstagramTables(db);
  if (!/^[0-9a-f]{48}$/.test(state)) return null;
  const r = await db
    .prepare('SELECT line_account_id, redirect_uri, return_to, created_at FROM ig_oauth_states WHERE state = ?')
    .bind(state)
    .first<{ line_account_id: string; redirect_uri: string; return_to: string; created_at: string }>();
  if (!r) return null;
  await db.prepare('DELETE FROM ig_oauth_states WHERE state = ?').bind(state).run();
  if (now.getTime() - new Date(r.created_at).getTime() > OAUTH_STATE_TTL_MS) return null;
  return { lineAccountId: r.line_account_id, redirectUri: r.redirect_uri, returnTo: r.return_to };
}

/** Meta のログイン画面のリンク（prompt=login で「Instagramでログイン」も選べるようにする） */
export function buildLoginUrl(app: Pick<IgAppSettings, 'appId' | 'configId'>, redirectUri: string, state: string): string {
  const u = new URL(FB_LOGIN_DIALOG);
  u.searchParams.set('client_id', app.appId);
  u.searchParams.set('config_id', app.configId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', state);
  u.searchParams.set('prompt', 'login');
  return u.toString();
}

type RuleRow = {
  id: string; ig_user_id: string; line_account_id: string; name: string; is_active: number; media_scope: string; media_ids: string;
  keywords: string; match_mode: string; dm_text: string; button_label: string; link_url: string; public_replies: string;
  sort_order: number; activated_at: string | null; created_at: string; updated_at: string;
};

function parseList(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function toRule(r: RuleRow): IgRule {
  return {
    id: r.id,
    igUserId: r.ig_user_id,
    lineAccountId: r.line_account_id,
    name: r.name,
    isActive: r.is_active === 1,
    mediaScope: r.media_scope === 'selected' ? 'selected' : 'all',
    mediaIds: parseList(r.media_ids),
    keywords: parseList(r.keywords),
    matchMode: r.match_mode === 'exact' ? 'exact' : r.match_mode === 'any' ? 'any' : 'contains',
    dmText: r.dm_text,
    buttonLabel: r.button_label,
    linkUrl: r.link_url,
    publicReplies: parseList(r.public_replies),
    sortOrder: r.sort_order,
    activatedAt: r.activated_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function listRules(db: D1Database, igUserId: string): Promise<IgRule[]> {
  await ensureInstagramTables(db);
  const rows = await db
    .prepare('SELECT * FROM ig_dm_rules WHERE ig_user_id = ? ORDER BY sort_order ASC, created_at ASC')
    .bind(igUserId)
    .all<RuleRow>();
  return rows.results.map(toRule);
}

export async function getRule(db: D1Database, id: string): Promise<IgRule | null> {
  await ensureInstagramTables(db);
  const r = await db.prepare('SELECT * FROM ig_dm_rules WHERE id = ?').bind(id).first<RuleRow>();
  return r ? toRule(r) : null;
}

export interface RuleInput {
  name: string;
  isActive: boolean;
  mediaScope: MediaScope;
  mediaIds: string[];
  keywords: string[];
  matchMode: MatchMode;
  dmText: string;
  buttonLabel: string;
  linkUrl: string;
  publicReplies: string[];
}

/** 画面から来た値を確かめて整える。おかしければ日本語の理由を返す */
export function validateRuleInput(body: unknown): { ok: true; value: RuleInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
  const list = (v: unknown, maxItems: number, maxLen: number) =>
    Array.isArray(v)
      ? [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim().slice(0, maxLen)).filter(Boolean))].slice(0, maxItems)
      : [];
  const name = str(b.name, 60);
  const matchMode: MatchMode = b.matchMode === 'exact' ? 'exact' : b.matchMode === 'any' ? 'any' : 'contains';
  const mediaScope: MediaScope = b.mediaScope === 'selected' ? 'selected' : 'all';
  const value: RuleInput = {
    name,
    isActive: b.isActive === true,
    mediaScope,
    mediaIds: list(b.mediaIds, 50, 40),
    keywords: list(b.keywords, 20, 40),
    matchMode,
    dmText: typeof b.dmText === 'string' ? b.dmText.slice(0, 900) : '',
    buttonLabel: str(b.buttonLabel, 20),
    linkUrl: str(b.linkUrl, 500),
    publicReplies: list(b.publicReplies, 10, 200),
  };
  if (!value.name) return { ok: false, error: 'ルールの名前を入れてください' };
  if (value.matchMode !== 'any' && value.keywords.length === 0) return { ok: false, error: '反応する言葉を1つ以上入れてください' };
  if (value.mediaScope === 'selected' && value.mediaIds.length === 0) return { ok: false, error: '対象の投稿を1つ以上選んでください' };
  if (!value.dmText.trim()) return { ok: false, error: 'DM の文面を入れてください' };
  if (value.linkUrl && !/^https:\/\/\S+$/.test(value.linkUrl)) return { ok: false, error: 'リンクは https:// から始まる形で入れてください' };
  if (value.buttonLabel && !value.linkUrl) return { ok: false, error: 'ボタンを出すときは、リンクも入れてください' };
  return { ok: true, value };
}

export async function createRule(db: D1Database, account: Pick<IgAccount, 'igUserId' | 'lineAccountId'>, input: RuleInput, now = new Date()): Promise<IgRule> {
  await ensureInstagramTables(db);
  const id = crypto.randomUUID();
  const iso = now.toISOString();
  const max = await db
    .prepare('SELECT COALESCE(MAX(sort_order), 0) AS m FROM ig_dm_rules WHERE ig_user_id = ?')
    .bind(account.igUserId)
    .first<{ m: number }>();
  await db
    .prepare(
      `INSERT INTO ig_dm_rules (id, ig_user_id, line_account_id, name, is_active, media_scope, media_ids, keywords, match_mode, dm_text, button_label, link_url, public_replies, sort_order, activated_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id, account.igUserId, account.lineAccountId, input.name, input.isActive ? 1 : 0, input.mediaScope, JSON.stringify(input.mediaIds),
      JSON.stringify(input.keywords), input.matchMode, input.dmText, input.buttonLabel, input.linkUrl,
      JSON.stringify(input.publicReplies), (max?.m ?? 0) + 1, input.isActive ? iso : null, iso, iso,
    )
    .run();
  return (await getRule(db, id))!;
}

export async function updateRule(db: D1Database, rule: IgRule, input: RuleInput, now = new Date()): Promise<IgRule> {
  const iso = now.toISOString();
  // 止めていたルールを動かした時刻。これより前のコメントには送らない（動かした途端に過去のコメントへ一斉に送らないため）
  const activatedAt = input.isActive ? (rule.isActive ? rule.activatedAt ?? iso : iso) : rule.activatedAt;
  await db
    .prepare(
      `UPDATE ig_dm_rules SET name = ?, is_active = ?, media_scope = ?, media_ids = ?, keywords = ?, match_mode = ?, dm_text = ?,
         button_label = ?, link_url = ?, public_replies = ?, activated_at = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(
      input.name, input.isActive ? 1 : 0, input.mediaScope, JSON.stringify(input.mediaIds), JSON.stringify(input.keywords),
      input.matchMode, input.dmText, input.buttonLabel, input.linkUrl, JSON.stringify(input.publicReplies), activatedAt, iso, rule.id,
    )
    .run();
  return (await getRule(db, rule.id))!;
}

export async function deleteRule(db: D1Database, id: string): Promise<void> {
  await ensureInstagramTables(db);
  await db.prepare('DELETE FROM ig_dm_rules WHERE id = ?').bind(id).run();
}

// ── 言葉の判定 ─────────────────────────────────────

/** 比べる前にそろえる：全角英数→半角、大文字→小文字、カタカナ→ひらがな、空白と記号の一部を除く */
export function normalizeText(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[\s　]+/g, '')
    .replace(/[!！?？。、.,・〜~ー-]+$/u, '');
}

export function ruleMatchesText(rule: Pick<IgRule, 'keywords' | 'matchMode'>, text: string): boolean {
  if (rule.matchMode === 'any') return text.trim().length > 0;
  const t = normalizeText(text);
  if (!t) return false;
  return rule.keywords.some((k) => {
    const nk = normalizeText(k);
    if (!nk) return false;
    return rule.matchMode === 'exact' ? t === nk : t.includes(nk);
  });
}

export function ruleCoversMedia(rule: Pick<IgRule, 'mediaScope' | 'mediaIds'>, mediaId: string): boolean {
  return rule.mediaScope === 'all' || rule.mediaIds.includes(mediaId);
}

/** 並び順で最初に合うルール（動いているものだけ） */
export function findMatchingRule(rules: IgRule[], comment: Pick<IncomingComment, 'mediaId' | 'text'>): IgRule | null {
  return rules.find((r) => r.isActive && ruleCoversMedia(r, comment.mediaId) && ruleMatchesText(r, comment.text)) ?? null;
}

// ── DM の中身 ──────────────────────────────────────

/** {ユーザー名} を相手の Instagram の名前に置き換える */
export const USERNAME_MARK = '{ユーザー名}';
/** {リンク} をリンクに置き換える（ボタンを出さないときに文の中へ置く用） */
export const LINK_MARK = '{リンク}';

export function renderDmText(rule: Pick<IgRule, 'dmText' | 'linkUrl'>, username: string | null): string {
  let text = rule.dmText.split(USERNAME_MARK).join(username ? username : '');
  if (text.includes(LINK_MARK)) text = text.split(LINK_MARK).join(rule.linkUrl);
  return text.trim();
}

/** ボタン付きの DM（Instagram のボタンテンプレート）。送れなかったときの文だけの形も作る */
export function buildDmMessages(rule: Pick<IgRule, 'dmText' | 'linkUrl' | 'buttonLabel'>, username: string | null): {
  primary: Record<string, unknown>;
  fallback: Record<string, unknown> | null;
} {
  const text = renderDmText(rule, username);
  const hasLinkInText = rule.linkUrl && text.includes(rule.linkUrl);
  if (rule.buttonLabel && rule.linkUrl) {
    const fallbackText = hasLinkInText ? text : `${text}\n\n${rule.linkUrl}`;
    return {
      primary: {
        attachment: {
          type: 'template',
          payload: {
            template_type: 'button',
            text: text.slice(0, 640),
            buttons: [{ type: 'web_url', url: rule.linkUrl, title: rule.buttonLabel.slice(0, 20) }],
          },
        },
      },
      fallback: { text: fallbackText.slice(0, 1000) },
    };
  }
  const plain = rule.linkUrl && !hasLinkInText ? `${text}\n\n${rule.linkUrl}` : text;
  return { primary: { text: plain.slice(0, 1000) }, fallback: null };
}

export function pickPublicReply(rule: Pick<IgRule, 'publicReplies'>, username: string | null, rand = Math.random): string | null {
  if (rule.publicReplies.length === 0) return null;
  const t = rule.publicReplies[Math.floor(rand() * rule.publicReplies.length)] ?? '';
  const out = t.split(USERNAME_MARK).join(username ? `@${username}` : '').trim();
  return out || null;
}

// ── Instagram への問い合わせ ─────────────────────────

async function igJson<T>(fetchFn: IgFetch, url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string; status: number }> {
  try {
    const res = await fetchFn(url, init);
    const body = (await res.json().catch(() => null)) as (T & { error?: { message?: string; code?: number } }) | null;
    if (!res.ok || !body || (body as { error?: unknown }).error) {
      const msg = body?.error?.message ?? `HTTP ${res.status}`;
      return { ok: false, error: msg.slice(0, 300), status: res.status };
    }
    return { ok: true, data: body };
  } catch (err) {
    return { ok: false, error: String(err).slice(0, 300), status: 0 };
  }
}

function apiUrl(path: string, params: Record<string, string>): string {
  const u = new URL(`${IG_GRAPH}/${IG_API_VERSION}/${path.replace(/^\//, '')}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

/** ログインで受け取った合図（code）を鍵に換える。鍵は「システムユーザーの鍵」で期限がない */
export async function exchangeCode(fetchFn: IgFetch, app: Pick<IgAppSettings, 'appId' | 'appSecret'>, redirectUri: string, code: string) {
  return igJson<{ access_token: string; token_type?: string; expires_in?: number }>(
    fetchFn,
    apiUrl('oauth/access_token', { client_id: app.appId, client_secret: app.appSecret, redirect_uri: redirectUri, code }),
  );
}

/** この鍵で使える Instagram アカウント（ログインのときに選んだもの） */
export async function fetchAssignedAccounts(fetchFn: IgFetch, token: string) {
  return igJson<{ data: { id: string; username?: string }[] }>(
    fetchFn,
    apiUrl('me/assigned_instagram_accounts', { fields: 'id,username', access_token: token }),
  );
}

/** このアカウントのコメントの知らせを受け取る申し込み */
export async function subscribeWebhooks(fetchFn: IgFetch, token: string, igUserId: string) {
  return igJson<{ success?: boolean }>(
    fetchFn,
    apiUrl(`${igUserId}/subscribed_apps`, { subscribed_fields: 'comments,messages', access_token: token }),
    { method: 'POST' },
  );
}

/**
 * 鍵を受け取ってから、使えるアカウントをすべて保存し、知らせを申し込む（ログインの戻り・鍵の貼り付けの両方で使う）。
 * 返り値は保存したアカウントと、画面に出す一言
 */
export async function connectWithToken(
  db: D1Database,
  fetchFn: IgFetch,
  input: { token: string; lineAccountId: string; via: 'login' | 'token' },
  now = new Date(),
): Promise<{ ok: true; accounts: IgAccount[]; notes: string[] } | { ok: false; error: string }> {
  const list = await fetchAssignedAccounts(fetchFn, input.token);
  if (!list.ok) return { ok: false, error: `Instagram のアカウントを確かめられませんでした：${list.error}` };
  const found = list.data.data.filter((x) => x && x.id);
  if (found.length === 0) return { ok: false, error: 'この鍵で使える Instagram アカウントがありません（ログインのときにアカウントを選んだか確かめてください）' };
  const accounts: IgAccount[] = [];
  const notes: string[] = [];
  for (const x of found) {
    const acc = await upsertAccount(db, { igUserId: String(x.id), lineAccountId: input.lineAccountId, username: x.username ?? '', accessToken: input.token, connectedVia: input.via }, now);
    accounts.push(acc);
    const sub = await subscribeWebhooks(fetchFn, input.token, acc.igUserId);
    if (!sub.ok) notes.push(`@${acc.username || acc.igUserId} のコメントの知らせの申し込みに失敗：${sub.error}`);
  }
  return { ok: true, accounts, notes };
}

export interface IgMedia {
  id: string;
  caption?: string;
  media_type?: string;
  media_product_type?: string;
  permalink?: string;
  thumbnail_url?: string;
  media_url?: string;
  timestamp?: string;
}

export async function fetchRecentMedia(fetchFn: IgFetch, conn: Pick<IgAccount, 'igUserId' | 'accessToken'>, limit = 24) {
  return igJson<{ data: IgMedia[] }>(
    fetchFn,
    apiUrl(`${conn.igUserId}/media`, {
      fields: 'id,caption,media_type,media_product_type,permalink,thumbnail_url,media_url,timestamp',
      limit: String(limit),
      access_token: conn.accessToken,
    }),
  );
}

export async function fetchMediaComments(fetchFn: IgFetch, token: string, mediaId: string) {
  return igJson<{ data: { id: string; text?: string; username?: string; timestamp?: string; from?: { id?: string; username?: string } }[] }>(
    fetchFn,
    apiUrl(`${mediaId}/comments`, { fields: 'id,text,username,timestamp,from', limit: '50', access_token: token }),
  );
}

/** コメントした人に DM（非公開の返信）を送る */
export async function sendPrivateReply(fetchFn: IgFetch, conn: Pick<IgAccount, 'igUserId' | 'accessToken'>, commentId: string, message: Record<string, unknown>) {
  return igJson<{ recipient_id?: string; message_id?: string }>(fetchFn, apiUrl(`${conn.igUserId}/messages`, {}), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${conn.accessToken}` },
    body: JSON.stringify({ recipient: { comment_id: commentId }, message }),
  });
}

/** コメント欄に返信する（「DM を送りました」など） */
export async function sendPublicReply(fetchFn: IgFetch, token: string, commentId: string, message: string) {
  return igJson<{ id?: string }>(fetchFn, apiUrl(`${commentId}/replies`, {}), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ message }),
  });
}

// ── 知らせ（Webhook）───────────────────────────────

/** 知らせの署名（X-Hub-Signature-256）を、アプリの秘密の値で確かめる */
export async function verifySignature(appSecret: string, rawBody: string, header: string | null | undefined): Promise<boolean> {
  if (!header || !header.startsWith('sha256=')) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const given = header.slice('sha256='.length).toLowerCase();
  if (given.length !== hex.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

/** 知らせの中から、コメントの部分だけを取り出す（アカウントの ID ごと） */
export function extractComments(payload: unknown): { igUserId: string; comment: IncomingComment }[] {
  const out: { igUserId: string; comment: IncomingComment }[] = [];
  const p = payload as { object?: string; entry?: { id?: string; time?: number; changes?: { field?: string; value?: Record<string, unknown> }[] }[] };
  if (!p || !Array.isArray(p.entry)) return out;
  for (const entry of p.entry) {
    const igUserId = String(entry.id ?? '');
    for (const ch of entry.changes ?? []) {
      if (ch.field !== 'comments' && ch.field !== 'live_comments') continue;
      const v = ch.value ?? {};
      const from = (v.from ?? {}) as { id?: string; username?: string };
      const media = (v.media ?? {}) as { id?: string; media_product_type?: string };
      // 資料によってコメントの番号が id / comment_id のどちらかで来るので両方見る
      const id = typeof v.comment_id === 'string' ? v.comment_id : typeof v.id === 'string' ? v.id : '';
      if (!id) continue;
      out.push({
        igUserId,
        comment: {
          commentId: id,
          mediaId: String(media.id ?? ''),
          mediaProductType: media.media_product_type ?? null,
          fromId: from.id ? String(from.id) : null,
          username: from.username ?? null,
          text: typeof v.text === 'string' ? v.text : '',
          parentId: typeof v.parent_id === 'string' ? v.parent_id : null,
          createdAt: entry.time ? new Date(entry.time * (entry.time > 1e12 ? 1 : 1000)).toISOString() : null,
        },
      });
    }
  }
  return out;
}

// ── 1件のコメントを処理する ─────────────────────────

export type HandleResult =
  | 'sent'          // DM を送った
  | 'sent_text'     // ボタン付きは断られたので、文だけで送った
  | 'failed'        // 送れなかった
  | 'no_match'      // 合うルールなし（記録しない）
  | 'duplicate'     // 前に処理したコメント
  | 'own'           // 自分のアカウントのコメント（返信の輪にならないよう飛ばす）
  | 'reply'         // 返信への返信（コメントの下のやりとり）は対象外
  | 'already_sent'  // 同じ人には同じルールで送り済み
  | 'too_old';      // ルールを動かす前・7日より前のコメント

async function writeLog(
  db: D1Database,
  conn: IgAccount,
  c: IncomingComment,
  ruleId: string | null,
  status: string,
  detail: string | null,
  via: string,
  now: Date,
): Promise<boolean> {
  const r = await db
    .prepare(
      `INSERT OR IGNORE INTO ig_dm_log (comment_id, ig_user_id, line_account_id, rule_id, media_id, from_id, username, text, status, detail, via, commented_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(c.commentId, conn.igUserId, conn.lineAccountId, ruleId, c.mediaId, c.fromId, c.username, c.text.slice(0, 500), status, detail, via, c.createdAt ?? null, now.toISOString())
    .run();
  return (r.meta?.changes ?? 1) > 0;
}

export async function handleComment(
  db: D1Database,
  fetchFn: IgFetch,
  conn: IgAccount,
  comment: IncomingComment,
  opts: { via?: 'webhook' | 'poll'; now?: Date; rules?: IgRule[]; rand?: () => number } = {},
): Promise<HandleResult> {
  const now = opts.now ?? new Date();
  const via = opts.via ?? 'webhook';
  if (comment.fromId && comment.fromId === conn.igUserId) return 'own';
  if (comment.username && conn.username && comment.username === conn.username) return 'own';
  if (comment.parentId) return 'reply';

  const rules = opts.rules ?? (await listRules(db, conn.igUserId));
  const rule = findMatchingRule(rules, comment);
  if (!rule) return 'no_match';

  const commentedAt = comment.createdAt ? new Date(comment.createdAt).getTime() : now.getTime();
  if (Number.isFinite(commentedAt)) {
    if (now.getTime() - commentedAt > PRIVATE_REPLY_WINDOW_MS) return 'too_old';
    // 動かした時刻より前のコメントは見回りで拾っても送らない（少しの時計のずれは許す）
    if (rule.activatedAt && commentedAt < new Date(rule.activatedAt).getTime() - 60_000) return 'too_old';
  }

  // 前に処理したコメント（Meta の送り直し・見回りとの重なり）
  const seen = await db.prepare('SELECT 1 AS x FROM ig_dm_log WHERE comment_id = ?').bind(comment.commentId).first<{ x: number }>();
  if (seen) return 'duplicate';

  // 同じ人には同じルールで1回だけ（何度コメントしても DM は1通）
  if (comment.fromId) {
    const prev = await db
      .prepare(`SELECT 1 AS x FROM ig_dm_log WHERE rule_id = ? AND from_id = ? AND status IN ('sent','sent_text') LIMIT 1`)
      .bind(rule.id, comment.fromId)
      .first<{ x: number }>();
    if (prev) {
      await writeLog(db, conn, comment, rule.id, 'already_sent', null, via, now);
      return 'already_sent';
    }
  }

  // 先に「処理中」として場所を取る（知らせと見回りが同時に来ても二重に送らない）
  const claimed = await writeLog(db, conn, comment, rule.id, 'sending', null, via, now);
  if (!claimed) return 'duplicate';

  const { primary, fallback } = buildDmMessages(rule, comment.username);
  let status: 'sent' | 'sent_text' | 'failed' = 'sent';
  let detail: string | null = null;
  let res = await sendPrivateReply(fetchFn, conn, comment.commentId, primary);
  if (!res.ok && fallback) {
    const first = res.error;
    res = await sendPrivateReply(fetchFn, conn, comment.commentId, fallback);
    if (res.ok) {
      status = 'sent_text';
      detail = `ボタン付きは送れず文だけで送信: ${first}`.slice(0, 300);
    }
  }
  if (!res.ok) {
    status = 'failed';
    detail = res.error;
  }

  let publicStatus: string | null = null;
  if (status !== 'failed') {
    const reply = pickPublicReply(rule, comment.username, opts.rand);
    if (reply) {
      const pr = await sendPublicReply(fetchFn, conn.accessToken, comment.commentId, reply);
      publicStatus = pr.ok ? 'sent' : `failed: ${pr.error}`.slice(0, 300);
    }
  }

  await db
    .prepare('UPDATE ig_dm_log SET status = ?, detail = ?, public_reply_status = ? WHERE comment_id = ?')
    .bind(status, detail, publicStatus, comment.commentId)
    .run();
  return status;
}

/** 知らせ1回分を処理する。返り値は処理した数（記録用） */
export async function handleWebhookPayload(db: D1Database, fetchFn: IgFetch, payload: unknown, now = new Date()): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const items = extractComments(payload);
  const connCache = new Map<string, IgAccount | null>();
  const rulesCache = new Map<string, IgRule[]>();
  for (const { igUserId, comment } of items) {
    if (!connCache.has(igUserId)) connCache.set(igUserId, await getAccount(db, igUserId));
    const conn = connCache.get(igUserId);
    if (!conn) {
      counts.unknown_account = (counts.unknown_account ?? 0) + 1;
      continue;
    }
    if (!rulesCache.has(igUserId)) rulesCache.set(igUserId, await listRules(db, igUserId));
    const result = await handleComment(db, fetchFn, conn, comment, { via: 'webhook', now, rules: rulesCache.get(igUserId) });
    counts[result] = (counts[result] ?? 0) + 1;
  }
  return counts;
}

// ── 見回り（1分ごと）─────────────────────────────

/** 知らせが届かなくても拾えるよう、最近の投稿のコメントを見に行く */
// 1回の見回りで使う問い合わせの上限（Cloudflare の1回あたりの上限に当たらないよう小さく保つ）
const POLL_MAX_MEDIA = 6;
const POLL_MAX_HANDLED = 8;
/** 知らせがこの時間内に届いていれば、1分ごとの見回りは休む（知らせが動いているなら二度見る必要はない） */
const WEBHOOK_FRESH_MS = 6 * 60 * 60_000;

/**
 * onlyIgUserId を渡したとき（画面の「今すぐ確かめる」）は、見回りの切り替えや知らせの有無に関係なくそのアカウントだけ見る
 */
export async function pollComments(db: D1Database, fetchFn: IgFetch, now = new Date(), onlyIgUserId?: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const conns = (await listAccounts(db)).filter((x) => !onlyIgUserId || x.igUserId === onlyIgUserId);
  for (const conn of conns) {
    if (!onlyIgUserId) {
      if (!conn.pollEnabled) continue;
      const lastHook = conn.lastWebhookAt ? new Date(conn.lastWebhookAt).getTime() : 0;
      if (lastHook && now.getTime() - lastHook < WEBHOOK_FRESH_MS) continue;
    }
    let handled = 0;
    const rules = (await listRules(db, conn.igUserId)).filter((r) => r.isActive);
    if (rules.length === 0) continue;

    // 見る投稿：選んだ投稿があればそれ、「すべて」のルールがあれば新しい順に数件
    const mediaIds = new Set<string>();
    for (const r of rules) if (r.mediaScope === 'selected') r.mediaIds.forEach((id) => mediaIds.add(id));
    if (rules.some((r) => r.mediaScope === 'all')) {
      const media = await fetchRecentMedia(fetchFn, conn, POLL_MEDIA_LIMIT);
      if (media.ok) media.data.data.forEach((m) => mediaIds.add(m.id));
      else counts.media_error = (counts.media_error ?? 0) + 1;
    }

    for (const mediaId of [...mediaIds].slice(0, POLL_MAX_MEDIA)) {
      if (handled >= POLL_MAX_HANDLED) break;
      const res = await fetchMediaComments(fetchFn, conn.accessToken, mediaId);
      if (!res.ok) {
        counts.comments_error = (counts.comments_error ?? 0) + 1;
        continue;
      }
      const ids = res.data.data.map((c) => c.id);
      if (ids.length === 0) continue;
      // すでに記録のあるコメントは問い合わせ前に外す
      const seen = new Set<string>();
      for (let i = 0; i < ids.length; i += 50) {
        const chunk = ids.slice(i, i + 50);
        const rows = await db
          .prepare(`SELECT comment_id FROM ig_dm_log WHERE comment_id IN (${chunk.map(() => '?').join(',')})`)
          .bind(...chunk)
          .all<{ comment_id: string }>();
        rows.results.forEach((r) => seen.add(r.comment_id));
      }
      for (const c of res.data.data) {
        if (seen.has(c.id)) continue;
        if (handled >= POLL_MAX_HANDLED) break;
        const result = await handleComment(db, fetchFn, conn, {
          commentId: c.id,
          mediaId,
          fromId: c.from?.id ?? null,
          username: c.from?.username ?? c.username ?? null,
          text: c.text ?? '',
          createdAt: c.timestamp ?? null,
        }, { via: 'poll', now, rules });
        counts[result] = (counts[result] ?? 0) + 1;
        if (result !== 'no_match' && result !== 'own' && result !== 'reply') handled++;
      }
    }
    await db.prepare('UPDATE ig_accounts SET last_polled_at = ? WHERE ig_user_id = ?').bind(now.toISOString(), conn.igUserId).run();
  }
  return counts;
}

// ── 画面に出す数字と記録 ───────────────────────────

export async function ruleStats(db: D1Database, igUserId: string): Promise<Record<string, { sent: number; failed: number; matched: number; lastAt: string | null }>> {
  await ensureInstagramTables(db);
  const rows = await db
    .prepare(
      `SELECT rule_id,
         SUM(CASE WHEN status IN ('sent','sent_text') THEN 1 ELSE 0 END) AS sent,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
         COUNT(*) AS matched,
         MAX(created_at) AS last_at
       FROM ig_dm_log WHERE ig_user_id = ? AND rule_id IS NOT NULL GROUP BY rule_id`,
    )
    .bind(igUserId)
    .all<{ rule_id: string; sent: number; failed: number; matched: number; last_at: string | null }>();
  const out: Record<string, { sent: number; failed: number; matched: number; lastAt: string | null }> = {};
  for (const r of rows.results) out[r.rule_id] = { sent: r.sent ?? 0, failed: r.failed ?? 0, matched: r.matched ?? 0, lastAt: r.last_at };
  return out;
}

export interface LogRow {
  commentId: string;
  ruleId: string | null;
  mediaId: string;
  username: string | null;
  text: string;
  status: string;
  detail: string | null;
  publicReplyStatus: string | null;
  via: string;
  createdAt: string;
}

export async function recentLog(db: D1Database, igUserId: string, limit = 100): Promise<LogRow[]> {
  await ensureInstagramTables(db);
  const rows = await db
    .prepare(
      `SELECT comment_id, rule_id, media_id, username, text, status, detail, public_reply_status, via, created_at
       FROM ig_dm_log WHERE ig_user_id = ? ORDER BY created_at DESC LIMIT ?`,
    )
    .bind(igUserId, limit)
    .all<{ comment_id: string; rule_id: string | null; media_id: string; username: string | null; text: string; status: string; detail: string | null; public_reply_status: string | null; via: string; created_at: string }>();
  return rows.results.map((r) => ({
    commentId: r.comment_id,
    ruleId: r.rule_id,
    mediaId: r.media_id,
    username: r.username,
    text: r.text,
    status: r.status,
    detail: r.detail,
    publicReplyStatus: r.public_reply_status,
    via: r.via,
    createdAt: r.created_at,
  }));
}

/** 画面に返すつなぎ情報（鍵そのものは返さない） */
export function publicAccount(conn: IgAccount) {
  return {
    igUserId: conn.igUserId,
    username: conn.username,
    pollEnabled: conn.pollEnabled,
    lastPolledAt: conn.lastPolledAt,
    lastWebhookAt: conn.lastWebhookAt ?? null,
    lastWebhookNote: conn.lastWebhookNote ?? null,
    connectedVia: conn.connectedVia,
    connectedAt: conn.connectedAt,
    updatedAt: conn.updatedAt,
  };
}

/** 画面に返すアプリの設定（秘密の値そのものは返さない） */
export function publicApp(app: IgAppSettings) {
  return { appId: app.appId, configId: app.configId, hasAppSecret: !!app.appSecret, verifyToken: app.verifyToken };
}

export function newVerifyToken(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return 'kidou_ig_' + [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

