import {createAuthorizedRouter} from '../middleware/authorized-router.js';
import { Hono } from 'hono';
import type { Env } from '../index.js';
import { requireRole } from '../middleware/role-guard.js';
export const inboundEvents = createAuthorizedRouter<Env>();
// No public payload/credentials, no automatic replay/delete endpoint.
inboundEvents.get('/api/inbound-events', requireRole('owner', 'admin'), async c => {
  const status = c.req.query('status') || 'needs_review';
  if (!['pending', 'processing', 'completed', 'needs_review'].includes(status)) return c.json({ success: false, error: 'Invalid status' }, 400);
  const rows = await c.env.DB.prepare(`SELECT id,provider,source_id,event_id,account_id,status,created_at,started_at,completed_at,error_code
    FROM inbound_event_receipts WHERE status=? ORDER BY created_at DESC LIMIT 100`).bind(status).all();
  c.header('Cache-Control', 'no-store');
  return c.json({ success: true, data: rows.results });
});
