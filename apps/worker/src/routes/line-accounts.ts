import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import {
  getLineAccounts,
  getLineAccountById,
  createLineAccount,
  updateLineAccount,
  updateLineAccountFields,
  updateLineAccountOrder,
  deleteLineAccount,
} from '@line-crm/db';
import type { LineAccount as DbLineAccount } from '@line-crm/db';
import { requireRole } from '../middleware/role-guard.js';
import {
  detectFollowerImportCapability,
  getFollowerImportState,
  processFollowerImportStep,
  startFollowerImport,
} from '../services/follower-import.js';
import type { FollowerImportClient } from '../services/follower-import.js';
import type { Env } from '../index.js';
import { countAccountMonthlyMessages, jstYyyyMmDd } from '../services/quota.js';
import { countDeliverableAudience } from '../services/quota-alert.js';

const lineAccounts = new Hono<Env>();

function serializeLineAccount(row: DbLineAccount) {
  return {
    id: row.id,
    channelId: row.channel_id,
    name: row.name,
    isActive: Boolean(row.is_active),
    country: row.country,
    role: row.role,
    displayOrder: row.display_order,
    // login_channel_id and liff_id are non-secret identifiers (visible in
    // LINE Developers console, embedded in public LIFF URLs). Safe to expose
    // in list responses so the admin UI can show "Login/LIFF configured?"
    // without a separate fetch.
    loginChannelId: row.login_channel_id,
    liffId: row.liff_id,
    ogSiteName: row.og_site_name,
    ogDefaultImageUrl: row.og_default_image_url,
    ogDefaultDescription: row.og_default_description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Intentionally omit channelAccessToken / channelSecret / loginChannelSecret
    // from list responses (secrets).
  };
}

function serializeLineAccountFull(row: DbLineAccount) {
  return {
    ...serializeLineAccount(row),
    channelAccessToken: row.channel_access_token,
    channelSecret: row.channel_secret,
    loginChannelSecret: row.login_channel_secret,
  };
}

/** Show the last 4 chars so the UI can say "configured" without leaking the value. */
function maskSecret(value: string | null | undefined): string | null {
  if (!value) return null;
  return `****${value.slice(-4)}`;
}

/**
 * GET responses carry masked secrets only. The admin UI never reads these back
 * (its edit form leaves the fields blank and only sends a value when changing
 * one), so masking costs nothing there — but an API key handed to an MCP agent
 * is owner-role, and returning the plaintext channel token would let a leaked
 * key take over the LINE channel itself, far beyond this harness.
 * POST/PUT still echo the full values: those are the caller's own input.
 */
function serializeLineAccountMasked(row: DbLineAccount) {
  return {
    ...serializeLineAccount(row),
    channelAccessToken: maskSecret(row.channel_access_token),
    channelSecret: maskSecret(row.channel_secret),
    loginChannelSecret: maskSecret(row.login_channel_secret),
  };
}

