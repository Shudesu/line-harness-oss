import { Hono } from 'hono';
import type { Env } from '../index.js';
import {
  computeUnansweredInbox,
  countUnanswered,
  type UnansweredInboxOptions,
} from '../services/unanswered-inbox.js';
import {
  getActivityDigest,
  parseActivityDigestHours,
} from '../services/activity-digest.js';

export const inbox = new Hono<Env>();

// GET /api/inbox/activity-digest?hours=3
// Codex の定期レポートなど、読み取り専用の外部クライアント向け集約 API。
// グローバル authMiddleware 配下なので Bearer API key / admin session が必須。
inbox.get('/api/inbox/activity-digest', async (c) => {
  const hours = parseActivityDigestHours(c.req.query('hours'));
  if (hours === null) {
    return c.json({
      success: false,
      error: 'hours must be an integer between 1 and 168',
    }, 400);
  }

  try {
    const data = await getActivityDigest(c.env.DB, { hours });
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/inbox/activity-digest error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

inbox.get('/api/inbox/unanswered', async (c) => {
  try {
    const q = c.req.query('q');
    const account = c.req.query('account') || undefined;
    const minWaitMinutesStr = c.req.query('minWaitMinutes');
    const pageStr = c.req.query('page');
    const pageSizeStr = c.req.query('pageSize');

    const opts: UnansweredInboxOptions = {
      q: q || undefined,
      account,
      minWaitMinutes: minWaitMinutesStr ? Number.parseInt(minWaitMinutesStr, 10) : undefined,
      page: pageStr ? Number.parseInt(pageStr, 10) : undefined,
      pageSize: pageSizeStr ? Number.parseInt(pageSizeStr, 10) : undefined,
    };

    const result = await computeUnansweredInbox(c.env.DB, opts);
    return c.json({ success: true, data: result });
  } catch (err) {
    console.error('GET /api/inbox/unanswered error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

inbox.get('/api/inbox/unanswered/count', async (c) => {
  try {
    const result = await countUnanswered(c.env.DB);
    return c.json({ success: true, data: result });
  } catch (err) {
    console.error('GET /api/inbox/unanswered/count error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
