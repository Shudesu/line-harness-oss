import { Hono } from 'hono';
import type { Env } from '../index.js';

const conversations = new Hono<Env>();

// GET /api/conversations?lineAccountId=&minHoursSince=&maxHoursSince=&limit=&offset=
conversations.get('/api/conversations', async (c) => {
  try {
    const url = new URL(c.req.url);
    const accountId = url.searchParams.get('lineAccountId') ?? undefined;
    const minHoursSince = Number(url.searchParams.get('minHoursSince') ?? '0');
    const maxHoursSinceParam = url.searchParams.get('maxHoursSince');
    const maxHoursSince = maxHoursSinceParam !== null ? Number(maxHoursSinceParam) : null;
    const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);
    const offset = Number(url.searchParams.get('offset') ?? '0');

    const whereAccount = accountId ? 'AND f.line_account_id = ?' : '';
    const whereMaxHours =
      maxHoursSince !== null
        ? `AND ((strftime('%s', 'now') - strftime('%s', li.at)) / 3600.0) <= ?`
        : '';

    const sql = `
      WITH last_incoming AS (
        SELECT friend_id, MAX(created_at) AS at
        FROM messages_log
        WHERE direction = 'incoming'
        GROUP BY friend_id
      ),
      last_human AS (
        SELECT friend_id, MAX(created_at) AS at
        FROM messages_log
        WHERE direction = 'outgoing' AND source = 'manual'
        GROUP BY friend_id
      ),
      latest_msg AS (
        SELECT ml.friend_id, ml.content, ml.message_type
        FROM messages_log ml
        INNER JOIN (
          SELECT friend_id, MAX(created_at) AS mx
          FROM messages_log WHERE direction = 'incoming'
          GROUP BY friend_id
        ) lm ON lm.friend_id = ml.friend_id AND lm.mx = ml.created_at
        WHERE ml.direction = 'incoming'
      )
      SELECT
        f.id AS friend_id,
        f.line_user_id,
        f.display_name,
        f.line_account_id,
        la.name AS line_account_name,
        li.at AS last_incoming_at,
        (strftime('%s', 'now') - strftime('%s', li.at)) / 3600.0 AS hours_since,
        substr(lm.content, 1, 80) AS last_incoming_preview,
        lm.message_type AS last_incoming_type
      FROM friends f
      LEFT JOIN line_accounts la ON la.id = f.line_account_id
      INNER JOIN last_incoming li ON li.friend_id = f.id
      LEFT JOIN last_human lh ON lh.friend_id = f.id
      LEFT JOIN latest_msg lm ON lm.friend_id = f.id
      WHERE f.is_following = 1
        AND (lh.at IS NULL OR lh.at < li.at)
        AND ((strftime('%s', 'now') - strftime('%s', li.at)) / 3600.0) >= ?
        ${whereMaxHours}
        ${whereAccount}
      ORDER BY li.at ASC
      LIMIT ? OFFSET ?
    `;

    const bindings: (string | number)[] = [minHoursSince];
    if (maxHoursSince !== null) bindings.push(maxHoursSince);
    if (accountId) bindings.push(accountId);
    bindings.push(limit, offset);

    const { results } = await c.env.DB.prepare(sql)
      .bind(...bindings)
      .all();

    // total count
    const countSql = `
      WITH last_incoming AS (
        SELECT friend_id, MAX(created_at) AS at FROM messages_log
        WHERE direction = 'incoming' GROUP BY friend_id
      ),
      last_human AS (
        SELECT friend_id, MAX(created_at) AS at FROM messages_log
        WHERE direction = 'outgoing' AND source = 'manual' GROUP BY friend_id
      )
      SELECT COUNT(*) AS total FROM friends f
      INNER JOIN last_incoming li ON li.friend_id = f.id
      LEFT JOIN last_human lh ON lh.friend_id = f.id
      WHERE f.is_following = 1
        AND (lh.at IS NULL OR lh.at < li.at)
        AND ((strftime('%s', 'now') - strftime('%s', li.at)) / 3600.0) >= ?
        ${whereMaxHours}
        ${whereAccount}
    `;
    const countBindings: (string | number)[] = [minHoursSince];
    if (maxHoursSince !== null) countBindings.push(maxHoursSince);
    if (accountId) countBindings.push(accountId);

    const countRow = await c.env.DB.prepare(countSql)
      .bind(...countBindings)
      .first<{ total: number }>();

    // tags lookup (friend_id -> tag names)
    const friendIds = results.map((r) => (r as { friend_id: string }).friend_id);
    const tagMap: Record<string, string[]> = {};
    if (friendIds.length > 0) {
      const placeholders = friendIds.map(() => '?').join(',');
      const tagRows = await c.env.DB.prepare(
        `SELECT ft.friend_id, t.name FROM friend_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.friend_id IN (${placeholders})`,
      )
        .bind(...friendIds)
        .all<{ friend_id: string; name: string }>();
      for (const row of tagRows.results) {
        (tagMap[row.friend_id] ??= []).push(row.name);
      }
    }

    const items = results.map((r) => {
      const row = r as {
        friend_id: string;
        line_user_id: string;
        display_name: string | null;
        line_account_id: string | null;
        line_account_name: string | null;
        last_incoming_at: string;
        hours_since: number;
        last_incoming_preview: string | null;
        last_incoming_type: string | null;
      };
      return {
        friendId: row.friend_id,
        lineUserId: row.line_user_id,
        displayName: row.display_name,
        lineAccountId: row.line_account_id,
        lineAccountName: row.line_account_name,
        lastIncomingAt: row.last_incoming_at,
        hoursSince: Math.round(row.hours_since * 10) / 10,
        lastIncomingPreview: row.last_incoming_preview,
        lastIncomingType: row.last_incoming_type,
        tags: tagMap[row.friend_id] ?? [],
      };
    });

    return c.json({ success: true, data: { total: countRow?.total ?? 0, items } });
  } catch (err) {
    console.error('GET /api/conversations error:', err);
    return c.json({ success: false, error: String(err) }, 500);
  }
});

