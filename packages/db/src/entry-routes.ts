import { jstNow } from './utils.js';
export interface EntryRoute {
  id: string;
  ref_code: string;
  name: string;
  tag_id: string | null;
  scenario_id: string | null;
  redirect_url: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface RefTracking {
  id: string;
  ref_code: string;
  friend_id: string | null;
  entry_route_id: string | null;
  source_url: string | null;
  fbclid: string | null;
  gclid: string | null;
  twclid: string | null;
  ttclid: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
}

export interface CreateEntryRouteInput {
  refCode: string;
  name: string;
  tagId?: string | null;
  scenarioId?: string | null;
  redirectUrl?: string | null;
  isActive?: boolean;
}

export async function getEntryRoutes(db: D1Database): Promise<EntryRoute[]> {
  const result = await db
    .prepare(`SELECT * FROM entry_routes ORDER BY created_at DESC`)
    .all<EntryRoute>();
  return result.results;
}

export async function getEntryRouteByRefCode(
  db: D1Database,
  refCode: string,
): Promise<EntryRoute | null> {
  return db
    .prepare(`SELECT * FROM entry_routes WHERE ref_code = ? AND is_active = 1`)
    .bind(refCode)
    .first<EntryRoute>();
}

export async function createEntryRoute(
  db: D1Database,
  input: CreateEntryRouteInput,
): Promise<EntryRoute> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const isActive = input.isActive !== false ? 1 : 0;

  await db
    .prepare(
      `INSERT INTO entry_routes
         (id, ref_code, name, tag_id, scenario_id, redirect_url, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.refCode,
      input.name,
      input.tagId ?? null,
      input.scenarioId ?? null,
      input.redirectUrl ?? null,
      isActive,
      now,
      now,
    )
    .run();

  return (await db
    .prepare(`SELECT * FROM entry_routes WHERE id = ?`)
    .bind(id)
    .first<EntryRoute>())!;
}

export async function updateEntryRoute(
  db: D1Database,
  id: string,
  input: Partial<CreateEntryRouteInput>,
): Promise<EntryRoute | null> {
  const now = jstNow();
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];

  if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
  if (input.refCode !== undefined) { fields.push('ref_code = ?'); values.push(input.refCode); }
  if (input.tagId !== undefined) { fields.push('tag_id = ?'); values.push(input.tagId ?? null); }
  if (input.scenarioId !== undefined) { fields.push('scenario_id = ?'); values.push(input.scenarioId ?? null); }
  if (input.redirectUrl !== undefined) { fields.push('redirect_url = ?'); values.push(input.redirectUrl ?? null); }
  if (input.isActive !== undefined) { fields.push('is_active = ?'); values.push(input.isActive ? 1 : 0); }

  values.push(id);

  await db
    .prepare(`UPDATE entry_routes SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return db
    .prepare(`SELECT * FROM entry_routes WHERE id = ?`)
    .bind(id)
    .first<EntryRoute>();
}

export async function deleteEntryRoute(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM entry_routes WHERE id = ?`).bind(id).run();
}

export async function recordRefTracking(
  db: D1Database,
  opts: {
    refCode: string;
    friendId?: string | null;
    entryRouteId?: string | null;
    sourceUrl?: string | null;
    fbclid?: string | null;
    gclid?: string | null;
    twclid?: string | null;
    ttclid?: string | null;
    utmSource?: string | null;
    utmMedium?: string | null;
    utmCampaign?: string | null;
    userAgent?: string | null;
    ipAddress?: string | null;
  },
): Promise<RefTracking> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO ref_tracking
       (id, ref_code, friend_id, entry_route_id, source_url,
        fbclid, gclid, twclid, ttclid, utm_source, utm_medium, utm_campaign,
        user_agent, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      opts.refCode,
      opts.friendId ?? null,
      opts.entryRouteId ?? null,
      opts.sourceUrl ?? null,
      opts.fbclid ?? null,
      opts.gclid ?? null,
      opts.twclid ?? null,
      opts.ttclid ?? null,
      opts.utmSource ?? null,
      opts.utmMedium ?? null,
      opts.utmCampaign ?? null,
      opts.userAgent ?? null,
      opts.ipAddress ?? null,
      now,
    )
    .run();

  return (await db
    .prepare(`SELECT * FROM ref_tracking WHERE id = ?`)
    .bind(id)
    .first<RefTracking>())!;
}

export async function getRefTrackingWithClickIds(
  db: D1Database,
  friendId: string,
): Promise<RefTracking | null> {
  return db
    .prepare(
      `SELECT * FROM ref_tracking
       WHERE friend_id = ?
       AND (fbclid IS NOT NULL OR gclid IS NOT NULL OR twclid IS NOT NULL OR ttclid IS NOT NULL)
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .bind(friendId)
    .first<RefTracking>();
}

export async function getRefTrackingByFriend(
  db: D1Database,
  friendId: string,
): Promise<RefTracking[]> {
  const result = await db
    .prepare(`SELECT * FROM ref_tracking WHERE friend_id = ? ORDER BY created_at DESC`)
    .bind(friendId)
    .all<RefTracking>();
  return result.results;
}

export async function getRefTrackingStats(
  db: D1Database,
  refCode: string,
): Promise<{ ref_code: string; count: number }> {
  const row = await db
    .prepare(
      `SELECT ref_code, COUNT(*) as count FROM ref_tracking WHERE ref_code = ? GROUP BY ref_code`,
    )
    .bind(refCode)
    .first<{ ref_code: string; count: number }>();
  return row ?? { ref_code: refCode, count: 0 };
}
