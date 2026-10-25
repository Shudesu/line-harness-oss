import { Hono } from 'hono';
import {
  listGroups,
  getGroupById,
  addTagToGroup,
  removeTagFromGroup,
  upsertLineGroup,
} from '@line-crm/db';
import type { LineGroupWithTags } from '@line-crm/db';
import type { Env } from '../index.js';

const groups = new Hono<Env>();

function serialize(g: LineGroupWithTags) {
  return {
    id: g.id,
    accountId: g.account_id,
    name: g.name,
    status: g.status,
    messageCount: g.message_count,
    lastMessageAt: g.last_message_at,
    joinedAt: g.joined_at,
    leftAt: g.left_at,
    createdAt: g.created_at,
    updatedAt: g.updated_at,
    tags: g.tags.map((t) => ({ id: t.id, name: t.name, color: t.color })),
  };
}

// GET /api/groups?tagId=&accountId=&status= — list groups, optionally filtered by tag
groups.get('/api/groups', async (c) => {
  try {
    const status = c.req.query('status');
    const list = await listGroups(c.env.DB, {
      tagId: c.req.query('tagId') ?? null,
      accountId: c.req.query('accountId') ?? null,
      status: status === 'joined' || status === 'left' ? status : null,
    });
    return c.json({ success: true, data: list.map(serialize) });
  } catch (err) {
    console.error('GET /api/groups error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/groups/:id
groups.get('/api/groups/:id', async (c) => {
  try {
    const group = await getGroupById(c.env.DB, c.req.param('id'));
    if (!group) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serialize(group) });
  } catch (err) {
    console.error('GET /api/groups/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/groups — register a group by hand (the webhook upsert is the usual path)
groups.post('/api/groups', async (c) => {
  try {
    const body = await c.req.json<{
      id: string;
      name?: string | null;
      accountId?: string | null;
    }>();
    if (!body.id) {
      return c.json({ success: false, error: 'id is required' }, 400);
    }
    await upsertLineGroup(c.env.DB, {
      id: body.id,
      name: body.name ?? null,
      accountId: body.accountId ?? null,
    });
    const group = await getGroupById(c.env.DB, body.id);
    return c.json({ success: true, data: group ? serialize(group) : null }, 201);
  } catch (err) {
    console.error('POST /api/groups error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/groups/:id/tags — attach an existing tag
groups.post('/api/groups/:id/tags', async (c) => {
  try {
    const groupId = c.req.param('id');
    const body = await c.req.json<{ tagId: string }>();
    if (!body.tagId) {
      return c.json({ success: false, error: 'tagId is required' }, 400);
    }
    if (!(await getGroupById(c.env.DB, groupId))) {
      return c.json({ success: false, error: 'Group not found' }, 404);
    }

    const tag = await c.env.DB.prepare(`SELECT id FROM tags WHERE id = ?`)
      .bind(body.tagId)
      .first<{ id: string }>();
    if (!tag) {
      return c.json({ success: false, error: 'Tag not found' }, 404);
    }

    const added = await addTagToGroup(c.env.DB, groupId, body.tagId);
    const group = await getGroupById(c.env.DB, groupId);
    return c.json({
      success: true,
      data: { added, group: group ? serialize(group) : null },
    });
  } catch (err) {
    console.error('POST /api/groups/:id/tags error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/groups/:id/tags/:tagId
groups.delete('/api/groups/:id/tags/:tagId', async (c) => {
  try {
    await removeTagFromGroup(
      c.env.DB,
      c.req.param('id'),
      c.req.param('tagId'),
    );
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/groups/:id/tags/:tagId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { groups };
