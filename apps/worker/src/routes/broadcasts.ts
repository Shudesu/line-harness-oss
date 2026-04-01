import { Hono } from 'hono';
import {
  getBroadcasts,
  getBroadcastById,
  createBroadcast,
  updateBroadcast,
  deleteBroadcast,
} from '@line-crm/db';
import type { Broadcast as DbBroadcast, BroadcastMessageType, BroadcastTargetType } from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import { processBroadcastSend, buildMessage } from '../services/broadcast.js';
import { processSegmentSend } from '../services/segment-send.js';
import type { SegmentCondition } from '../services/segment-query.js';
import { getLineAccountById } from '@line-crm/db';
import type { Env } from '../index.js';

const broadcasts = new Hono<Env>();

function serializeBroadcast(row: DbBroadcast) {
  const r = row as unknown as Record<string, unknown>;
  return {
    id: row.id,
    title: row.title,
    messageType: row.message_type,
    messageContent: row.message_content,
    targetType: row.target_type,
    targetTagId: row.target_tag_id,
    status: row.status,
    scheduledAt: row.scheduled_at,
    sentAt: row.sent_at,
    totalCount: row.total_count,
    successCount: row.success_count,
    lineRequestId: r.line_request_id || null,
    aggregationUnit: r.aggregation_unit || null,
    lineAccountId: r.line_account_id || null,
    createdAt: row.created_at,
  };
}

