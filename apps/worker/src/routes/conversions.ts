import { Hono } from 'hono';
import {
  getConversionPoints,
  getConversionPointById,
  createConversionPoint,
  deleteConversionPoint,
  trackConversion,
  getConversionEvents,
  getConversionReport,
} from '@line-crm/db';
import { getFriendOrReject } from '../utils/account-boundary.js';
import type { Env } from '../index.js';

const conversions = new Hono<Env>();

// ── Conversion Points ───────────────────────────────────────────────────────

// GET /api/conversions/points - list all
conversions.get('/api/conversions/points', async (c) => {
  try {
    const items = await getConversionPoints(c.env.DB);
    return c.json({
      success: true,
      data: items.map((p) => ({
        id: p.id,
        name: p.name,
        eventType: p.event_type,
        value: p.value,
        createdAt: p.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/conversions/points error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/conversions/points - create
conversions.post('/api/conversions/points', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      eventType: string;
      value?: number | null;
    }>();

    if (!body.name || !body.eventType) {
      return c.json({ success: false, error: 'name and eventType are required' }, 400);
    }

    const point = await createConversionPoint(c.env.DB, body);
    return c.json({
      success: true,
      data: {
        id: point.id,
        name: point.name,
        eventType: point.event_type,
        value: point.value,
        createdAt: point.created_at,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/conversions/points error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/conversions/points/:id - delete
conversions.delete('/api/conversions/points/:id', async (c) => {
  try {
    await deleteConversionPoint(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/conversions/points/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ── Conversion Tracking ─────────────────────────────────────────────────────

// POST /api/conversions/track - record conversion
// Codex P0 修正: account 境界を強制。任意 friendId で他テナントの CV を記録
// できないよう、呼び出し側に lineAccountId を渡させ、friend.line_account_id と
// 一致しなければ 403。
conversions.post('/api/conversions/track', async (c) => {
  try {
    const body = await c.req.json<{
      conversionPointId: string;
      friendId: string;
      lineAccountId?: string;
      userId?: string | null;
      affiliateCode?: string | null;
      metadata?: Record<string, unknown> | null;
    }>();

    if (!body.conversionPointId || !body.friendId) {
      return c.json(
        { success: false, error: 'conversionPointId and friendId are required' },
        400,
      );
    }
    // body 優先、無ければ query (cookie/external from LIFF 等で query 経由になる)
    const lineAccountId = body.lineAccountId ?? c.req.query('lineAccountId');
    if (!lineAccountId) {
      return c.json(
        { success: false, error: 'lineAccountId is required' },
        400,
      );
    }
    const guard = await getFriendOrReject(c.env.DB, body.friendId, lineAccountId);
    if (!guard.ok) {
      return c.json({ success: false, error: guard.error }, guard.status);
    }

    const event = await trackConversion(c.env.DB, {
      conversionPointId: body.conversionPointId,
      friendId: body.friendId,
      userId: body.userId,
      affiliateCode: body.affiliateCode,
      metadata: body.metadata ? JSON.stringify(body.metadata) : null,
    });

    return c.json({
      success: true,
      data: {
        id: event.id,
        conversionPointId: event.conversion_point_id,
        friendId: event.friend_id,
        userId: event.user_id,
        affiliateCode: event.affiliate_code,
        metadata: event.metadata,
        createdAt: event.created_at,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/conversions/track error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/conversions/events - list events with filters
conversions.get('/api/conversions/events', async (c) => {
  try {
    const events = await getConversionEvents(c.env.DB, {
      conversionPointId: c.req.query('conversionPointId'),
      friendId: c.req.query('friendId'),
      affiliateCode: c.req.query('affiliateCode'),
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
      limit: Number(c.req.query('limit') ?? '100'),
      offset: Number(c.req.query('offset') ?? '0'),
    });

    return c.json({
      success: true,
      data: events.map((e) => ({
        id: e.id,
        conversionPointId: e.conversion_point_id,
        friendId: e.friend_id,
        userId: e.user_id,
        affiliateCode: e.affiliate_code,
        metadata: e.metadata,
        createdAt: e.created_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/conversions/events error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/conversions/report - aggregated report
conversions.get('/api/conversions/report', async (c) => {
  try {
    const report = await getConversionReport(c.env.DB, {
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
    });

    return c.json({ success: true, data: report });
  } catch (err) {
    console.error('GET /api/conversions/report error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { conversions };
