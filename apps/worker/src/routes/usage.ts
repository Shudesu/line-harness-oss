import { Hono } from 'hono';
import type { Env } from '../index.js';
import { getQuotaUsage } from '../services/quota.js';

export const usage = new Hono<Env>();

// Deliberately NOT on the authMiddleware allowlist: quota numbers are
// operational data for signed-in admins only.
usage.get('/api/usage', async (c) => {
  try {
    const data = await getQuotaUsage(c.env.DB, c.env);
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/usage error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});
