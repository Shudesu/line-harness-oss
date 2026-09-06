import { Hono } from 'hono';
import type { Env } from '../index.js';
import { computeUsersGrouped, type UsersGroupedOptions } from '../services/users-grouped.js';
import { requireRole } from '../middleware/role-guard.js';

export const usersGrouped = new Hono<Env>();

usersGrouped.get('/api/users-grouped', requireRole('owner', 'admin'), async (c) => {
  try {
    const q = c.req.query('q');
    const onlyDups = c.req.query('onlyDups') === '1';
    const account = c.req.query('account') || undefined;
    const pageStr = c.req.query('page');
    const pageSizeStr = c.req.query('pageSize');
    const forceRefresh = c.req.query('refresh') === '1';

    const opts: UsersGroupedOptions = {
      q: q || undefined,
      onlyDups,
      account,
      page: pageStr ? Number.parseInt(pageStr, 10) : undefined,
      pageSize: pageSizeStr ? Number.parseInt(pageSizeStr, 10) : undefined,
      forceRefresh,
    };

    const result = await computeUsersGrouped(c.env.DB, opts);
    return c.json({ success: true, data: result });
  } catch (err) {
    console.error('GET /api/users-grouped failed', {
      errorType: err instanceof Error ? err.name : typeof err,
    });
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
