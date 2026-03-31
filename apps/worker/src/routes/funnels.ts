import { Hono } from 'hono';
import {
  getFunnels,
  getFunnelById,
  createFunnel,
  updateFunnel,
  deleteFunnel,
  getFunnelStats,
} from '@line-crm/db';
import type { FunnelStep } from '@line-crm/db';
import type { Env } from '../index.js';

const funnels = new Hono<Env>();

// GET /api/funnels
funnels.get('/api/funnels', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    const data = await getFunnels(c.env.DB, lineAccountId);
    return c.json({ success: true, data });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// GET /api/funnels/:id
funnels.get('/api/funnels/:id', async (c) => {
  try {
    const data = await getFunnelById(c.env.DB, c.req.param('id'));
    if (!data) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// POST /api/funnels
funnels.post('/api/funnels', async (c) => {
  try {
    const body = await c.req.json<{ name: string; description?: string; stepsJson: string; lineAccountId?: string }>();
    if (!body.name) return c.json({ success: false, error: 'name is required' }, 400);
    const data = await createFunnel(c.env.DB, body);
    return c.json({ success: true, data }, 201);
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// PUT /api/funnels/:id
funnels.put('/api/funnels/:id', async (c) => {
  try {
    const body = await c.req.json<{ name?: string; description?: string; stepsJson?: string }>();
    const data = await updateFunnel(c.env.DB, c.req.param('id'), body);
    if (!data) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// DELETE /api/funnels/:id
funnels.delete('/api/funnels/:id', async (c) => {
  try {
    await deleteFunnel(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// POST /api/funnels/:id/stats — get funnel step counts
funnels.post('/api/funnels/:id/stats', async (c) => {
  try {
    const funnel = await getFunnelById(c.env.DB, c.req.param('id'));
    if (!funnel) return c.json({ success: false, error: 'Not found' }, 404);

    const steps: FunnelStep[] = JSON.parse(funnel.steps_json);
    const lineAccountId = c.req.query('lineAccountId');
    const counts = await getFunnelStats(c.env.DB, steps, lineAccountId);

    return c.json({ success: true, data: { steps, counts } });
  } catch (err) {
    return c.json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

export { funnels };
