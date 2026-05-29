import { Hono } from 'hono';
import {
  getExternalCustomerProfileById,
  linkFriendToExternalCustomer,
  listExternalCustomerLinksForFriend,
  searchExternalCustomerProfiles,
  unlinkFriendFromExternalCustomer,
  upsertExternalCustomerProfile,
} from '@line-crm/db';
import type { Env } from '../index.js';

const externalCustomers = new Hono<Env>();

function serializeCustomer(row: Awaited<ReturnType<typeof getExternalCustomerProfileById>> extends infer T ? NonNullable<T> : never) {
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id,
    name: row.name,
    phone: row.phone,
    email: row.email,
    metadata: JSON.parse(row.metadata || '{}'),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeLink(row: Awaited<ReturnType<typeof listExternalCustomerLinksForFriend>>[number]) {
  return {
    id: row.id,
    friendId: row.friend_id,
    externalCustomerId: row.external_customer_id,
    linkMethod: row.link_method,
    confidence: row.confidence,
    createdAt: row.created_at,
    customer: serializeCustomer(row.customer),
  };
}

externalCustomers.get('/api/external-customers', async (c) => {
  try {
    const items = await searchExternalCustomerProfiles(c.env.DB, {
      query: c.req.query('q') ?? c.req.query('query') ?? null,
      source: c.req.query('source') ?? null,
      limit: Number(c.req.query('limit') ?? '20'),
    });
    return c.json({ success: true, data: items.map(serializeCustomer) });
  } catch (err) {
    console.error('GET /api/external-customers error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

externalCustomers.post('/api/external-customers', async (c) => {
  try {
    const body = await c.req.json<{
      source?: string;
      externalId?: string | null;
      name?: string | null;
      phone?: string | null;
      email?: string | null;
      metadata?: Record<string, unknown> | string | null;
    }>();
    if (!body.source?.trim()) return c.json({ success: false, error: 'source is required' }, 400);

    const item = await upsertExternalCustomerProfile(c.env.DB, {
      source: body.source,
      externalId: body.externalId,
      name: body.name,
      phone: body.phone,
      email: body.email,
      metadata: body.metadata,
    });
    return c.json({ success: true, data: serializeCustomer(item) }, 201);
  } catch (err) {
    console.error('POST /api/external-customers error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

externalCustomers.get('/api/friends/:id/external-customers', async (c) => {
  try {
    const links = await listExternalCustomerLinksForFriend(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: links.map(serializeLink) });
  } catch (err) {
    console.error('GET /api/friends/:id/external-customers error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

externalCustomers.post('/api/friends/:id/external-customers', async (c) => {
  try {
    const friendId = c.req.param('id');
    const body = await c.req.json<{
      externalCustomerId?: string;
      linkMethod?: 'manual' | 'phone' | 'email' | 'import';
      confidence?: number;
    }>();
    if (!body.externalCustomerId) {
      return c.json({ success: false, error: 'externalCustomerId is required' }, 400);
    }
    const link = await linkFriendToExternalCustomer(c.env.DB, {
      friendId,
      externalCustomerId: body.externalCustomerId,
      linkMethod: body.linkMethod ?? 'manual',
      confidence: body.confidence ?? 100,
    });
    const links = await listExternalCustomerLinksForFriend(c.env.DB, link.friend_id);
    const created = links.find((item) => item.id === link.id);
    return c.json({ success: true, data: created ? serializeLink(created) : link }, 201);
  } catch (err) {
    console.error('POST /api/friends/:id/external-customers error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

externalCustomers.delete('/api/friends/:id/external-customers/:externalCustomerId', async (c) => {
  try {
    await unlinkFriendFromExternalCustomer(
      c.env.DB,
      c.req.param('id'),
      c.req.param('externalCustomerId'),
    );
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/friends/:id/external-customers/:externalCustomerId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { externalCustomers };
