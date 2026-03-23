import { Hono } from 'hono';
import {
  getUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  linkFriendToUser,
  getUserFriends,
  getUserByEmail,
  getUserByPhone,
} from '@line-crm/db';
import type { User as DbUser } from '@line-crm/db';
import type { Env } from '../index.js';

const users = new Hono<Env>();

function serializeUser(row: DbUser) {
  return {
    id: row.id,
    email: row.email,
    phone: row.phone,
    externalId: row.external_id,
    displayName: row.display_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// GET /api/users - list all
users.get('/api/users', async (c) => {
  try {
    const items = await getUsers(c.env.DB);
    return c.json({ success: true, data: items.map(serializeUser) });
  } catch (err) {
    console.error('GET /api/users error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/users/:id - get single
users.get('/api/users/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const user = await getUserById(c.env.DB, id);
    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }
    return c.json({ success: true, data: serializeUser(user) });
  } catch (err) {
    console.error('GET /api/users/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/users - create
users.post('/api/users', async (c) => {
  try {
    const body = await c.req.json<{
      email?: string | null;
      phone?: string | null;
      externalId?: string | null;
      displayName?: string | null;
    }>();

    const user = await createUser(c.env.DB, body);
    return c.json({ success: true, data: serializeUser(user) }, 201);
  } catch (err) {
    console.error('POST /api/users error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PUT /api/users/:id - update
users.put('/api/users/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      email?: string | null;
      phone?: string | null;
      externalId?: string | null;
      displayName?: string | null;
    }>();

    const updated = await updateUser(c.env.DB, id, {
      email: body.email,
      phone: body.phone,
      external_id: body.externalId,
      display_name: body.displayName,
    });

    if (!updated) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }
    return c.json({ success: true, data: serializeUser(updated) });
  } catch (err) {
    console.error('PUT /api/users/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/users/:id - delete
users.delete('/api/users/:id', async (c) => {
  try {
    await deleteUser(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/users/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/users/:id/link - link friend to user UUID
users.post('/api/users/:id/link', async (c) => {
  try {
    const userId = c.req.param('id');
    const body = await c.req.json<{ friendId: string }>();

    if (!body.friendId) {
      return c.json({ success: false, error: 'friendId is required' }, 400);
    }

    await linkFriendToUser(c.env.DB, body.friendId, userId);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('POST /api/users/:id/link error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/users/:id/accounts - get all linked friends/accounts
users.get('/api/users/:id/accounts', async (c) => {
  try {
    const userId = c.req.param('id');
    const friends = await getUserFriends(c.env.DB, userId);
    return c.json({
      success: true,
      data: friends.map((f) => ({
        id: f.id,
        lineUserId: f.line_user_id,
        displayName: f.display_name,
        isFollowing: Boolean(f.is_following),
      })),
    });
  } catch (err) {
    console.error('GET /api/users/:id/accounts error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/users/match - find user by email or phone
users.post('/api/users/match', async (c) => {
  try {
    const body = await c.req.json<{ email?: string; phone?: string }>();
    let user = null;

    if (body.email) {
      user = await getUserByEmail(c.env.DB, body.email);
    }
    if (!user && body.phone) {
      user = await getUserByPhone(c.env.DB, body.phone);
    }

    if (!user) {
      return c.json({ success: false, error: 'User not found' }, 404);
    }
    return c.json({ success: true, data: serializeUser(user) });
  } catch (err) {
    console.error('POST /api/users/match error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { users };
