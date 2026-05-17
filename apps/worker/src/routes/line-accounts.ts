import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import {
  getLineAccounts,
  getLineAccountById,
  createLineAccount,
  updateLineAccount,
  deleteLineAccount,
  upsertFriend,
  getFriendByLineUserId,
  jstNow,
} from '@line-crm/db';
import type { LineAccount as DbLineAccount } from '@line-crm/db';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';
import { hasColumn } from '../utils/db-compat.js';

const lineAccounts = new Hono<Env>();

function serializeLineAccount(row: DbLineAccount) {
  return {
    id: row.id,
    channelId: row.channel_id,
    name: row.name,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // Intentionally omit channelAccessToken and channelSecret from list responses
  };
}

function serializeLineAccountFull(row: DbLineAccount) {
  return {
    ...serializeLineAccount(row),
    channelAccessToken: row.channel_access_token,
    channelSecret: row.channel_secret,
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
    const hasFriendLineAccountId = await hasColumn(db, 'friends', 'line_account_id');

    // Get stats for all accounts in parallel
    const results = await Promise.all(
      items.map(async (item) => {
        const profile = await fetchBotProfile(item.channel_access_token);
        const [friendCount, scenarioCount, msgCount] = hasFriendLineAccountId
          ? await Promise.all([
              db.prepare(`SELECT COUNT(*) as count FROM friends WHERE is_following = 1 AND line_account_id = ?`).bind(item.id).first<{ count: number }>(),
              db.prepare(
                `SELECT COUNT(*) as count FROM friend_scenarios fs
                 INNER JOIN friends f ON f.id = fs.friend_id
                 WHERE fs.status = 'active' AND f.line_account_id = ?`,
              ).bind(item.id).first<{ count: number }>(),
              db.prepare(
                `SELECT COUNT(*) as count FROM messages_log ml
                 INNER JOIN friends f ON f.id = ml.friend_id
                 WHERE ml.direction = 'outgoing' AND (ml.delivery_type IS NULL OR ml.delivery_type = 'push') AND ml.created_at >= date('now', '-30 days') AND f.line_account_id = ?`,
              ).bind(item.id).first<{ count: number }>(),
            ])
          : [null, null, null];

        return {
          ...serializeLineAccount(item),
          displayName: profile.displayName || item.name,
          pictureUrl: profile.pictureUrl || null,
          basicId: profile.basicId || null,
          stats: {
            friendCount: friendCount?.count ?? 0,
            activeScenarios: scenarioCount?.count ?? 0,
            messagesThisMonth: msgCount?.count ?? 0,
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

// GET /api/line-accounts/:id - get single (secrets only for owner/admin)
lineAccounts.get('/api/line-accounts/:id', async (c) => {
  try {
    const account = await getLineAccountById(c.env.DB, c.req.param('id'));
    if (!account) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    const staff = c.get('staff');
    const data = staff?.role === 'staff'
      ? serializeLineAccount(account)
      : serializeLineAccountFull(account);
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/line-accounts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/line-accounts - create
lineAccounts.post('/api/line-accounts', requireRole('owner'), async (c) => {
  try {
    const body = await c.req.json<{
      channelId: string;
      name: string;
      channelAccessToken: string;
      channelSecret: string;
    }>();

    if (!body.channelId || !body.name || !body.channelAccessToken || !body.channelSecret) {
      return c.json(
        { success: false, error: 'channelId, name, channelAccessToken, and channelSecret are required' },
        400,
      );
    }

    const account = await createLineAccount(c.env.DB, body);
    return c.json({ success: true, data: serializeLineAccountFull(account) }, 201);
  } catch (err) {
    console.error('POST /api/line-accounts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/line-accounts/:id - update
lineAccounts.put('/api/line-accounts/:id', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const body = await c.req.json<{
      name?: string;
      channelAccessToken?: string;
      channelSecret?: string;
      isActive?: boolean;
    }>();

    const updated = await updateLineAccount(c.env.DB, id, {
      name: body.name,
      channel_access_token: body.channelAccessToken,
      channel_secret: body.channelSecret,
      is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
    });

    if (!updated) {
      return c.json({ success: false, error: 'LINE account not found' }, 404);
    }
    return c.json({ success: true, data: serializeLineAccountFull(updated) });
  } catch (err) {
    console.error('PUT /api/line-accounts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/line-accounts/:id/sync-followers - pull follower list from LINE API
//
// LINE Platform does not replay `follow` events, so friends added before this
// system was attached to the official account never reach the DB until they
// message us. This endpoint walks LINE's `GET /v2/bot/followers/ids` cursor
// once per request, upserts each friend, and returns the next cursor so the
// caller (web UI) can drive the loop without blowing the Worker CPU budget.
lineAccounts.post('/api/line-accounts/:id/sync-followers', requireRole('owner'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const account = await getLineAccountById(c.env.DB, id);
    if (!account) return c.json({ success: false, error: 'LINE account not found' }, 404);
    if (!account.is_active) return c.json({ success: false, error: 'LINE account is not active' }, 400);

    const start = c.req.query('start') || undefined;
    const limitParam = Number(c.req.query('limit') ?? '300');
    const pageLimit = Math.min(1000, Math.max(50, Number.isFinite(limitParam) ? limitParam : 300));

    const client = new LineClient(account.channel_access_token);
    const page = await client.getFollowerIds({ start, limit: pageLimit });

    const hasFriendLineAccountId = await hasColumn(c.env.DB, 'friends', 'line_account_id');

    let created = 0;
    let updated = 0;
    let failed = 0;

    // getProfile is rate-limited softly; bound concurrency so a large account
    // doesn't trip LINE's per-second cap. Workers can hold many in-flight fetches
    // cheaply since they're I/O-bound.
    const CONCURRENCY = 10;
    for (let i = 0; i < page.userIds.length; i += CONCURRENCY) {
      const batch = page.userIds.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (lineUserId) => {
        try {
          const existing = await getFriendByLineUserId(c.env.DB, lineUserId);
          let profile;
          // Only fetch profile for new friends — re-syncs shouldn't refresh
          // display_name/picture_url on every run (LINE rate limits and we
          // already keep these fresh from webhook events).
          if (!existing) {
            try {
              profile = await client.getProfile(lineUserId);
            } catch (err) {
              console.warn(`[sync-followers] getProfile failed userId=${lineUserId}`, err);
            }
          }
          const friend = await upsertFriend(c.env.DB, {
            lineUserId,
            displayName: profile?.displayName ?? existing?.display_name ?? null,
            pictureUrl: profile?.pictureUrl ?? existing?.picture_url ?? null,
            statusMessage: profile?.statusMessage ?? existing?.status_message ?? null,
          });
          if (hasFriendLineAccountId && friend.line_account_id !== id) {
            await c.env.DB
              .prepare('UPDATE friends SET line_account_id = ?, updated_at = ? WHERE id = ?')
              .bind(id, jstNow(), friend.id)
              .run();
          }
          if (existing) updated++;
          else created++;
        } catch (err) {
          failed++;
          console.error(`[sync-followers] failed userId=${lineUserId}`, err);
        }
      }));
    }

    return c.json({
      success: true,
      data: {
        processed: page.userIds.length,
        created,
        updated,
        failed,
        next: page.next ?? null,
        done: !page.next,
      },
    });
  } catch (err) {
    console.error('POST /api/line-accounts/:id/sync-followers error:', err);
    const message = err instanceof Error ? err.message : 'Internal server error';
    return c.json({ success: false, error: message }, 500);
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
