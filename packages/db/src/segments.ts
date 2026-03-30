import { jstNow } from './utils';

export interface Segment {
  id: string;
  name: string;
  description: string | null;
  conditions_json: string;
  line_account_id: string | null;
  created_at: string;
  updated_at: string;
}

export async function getSegments(db: D1Database, lineAccountId?: string): Promise<Segment[]> {
  const sql = lineAccountId
    ? 'SELECT * FROM segments WHERE line_account_id = ? OR line_account_id IS NULL ORDER BY created_at DESC'
    : 'SELECT * FROM segments ORDER BY created_at DESC';
  const result = await db
    .prepare(sql)
    .bind(...(lineAccountId ? [lineAccountId] : []))
    .all<Segment>();
  return result.results;
}

export async function getSegmentById(db: D1Database, id: string): Promise<Segment | null> {
  return db.prepare('SELECT * FROM segments WHERE id = ?').bind(id).first<Segment>();
}

export async function createSegment(
  db: D1Database,
  data: { name: string; description?: string; conditionsJson: string; lineAccountId?: string },
): Promise<Segment> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      'INSERT INTO segments (id, name, description, conditions_json, line_account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .bind(id, data.name, data.description || null, data.conditionsJson, data.lineAccountId || null, now, now)
    .run();
  return (await getSegmentById(db, id))!;
}

export async function updateSegment(
  db: D1Database,
  id: string,
  data: { name?: string; description?: string; conditionsJson?: string },
): Promise<Segment | null> {
  const existing = await getSegmentById(db, id);
  if (!existing) return null;
  const now = jstNow();
  await db
    .prepare(
      'UPDATE segments SET name = ?, description = ?, conditions_json = ?, updated_at = ? WHERE id = ?',
    )
    .bind(
      data.name ?? existing.name,
      data.description ?? existing.description,
      data.conditionsJson ?? existing.conditions_json,
      now,
      id,
    )
    .run();
  return getSegmentById(db, id);
}

export async function deleteSegment(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM segments WHERE id = ?').bind(id).run();
}
