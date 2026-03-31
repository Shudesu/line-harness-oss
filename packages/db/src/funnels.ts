import { jstNow } from './utils';

export interface Funnel {
  id: string;
  name: string;
  description: string | null;
  steps_json: string;
  line_account_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface FunnelStep {
  name: string;
  type: 'scenario_enrolled' | 'scenario_completed' | 'tag_added' | 'conversion' | 'custom_event';
  value: string; // scenario_id, tag_id, conversion_point_id, or event_name
}

export async function getFunnels(db: D1Database, lineAccountId?: string): Promise<Funnel[]> {
  const sql = lineAccountId
    ? 'SELECT * FROM funnels WHERE line_account_id = ? OR line_account_id IS NULL ORDER BY created_at DESC'
    : 'SELECT * FROM funnels ORDER BY created_at DESC';
  const result = await db.prepare(sql).bind(...(lineAccountId ? [lineAccountId] : [])).all<Funnel>();
  return result.results;
}

export async function getFunnelById(db: D1Database, id: string): Promise<Funnel | null> {
  return db.prepare('SELECT * FROM funnels WHERE id = ?').bind(id).first<Funnel>();
}

export async function createFunnel(
  db: D1Database,
  data: { name: string; description?: string; stepsJson: string; lineAccountId?: string },
): Promise<Funnel> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare('INSERT INTO funnels (id, name, description, steps_json, line_account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, data.name, data.description || null, data.stepsJson, data.lineAccountId || null, now, now)
    .run();
  return (await getFunnelById(db, id))!;
}

export async function updateFunnel(
  db: D1Database,
  id: string,
  data: { name?: string; description?: string; stepsJson?: string },
): Promise<Funnel | null> {
  const existing = await getFunnelById(db, id);
  if (!existing) return null;
  const now = jstNow();
  await db
    .prepare('UPDATE funnels SET name = ?, description = ?, steps_json = ?, updated_at = ? WHERE id = ?')
    .bind(
      data.name ?? existing.name,
      data.description ?? existing.description,
      data.stepsJson ?? existing.steps_json,
      now,
      id,
    )
    .run();
  return getFunnelById(db, id);
}

export async function deleteFunnel(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM funnels WHERE id = ?').bind(id).run();
}

/** Count friends who match each step of a funnel */
export async function getFunnelStats(
  db: D1Database,
  steps: FunnelStep[],
  lineAccountId?: string,
): Promise<number[]> {
  const counts: number[] = [];
  const accountFilter = lineAccountId ? ' AND f.line_account_id = ?' : '';
  const accountBindings = lineAccountId ? [lineAccountId] : [];

  for (const step of steps) {
    let sql = '';
    const bindings: unknown[] = [];

    switch (step.type) {
      case 'scenario_enrolled':
        sql = `SELECT COUNT(DISTINCT fs.friend_id) as cnt FROM friend_scenarios fs INNER JOIN friends f ON f.id = fs.friend_id WHERE fs.scenario_id = ?${accountFilter}`;
        bindings.push(step.value, ...accountBindings);
        break;
      case 'scenario_completed':
        sql = `SELECT COUNT(DISTINCT fs.friend_id) as cnt FROM friend_scenarios fs INNER JOIN friends f ON f.id = fs.friend_id WHERE fs.scenario_id = ? AND fs.status = 'completed'${accountFilter}`;
        bindings.push(step.value, ...accountBindings);
        break;
      case 'tag_added':
        sql = `SELECT COUNT(DISTINCT ft.friend_id) as cnt FROM friend_tags ft INNER JOIN friends f ON f.id = ft.friend_id WHERE ft.tag_id = ?${accountFilter}`;
        bindings.push(step.value, ...accountBindings);
        break;
      case 'conversion':
        sql = `SELECT COUNT(DISTINCT cl.friend_id) as cnt FROM conversion_logs cl INNER JOIN friends f ON f.id = cl.friend_id WHERE cl.conversion_point_id = ?${accountFilter}`;
        bindings.push(step.value, ...accountBindings);
        break;
      case 'custom_event':
        // Count from messages_log or automation_logs
        sql = `SELECT COUNT(DISTINCT ml.friend_id) as cnt FROM messages_log ml INNER JOIN friends f ON f.id = ml.friend_id WHERE ml.content LIKE ?${accountFilter}`;
        bindings.push(`%${step.value}%`, ...accountBindings);
        break;
      default:
        counts.push(0);
        continue;
    }

    const result = await db.prepare(sql).bind(...bindings).first<{ cnt: number }>();
    counts.push(result?.cnt || 0);
  }

  return counts;
}
