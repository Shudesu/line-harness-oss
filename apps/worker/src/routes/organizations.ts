import { Hono } from 'hono';
import {
  getOrganizations,
  getOrganizationById,
  createOrganization,
  renameOrganization,
  deleteOrganization,
  assignAccountToOrganization,
  getOrganizationLtv,
  getLineAccountById,
} from '@line-crm/db';
import type { Organization } from '@line-crm/db';
import { requireRole } from '../middleware/role-guard.js';
import type { Env } from '../index.js';

const organizations = new Hono<Env>();

function serializeOrganization(row: Organization) {
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/organizations - list all
organizations.get('/api/organizations', async (c) => {
  try {
    const items = await getOrganizations(c.env.DB);
    return c.json({ success: true, data: items.map(serializeOrganization) });
  } catch (err) {
    console.error('GET /api/organizations error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/organizations/:id - get single
organizations.get('/api/organizations/:id', async (c) => {
  try {
    const org = await getOrganizationById(c.env.DB, c.req.param('id'));
    if (!org) return c.json({ success: false, error: 'Organization not found' }, 404);
    return c.json({ success: true, data: serializeOrganization(org) });
  } catch (err) {
    console.error('GET /api/organizations/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/organizations/ltv - cross-account LTV rollup
// Declared before /:id so Hono matches the literal "ltv" segment first.
organizations.get('/api/organizations/ltv', async (c) => {
  try {
    const startDate = c.req.query('startDate');
    const endDate = c.req.query('endDate');
    const data = await getOrganizationLtv(c.env.DB, { startDate, endDate });
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/organizations/ltv error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/organizations - create
organizations.post('/api/organizations', requireRole('owner', 'admin'), async (c) => {
  try {
    const body = await c.req.json<{ name?: string }>();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ success: false, error: 'name is required' }, 400);

    const org = await createOrganization(c.env.DB, name);
    return c.json({ success: true, data: serializeOrganization(org) }, 201);
  } catch (err) {
    console.error('POST /api/organizations error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/organizations/:id - rename
organizations.patch('/api/organizations/:id', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id')!;
    const body = await c.req.json<{ name?: string }>();
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) return c.json({ success: false, error: 'name is required' }, 400);

    const existing = await getOrganizationById(c.env.DB, id);
    if (!existing) return c.json({ success: false, error: 'Organization not found' }, 404);

    await renameOrganization(c.env.DB, id, name);
    return c.json({ success: true, data: serializeOrganization((await getOrganizationById(c.env.DB, id))!) });
  } catch (err) {
    console.error('PATCH /api/organizations/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/organizations/:id - delete (unassigns member accounts first)
organizations.delete('/api/organizations/:id', requireRole('owner'), async (c) => {
  try {
    await deleteOrganization(c.env.DB, c.req.param('id')!);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/organizations/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/organizations/:id/accounts/:accountId - assign a LINE account to this organization
organizations.put(
  '/api/organizations/:id/accounts/:accountId',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const id = c.req.param('id')!;
      const accountId = c.req.param('accountId')!;

      const org = await getOrganizationById(c.env.DB, id);
      if (!org) return c.json({ success: false, error: 'Organization not found' }, 404);

      const account = await getLineAccountById(c.env.DB, accountId);
      if (!account) return c.json({ success: false, error: 'LINE account not found' }, 404);

      await assignAccountToOrganization(c.env.DB, accountId, id);
      return c.json({ success: true, data: null });
    } catch (err) {
      console.error('PUT /api/organizations/:id/accounts/:accountId error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

// DELETE /api/organizations/:id/accounts/:accountId - unassign (organization_id -> NULL)
organizations.delete(
  '/api/organizations/:id/accounts/:accountId',
  requireRole('owner', 'admin'),
  async (c) => {
    try {
      const accountId = c.req.param('accountId')!;
      const account = await getLineAccountById(c.env.DB, accountId);
      if (!account) return c.json({ success: false, error: 'LINE account not found' }, 404);

      await assignAccountToOrganization(c.env.DB, accountId, null);
      return c.json({ success: true, data: null });
    } catch (err) {
      console.error('DELETE /api/organizations/:id/accounts/:accountId error:', err);
      return c.json({ success: false, error: 'Internal server error' }, 500);
    }
  },
);

export { organizations };
