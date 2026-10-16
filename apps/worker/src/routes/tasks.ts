import { Hono } from 'hono';
import {
  listTasks,
  getTaskById,
  createTask,
  updateTask,
  deleteTask,
  getTaskCounts,
  isTaskStatus,
} from '@line-crm/db';
import type { Task, TaskWithGroup } from '@line-crm/db';
import type { Env } from '../index.js';

const tasks = new Hono<Env>();

const DUE_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function serialize(t: TaskWithGroup | Task) {
  return {
    id: t.id,
    groupId: t.group_id,
    groupName: 'group_name' in t ? t.group_name : undefined,
    title: t.title,
    status: t.status,
    dueDate: t.due_date,
    assignee: t.assignee,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

/** Accepts 'YYYY-MM-DD', or null/'' to clear. Returns undefined when invalid. */
function normalizeDueDate(value: unknown): string | null | undefined {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  return DUE_DATE_PATTERN.test(value) ? value : undefined;
}

// GET /api/tasks?status=&groupId=&openOnly=1 — due date ascending, undated last
tasks.get('/api/tasks', async (c) => {
  try {
    const status = c.req.query('status');
    if (status && !isTaskStatus(status)) {
      return c.json(
        { success: false, error: 'status must be one of todo, doing, done' },
        400,
      );
    }

    const groupId = c.req.query('groupId') ?? null;
    const [list, counts] = await Promise.all([
      listTasks(c.env.DB, {
        status: status && isTaskStatus(status) ? status : null,
        groupId,
        openOnly: c.req.query('openOnly') === '1',
      }),
      getTaskCounts(c.env.DB, groupId),
    ]);

    return c.json({ success: true, data: list.map(serialize), counts });
  } catch (err) {
    console.error('GET /api/tasks error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// GET /api/tasks/:id
tasks.get('/api/tasks/:id', async (c) => {
  try {
    const task = await getTaskById(c.env.DB, c.req.param('id'));
    if (!task) return c.json({ success: false, error: 'Not found' }, 404);
    return c.json({ success: true, data: serialize(task) });
  } catch (err) {
    console.error('GET /api/tasks/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// POST /api/tasks
tasks.post('/api/tasks', async (c) => {
  try {
    const body = await c.req.json<{
      title?: string;
      groupId?: string | null;
      status?: string;
      dueDate?: string | null;
      assignee?: string | null;
    }>();

    const title = body.title?.trim();
    if (!title) {
      return c.json({ success: false, error: 'title is required' }, 400);
    }
    if (body.status !== undefined && !isTaskStatus(body.status)) {
      return c.json(
        { success: false, error: 'status must be one of todo, doing, done' },
        400,
      );
    }

    const dueDate = normalizeDueDate(body.dueDate ?? null);
    if (dueDate === undefined) {
      return c.json(
        { success: false, error: 'dueDate must be formatted YYYY-MM-DD' },
        400,
      );
    }

    if (body.groupId) {
      const group = await c.env.DB.prepare(
        `SELECT id FROM line_groups WHERE id = ?`,
      )
        .bind(body.groupId)
        .first<{ id: string }>();
      if (!group) {
        return c.json({ success: false, error: 'Group not found' }, 404);
      }
    }

    const task = await createTask(c.env.DB, {
      title,
      groupId: body.groupId ?? null,
      status: body.status && isTaskStatus(body.status) ? body.status : 'todo',
      dueDate,
      assignee: body.assignee ?? null,
    });

    return c.json({ success: true, data: serialize(task) }, 201);
  } catch (err) {
    console.error('POST /api/tasks error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// PATCH /api/tasks/:id — only the supplied fields change
tasks.patch('/api/tasks/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{
      title?: string;
      status?: string;
      dueDate?: string | null;
      assignee?: string | null;
      groupId?: string | null;
    }>();

    if (body.status !== undefined && !isTaskStatus(body.status)) {
      return c.json(
        { success: false, error: 'status must be one of todo, doing, done' },
        400,
      );
    }
    if (body.title !== undefined && !body.title.trim()) {
      return c.json({ success: false, error: 'title must not be empty' }, 400);
    }

    let dueDate: string | null | undefined;
    if (body.dueDate !== undefined) {
      dueDate = normalizeDueDate(body.dueDate);
      if (dueDate === undefined) {
        return c.json(
          { success: false, error: 'dueDate must be formatted YYYY-MM-DD' },
          400,
        );
      }
    }

    if (!(await getTaskById(c.env.DB, id))) {
      return c.json({ success: false, error: 'Not found' }, 404);
    }

    const updated = await updateTask(c.env.DB, id, {
      ...(body.title !== undefined ? { title: body.title.trim() } : {}),
      ...(body.status !== undefined && isTaskStatus(body.status)
        ? { status: body.status }
        : {}),
      ...(body.dueDate !== undefined ? { dueDate } : {}),
      ...(body.assignee !== undefined ? { assignee: body.assignee } : {}),
      ...(body.groupId !== undefined ? { groupId: body.groupId } : {}),
    });

    return c.json({ success: true, data: updated ? serialize(updated) : null });
  } catch (err) {
    console.error('PATCH /api/tasks/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// DELETE /api/tasks/:id
tasks.delete('/api/tasks/:id', async (c) => {
  try {
    await deleteTask(c.env.DB, c.req.param('id'));
    return c.json({ success: true });
  } catch (err) {
    console.error('DELETE /api/tasks/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { tasks };
