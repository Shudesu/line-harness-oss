import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

/**
 * Per-LINE-account access restriction for staff members.
 *
 * - owner (and the env API_KEY owner) can use every account — unrestricted.
 * - admin / staff can only use the accounts assigned to them. No assignment
 *   means no account at all (default deny).
 *
 * Assignments are stored in `account_settings` (no schema change needed):
 *   line_account_id = <account>, key = 'staff_access:<staffId>', value = '1'
 *
 * Enforcement is an allowlist: a restricted staff member may only call the
 * endpoints listed in RULES below, and each rule says how to find the account
 * the request touches. Anything not listed is refused, so new endpoints are
 * closed until someone decides how they should be scoped.
 */

export const STAFF_ACCESS_KEY_PREFIX = 'staff_access:';

export function staffAccessKey(staffId: string): string {
  return `${STAFF_ACCESS_KEY_PREFIX}${staffId}`;
}

export async function getStaffAccountIds(db: D1Database, staffId: string): Promise<string[]> {
  const rows = await db
    .prepare(`SELECT line_account_id FROM account_settings WHERE key = ?`)
    .bind(staffAccessKey(staffId))
    .all<{ line_account_id: string }>();
  return rows.results.map((r) => r.line_account_id);
}

export async function setStaffAccountIds(
  db: D1Database,
  staffId: string,
  accountIds: string[],
): Promise<void> {
  const key = staffAccessKey(staffId);
  const unique = [...new Set(accountIds)];
  const stmts = [db.prepare(`DELETE FROM account_settings WHERE key = ?`).bind(key)];
  for (const accountId of unique) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO account_settings (id, line_account_id, key, value) VALUES (?, ?, ?, '1')`,
        )
        .bind(crypto.randomUUID(), accountId, key),
    );
  }
  await db.batch(stmts);
}

export async function clearStaffAccountIds(db: D1Database, staffId: string): Promise<void> {
  await db.prepare(`DELETE FROM account_settings WHERE key = ?`).bind(staffAccessKey(staffId)).run();
}

/** null = unrestricted (owner). Otherwise the account ids this staff may use. */
export function getAccountScope(c: Context<Env>): string[] | null {
  return c.get('accountScope') ?? null;
}

// ---------------------------------------------------------------------------
// Resolvers: figure out which accounts a request touches.
// ---------------------------------------------------------------------------

/** Accounts touched, or 'global' (no account involved), or an error message. */
type Resolution = { accounts: string[] } | { global: true } | { error: string };
type Resolver = (c: Context<Env>, m: RegExpMatchArray) => Promise<Resolution>;

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
const NEED_ACCOUNT = 'アカウントを選んでから操作してください';
const SHARED_READ_ONLY = '全アカウント共通のものは、担当のアカウントが決まっているスタッフは変更できません';

const global: Resolver = async () => ({ global: true });

/** Required query param (first present name wins). */
function query(...names: string[]): Resolver {
  return async (c) => {
    for (const name of names) {
      const v = c.req.query(name);
      if (v) return { accounts: [v] };
    }
    return { error: NEED_ACCOUNT };
  };
}

async function readBody(c: Context<Env>): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json<unknown>();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Required JSON body field. String fields or string arrays (all must be allowed). */
function body(...names: string[]): Resolver {
  return async (c) => {
    const data = await readBody(c);
    const accounts: string[] = [];
    for (const name of names) {
      const v = data[name];
      if (typeof v === 'string' && v) accounts.push(v);
      if (Array.isArray(v)) {
        for (const item of v) if (typeof item === 'string' && item) accounts.push(item);
      }
    }
    return accounts.length ? { accounts } : { error: NEED_ACCOUNT };
  };
}

/** Optional JSON body field: checked only when present. */
function bodyIfPresent(...names: string[]): Resolver {
  return async (c) => {
    const data = await readBody(c);
    const present = names.some((n) => data[n] !== undefined);
    if (!present) return { global: true };
    const nullSet = names.some((n) => data[n] === null);
    if (nullSet) return { error: SHARED_READ_ONLY };
    return body(...names)(c, [] as unknown as RegExpMatchArray);
  };
}

/** A path segment that is itself a line account id. */
function param(group: number): Resolver {
  return async (_c, m) => ({ accounts: [m[group]] });
}

/**
 * A path segment that is a row id; the row carries the account. Missing rows
 * pass through (the handler answers 404). NULL means "shared by all accounts":
 * readable, but not changeable by a restricted staff member.
 */
function row(table: string, column: string, group: number, idColumn = 'id'): Resolver {
  return async (c, m) => {
    const found = await c.env.DB
      .prepare(`SELECT ${column} AS account FROM ${table} WHERE ${idColumn} = ?`)
      .bind(m[group])
      .first<{ account: string | null }>();
    if (!found) return { accounts: [] };
    if (found.account === null || found.account === undefined) {
      return SAFE.has(c.req.method.toUpperCase()) ? { global: true } : { error: SHARED_READ_ONLY };
    }
    return { accounts: [found.account] };
  };
}

/** Rows that can target several accounts through an `account_ids` JSON column. */
function multiRow(table: string, group: number): Resolver {
  return async (c, m) => {
    const found = await c.env.DB
      .prepare(`SELECT line_account_id, account_ids FROM ${table} WHERE id = ?`)
      .bind(m[group])
      .first<{ line_account_id: string | null; account_ids: string | null }>();
    if (!found) return { accounts: [] };
    const accounts: string[] = [];
    if (found.line_account_id) accounts.push(found.line_account_id);
    if (found.account_ids) {
      try {
        const ids = JSON.parse(found.account_ids);
        if (Array.isArray(ids)) for (const id of ids) if (typeof id === 'string') accounts.push(id);
      } catch {
        // malformed JSON — fall through with what we have
      }
    }
    if (!accounts.length) {
      return SAFE.has(c.req.method.toUpperCase()) ? { global: true } : { error: SHARED_READ_ONLY };
    }
    return { accounts };
  };
}

/** /api/chats/:id accepts a chats.id or a friends.id. */
const chatOrFriend: Resolver = async (c, m) => {
  const viaChat = await row('chats', 'line_account_id', 1)(c, m);
  if ('accounts' in viaChat && viaChat.accounts.length === 0) {
    return row('friends', 'line_account_id', 1)(c, m);
  }
  return viaChat;
};

/** All resolvers must pass; accounts are combined. */
function all(...resolvers: Resolver[]): Resolver {
  return async (c, m) => {
    const accounts: string[] = [];
    for (const r of resolvers) {
      const res = await r(c, m);
      if ('error' in res) return res;
      if ('accounts' in res) accounts.push(...res.accounts);
    }
    return { accounts };
  };
}

// ---------------------------------------------------------------------------
// Allowlist of endpoints a restricted staff member may use.
// ---------------------------------------------------------------------------

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Rule = { methods: Method[]; path: RegExp; resolve: Resolver };

const ID = '([^/]+)';
const r = (methods: Method[], path: string, resolve: Resolver): Rule => ({
  methods,
  path: new RegExp(`^${path}$`),
  resolve,
});

const friendRow = (g: number) => row('friends', 'line_account_id', g);

export const RULES: Rule[] = [
  // Self / session — no account involved.
  r(['GET'], '/api/staff/me', global),
  r(['GET'], '/api/auth/session', global),
  r(['GET'], '/api/capabilities', global),

  // LINE accounts — the list is filtered in the handler.
  r(['GET'], '/api/line-accounts', global),
  r(['GET'], `/api/line-accounts/${ID}`, param(1)),
  r(['GET'], `/api/line-accounts/${ID}/follower-insight`, param(1)),
  r(['PATCH'], `/api/line-accounts/${ID}`, param(1)), // role guard: owner/admin
  r(['GET'], `/api/accounts/${ID}/health`, param(1)),

  // Friends
  r(['GET'], '/api/friends', query('lineAccountId')),
  r(['GET'], '/api/friends/count', query('lineAccountId')),
  r(['GET'], '/api/friends/ref-stats', query('lineAccountId')),
  r(['GET'], `/api/friends/${ID}`, friendRow(1)),
  r(['POST'], `/api/friends/${ID}/tags`, friendRow(1)),
  r(['DELETE'], `/api/friends/${ID}/tags/${ID}`, friendRow(1)),
  r(['PUT'], `/api/friends/${ID}/metadata`, friendRow(1)),
  r(['GET', 'POST'], `/api/friends/${ID}/messages`, friendRow(1)),
  r(['GET', 'POST'], `/api/friends/${ID}/score`, friendRow(1)),
  r(['GET', 'POST', 'DELETE'], `/api/friends/${ID}/rich-menu`, friendRow(1)),
  r(['GET'], `/api/friends/${ID}/reminders`, friendRow(1)),

  // Tags are shared by all accounts: may read and create, not delete.
  r(['GET', 'POST'], '/api/tags', global),

  // Images (upload for messages / rich menus)
  r(['POST'], '/api/images', global),

  // Chats / conversations / inbox
  r(['GET'], '/api/chats', query('lineAccountId')),
  r(['POST'], '/api/chats', friendFromBody),
  r(['GET', 'PUT'], `/api/chats/${ID}`, chatOrFriend),
  r(['POST'], `/api/chats/${ID}/loading`, chatOrFriend),
  r(['POST'], `/api/chats/${ID}/send`, chatOrFriend),
  r(['GET'], '/api/conversations', query('lineAccountId')),
  r(['GET'], `/api/conversations/${ID}`, friendRow(1)),
  r(['GET'], '/api/inbox/unanswered', query('account')),

  // Scenarios (NULL account = shared, read-only for restricted staff)
  r(['GET'], '/api/scenarios', query('lineAccountId')),
  r(['POST'], '/api/scenarios', body('lineAccountId')),
  r(['GET', 'PUT', 'DELETE'], `/api/scenarios/${ID}`, row('scenarios', 'line_account_id', 1)),
  r(['GET'], `/api/scenarios/${ID}/(?:preview|stats)`, row('scenarios', 'line_account_id', 1)),
  r(['POST'], `/api/scenarios/${ID}/steps`, row('scenarios', 'line_account_id', 1)),
  r(['POST'], `/api/scenarios/${ID}/steps/reorder`, row('scenarios', 'line_account_id', 1)),
  r(['PUT', 'DELETE'], `/api/scenarios/${ID}/steps/${ID}`, row('scenarios', 'line_account_id', 1)),
  r(['POST'], `/api/scenarios/${ID}/enroll/${ID}`, all(row('scenarios', 'line_account_id', 1), friendRow(2))),

  // Reminders
  r(['GET'], '/api/reminders', query('lineAccountId')),
  r(['POST'], '/api/reminders', body('lineAccountId')),
  r(['GET', 'PUT', 'DELETE'], `/api/reminders/${ID}`, row('reminders', 'line_account_id', 1)),
  r(['POST'], `/api/reminders/${ID}/steps`, row('reminders', 'line_account_id', 1)),
  r(['DELETE'], `/api/reminders/${ID}/steps/${ID}`, row('reminders', 'line_account_id', 1)),
  r(['POST'], `/api/reminders/${ID}/enroll/${ID}`, all(row('reminders', 'line_account_id', 1), friendRow(2))),

  // Broadcasts
  r(['GET'], '/api/broadcasts', query('lineAccountId')),
  r(['POST'], '/api/broadcasts', body('lineAccountId', 'accountIds')),
  r(['POST'], '/api/broadcasts/dedup-preview', body('accountIds')),
  r(['POST'], '/api/segments/count', body('accountId')),
  r(['GET', 'PUT', 'DELETE'], `/api/broadcasts/${ID}`, multiRow('broadcasts', 1)),
  r(['GET'], `/api/broadcasts/${ID}/(?:preview-count|per-account-stats|insight|progress)`, multiRow('broadcasts', 1)),
  r(['POST'], `/api/broadcasts/${ID}/(?:send|send-segment|fetch-insight|test-send)`, multiRow('broadcasts', 1)),

  // Automations
  r(['GET'], '/api/automations', query('lineAccountId')),
  r(['POST'], '/api/automations', body('lineAccountId')),
  r(['GET', 'PUT', 'DELETE'], `/api/automations/${ID}`, row('automations', 'line_account_id', 1)),
  r(['GET'], `/api/automations/${ID}/logs`, row('automations', 'line_account_id', 1)),

  // Auto replies (PUT may move the row to another account)
  r(['GET'], '/api/auto-replies', query('accountId')),
  r(['POST'], '/api/auto-replies', body('lineAccountId')),
  r(['GET', 'DELETE'], `/api/auto-replies/${ID}`, row('auto_replies', 'line_account_id', 1)),
  r(['PUT'], `/api/auto-replies/${ID}`, all(row('auto_replies', 'line_account_id', 1), bodyIfPresent('lineAccountId'))),

  // Rich menus (legacy direct LINE API — accountId is required, otherwise it
  // would fall back to the env channel token)
  r(['GET', 'POST'], '/api/rich-menus', query('accountId')),
  r(['DELETE'], `/api/rich-menus/${ID}`, query('accountId')),
  r(['POST'], `/api/rich-menus/${ID}/(?:default|image)`, query('accountId')),

  // Rich menu groups
  r(['GET'], '/api/rich-menu-groups', query('accountId')),
  r(['GET'], '/api/rich-menu-groups/external', query('accountId')),
  r(['DELETE'], `/api/rich-menu-groups/external/${ID}`, query('accountId')),
  r(['POST'], '/api/rich-menu-groups/import', query('accountId')),
  r(['POST'], '/api/rich-menu-groups', body('accountId')),
  r(['GET', 'PATCH', 'DELETE'], `/api/rich-menu-groups/${ID}`, row('rich_menu_groups', 'account_id', 1)),
  r(['POST'], `/api/rich-menu-groups/${ID}/pages/${ID}/image`, row('rich_menu_groups', 'account_id', 1)),
  r(['POST'], `/api/rich-menu-groups/${ID}/(?:publish|unpublish|apply-to-tag)`, row('rich_menu_groups', 'account_id', 1)),

  // Tracked links (the list is filtered in the handler)
  r(['GET'], '/api/tracked-links', global),
  r(['POST'], '/api/tracked-links', body('lineAccountId')),
  r(['GET', 'DELETE'], `/api/tracked-links/${ID}`, row('tracked_links', 'line_account_id', 1)),
  r(['PATCH'], `/api/tracked-links/${ID}`, all(row('tracked_links', 'line_account_id', 1), bodyIfPresent('lineAccountId'))),

  // Per-account settings
  r(['GET'], '/api/account-settings/test-recipients', query('accountId')),
  r(['PUT'], '/api/account-settings/test-recipients', body('accountId')),
  r(['GET'], '/api/account-settings/(?:link-base-url|tracked-link-base-url)', global),

  // Analytics
  r(['GET'], '/api/analytics/ref-summary', query('lineAccountId')),
  r(['GET'], `/api/analytics/ref/${ID}`, query('lineAccountId')),

  // Booking / events — account_id is required and the handlers check that
  // every row belongs to it.
  r(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], '/api/booking/admin/.+', query('account_id')),
  r(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], '/api/events/admin/.+', query('account_id')),
];

/** POST /api/chats: the friend decides the account; an explicit lineAccountId must also be allowed. */
async function friendFromBody(c: Context<Env>): Promise<Resolution> {
  const data = await readBody(c);
  const accounts: string[] = [];
  if (typeof data.friendId === 'string') {
    const found = await c.env.DB
      .prepare(`SELECT line_account_id FROM friends WHERE id = ?`)
      .bind(data.friendId)
      .first<{ line_account_id: string | null }>();
    if (found?.line_account_id) accounts.push(found.line_account_id);
  }
  if (typeof data.lineAccountId === 'string' && data.lineAccountId) accounts.push(data.lineAccountId);
  return accounts.length ? { accounts } : { error: NEED_ACCOUNT };
}

function findRule(method: string, path: string): { rule: Rule; match: RegExpMatchArray } | null {
  for (const rule of RULES) {
    if (!rule.methods.includes(method as Method)) continue;
    const match = path.match(rule.path);
    if (match) {
      // 道順は文字を戻したパスで決まるので、取り出した ID も戻してから照合する（%61 などですり抜けさせない）
      for (let i = 1; i < match.length; i++) {
        if (match[i] === undefined) continue;
        try {
          match[i] = decodeURIComponent(match[i]);
        } catch {
          return null;
        }
      }
      return { rule, match };
    }
  }
  return null;
}

/**
 * Runs after authMiddleware. Public endpoints never get a staff identity, so
 * they pass straight through.
 */
export async function accountScopeMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  const staff = c.get('staff');
  if (!staff || staff.role === 'owner') return next();

  const method = c.req.method.toUpperCase();
  if (method === 'OPTIONS') return next();

  const allowed = await getStaffAccountIds(c.env.DB, staff.id);
  c.set('accountScope', allowed);

  // Hono が道順を決めるときと同じ、文字を戻したパスで見る
  const path = c.req.path;
  const found = findRule(method === 'HEAD' ? 'GET' : method, path);
  if (!found) {
    return c.json(
      { success: false, error: 'この機能はオーナーだけが使えます（担当のアカウントが決まっているため）' },
      403,
    );
  }

  const res = await found.rule.resolve(c, found.match);
  if ('error' in res) return c.json({ success: false, error: res.error }, 403);
  if ('accounts' in res) {
    const denied = res.accounts.find((id) => !allowed.includes(id));
    if (denied) {
      return c.json({ success: false, error: '担当していないアカウントは操作できません' }, 403);
    }
  }
  return next();
}