// GET /api/broadcasts - list all
broadcasts.get('/api/broadcasts', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    const items = await getBroadcasts(c.env.DB, lineAccountId || undefined);
    return c.json({ success: true, data: items.map(serializeBroadcast) });
  } catch (err) {
    console.error('GET /api/broadcasts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/broadcasts/:id - get single
broadcasts.get('/api/broadcasts/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const broadcast = await getBroadcastById(c.env.DB, id);

    if (!broadcast) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }

    return c.json({ success: true, data: serializeBroadcast(broadcast) });
  } catch (err) {
    console.error('GET /api/broadcasts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts - create
broadcasts.post('/api/broadcasts', async (c) => {
  try {
    const body = await c.req.json<{
      title: string;
      messageType: BroadcastMessageType;
      messageContent: string;
      targetType: BroadcastTargetType;
      targetTagId?: string | null;
      scheduledAt?: string | null;
      lineAccountId?: string | null;
      altText?: string | null;
    }>();

    if (!body.title || !body.messageType || !body.messageContent || !body.targetType) {
      return c.json(
        { success: false, error: 'title, messageType, messageContent, and targetType are required' },
        400,
      );
    }

    if ((body.targetType === 'tag' || body.targetType === 'tag_exclude') && !body.targetTagId) {
      return c.json(
        { success: false, error: 'targetTagId is required when targetType is "tag" or "tag_exclude"' },
        400,
      );
    }

    const broadcast = await createBroadcast(c.env.DB, {
      title: body.title,
      messageType: body.messageType,
      messageContent: body.messageContent,
      targetType: body.targetType,
      targetTagId: body.targetTagId ?? null,
      scheduledAt: body.scheduledAt ?? null,
    });

    // Save line_account_id and alt_text if provided
    const updates: string[] = [];
    const binds: unknown[] = [];
    if (body.lineAccountId) { updates.push('line_account_id = ?'); binds.push(body.lineAccountId); }
    if (body.altText) { updates.push('alt_text = ?'); binds.push(body.altText); }
    if (updates.length > 0) {
      binds.push(broadcast.id);
      await c.env.DB.prepare(`UPDATE broadcasts SET ${updates.join(', ')} WHERE id = ?`)
        .bind(...binds).run();
    }

    return c.json({ success: true, data: serializeBroadcast(broadcast) }, 201);
  } catch (err) {
    console.error('POST /api/broadcasts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/broadcasts/:id - update draft
broadcasts.put('/api/broadcasts/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getBroadcastById(c.env.DB, id);

    if (!existing) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }

    if (existing.status !== 'draft' && existing.status !== 'scheduled') {
      return c.json({ success: false, error: 'Only draft or scheduled broadcasts can be updated' }, 400);
    }

    const body = await c.req.json<{
      title?: string;
      messageType?: BroadcastMessageType;
      messageContent?: string;
      targetType?: BroadcastTargetType;
      targetTagId?: string | null;
      scheduledAt?: string | null;
    }>();

    // Keep status in sync with scheduledAt changes
    let statusUpdate: 'draft' | 'scheduled' | undefined;
    if (body.scheduledAt !== undefined) {
      statusUpdate = body.scheduledAt ? 'scheduled' : 'draft';
    }

    const updated = await updateBroadcast(c.env.DB, id, {
      title: body.title,
      message_type: body.messageType,
      message_content: body.messageContent,
      target_type: body.targetType,
      target_tag_id: body.targetTagId,
      scheduled_at: body.scheduledAt,
      ...(statusUpdate !== undefined ? { status: statusUpdate } : {}),
    });

    return c.json({ success: true, data: updated ? serializeBroadcast(updated) : null });
  } catch (err) {
    console.error('PUT /api/broadcasts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/broadcasts/:id - delete
broadcasts.delete('/api/broadcasts/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await deleteBroadcast(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/broadcasts/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/:id/send - send now (tag配信で500人超はキュー方式)
broadcasts.post('/api/broadcasts/:id/send', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getBroadcastById(c.env.DB, id);

    if (!existing) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }

    if (existing.status === 'sending' || existing.status === 'sent') {
      return c.json({ success: false, error: 'Broadcast is already sent or sending' }, 400);
    }

    // target_type='tag' で対象が多い場合はキュー方式
    if (existing.target_type === 'tag' && existing.target_tag_id) {
      const { getFriendsByTag } = await import('@line-crm/db');
      const friends = await getFriendsByTag(c.env.DB, existing.target_tag_id);
      const followingCount = friends.filter(f => f.is_following).length;

      if (followingCount > 500) {
        // Set segment_conditions to a marker so getQueuedBroadcasts() can find it
        const tagMarker = JSON.stringify({ operator: 'AND', rules: [{ type: 'tag_exists', value: existing.target_tag_id }] });
        await c.env.DB.prepare(
          `UPDATE broadcasts SET status = 'sending', batch_offset = 0, segment_conditions = ? WHERE id = ?`
        ).bind(tagMarker, id).run();
        const result = await getBroadcastById(c.env.DB, id);
        return c.json({ success: true, data: result ? serializeBroadcast(result) : null, queued: true, message: 'Broadcast queued for batch processing by Cron' }, 202);
      }
    }

    // 500人以下またはtarget_type='all'は即時送信
    let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
    const broadcastAccountId = (existing as unknown as Record<string, unknown>).line_account_id;
    if (broadcastAccountId) {
      const { getLineAccountById } = await import('@line-crm/db');
      const account = await getLineAccountById(c.env.DB, broadcastAccountId as string);
      if (account) accessToken = account.channel_access_token;
    }
    const lineClient = new LineClient(accessToken);
    await processBroadcastSend(c.env.DB, lineClient, id, c.env.WORKER_URL);

    const result = await getBroadcastById(c.env.DB, id);
    return c.json({ success: true, data: result ? serializeBroadcast(result) : null });
  } catch (err) {
    console.error('POST /api/broadcasts/:id/send error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/:id/send-segment - send to a filtered segment (常にキュー方式)
broadcasts.post('/api/broadcasts/:id/send-segment', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getBroadcastById(c.env.DB, id);

    if (!existing) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }

    if (existing.status === 'sending' || existing.status === 'sent') {
      return c.json({ success: false, error: 'Broadcast is already sent or sending' }, 400);
    }

    const body = await c.req.json<{ conditions: SegmentCondition }>();

    if (!body.conditions || !body.conditions.operator || !Array.isArray(body.conditions.rules)) {
      return c.json(
        { success: false, error: 'conditions with operator and rules array is required' },
        400,
      );
    }

    // セグメント配信は常にキュー方式（タイムアウト防止）
    await c.env.DB.prepare(
      `UPDATE broadcasts SET status = 'sending', batch_offset = 0, segment_conditions = ? WHERE id = ?`
    ).bind(JSON.stringify(body.conditions), id).run();

    const result = await getBroadcastById(c.env.DB, id);
    return c.json({ success: true, data: result ? serializeBroadcast(result) : null, queued: true, message: 'Broadcast queued for batch processing by Cron' }, 202);
  } catch (err) {
    console.error('POST /api/broadcasts/:id/send-segment error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/broadcasts/:id/insight — インサイト（開封率・クリック率）取得
broadcasts.get('/api/broadcasts/:id/insight', async (c) => {
  try {
    const id = c.req.param('id');
    const insight = await c.env.DB.prepare(
      'SELECT * FROM broadcast_insights WHERE broadcast_id = ? ORDER BY created_at DESC LIMIT 1'
    ).bind(id).first<Record<string, unknown>>();

    if (!insight) {
      return c.json({ success: true, data: null, message: 'Insight not yet available' });
    }

    return c.json({
      success: true,
      data: {
        broadcastId: insight.broadcast_id,
        delivered: insight.delivered,
        uniqueImpression: insight.unique_impression,
        uniqueClick: insight.unique_click,
        uniqueMediaPlayed: insight.unique_media_played,
        openRate: insight.open_rate,
        clickRate: insight.click_rate,
        status: insight.status,
        fetchedAt: insight.fetched_at,
      },
    });
  } catch (err) {
    console.error('GET /api/broadcasts/:id/insight error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/:id/fetch-insight — LINE APIからインサイトを即時取得
broadcasts.post('/api/broadcasts/:id/fetch-insight', async (c) => {
  try {
    const id = c.req.param('id');
    const broadcast = await getBroadcastById(c.env.DB, id);
    if (!broadcast) {
      return c.json({ success: false, error: 'Broadcast not found' }, 404);
    }
    if (broadcast.status !== 'sent') {
      return c.json({ success: false, error: 'Broadcast has not been sent yet' }, 400);
    }

    // DBから直接取得してline_request_id/aggregation_unitを確実に読む
    const rawBroadcast = await c.env.DB.prepare('SELECT line_request_id, aggregation_unit, line_account_id FROM broadcasts WHERE id = ?').bind(id).first<Record<string, string | null>>();
    const lineRequestId = rawBroadcast?.line_request_id || null;
    const aggregationUnit = rawBroadcast?.aggregation_unit || null;

    if (!lineRequestId && !aggregationUnit) {
      return c.json({ success: false, error: 'No line_request_id or aggregation_unit available for this broadcast' }, 400);
    }

    // LINE APIクライアントを解決
    let accessToken = c.env.LINE_CHANNEL_ACCESS_TOKEN;
    const accountId = rawBroadcast?.line_account_id || null;
    if (accountId) {
      const { getLineAccountById } = await import('@line-crm/db');
      const account = await getLineAccountById(c.env.DB, accountId);
      if (account) accessToken = account.channel_access_token;
    }
    const lineClient = new LineClient(accessToken);

    let delivered: number | null = null;
    let uniqueImpression: number | null = null;
    let uniqueClick: number | null = null;
    let uniqueMediaPlayed: number | null = null;
    let rawResponse: string = '{}';

    if (lineRequestId) {
      const response = await lineClient.getMessageEventInsight(lineRequestId) as Record<string, unknown>;
      const overview = response.overview as Record<string, unknown> | undefined;
      delivered = (overview?.delivered as number) ?? null;
      uniqueImpression = (overview?.uniqueImpression as number) ?? null;
      uniqueClick = (overview?.uniqueClick as number) ?? null;
      uniqueMediaPlayed = (overview?.uniqueMediaPlayed as number) ?? null;
      rawResponse = JSON.stringify(response);
    } else if (aggregationUnit) {
      const sentDate = broadcast.sent_at!.slice(0, 10).replace(/-/g, '');
      const response = await lineClient.getUnitInsight(aggregationUnit, sentDate, sentDate) as Record<string, unknown>;
      const messages = response.messages as Array<Record<string, unknown>> | undefined;
      const overview = messages?.[0] || {};
      uniqueImpression = (overview.uniqueImpression as number) ?? null;
      uniqueClick = (overview.uniqueClick as number) ?? null;
      uniqueMediaPlayed = (overview.uniqueMediaPlayed as number) ?? null;
      rawResponse = JSON.stringify(response);
    }

    const openRate = (delivered && uniqueImpression) ? uniqueImpression / delivered : null;
    const clickRate = (delivered && uniqueClick) ? uniqueClick / delivered : null;

    // Upsert insight
    const insightId = crypto.randomUUID();
    const { jstNow } = await import('@line-crm/db');
    const now = jstNow();
    await c.env.DB.prepare(
      `INSERT INTO broadcast_insights (id, broadcast_id, delivered, unique_impression, unique_click, unique_media_played, open_rate, click_rate, raw_response, status, fetched_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
       ON CONFLICT(broadcast_id) DO UPDATE SET
         delivered = excluded.delivered,
         unique_impression = excluded.unique_impression,
         unique_click = excluded.unique_click,
         unique_media_played = excluded.unique_media_played,
         open_rate = excluded.open_rate,
         click_rate = excluded.click_rate,
         raw_response = excluded.raw_response,
         status = 'ready',
         fetched_at = excluded.fetched_at`
    ).bind(insightId, id, delivered, uniqueImpression, uniqueClick, uniqueMediaPlayed, openRate, clickRate, rawResponse, now, now).run();

    return c.json({
      success: true,
      data: { delivered, uniqueImpression, uniqueClick, uniqueMediaPlayed, openRate, clickRate },
    });
  } catch (err) {
    console.error('POST /api/broadcasts/:id/fetch-insight error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/broadcasts/:id/test-send — send to test recipients with 【テスト配信】 label
broadcasts.post('/api/broadcasts/:id/test-send', async (c) => {
  const id = c.req.param('id');
  try {
    const broadcast = await getBroadcastById(c.env.DB, id);
    if (!broadcast) return c.json({ success: false, error: 'Broadcast not found' }, 404);
    if (broadcast.status !== 'draft') {
      return c.json({ success: false, error: 'Only draft broadcasts can be test-sent' }, 400);
    }

    const raw = broadcast as unknown as Record<string, unknown>;
    const accountId = raw.line_account_id as string | null;
    if (!accountId) return c.json({ success: false, error: 'Broadcast has no line_account_id' }, 400);

    // Get test recipients
    const setting = await c.env.DB.prepare(
      `SELECT value FROM account_settings WHERE line_account_id = ? AND key = 'test_recipients'`
    ).bind(accountId).first<{ value: string }>();
    if (!setting) return c.json({ success: false, error: 'No test recipients configured' }, 400);

    const friendIds: string[] = JSON.parse(setting.value);
    if (friendIds.length === 0) return c.json({ success: false, error: 'No test recipients configured' }, 400);

    const placeholders = friendIds.map(() => '?').join(',');
    const friends = await c.env.DB.prepare(
      `SELECT id, line_user_id FROM friends WHERE id IN (${placeholders})`
    ).bind(...friendIds).all<{ id: string; line_user_id: string }>();

    const account = await getLineAccountById(c.env.DB, accountId);
    if (!account) return c.json({ success: false, error: 'LINE account not found' }, 400);
    const lineClient = new LineClient(account.channel_access_token);

    // Build message with test label
    let messageContent = broadcast.message_content;
    if (broadcast.message_type === 'text') {
      messageContent = `【テスト配信】\n${messageContent}`;
    }

    // Auto-track URLs
    const { autoTrackContent } = await import('../services/auto-track.js');
    const tracked = await autoTrackContent(c.env.DB, broadcast.message_type, messageContent, c.env.WORKER_URL);

    const { extractFlexAltText } = await import('../utils/flex-alt-text.js');
    const altText = raw.alt_text as string || (tracked.messageType === 'flex' ? extractFlexAltText(tracked.content) : undefined);
    const message = buildMessage(tracked.messageType, tracked.content, altText);

    let sent = 0;
    let failed = 0;
    const now = new Date(Date.now() + 9 * 60 * 60_000).toISOString().replace('Z', '+09:00');

    for (const friend of friends.results) {
      try {
        await lineClient.pushMessage(friend.line_user_id, [message]);
        sent++;
        await c.env.DB.prepare(
          `INSERT INTO messages_log (id, friend_id, direction, message_type, content, broadcast_id, delivery_type, source, created_at)
           VALUES (?, ?, 'outgoing', ?, ?, NULL, 'test', 'broadcast', ?)`
        ).bind(crypto.randomUUID(), friend.id, broadcast.message_type, messageContent, now).run();
      } catch (err) {
        console.error(`Test send to ${friend.id} failed:`, err);
        failed++;
      }
    }

    return c.json({ success: true, sent, failed });
  } catch (err) {
    console.error('POST /api/broadcasts/:id/test-send error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/broadcasts/:id/progress — batch send progress
broadcasts.get('/api/broadcasts/:id/progress', async (c) => {
  const id = c.req.param('id');
  const broadcast = await getBroadcastById(c.env.DB, id);
  if (!broadcast) return c.json({ success: false, error: 'Not found' }, 404);

  const raw = broadcast as unknown as Record<string, unknown>;
  return c.json({
    success: true,
    data: {
      status: broadcast.status,
      totalCount: broadcast.total_count,
      successCount: broadcast.success_count,
      batchOffset: raw.batch_offset as number,
    },
  });
});

// POST /api/segments/count — count friends matching segment conditions
broadcasts.post('/api/segments/count', async (c) => {
  const body = await c.req.json<{ conditions: unknown; accountId?: string }>();
  try {
    const { buildSegmentQuery } = await import('../services/segment-query.js');
    const { sql, bindings } = buildSegmentQuery(body.conditions as SegmentCondition);

    let accountSql = sql;
    const accountBindings = [...bindings];
    if (body.accountId) {
      accountSql = sql.replace('WHERE', 'WHERE f.line_account_id = ? AND');
      accountBindings.unshift(body.accountId);
    }

    const countSql = accountSql.replace(/^SELECT .+ FROM/, 'SELECT COUNT(*) as count FROM');
    const result = await c.env.DB.prepare(countSql).bind(...accountBindings).first<{ count: number }>();

    return c.json({ success: true, count: result?.count ?? 0 });
  } catch (err) {
    console.error('POST /api/segments/count error:', err);
    return c.json({ success: false, error: 'Invalid segment conditions' }, 400);
  }
});

export { broadcasts };
