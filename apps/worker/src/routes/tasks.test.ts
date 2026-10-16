import { describe, expect, test, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';

const dbMocks = {
  listTasks: vi.fn(),
  getTaskById: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  deleteTask: vi.fn(),
  getTaskCounts: vi.fn(),
  // The route imports the real guard's behaviour, so keep it faithful here.
  isTaskStatus: (v: unknown) => v === 'todo' || v === 'doing' || v === 'done',
};
vi.mock('@line-crm/db', () => dbMocks);

const { tasks } = await import('./tasks.js');

type TestEnv = { Bindings: { DB: D1Database } };

/** D1 stub for the ad-hoc group-existence lookup the route does. */
function makeDbStub(groupRow: { id: string } | null = { id: 'Cabc' }): D1Database {
  return {
    prepare: vi.fn(() => ({
      bind: vi.fn(() => ({
        all: vi.fn(async () => ({ results: [] })),
        first: vi.fn(async () => groupRow),
        run: vi.fn(async () => ({ meta: { changes: 0 } })),
      })),
    })),
  } as unknown as D1Database;
}

function setupApp(db?: D1Database) {
  const app = new Hono<TestEnv>();
  app.use('*', async (c, next) => {
    c.env = { DB: db ?? makeDbStub() };
    await next();
  });
  app.route('/', tasks);
  return app;
}

function taskRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-1',
    group_id: 'Cabc',
    group_name: 'KOBOREL PJ',
    title: '契約書のドラフトを送る',
    status: 'todo',
    due_date: '2026-10-15',
    assignee: '小嶋',
    created_at: '2026-10-11T10:00:00.000',
    updated_at: '2026-10-11T10:00:00.000',
    ...overrides,
  };
}

beforeEach(() => {
  for (const fn of Object.values(dbMocks)) {
    if (typeof fn === 'function' && 'mockReset' in fn) (fn as ReturnType<typeof vi.fn>).mockReset();
  }
  dbMocks.getTaskCounts.mockResolvedValue({ todo: 0, doing: 0, done: 0, overdue: 0 });
});

describe('GET /api/tasks', () => {
  test('returns tasks with counts', async () => {
    dbMocks.listTasks.mockResolvedValue([taskRow()]);
    dbMocks.getTaskCounts.mockResolvedValue({ todo: 1, doing: 0, done: 0, overdue: 0 });
    const res = await setupApp().request('/api/tasks');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Record<string, unknown>[];
      counts: Record<string, number>;
    };
    expect(body.data[0]).toMatchObject({
      id: 'task-1',
      groupId: 'Cabc',
      groupName: 'KOBOREL PJ',
      dueDate: '2026-10-15',
      assignee: '小嶋',
    });
    expect(body.counts).toEqual({ todo: 1, doing: 0, done: 0, overdue: 0 });
  });

  test('passes status and groupId filters through to SQL', async () => {
    dbMocks.listTasks.mockResolvedValue([]);
    await setupApp().request('/api/tasks?status=doing&groupId=Cabc&openOnly=1');
    expect(dbMocks.listTasks).toHaveBeenCalledWith(expect.anything(), {
      status: 'doing',
      groupId: 'Cabc',
      openOnly: true,
    });
  });

  test('400 on an unknown status rather than silently listing everything', async () => {
    const res = await setupApp().request('/api/tasks?status=blocked');
    expect(res.status).toBe(400);
    expect(dbMocks.listTasks).not.toHaveBeenCalled();
  });
});

describe('POST /api/tasks', () => {
  test('creates a task with defaults', async () => {
    dbMocks.createTask.mockResolvedValue(taskRow({ status: 'todo' }));
    const res = await setupApp().request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: '契約書のドラフトを送る', groupId: 'Cabc' }),
    });
    expect(res.status).toBe(201);
    expect(dbMocks.createTask).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: '契約書のドラフトを送る', status: 'todo', groupId: 'Cabc' }),
    );
  });

  test('400 when title is blank', async () => {
    const res = await setupApp().request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: '   ' }),
    });
    expect(res.status).toBe(400);
    expect(dbMocks.createTask).not.toHaveBeenCalled();
  });

  test('400 when dueDate is not YYYY-MM-DD', async () => {
    const res = await setupApp().request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'x', dueDate: '2026/10/15' }),
    });
    expect(res.status).toBe(400);
    expect(dbMocks.createTask).not.toHaveBeenCalled();
  });

  test('404 when the group does not exist', async () => {
    const res = await setupApp(makeDbStub(null)).request('/api/tasks', {
      method: 'POST',
      body: JSON.stringify({ title: 'x', groupId: 'ghost' }),
    });
    expect(res.status).toBe(404);
    expect(dbMocks.createTask).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/tasks/:id', () => {
  test('forwards only the supplied fields, leaving the others untouched', async () => {
    dbMocks.getTaskById.mockResolvedValue(taskRow());
    dbMocks.updateTask.mockResolvedValue(taskRow({ status: 'done' }));
    const res = await setupApp().request('/api/tasks/task-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'done' }),
    });
    expect(res.status).toBe(200);
    expect(dbMocks.updateTask).toHaveBeenCalledWith(expect.anything(), 'task-1', {
      status: 'done',
    });
  });

  test('an empty dueDate clears the deadline', async () => {
    dbMocks.getTaskById.mockResolvedValue(taskRow());
    dbMocks.updateTask.mockResolvedValue(taskRow({ due_date: null }));
    await setupApp().request('/api/tasks/task-1', {
      method: 'PATCH',
      body: JSON.stringify({ dueDate: '' }),
    });
    expect(dbMocks.updateTask).toHaveBeenCalledWith(expect.anything(), 'task-1', {
      dueDate: null,
    });
  });

  test('404 when the task is unknown', async () => {
    dbMocks.getTaskById.mockResolvedValue(null);
    const res = await setupApp().request('/api/tasks/missing', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'done' }),
    });
    expect(res.status).toBe(404);
    expect(dbMocks.updateTask).not.toHaveBeenCalled();
  });

  test('400 on an unknown status', async () => {
    const res = await setupApp().request('/api/tasks/task-1', {
      method: 'PATCH',
      body: JSON.stringify({ status: 'blocked' }),
    });
    expect(res.status).toBe(400);
    expect(dbMocks.updateTask).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/tasks/:id', () => {
  test('deletes the task', async () => {
    dbMocks.deleteTask.mockResolvedValue(undefined);
    const res = await setupApp().request('/api/tasks/task-1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(dbMocks.deleteTask).toHaveBeenCalledWith(expect.anything(), 'task-1');
  });
});
