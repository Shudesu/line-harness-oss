import { Hono } from 'hono';
import {
  getTags,
  createTag,
  updateTag,
  deleteTag,
  getTagGroups,
  createTagGroup,
  updateTagGroup,
  deleteTagGroup,
} from '@line-crm/db';
import type { Tag as DbTag, TagGroup as DbTagGroup } from '@line-crm/db';
import type { Env } from '../index.js';

const tags = new Hono<Env>();

function serializeTag(row: DbTag) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    groupId: row.group_id,
    createdAt: row.created_at,
  };
}

function serializeGroup(row: DbTagGroup) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

// GET /api/tags - list all tags
tags.get('/api/tags', async (c) => {
  try {
    const items = await getTags(c.env.DB);
    return c.json({ success: true, data: items.map(serializeTag) });
  } catch (err) {
    console.error('GET /api/tags error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/tags - create tag
tags.post('/api/tags', async (c) => {
  try {
    const body = await c.req.json<{ name: string; color?: string; groupId?: string | null }>();

    if (!body.name) {
      return c.json({ success: false, error: 'name is required' }, 400);
    }

    const tag = await createTag(c.env.DB, {
      name: body.name,
      color: body.color,
      groupId: body.groupId ?? null,
    });

    return c.json({ success: true, data: serializeTag(tag) }, 201);
  } catch (err) {
    console.error('POST /api/tags error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/tags/:id - update tag (name, color, groupId)
tags.patch('/api/tags/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ name?: string; color?: string; groupId?: string | null }>();
    const updated = await updateTag(c.env.DB, id, body);
    if (!updated) {
      return c.json({ success: false, error: 'Tag not found' }, 404);
    }
    return c.json({ success: true, data: serializeTag(updated) });
  } catch (err) {
    console.error('PATCH /api/tags/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/tags/:id - delete tag
tags.delete('/api/tags/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await deleteTag(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/tags/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ---------------- Tag groups ----------------

// GET /api/tag-groups
tags.get('/api/tag-groups', async (c) => {
  try {
    const items = await getTagGroups(c.env.DB);
    return c.json({ success: true, data: items.map(serializeGroup) });
  } catch (err) {
    console.error('GET /api/tag-groups error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/tag-groups
tags.post('/api/tag-groups', async (c) => {
  try {
    const body = await c.req.json<{ name: string; sortOrder?: number }>();
    if (!body.name) return c.json({ success: false, error: 'name is required' }, 400);
    const group = await createTagGroup(c.env.DB, body);
    return c.json({ success: true, data: serializeGroup(group) }, 201);
  } catch (err) {
    console.error('POST /api/tag-groups error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/tag-groups/:id
tags.patch('/api/tag-groups/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ name?: string; sortOrder?: number }>();
    const updated = await updateTagGroup(c.env.DB, id, body);
    if (!updated) return c.json({ success: false, error: 'Group not found' }, 404);
    return c.json({ success: true, data: serializeGroup(updated) });
  } catch (err) {
    console.error('PATCH /api/tag-groups/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/tag-groups/:id — tags in this group revert to ungrouped (ON DELETE SET NULL)
tags.delete('/api/tag-groups/:id', async (c) => {
  try {
    const id = c.req.param('id');
    await deleteTagGroup(c.env.DB, id);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('DELETE /api/tag-groups/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { tags };
