import { jstNow } from './utils.js';
export interface EntryRoute {
  id: string;
  ref_code: string;
  name: string;
  tag_id: string | null;
  scenario_id: string | null;
  redirect_url: string | null;
  pool_id: string | null;
  intro_template_id: string | null;
  run_account_friend_add_scenarios: number;
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
  poolId?: string | null;
  introTemplateId?: string | null;
  runAccountFriendAddScenarios?: boolean;
  isActive?: boolean;
}

export interface EntryRouteFunnel {
  click_count: number;
  friend_add_count: number;
  form_submission_count: number;
  cv_count: number;
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

  const runAccount = input.runAccountFriendAddScenarios !== false ? 1 : 0;

  await db
    .prepare(
      `INSERT INTO entry_routes
         (id, ref_code, name, tag_id, scenario_id, redirect_url,
          pool_id, intro_template_id, run_account_friend_add_scenarios,
          is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.refCode,
      input.name,
      input.tagId ?? null,
      input.scenarioId ?? null,
      input.redirectUrl ?? null,
      input.poolId ?? null,
      input.introTemplateId ?? null,
      runAccount,
      isActive,
      now,
      now,
    )
    .run();

  // Backfill historical ref_tracking rows that were recorded *before* this
  // entry_route existed (e.g. X Harness UUIDs first seen as unregistered
  // inflow, later registered via the /inflow-links 登録 button). Without
  // this, getEntryRouteFunnel() — which counts clicks via
  // ref_tracking.entry_route_id — would drop every pre-registration click
  // even though the same rows still show in the inflow-links list. Only
  // touch rows whose entry_route_id is NULL so we don't clobber attribution
  // from any other route that happens to share a ref_code.
  await db
    .prepare(
      `UPDATE ref_tracking
       SET entry_route_id = ?
       WHERE ref_code = ? AND entry_route_id IS NULL`,
    )
    .bind(id, input.refCode)
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
  if (input.poolId !== undefined) { fields.push('pool_id = ?'); values.push(input.poolId ?? null); }
  if (input.introTemplateId !== undefined) { fields.push('intro_template_id = ?'); values.push(input.introTemplateId ?? null); }
  if (input.runAccountFriendAddScenarios !== undefined) {
    fields.push('run_account_friend_add_scenarios = ?');
    values.push(input.runAccountFriendAddScenarios ? 1 : 0);
  }
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

export async function getEntryRouteById(
  db: D1Database,
  id: string,
): Promise<EntryRoute | null> {
  return db
    .prepare(`SELECT * FROM entry_routes WHERE id = ?`)
    .bind(id)
    .first<EntryRoute>();
}

/**
 * ファネル集計を entry_route_id ベースで返す。
 *
 *   - クリック: ref_tracking の当該 route 行数
 *               (OAuth/LIFF 完了したクリックのみ。/r/:ref ランディングで離脱
 *                したケースは現状計測対象外)
 *   - 友だち追加: friends.ref_code = entry_routes.ref_code の friend 数
 *               (first-touch 判定。friends.ref_code は初回流入時にのみ書かれる
 *                 → 既存友だちが後で別 link を踏んでもこの数には載らない)
 *   - フォーム送信: 上記 first-touch friend が送信した form_submissions 件数
 *   - CV: 上記 first-touch friend が起こした conversion_events 件数
 *
 * `/api/liff/link` は既存友だちにも ref_tracking 行を書くため、ref_tracking の
 * MIN(created_at) でなく friends.ref_code を使うことで、既存友だちの再訪問を
 * friend_add_count から除外している。
 */
export async function getEntryRouteFunnel(
  db: D1Database,
  entryRouteId: string,
): Promise<EntryRouteFunnel> {
  const row = await db
    .prepare(
      `WITH first_touch AS (
         SELECT f.id AS friend_id
         FROM friends f
         INNER JOIN entry_routes er ON er.ref_code = f.ref_code
         WHERE er.id = ?1
       )
       SELECT
         (SELECT COUNT(*) FROM ref_tracking WHERE entry_route_id = ?1) AS click_count,
         (SELECT COUNT(*) FROM first_touch) AS friend_add_count,
         (SELECT COUNT(*) FROM form_submissions
            WHERE friend_id IN (SELECT friend_id FROM first_touch)) AS form_submission_count,
         (SELECT COUNT(*) FROM conversion_events
            WHERE friend_id IN (SELECT friend_id FROM first_touch)) AS cv_count`,
    )
    .bind(entryRouteId)
    .first<EntryRouteFunnel>();
  return (
    row ?? { click_count: 0, friend_add_count: 0, form_submission_count: 0, cv_count: 0 }
  );
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

  if (opts.friendId) {
    await db
      .prepare(`UPDATE friends SET last_ref_code = ?, last_ref_at = ? WHERE id = ?`)
      .bind(opts.refCode, now, opts.friendId)
      .run();
  }

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
