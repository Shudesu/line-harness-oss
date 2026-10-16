import { jstNow } from './utils.js';

export type TaskStatus = 'todo' | 'doing' | 'done';

export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'doing', 'done'];

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value);
}

export interface Task {
  id: string;
  group_id: string | null;
  title: string;
  status: TaskStatus;
  due_date: string | null;
  assignee: string | null;
  created_at: string;
  updated_at: string;
}

export interface TaskWithGroup extends Task {
  group_name: string | null;
}

export interface ListTasksOptions {
  status?: TaskStatus | null;
  groupId?: string | null;
  /** Exclude completed tasks. Ignored when `status` is given. */
  openOnly?: boolean;
}

/**
 * Tasks ordered by due date, soonest first, undated last.
 *
 * SQLite sorts NULL before every value in ASC, which would put undated tasks
 * at the top of a deadline list — `due_date IS NULL` as the first sort key
 * pushes them to the bottom instead.
 */
export async function listTasks(
  db: D1Database,
  options: ListTasksOptions = {},
): Promise<TaskWithGroup[]> {
  const where: string[] = [];
  const binds: unknown[] = [];

  if (options.status) {
    where.push(`t.status = ?`);
    binds.push(options.status);
  } else if (options.openOnly) {
    where.push(`t.status != 'done'`);
  }
  if (options.groupId) {
    where.push(`t.group_id = ?`);
    binds.push(options.groupId);
  }

  const result = await db
    .prepare(
      `SELECT t.*, g.name AS group_name
         FROM tasks t
         LEFT JOIN line_groups g ON g.id = t.group_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY t.due_date IS NULL, t.due_date ASC, t.created_at ASC`,
    )
    .bind(...binds)
    .all<TaskWithGroup>();
  return result.results;
}

export async function getTaskById(
  db: D1Database,
  id: string,
): Promise<TaskWithGroup | null> {
  return db
    .prepare(
      `SELECT t.*, g.name AS group_name
         FROM tasks t
         LEFT JOIN line_groups g ON g.id = t.group_id
        WHERE t.id = ?`,
    )
    .bind(id)
    .first<TaskWithGroup>();
}

export interface CreateTaskInput {
  groupId?: string | null;
  title: string;
  status?: TaskStatus;
  /** 'YYYY-MM-DD'. */
  dueDate?: string | null;
  assignee?: string | null;
}

export async function createTask(
  db: D1Database,
  input: CreateTaskInput,
): Promise<Task> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO tasks (id, group_id, title, status, due_date, assignee, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.groupId ?? null,
      input.title,
      input.status ?? 'todo',
      input.dueDate ?? null,
      input.assignee ?? null,
      now,
      now,
    )
    .run();

  return (await db
    .prepare(`SELECT * FROM tasks WHERE id = ?`)
    .bind(id)
    .first<Task>())!;
}

export interface UpdateTaskInput {
  title?: string;
  status?: TaskStatus;
  dueDate?: string | null;
  assignee?: string | null;
  groupId?: string | null;
}

/**
 * Patch only the supplied fields. `dueDate: null` clears the deadline, while
 * omitting the key leaves it untouched — so callers can unset a value without
 * having to resend the whole row.
 */
export async function updateTask(
  db: D1Database,
  id: string,
  input: UpdateTaskInput,
): Promise<Task | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];

  if (input.title !== undefined) {
    sets.push('title = ?');
    binds.push(input.title);
  }
  if (input.status !== undefined) {
    sets.push('status = ?');
    binds.push(input.status);
  }
  if (input.dueDate !== undefined) {
    sets.push('due_date = ?');
    binds.push(input.dueDate);
  }
  if (input.assignee !== undefined) {
    sets.push('assignee = ?');
    binds.push(input.assignee);
  }
  if (input.groupId !== undefined) {
    sets.push('group_id = ?');
    binds.push(input.groupId);
  }

  if (!sets.length) {
    return db.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(id).first<Task>();
  }

  sets.push('updated_at = ?');
  binds.push(jstNow(), id);

  await db
    .prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  return db.prepare(`SELECT * FROM tasks WHERE id = ?`).bind(id).first<Task>();
}

export async function deleteTask(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM tasks WHERE id = ?`).bind(id).run();
}

export interface TaskCounts {
  todo: number;
  doing: number;
  done: number;
  overdue: number;
}

/** Counts for the list header. `overdue` excludes completed tasks. */
export async function getTaskCounts(
  db: D1Database,
  groupId?: string | null,
): Promise<TaskCounts> {
  const today = jstNow().slice(0, 10);
  const row = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'todo'  THEN 1 ELSE 0 END) AS todo,
         SUM(CASE WHEN status = 'doing' THEN 1 ELSE 0 END) AS doing,
         SUM(CASE WHEN status = 'done'  THEN 1 ELSE 0 END) AS done,
         SUM(CASE WHEN status != 'done' AND due_date IS NOT NULL AND due_date < ?
                  THEN 1 ELSE 0 END) AS overdue
         FROM tasks
        ${groupId ? 'WHERE group_id = ?' : ''}`,
    )
    .bind(...(groupId ? [today, groupId] : [today]))
    .first<{ todo: number | null; doing: number | null; done: number | null; overdue: number | null }>();

  return {
    todo: row?.todo ?? 0,
    doing: row?.doing ?? 0,
    done: row?.done ?? 0,
    overdue: row?.overdue ?? 0,
  };
}
