import { jstNow } from './utils.js';
// =============================================================================
// Conversion Points & Events — CV Tracking
// =============================================================================

export interface ConversionPoint {
  id: string;
  name: string;
  event_type: string;
  value: number | null;
  created_at: string;
}

export interface ConversionEvent {
  id: string;
  conversion_point_id: string;
  friend_id: string;
  user_id: string | null;
  affiliate_code: string | null;
  metadata: string | null;
  created_at: string;
}

// ── Conversion Points CRUD ──────────────────────────────────────────────────

export async function getConversionPoints(db: D1Database): Promise<ConversionPoint[]> {
  const result = await db
    .prepare(`SELECT * FROM conversion_points ORDER BY created_at DESC`)
    .all<ConversionPoint>();
  return result.results;
}

export async function getConversionPointById(
  db: D1Database,
  id: string,
): Promise<ConversionPoint | null> {
  return db
    .prepare(`SELECT * FROM conversion_points WHERE id = ?`)
    .bind(id)
    .first<ConversionPoint>();
}

export interface CreateConversionPointInput {
  name: string;
  eventType: string;
  value?: number | null;
}

export async function createConversionPoint(
  db: D1Database,
  input: CreateConversionPointInput,
): Promise<ConversionPoint> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO conversion_points (id, name, event_type, value, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, input.name, input.eventType, input.value ?? null, now)
    .run();

  return (await getConversionPointById(db, id))!;
}

export async function deleteConversionPoint(
  db: D1Database,
  id: string,
): Promise<void> {
  await db.prepare(`DELETE FROM conversion_points WHERE id = ?`).bind(id).run();
}

// ── Conversion Events ───────────────────────────────────────────────────────

export interface TrackConversionInput {
  conversionPointId: string;
  friendId: string;
  userId?: string | null;
  affiliateCode?: string | null;
  metadata?: string | null;
}

export async function trackConversion(
  db: D1Database,
  input: TrackConversionInput,
): Promise<ConversionEvent> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO conversion_events (id, conversion_point_id, friend_id, user_id, affiliate_code, metadata, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.conversionPointId,
      input.friendId,
      input.userId ?? null,
      input.affiliateCode ?? null,
      input.metadata ?? null,
      now,
    )
    .run();

  return (await db
    .prepare(`SELECT * FROM conversion_events WHERE id = ?`)
    .bind(id)
    .first<ConversionEvent>())!;
}

export async function getConversionEvents(
  db: D1Database,
  opts: {
    conversionPointId?: string;
    friendId?: string;
    affiliateCode?: string;
    startDate?: string;
    endDate?: string;
    limit?: number;
    offset?: number;
  } = {},
): Promise<ConversionEvent[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (opts.conversionPointId) {
    conditions.push('conversion_point_id = ?');
    values.push(opts.conversionPointId);
  }
  if (opts.friendId) {
    conditions.push('friend_id = ?');
    values.push(opts.friendId);
  }
  if (opts.affiliateCode) {
    conditions.push('affiliate_code = ?');
    values.push(opts.affiliateCode);
  }
  if (opts.startDate) {
    conditions.push('created_at >= ?');
    values.push(opts.startDate);
  }
  if (opts.endDate) {
    conditions.push('created_at <= ?');
    values.push(opts.endDate);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = opts.limit ?? 100;
  const offset = opts.offset ?? 0;

  values.push(limit, offset);

  const result = await db
    .prepare(
      `SELECT * FROM conversion_events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    )
    .bind(...values)
    .all<ConversionEvent>();
  return result.results;
}

export interface ConversionReport {
  conversionPointId: string;
  conversionPointName: string;
  eventType: string;
  totalCount: number;
  totalValue: number;
}

export async function getConversionReport(
  db: D1Database,
  opts: { startDate?: string; endDate?: string } = {},
): Promise<ConversionReport[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (opts.startDate) {
    conditions.push('ce.created_at >= ?');
    values.push(opts.startDate);
  }
  if (opts.endDate) {
    conditions.push('ce.created_at <= ?');
    values.push(opts.endDate);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db
    .prepare(
      `SELECT
         cp.id as conversion_point_id,
         cp.name as conversion_point_name,
         cp.event_type,
         COUNT(ce.id) as total_count,
         COALESCE(SUM(cp.value), 0) as total_value
       FROM conversion_points cp
       LEFT JOIN conversion_events ce ON ce.conversion_point_id = cp.id ${conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : ''}
       GROUP BY cp.id
       ORDER BY total_count DESC`,
    )
    .bind(...values)
    .all<{
      conversion_point_id: string;
      conversion_point_name: string;
      event_type: string;
      total_count: number;
      total_value: number;
    }>();

  return result.results.map((r) => ({
    conversionPointId: r.conversion_point_id,
    conversionPointName: r.conversion_point_name,
    eventType: r.event_type,
    totalCount: r.total_count,
    totalValue: r.total_value,
  }));
}
