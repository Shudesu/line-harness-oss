// KIDOUインターンの「数字」タブ（仕組みは services/intern-stats.ts）
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { getInternStats } from '../services/intern-stats.js';

const internStats = new Hono<Env>();

const ALLOWED_DAYS = [7, 14, 30, 90];

internStats.get('/api/intern/stats', async (c) => {
  const accountId = c.env.INTERN_SURVEY_ACCOUNT_ID;
  if (!accountId) return c.json({ success: false, error: 'KIDOUインターンのアカウントが設定されていません' }, 404);
  const asked = Number(c.req.query('days'));
  const days = ALLOWED_DAYS.includes(asked) ? asked : 30;
  try {
    const data = await getInternStats(c.env.DB, accountId, days);
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/intern/stats error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { internStats };
