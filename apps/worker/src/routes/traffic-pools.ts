import { Hono } from 'hono';
import {
  getTrafficPools,
  getTrafficPoolById,
  getTrafficPoolBySlug,
  createTrafficPool,
  updateTrafficPool,
  deleteTrafficPool,
  getPoolAccounts,
  addPoolAccount,
  removePoolAccount,
  togglePoolAccount,
} from '@line-crm/db';
import type { TrafficPoolWithAccount, PoolAccountWithDetails } from '@line-crm/db';
import type { Env } from '../index.js';

const trafficPools = new Hono<Env>();

function serialize(pool: TrafficPoolWithAccount) {
  return {
    id: pool.id,
    slug: pool.slug,
    name: pool.name,
    activeAccountId: pool.active_account_id,
    accountName: pool.account_name,
    liffId: pool.liff_id,
    isActive: Boolean(pool.is_active),
    createdAt: pool.created_at,
    updatedAt: pool.updated_at,
  };
}

// ── Public: GET /pool/:slug → 302 redirect to LIFF auth URL ────────────────

trafficPools.get('/pool/:slug', async (c) => {
  const slug = c.req.param('slug');
  const pool = await getTrafficPoolBySlug(c.env.DB, slug);

  if (!pool) {
    return c.json({ success: false, error: 'Pool not found' }, 404);
  }

  const baseUrl = new URL(c.req.url).origin;
  const params = new URLSearchParams();
  params.set('pool', slug);
  // Forward safe query params (ref, form, etc.) — block 'account' to prevent pool bypass
  const blocked = new Set(['pool', 'account']);
  for (const [key, value] of new URL(c.req.url).searchParams) {
    if (!blocked.has(key)) params.set(key, value);
  }
  return c.redirect(`${baseUrl}/auth/line?${params.toString()}`, 302);
});

// ── Admin API ───────────────────────────────────────────────────────────────

// GET /api/traffic-pools — list all
trafficPools.get('/api/traffic-pools', async (c) => {
  try {
    const pools = await getTrafficPools(c.env.DB);
    return c.json({ success: true, data: pools.map(serialize) });
  } catch (err) {
    console.error('GET /api/traffic-pools error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/traffic-pools — create
trafficPools.post('/api/traffic-pools', async (c) => {
  try {
    const body = await c.req.json<{
      slug: string;
      name: string;
      activeAccountId: string;
    }>();

    if (!body.slug || !body.name || !body.activeAccountId) {
      return c.json({ success: false, error: 'slug, name, and activeAccountId are required' }, 400);
    }

    const pool = await createTrafficPool(c.env.DB, {
      slug: body.slug,
      name: body.name,
      activeAccountId: body.activeAccountId,
    });
    return c.json({ success: true, data: serialize(pool) }, 201);
  } catch (err) {
    console.error('POST /api/traffic-pools error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/traffic-pools/:id — update (switch account here)
trafficPools.put('/api/traffic-pools/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      name?: string;
      activeAccountId?: string;
      isActive?: boolean;
    }>();

    const updated = await updateTrafficPool(c.env.DB, id, {
      name: body.name,
      activeAccountId: body.activeAccountId,
      isActive: body.isActive,
    });

    if (!updated) {
      return c.json({ success: false, error: 'Traffic pool not found' }, 404);
    }
    return c.json({ success: true, data: serialize(updated) });
  } catch (err) {
    console.error('PUT /api/traffic-pools/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/traffic-pools/:id
trafficPools.delete('/api/traffic-pools/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await getTrafficPoolById(c.env.DB, id);
    if (!existing) {
      return c.json({ success: false, error: 'Traffic pool not found' }, 404);
    }
    await deleteTrafficPool(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/traffic-pools/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

function serializePoolAccount(pa: PoolAccountWithDetails) {
  return {
    id: pa.id,
    poolId: pa.pool_id,
    lineAccountId: pa.line_account_id,
    accountName: pa.account_name,
    liffId: pa.liff_id,
    isActive: Boolean(pa.is_active),
    createdAt: pa.created_at,
  };
}

// GET /api/traffic-pools/:id/accounts — list pool accounts
trafficPools.get('/api/traffic-pools/:id/accounts', async (c) => {
  try {
    const accounts = await getPoolAccounts(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: accounts.map(serializePoolAccount) });
  } catch (err) {
    console.error('GET /api/traffic-pools/:id/accounts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/traffic-pools/:id/accounts — add account to pool
trafficPools.post('/api/traffic-pools/:id/accounts', async (c) => {
  try {
    const body = await c.req.json<{ lineAccountId: string }>();
    if (!body.lineAccountId) {
      return c.json({ success: false, error: 'lineAccountId is required' }, 400);
    }
    const account = await addPoolAccount(c.env.DB, c.req.param('id'), body.lineAccountId);
    return c.json({ success: true, data: account }, 201);
  } catch (err: any) {
    if (err?.message?.includes('UNIQUE constraint')) {
      return c.json({ success: false, error: 'Account already in this pool' }, 409);
    }
    console.error('POST /api/traffic-pools/:id/accounts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/traffic-pools/:id/accounts/:accountId — toggle active
trafficPools.put('/api/traffic-pools/:id/accounts/:accountId', async (c) => {
  try {
    const body = await c.req.json<{ isActive: boolean }>();
    const result = await togglePoolAccount(c.env.DB, c.req.param('accountId'), body.isActive);
    if (!result) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: result });
  } catch (err) {
    console.error('PUT /api/traffic-pools/:id/accounts/:accountId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/traffic-pools/:id/accounts/:accountId — remove account from pool
trafficPools.delete('/api/traffic-pools/:id/accounts/:accountId', async (c) => {
  try {
    const deleted = await removePoolAccount(c.env.DB, c.req.param('accountId'));
    if (!deleted) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/traffic-pools/:id/accounts/:accountId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { trafficPools };
