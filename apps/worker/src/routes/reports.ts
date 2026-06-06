/**
 * L-TRACK 互換: レポートAPI
 *
 * - GET /api/reports/summary?granularity=total|month|day&since=&until=&lineAccountId=&trackedLinkId=
 * - GET /api/reports/postback?limit=&status=&platformName=
 *
 * summary はトラックリンク × 期間軸の集計（クリック / 登録 / ブロック / AF）。
 * postback は ad_conversion_logs の生履歴。
 */

import { Hono } from 'hono';
import { getReport, getAdConversionLogsAll } from '@line-crm/db';
import type { Env } from '../index.js';

export const reports = new Hono<Env>();

reports.get('/api/reports/summary', async (c) => {
  const granRaw = c.req.query('granularity') ?? 'total';
  const granularity =
    granRaw === 'month' || granRaw === 'day' ? granRaw : 'total';
  const since = c.req.query('since') ?? undefined;
  const until = c.req.query('until') ?? undefined;
  const lineAccountId = c.req.query('lineAccountId') ?? null;
  const trackedLinkId = c.req.query('trackedLinkId') ?? undefined;

  try {
    const rows = await getReport(c.env.DB, {
      since,
      until,
      lineAccountId,
      trackedLinkId,
      granularity,
    });
    return c.json({ success: true, data: rows });
  } catch (err) {
    console.error('[reports] summary error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

reports.get('/api/reports/postback', async (c) => {
  const limit = Math.min(1000, Number(c.req.query('limit') ?? 200));
  const status = c.req.query('status') as 'sent' | 'failed' | undefined;
  const platformName = c.req.query('platformName') ?? undefined;
  const friendId = c.req.query('friendId') ?? undefined;
  const since = c.req.query('since') ?? undefined;
  const until = c.req.query('until') ?? undefined;
  try {
    const rows = await getAdConversionLogsAll(c.env.DB, {
      limit,
      status,
      platformName,
      friendId,
      since,
      until,
    });
    return c.json({ success: true, data: rows });
  } catch (err) {
    console.error('[reports] postback error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