// Fetch bot profile (displayName, pictureUrl) from LINE API
async function fetchBotProfile(accessToken: string): Promise<{ displayName?: string; pictureUrl?: string; basicId?: string }> {
  try {
    const res = await fetch('https://api.line.me/v2/bot/info', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return {};
    const data = await res.json() as { displayName?: string; pictureUrl?: string; basicId?: string };
    return { displayName: data.displayName, pictureUrl: data.pictureUrl, basicId: data.basicId };
  } catch {
    return {};
  }
}

// GET /api/line-accounts - list all (with LINE profile + stats)
lineAccounts.get('/api/line-accounts', async (c) => {
  try {
    const db = c.env.DB;
    const items = await getLineAccounts(db);

    // Get stats for all accounts in parallel
    const results = await Promise.all(
      items.map(async (item) => {
        const [profile, friendCount, scenarioCount, msgCount] = await Promise.all([
          fetchBotProfile(item.channel_access_token),
          db.prepare(`SELECT COUNT(*) as count FROM friends WHERE is_following = 1 AND line_account_id = ?`).bind(item.id).first<{ count: number }>(),
          db.prepare(
            `SELECT COUNT(*) as count FROM friend_scenarios fs
             INNER JOIN friends f ON f.id = fs.friend_id
             WHERE fs.status = 'active' AND f.line_account_id = ?`,
          ).bind(item.id).first<{ count: number }>(),
          // 「今月送信」(messagesThisMonth) は LINE 公式ダッシュボードの「配信済みの無料メッセージ数」に
          // 近い概算 (マルチアカウント運用では NULL プール分だけ上振れする —
          // countAccountMonthlyMessages の注意書き参照)。定義は services/quota.ts に一本化。
          countAccountMonthlyMessages(db, item.id),
        ]);

        return {
          ...serializeLineAccount(item),
          displayName: profile.displayName || item.name,
          pictureUrl: profile.pictureUrl || null,
          basicId: profile.basicId || null,
          stats: {
            friendCount: friendCount?.count ?? 0,
            activeScenarios: scenarioCount?.count ?? 0,
            messagesThisMonth: msgCount,
          },
        };
      }),
    );
    return c.json({ success: true, data: results });
  } catch (err) {
    console.error('GET /api/line-accounts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

/**
 * LINE's insight endpoints have a low rate limit (60 requests/hour), and a
 * followers insight that reached status 'ready' for a past date never changes
 * again — so 'ready' results are kept in the Workers Cache for 6h to stop
 * dashboard reloads from burning the budget. Non-ready results are never
 * cached (LINE finishes aggregating during the day and we must retry).
 * caches.default is absent under vitest/node, where the guard falls through
 * to the live (mocked) client.
 */
async function getFollowersInsightCached(
  client: LineClient,
  lineAccountId: string,
  date: string,
): Promise<Awaited<ReturnType<LineClient['getFollowersInsight']>>> {
  type Insight = Awaited<ReturnType<LineClient['getFollowersInsight']>>;
  const cache = (globalThis as { caches?: { default?: Cache } }).caches?.default;
  const key = `https://line-harness.internal/insight-cache/${encodeURIComponent(lineAccountId)}/${date}`;
  if (cache) {
    try {
      const hit = await cache.match(key);
      if (hit) return (await hit.json()) as Insight;
    } catch {
      // Cache read failures must never break the endpoint.
    }
  }
  const insight = await client.getFollowersInsight(date);
  if (cache && insight.status === 'ready') {
    try {
      await cache.put(
        key,
        new Response(JSON.stringify(insight), {
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=21600' },
        }),
      );
    } catch {
      // Best-effort: a failed put just means the next request refetches.
    }
  }
  return insight;
}

// GET /api/line-accounts/delivery-health — per-account broadcast-health snapshot
// for the dashboard: LINE plan quota vs. this month's consumption, follower /
// block counts with day-over-day deltas, and the harness-side monthly send count.
//
// Born from the 2026-09-01 incident where two accounts ran out of monthly quota
// and every all-target send failed silently — the quota was visible nowhere in
// the UI. quotaAlert flags the state where the remaining quota can no longer
// cover one all-target broadcast (remaining < deliverable audience).
//
// IMPORTANT: declared BEFORE the /:id routes below so Hono matches the literal
// "delivery-health" segment first (same ordering rule as PATCH /order).
lineAccounts.get('/api/line-accounts/delivery-health', async (c) => {
  try {
    const db = c.env.DB;
    const items = (await getLineAccounts(db)).filter((item) => item.is_active);
    // audience フォールバックの NULL 行ポリシーは監視 (ban-monitor) ・送信ガードと
    // 同じ定義に揃える: 単一アカウント運用では legacy NULL 行こそが友だちの本体。
    // ここだけ厳密一致で数えると、insight 未取得時に audience≈0 → quotaAlert=false
    // となり、ban-monitor が warning を出している状態でダッシュボードだけ正常表示になる。
    const singleAccountInstall = items.length <= 1;
    // LINE's followers insight is only 'ready' for completed JST days: ask for
    // yesterday, and the day before for the day-over-day delta.
    const insightDate = jstYyyyMmDd(1);
    const prevInsightDate = jstYyyyMmDd(2);

    const accounts = await Promise.all(
      items.map(async (account) => {
        const client = new LineClient(account.channel_access_token);
        const [quotaRes, consumptionRes, insightRes, prevInsightRes, msgCountRes, friendCountRes] =
          await Promise.allSettled([
            client.getMessageQuota(),
            client.getMessageQuotaConsumption(),
            getFollowersInsightCached(client, account.id, insightDate),
            getFollowersInsightCached(client, account.id, prevInsightDate),
            countAccountMonthlyMessages(db, account.id),
            countDeliverableAudience(db, account.id, singleAccountInstall),
          ]);

        // Partial failures degrade to null fields (one revoked token must not
        // blank the whole dashboard). take() records every failure in errors
        // so value extraction and error bookkeeping cannot drift apart, and
        // the UI can say 取得失敗 instead of rendering a silent zero.
        const errors: string[] = [];
        const take = <T>(r: PromiseSettledResult<T>, name: string): T | null => {
          if (r.status === 'fulfilled') return r.value;
          errors.push(name);
          return null;
        };

        const quota = take(quotaRes, 'quota');
        const consumptionData = take(consumptionRes, 'consumption');
        const insightRaw = take(insightRes, 'insight');
        const prevInsightRaw = take(prevInsightRes, 'prevInsight');
        const messagesThisMonth = take(msgCountRes, 'messagesThisMonth');
        const deliverableFriendCount = take(friendCountRes, 'friendCount');

        const limit =
          quota?.type === 'limited' && typeof quota.value === 'number' ? quota.value : null;
        const consumption = consumptionData?.totalUsage ?? null;
        const remaining =
          limit !== null && consumption !== null ? Math.max(0, limit - consumption) : null;

        // 'unready' (LINE has not aggregated the day yet) is a distinct state
        // from a failed call: the UI must render "集計待ち", not "正常".
        const insightStatus: 'ready' | 'unready' | 'error' =
          insightRaw === null ? 'error' : insightRaw.status === 'ready' ? 'ready' : 'unready';
        const insight = insightStatus === 'ready' ? insightRaw : null;
        const prevInsight = prevInsightRaw?.status === 'ready' ? prevInsightRaw : null;
        const followers = insight?.followers ?? null;
        const targetedReaches = insight?.targetedReaches ?? null;
        const blocks = insight?.blocks ?? null;
        const prevFollowers = prevInsight?.followers ?? null;
        const prevBlocks = prevInsight?.blocks ?? null;

        // "全員配信が不可能" check: an all-target broadcast costs one message per
        // deliverable friend — targetedReaches (followers minus blocked). When
        // the insight is unavailable, fall back to the DB following count
        // (close to targetedReaches; the raw followers number would include
        // blocked users and over-alert). remaining === 0 always alerts: with
        // nothing left to send, no audience estimate is needed to know bulk
        // sends will fail.
        const audience = targetedReaches ?? deliverableFriendCount ?? null;
        const quotaAlert =
          quota?.type === 'limited' &&
          remaining !== null &&
          (remaining === 0 || (audience !== null && remaining < audience));

        return {
          lineAccountId: account.id,
          name: account.name,
          quota: {
            type: quota?.type ?? null,
            limit,
            consumption,
            remaining,
          },
          quotaAlert,
          insight: {
            status: insightStatus,
            date: insight ? insightDate : null,
            followers,
            targetedReaches,
            blocks,
            followersDelta:
              followers !== null && prevFollowers !== null ? followers - prevFollowers : null,
            blocksDelta: blocks !== null && prevBlocks !== null ? blocks - prevBlocks : null,
          },
          messagesThisMonth,
          errors,
        };
      }),
    );

    return c.json({ success: true, data: { insightDate, accounts } });
  } catch (err) {
    console.error('GET /api/line-accounts/delivery-health error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/line-accounts/:id - get single (secrets masked; staff sees none at all)
lineAccounts.get('/api/line-accounts/:id', async (c) => {
  try {
    const account = await getLineAccountById(c.env.DB, c.req.param('id'));
    if (!account) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    const staff = c.get('staff');
    const data = staff?.role === 'staff'
      ? serializeLineAccount(account)
      : serializeLineAccountMasked(account);
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/line-accounts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/line-accounts/:id/follower-insight - compare DB state with LINE official follower stats
lineAccounts.get('/api/line-accounts/:id/follower-insight', async (c) => {
  try {
    const date = c.req.query('date');
    if (!date || !/^\d{8}$/.test(date)) {
      return c.json({ success: false, error: 'date query is required in yyyyMMdd format' }, 400);
    }

    const account = await getLineAccountById(c.env.DB, c.req.param('id'));
    if (!account) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }

    const client = new LineClient(account.channel_access_token);
    const insight = await client.getFollowersInsight(date);
    return c.json({
      success: true,
      data: {
        lineAccountId: account.id,
        date,
        status: insight.status,
        followers: typeof insight.followers === 'number' ? insight.followers : null,
        targetedReaches: typeof insight.targetedReaches === 'number' ? insight.targetedReaches : null,
        blocks: typeof insight.blocks === 'number' ? insight.blocks : null,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('GET /api/line-accounts/:id/follower-insight error:', message);
    return c.json({ success: false, error: 'Failed to fetch LINE follower insight' }, 502);
  }
});

// Existing-follower migration is an explicit, persisted, one-time job.
// No cron polls LINE: connection/UI performs a one-item capability probe, then
// operator-approved step requests advance the D1 cursor until completion.
lineAccounts.get('/api/line-accounts/:id/follower-import', async (c) => {
  const account = await getLineAccountById(c.env.DB, c.req.param('id')!);
  if (!account) return c.json({ success: false, error: 'LINE account not found' }, 404);
  const state = await getFollowerImportState(c.env.DB, account.id);
  return c.json({ success: true, data: state });
});

lineAccounts.post(
  '/api/line-accounts/:id/follower-import/detect',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const account = await getLineAccountById(c.env.DB, c.req.param('id')!);
      if (!account) return c.json({ success: false, error: 'LINE account not found' }, 404);
      const client = new LineClient(account.channel_access_token);
      const state = await detectFollowerImportCapability(
        c.env.DB,
        client as unknown as FollowerImportClient,
        account.id,
      );
      return c.json({ success: true, data: state });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('follower import capability detection error:', message);
      return c.json({ success: false, error: '利用可否の確認に失敗しました' }, 502);
    }
  },
);

lineAccounts.post(
  '/api/line-accounts/:id/follower-import/start',
  requireRole('owner', 'admin'),
  async (c) => {
    const account = await getLineAccountById(c.env.DB, c.req.param('id')!);
    if (!account) return c.json({ success: false, error: 'LINE account not found' }, 404);
    try {
      const state = await startFollowerImport(c.env.DB, account.id);
      return c.json({ success: true, data: state });
    } catch (err) {
      if (err instanceof Error && err.message === 'FOLLOWER_IMPORT_NOT_AVAILABLE') {
        return c.json({ success: false, error: 'このアカウントでは既存友だち取得を利用できません' }, 409);
      }
      throw err;
    }
  },
);

lineAccounts.post(
  '/api/line-accounts/:id/follower-import/step',
  requireRole('owner', 'admin'),
  async (c) => {
    const account = await getLineAccountById(c.env.DB, c.req.param('id')!);
    if (!account) return c.json({ success: false, error: 'LINE account not found' }, 404);
    const client = new LineClient(account.channel_access_token);
    const result = await processFollowerImportStep(
      c.env.DB,
      client as unknown as FollowerImportClient,
      account.id,
    );
    return c.json({ success: true, data: result });
  },
);

// Normalize optional string inputs from the UI:
//   undefined → undefined (caller skips the column)
//   null      → null      (explicit clear)
//   ""        → null      (UI cleared the field)
//   non-string → undefined (defensive: silently drop bad input)
//
// Defined here (and in PATCH below) rather than shared, because the create
// path treats undefined and "" identically (both "no value provided"), while
// the partial-update path needs to distinguish "field absent" (no change)
// from "field cleared" (set to null). Keep the helper local so future
// behavior changes don't accidentally couple the two paths.
function normalizeOptionalString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

// Pair-validate Login Channel ID / Secret. Required because the OAuth flow
// asymmetrically gates on the two columns:
//   /auth/line       — switches to account-specific client_id as soon as
//                      login_channel_id is set (regardless of secret)
//   /auth/callback   — only uses account-specific creds when BOTH are set
// → an account with id-only or secret-only ends up half-configured: looks
// fine in the list, breaks token exchange for new friend-add flows.
//
// Rule: within a single request, the two fields must end up consistent.
// "current" reflects the state already stored (used on update paths so the
// caller can leave the secret unchanged when only renaming the ID).
function validateLoginChannelPair(
  next: { loginChannelId?: string | null | undefined; loginChannelSecret?: string | null | undefined },
  current: { login_channel_id: string | null; login_channel_secret: string | null } | null,
): string | null {
  // Resolve the post-update state for each field.
  // undefined = "not in request" → keep current value
  // null/string = "explicit set"  → use as-is
  const finalId =
    next.loginChannelId === undefined
      ? current?.login_channel_id ?? null
      : next.loginChannelId;
  const finalSecret =
    next.loginChannelSecret === undefined
      ? current?.login_channel_secret ?? null
      : next.loginChannelSecret;

  const idSet = finalId !== null && finalId !== '';
  const secretSet = finalSecret !== null && finalSecret !== '';

  if (idSet !== secretSet) {
    return idSet
      ? 'loginChannelSecret must be provided when loginChannelId is set'
      : 'loginChannelId must be provided when loginChannelSecret is set';
  }
  return null;
}

// Reject duplicate login_channel_id / liff_id across accounts.
// /auth/callback and /api/liff/config both resolve the row with `.first()`
// after a `WHERE col = ?` lookup, so duplicates would silently bind events
// to whichever row D1 happens to return first. App-level check (no DB UNIQUE
// constraint) so we can tighten without a migration on a busy production DB.
async function checkUniqueLoginAndLiff(
  db: D1Database,
  values: { loginChannelId?: string | null | undefined; liffId?: string | null | undefined },
  excludeId: string | null,
): Promise<string | null> {
  // Only check fields we're explicitly setting to non-null.
  const checks: Array<{ column: string; value: string; label: string }> = [];
  if (typeof values.loginChannelId === 'string' && values.loginChannelId !== '') {
    checks.push({ column: 'login_channel_id', value: values.loginChannelId, label: 'loginChannelId' });
  }
  if (typeof values.liffId === 'string' && values.liffId !== '') {
    checks.push({ column: 'liff_id', value: values.liffId, label: 'liffId' });
  }
  for (const { column, value, label } of checks) {
    const row = excludeId
      ? await db
          .prepare(`SELECT id FROM line_accounts WHERE ${column} = ? AND id != ? LIMIT 1`)
          .bind(value, excludeId)
          .first<{ id: string }>()
      : await db
          .prepare(`SELECT id FROM line_accounts WHERE ${column} = ? LIMIT 1`)
          .bind(value)
          .first<{ id: string }>();
    if (row) {
      return `${label} '${value}' is already assigned to another account`;
    }
  }
  return null;
}

// POST /api/line-accounts - create
lineAccounts.post('/api/line-accounts', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{
      channelId: string;
      name: string;
      channelAccessToken: string;
      channelSecret: string;
      loginChannelId?: string | null;
      loginChannelSecret?: string | null;
      liffId?: string | null;
      ogSiteName?: string | null;
      ogDefaultImageUrl?: string | null;
      ogDefaultDescription?: string | null;
    }>();

    if (!body.channelId || !body.name || !body.channelAccessToken || !body.channelSecret) {
      return c.json(
        { success: false, error: 'channelId, name, channelAccessToken, and channelSecret are required' },
        400,
      );
    }

    // Optional fields: empty string from UI = "not provided" → store NULL.
    // Trim whitespace defensively (LINE IDs/secrets shouldn't have spaces;
    // accidental spaces from copy-paste would silently break OAuth otherwise).
    const loginChannelId = normalizeOptionalString(body.loginChannelId) ?? null;
    const loginChannelSecret = normalizeOptionalString(body.loginChannelSecret) ?? null;
    const liffId = normalizeOptionalString(body.liffId) ?? null;

    const pairError = validateLoginChannelPair(
      { loginChannelId, loginChannelSecret },
      null,
    );
    if (pairError) return c.json({ success: false, error: pairError }, 400);

    const dupError = await checkUniqueLoginAndLiff(c.env.DB, { loginChannelId, liffId }, null);
    if (dupError) return c.json({ success: false, error: dupError }, 409);

    const account = await createLineAccount(c.env.DB, {
      channelId: body.channelId,
      name: body.name,
      channelAccessToken: body.channelAccessToken,
      channelSecret: body.channelSecret,
      loginChannelId,
      loginChannelSecret,
      liffId,
      ogSiteName: normalizeOptionalString(body.ogSiteName) ?? null,
      ogDefaultImageUrl: normalizeOptionalString(body.ogDefaultImageUrl) ?? null,
      ogDefaultDescription: normalizeOptionalString(body.ogDefaultDescription) ?? null,
    });

    // One read-only request at connection time records whether this account
    // can use followers/ids. This never starts the migration and is non-fatal:
    // a temporary LINE outage must not roll back account registration.
    try {
      await detectFollowerImportCapability(
        c.env.DB,
        new LineClient(account.channel_access_token) as unknown as FollowerImportClient,
        account.id,
      );
    } catch (err) {
      console.error('[line-accounts] follower import capability probe failed', err);
    }

    // Auto-enroll new account into the 'main' traffic pool.
    // If migration 039 ran before any LINE accounts existed (fresh tenant),
    // the 'main' pool was never seeded — create it on the first account.
    // createTrafficPool already mirrors activeAccountId into pool_accounts,
    // so we only call addPoolAccount when the pool already exists.
    // Non-fatal: account creation succeeds even if pool enrollment fails.
    try {
      const { getTrafficPoolBySlug, createTrafficPool, addPoolAccount } = await import(
        '@line-crm/db'
      );
      const existingMain = await getTrafficPoolBySlug(c.env.DB, 'main');
      if (!existingMain) {
        await createTrafficPool(c.env.DB, {
          slug: 'main',
          name: 'メインプール',
          activeAccountId: account.id,
        });
        console.log(`[line-accounts] created main pool (first-account bootstrap)`);
      } else {
        await addPoolAccount(c.env.DB, existingMain.id, account.id);
        console.log(`[line-accounts] enrolled new account ${account.id} into main pool`);
      }
    } catch (err) {
      console.error('[line-accounts] failed to auto-enroll into main pool', err);
    }

    return c.json({ success: true, data: serializeLineAccountFull(account) }, 201);
  } catch (err) {
    // D1 surfaces UNIQUE-constraint violations as a thrown error. Surface
    // those as 409 so idempotent callers (e.g. create-line-harness retry
    // loop) can treat "already registered" as a non-fatal success.
    const message = err instanceof Error ? err.message : String(err);
    if (/UNIQUE constraint failed/i.test(message)) {
      return c.json({ success: false, error: 'channelId already registered' }, 409);
    }
    console.error('POST /api/line-accounts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// Authorization split:
//   PUT  (credentials replace)                                       -> owner only
//   PATCH /:id   (metadata: country/role/is_active/display_order)    -> owner|admin
//   PATCH /order (display_order bulk reorder)                        -> owner|admin
// Rationale: PUT replaces channel_access_token / channel_secret which is high-risk
// (mistake or misuse can stop production). PATCH only edits display metadata that
// is operationally safe for admins to change without owner intervention.

// PATCH /api/line-accounts/order — bulk update display_order
// IMPORTANT: must be declared BEFORE /:id so Hono matches the literal "order" first.
lineAccounts.patch(
  '/api/line-accounts/order',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const body = await c.req.json<{
        ordered: Array<{ id: string; displayOrder: number }>;
      }>();

      if (!Array.isArray(body.ordered)) {
        return c.json({ success: false, error: 'ordered: array required' }, 400);
      }
      for (const item of body.ordered) {
        if (typeof item.id !== 'string' || typeof item.displayOrder !== 'number') {
          return c.json(
            { success: false, error: 'ordered[].id (string) and displayOrder (number) required' },
            400,
          );
        }
      }

      await updateLineAccountOrder(c.env.DB, body.ordered);
      return c.json({ success: true });
    } catch (err) {
      console.error('PATCH /api/line-accounts/order error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

// PATCH /api/line-accounts/:id — partial update of metadata + optional Login/LIFF wiring.
// Scope: name, isActive, country, role, loginChannelId, loginChannelSecret, liffId.
// Out-of-scope (use PUT instead): channelAccessToken, channelSecret — those are
// production-impacting credentials and require owner-only PUT.
//
// Why loginChannelSecret is allowed via PATCH (admin) but channelSecret isn't:
// rotating the LINE Login secret only breaks the auth/friend-add flow for new
// users (recoverable). Rotating the Messaging channelSecret breaks webhook
// verification for *all* incoming events from LINE → silent message loss, no
// observability until users complain. Different blast radius, different role.
lineAccounts.patch(
  '/api/line-accounts/:id',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const id = c.req.param('id')!;
      const body = await c.req.json<{
        name?: string;
        isActive?: boolean;
        country?: string | null;
        role?: string | null;
        loginChannelId?: string | null;
        loginChannelSecret?: string | null;
        liffId?: string | null;
        ogSiteName?: string | null;
        ogDefaultImageUrl?: string | null;
        ogDefaultDescription?: string | null;
      }>();

      // Normalize: trim non-empty strings; treat empty/whitespace-only as null.
      // Empty-string-from-UI represents "user cleared the field" — store as NULL,
      // not as empty string, so countryFlag() lookup degrades gracefully.
      const country = normalizeOptionalString(body.country);
      const role = normalizeOptionalString(body.role);
      const loginChannelId = normalizeOptionalString(body.loginChannelId);
      const loginChannelSecret = normalizeOptionalString(body.loginChannelSecret);
      const liffId = normalizeOptionalString(body.liffId);
      const ogSiteName = normalizeOptionalString(body.ogSiteName);
      const ogDefaultImageUrl = normalizeOptionalString(body.ogDefaultImageUrl);
      const ogDefaultDescription = normalizeOptionalString(body.ogDefaultDescription);

      // Pre-validate Login pair + uniqueness against the existing row so the
      // caller gets a clean error before we mutate. Skip the lookup entirely
      // if the request doesn't touch any of the fields we'd validate, to
      // avoid a wasted SELECT on the toggle-isActive hot path.
      //
      // The pair check only runs when the request itself touches Login
      // fields. That matters because the setup CLI (packages/create-line-
      // harness/.../setup.ts:646-665) persists `login_channel_id` without
      // `login_channel_secret` as a best-effort step, so accounts in the
      // wild can have a half-set Login pair. A LIFF-only dashboard save
      // shouldn't be blocked by that pre-existing inconsistency.
      const touchesLogin =
        loginChannelId !== undefined || loginChannelSecret !== undefined;
      const touchesLoginOrLiff = touchesLogin || liffId !== undefined;
      if (touchesLoginOrLiff) {
        const current = await getLineAccountById(c.env.DB, id);
        if (!current) return c.json({ success: false, error: 'not found' }, 404);
        if (touchesLogin) {
          const pairError = validateLoginChannelPair(
            { loginChannelId, loginChannelSecret },
            current,
          );
          if (pairError) return c.json({ success: false, error: pairError }, 400);
        }
        const dupError = await checkUniqueLoginAndLiff(
          c.env.DB,
          { loginChannelId, liffId },
          id,
        );
        if (dupError) return c.json({ success: false, error: dupError }, 409);
      }

      const touchesOg =
        ogSiteName !== undefined ||
        ogDefaultImageUrl !== undefined ||
        ogDefaultDescription !== undefined;

      const fieldsTouched =
        country !== undefined ||
        role !== undefined ||
        body.isActive !== undefined ||
        touchesLoginOrLiff ||
        touchesOg;

      // Route to the fields helper when name is not being changed.
      if (body.name === undefined && fieldsTouched) {
        const updated = await updateLineAccountFields(c.env.DB, id, {
          country,
          role,
          isActive: body.isActive,
          loginChannelId,
          loginChannelSecret,
          liffId,
          ogSiteName,
          ogDefaultImageUrl,
          ogDefaultDescription,
        });
        if (!updated) return c.json({ success: false, error: 'not found' }, 404);
        return c.json({ success: true, data: serializeLineAccount(updated) });
      }

      // name is present — use the full updateLineAccount path
      const updated = await updateLineAccount(c.env.DB, id, {
        name: body.name,
        is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
        login_channel_id: loginChannelId,
        login_channel_secret: loginChannelSecret,
        liff_id: liffId,
        og_site_name: ogSiteName,
        og_default_image_url: ogDefaultImageUrl,
        og_default_description: ogDefaultDescription,
      });
      if (!updated) return c.json({ success: false, error: 'LINE account not found' }, 404);
      return c.json({ success: true, data: serializeLineAccount(updated) });
    } catch (err) {
      console.error('PATCH /api/line-accounts/:id error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

// PUT /api/line-accounts/:id - update
// Despite the verb, behaves as a partial update (only provided fields are
// touched). Kept on PUT + owner-only because it's the entry point for
// rotating Messaging credentials (channelAccessToken / channelSecret).
// Also accepts the metadata fields that PATCH handles so an owner can update
// "everything" in one call (e.g. AccountSettingsSection sends country/role
// through this same `api.lineAccounts.update` helper). Without this, country
// and role were silently dropped because PUT used to ignore them.
lineAccounts.put('/api/line-accounts/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const body = await c.req.json<{
      name?: string;
      channelAccessToken?: string;
      channelSecret?: string;
      loginChannelId?: string | null;
      loginChannelSecret?: string | null;
      liffId?: string | null;
      isActive?: boolean;
      country?: string | null;
      role?: string | null;
      ogSiteName?: string | null;
      ogDefaultImageUrl?: string | null;
      ogDefaultDescription?: string | null;
    }>();

    const country = normalizeOptionalString(body.country);
    const role = normalizeOptionalString(body.role);
    const loginChannelId = normalizeOptionalString(body.loginChannelId);
    const loginChannelSecret = normalizeOptionalString(body.loginChannelSecret);
    const liffId = normalizeOptionalString(body.liffId);
    const ogSiteName = normalizeOptionalString(body.ogSiteName);
    const ogDefaultImageUrl = normalizeOptionalString(body.ogDefaultImageUrl);
    const ogDefaultDescription = normalizeOptionalString(body.ogDefaultDescription);

    // Validate Login pair + uniqueness identically to PATCH. PUT is the
    // owner-only credential rotation endpoint, so the same correctness
    // guarantees should apply here.
    const putTouchesLogin =
      loginChannelId !== undefined || loginChannelSecret !== undefined;
    if (putTouchesLogin || liffId !== undefined) {
      const current = await getLineAccountById(c.env.DB, id);
      if (!current) return c.json({ success: false, error: 'LINE account not found' }, 404);
      if (putTouchesLogin) {
        const pairError = validateLoginChannelPair(
          { loginChannelId, loginChannelSecret },
          current,
        );
        if (pairError) return c.json({ success: false, error: pairError }, 400);
      }
      const dupError = await checkUniqueLoginAndLiff(
        c.env.DB,
        { loginChannelId, liffId },
        id,
      );
      if (dupError) return c.json({ success: false, error: dupError }, 409);
    }

    // Two-step update because metadata (country/role) lives on a separate
    // helper from the credentials/name path. Skip whichever step has nothing
    // to do so we don't bump updated_at gratuitously.
    const credentialsTouched =
      body.name !== undefined ||
      body.channelAccessToken !== undefined ||
      body.channelSecret !== undefined ||
      loginChannelId !== undefined ||
      loginChannelSecret !== undefined ||
      liffId !== undefined ||
      body.isActive !== undefined;

    let updated = credentialsTouched
      ? await updateLineAccount(c.env.DB, id, {
          name: body.name,
          channel_access_token: body.channelAccessToken,
          channel_secret: body.channelSecret,
          login_channel_id: loginChannelId,
          login_channel_secret: loginChannelSecret,
          liff_id: liffId,
          is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
        })
      : await getLineAccountById(c.env.DB, id);

    if (!updated) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }

    if (
      country !== undefined ||
      role !== undefined ||
      ogSiteName !== undefined ||
      ogDefaultImageUrl !== undefined ||
      ogDefaultDescription !== undefined
    ) {
      updated = await updateLineAccountFields(c.env.DB, id, {
        country,
        role,
        ogSiteName,
        ogDefaultImageUrl,
        ogDefaultDescription,
      });
      if (!updated) {
        return c.json({ success: false, error: 'LINE account not found' }, 404);
      }
    }

    // Masked, not full: an update may touch only non-secret fields (or send an
    // empty body), in which case the echoed secrets would be the *stored* ones —
    // reopening exactly the read path the GET masking above closes.
    return c.json({ success: true, data: serializeLineAccountMasked(updated) });
  } catch (err) {
    console.error('PUT /api/line-accounts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/line-accounts/:id - delete
lineAccounts.delete('/api/line-accounts/:id', requireRole('owner'), async (c) => {
  try {
    await deleteLineAccount(c.env.DB, c.req.param('id')!);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/line-accounts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { lineAccounts };
