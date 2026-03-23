import { Hono } from 'hono';
import {
  getAffiliates,
  getAffiliateById,
  getAffiliateByCode,
  createAffiliate,
  updateAffiliate,
  deleteAffiliate,
  recordAffiliateClick,
  getAffiliateReport,
} from '@line-crm/db';
import type { Env } from '../index.js';

const affiliates = new Hono<Env>();

function serializeAffiliate(row: { id: string; name: string; code: string; commission_rate: number; is_active: number; created_at: string }) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    commissionRate: row.commission_rate,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
  };
}

// GET /api/affiliates - list all
affiliates.get('/api/affiliates', async (c) => {
  try {
    const items = await getAffiliates(c.env.DB);
    return c.json({ success: true, data: items.map(serializeAffiliate) });
  } catch (err) {
    console.error('GET /api/affiliates error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/affiliates/:id - get single
affiliates.get('/api/affiliates/:id', async (c) => {
  try {
    const item = await getAffiliateById(c.env.DB, c.req.param('id'));
    if (!item) {
      return c.json({ success: false, error: 'Affiliate not found' }, 404);
    }
    return c.json({ success: true, data: serializeAffiliate(item) });
  } catch (err) {
    console.error('GET /api/affiliates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/affiliates - create
affiliates.post('/api/affiliates', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      code: string;
      commissionRate?: number;
    }>();

    if (!body.name || !body.code) {
      return c.json({ success: false, error: 'name and code are required' }, 400);
    }

    const item = await createAffiliate(c.env.DB, body);
    return c.json({ success: true, data: serializeAffiliate(item) }, 201);
  } catch (err) {
    console.error('POST /api/affiliates error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/affiliates/:id - update
affiliates.put('/api/affiliates/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      commissionRate?: number;
      isActive?: boolean;
    }>();

    const updated = await updateAffiliate(c.env.DB, id, {
      name: body.name,
      commission_rate: body.commissionRate,
      is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : undefined,
    });

    if (!updated) {
      return c.json({ success: false, error: 'Affiliate not found' }, 404);
    }
    return c.json({ success: true, data: serializeAffiliate(updated) });
  } catch (err) {
    console.error('PUT /api/affiliates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/affiliates/:id - delete
affiliates.delete('/api/affiliates/:id', async (c) => {
  try {
    await deleteAffiliate(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/affiliates/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/affiliates/:id/report - affiliate performance report
affiliates.get('/api/affiliates/:id/report', async (c) => {
  try {
    const report = await getAffiliateReport(c.env.DB, c.req.param('id'), {
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
    });

    if (report.length === 0) {
      return c.json({ success: false, error: 'Affiliate not found' }, 404);
    }
    return c.json({ success: true, data: report[0] });
  } catch (err) {
    console.error('GET /api/affiliates/:id/report error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/affiliates/click - record click (public endpoint tracked by ref param)
affiliates.post('/api/affiliates/click', async (c) => {
  try {
    const body = await c.req.json<{
      code: string;
      url?: string | null;
    }>();

    if (!body.code) {
      return c.json({ success: false, error: 'code is required' }, 400);
    }

    const affiliate = await getAffiliateByCode(c.env.DB, body.code);
    if (!affiliate) {
      return c.json({ success: false, error: 'Affiliate not found' }, 404);
    }

    const ipAddress = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? null;
    await recordAffiliateClick(c.env.DB, affiliate.id, body.url, ipAddress);
    return c.json({ success: true, data: null }, 201);
  } catch (err) {
    console.error('POST /api/affiliates/click error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/affiliates/report - all affiliates report
affiliates.get('/api/affiliates-report', async (c) => {
  try {
    const report = await getAffiliateReport(c.env.DB, undefined, {
      startDate: c.req.query('startDate'),
      endDate: c.req.query('endDate'),
    });
    return c.json({ success: true, data: report });
  } catch (err) {
    console.error('GET /api/affiliates-report error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { affiliates };