// GET /api/conversations/:friendId?limit=&before=
conversations.get('/api/conversations/:friendId', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    const url = new URL(c.req.url);
    const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200);
    const before = url.searchParams.get('before');

    const friend = await c.env.DB.prepare(
      `SELECT f.id, f.line_user_id, f.display_name, f.is_following, f.line_account_id, la.name AS line_account_name
       FROM friends f LEFT JOIN line_accounts la ON la.id = f.line_account_id WHERE f.id = ?`,
    )
      .bind(friendId)
      .first<{
        id: string;
        line_user_id: string;
        display_name: string | null;
        is_following: number;
        line_account_id: string | null;
        line_account_name: string | null;
      }>();

    if (!friend) {
      return c.json({ success: false, error: 'friend not found' }, 404);
    }

    const tagRows = await c.env.DB.prepare(
      `SELECT t.name FROM friend_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.friend_id = ?`,
    )
      .bind(friendId)
      .all<{ name: string }>();
    const tags = tagRows.results.map((r) => r.name);

    // Normalize the `before` cursor via julianday() so sub-second precision
    // is preserved and cursors in any ISO 8601 timezone form (Z, +09:00) sort
    // correctly against stored `+09:00` timestamps. strftime('%s', ...) would
    // truncate to whole seconds and drop messages that share a second.
    const msgSql = before
      ? `SELECT id, direction, message_type, content, delivery_type, source, broadcast_id, scenario_step_id, created_at
         FROM messages_log WHERE friend_id = ? AND julianday(created_at) < julianday(?)
         ORDER BY created_at DESC LIMIT ?`
      : `SELECT id, direction, message_type, content, delivery_type, source, broadcast_id, scenario_step_id, created_at
         FROM messages_log WHERE friend_id = ?
         ORDER BY created_at DESC LIMIT ?`;
    const bindings: (string | number)[] = before ? [friendId, before, limit] : [friendId, limit];
    const msgResult = await c.env.DB.prepare(msgSql)
      .bind(...bindings)
      .all<{
        id: string;
        direction: 'incoming' | 'outgoing';
        message_type: string;
        content: string;
        delivery_type: string | null;
        source: string | null;
        broadcast_id: string | null;
        scenario_step_id: string | null;
        created_at: string;
      }>();

    const messages = msgResult.results.reverse().map((m) => ({
      id: m.id,
      direction: m.direction,
      messageType: m.message_type,
      content: m.content,
      deliveryType: m.delivery_type,
      source: m.source ?? (m.direction === 'incoming' ? 'user' : 'manual'),
      createdAt: m.created_at,
    }));

    return c.json({
      success: true,
      data: {
        friend: {
          friendId: friend.id,
          lineUserId: friend.line_user_id,
          displayName: friend.display_name,
          lineAccountId: friend.line_account_id,
          lineAccountName: friend.line_account_name,
          isFollowing: friend.is_following === 1,
          tags,
        },
        messages,
      },
    });
  } catch (err) {
    console.error('GET /api/conversations/:friendId error:', err);
    return c.json({ success: false, error: String(err) }, 500);
  }
});

export { conversations };
