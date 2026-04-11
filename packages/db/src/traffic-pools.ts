import { jstNow } from './utils.js';
// =============================================================================
// Traffic Pools — instant account switching via /pool/:slug
// =============================================================================

export interface TrafficPool {
  id: string;
  slug: string;
  name: string;
  active_account_id: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface TrafficPoolWithAccount extends TrafficPool {
  account_name: string;
  liff_id: string | null;
  login_channel_id: string | null;
  login_channel_secret: string | null;
  channel_access_token: string | null;
  channel_id: string | null;
}

// ── Queries ─────────────────────────────────────────────────────────────────

export async function getTrafficPools(db: D1Database): Promise<TrafficPoolWithAccount[]> {
  const result = await db
    .prepare(
      `SELECT tp.*, la.name as account_name, la.liff_id, la.login_channel_id, la.login_channel_secret, la.channel_access_token, la.channel_id
       FROM traffic_pools tp
       JOIN line_accounts la ON la.id = tp.active_account_id
       ORDER BY tp.created_at DESC`,
    )
    .all<TrafficPoolWithAccount>();
  return result.results;
}

export async function getTrafficPoolById(
  db: D1Database,
  id: string,
): Promise<TrafficPoolWithAccount | null> {
  return db
    .prepare(
      `SELECT tp.*, la.name as account_name, la.liff_id, la.login_channel_id, la.login_channel_secret, la.channel_access_token, la.channel_id
       FROM traffic_pools tp
       JOIN line_accounts la ON la.id = tp.active_account_id
       WHERE tp.id = ?`,
    )
    .bind(id)
    .first<TrafficPoolWithAccount>();
}

export async function getTrafficPoolBySlug(
  db: D1Database,
  slug: string,
): Promise<TrafficPoolWithAccount | null> {
  return db
    .prepare(
      `SELECT tp.*, la.name as account_name, la.liff_id, la.login_channel_id, la.login_channel_secret, la.channel_access_token, la.channel_id
       FROM traffic_pools tp
       JOIN line_accounts la ON la.id = tp.active_account_id
       WHERE tp.slug = ? AND tp.is_active = 1`,
    )
    .bind(slug)
    .first<TrafficPoolWithAccount>();
}

// ── Mutations ───────────────────────────────────────────────────────────────

export interface CreateTrafficPoolInput {
  slug: string;
  name: string;
  activeAccountId: string;
}

export async function createTrafficPool(
  db: D1Database,
  input: CreateTrafficPoolInput,
): Promise<TrafficPoolWithAccount> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO traffic_pools (id, slug, name, active_account_id, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, input.slug, input.name, input.activeAccountId, now, now)
    .run();

  return (await getTrafficPoolById(db, id))!;
}

export interface UpdateTrafficPoolInput {
  name?: string;
  activeAccountId?: string;
  isActive?: boolean;
}

export async function updateTrafficPool(
  db: D1Database,
  id: string,
  updates: UpdateTrafficPoolInput,
): Promise<TrafficPoolWithAccount | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.activeAccountId !== undefined) {
    fields.push('active_account_id = ?');
    values.push(updates.activeAccountId);
  }
  if (updates.isActive !== undefined) {
    fields.push('is_active = ?');
    values.push(updates.isActive ? 1 : 0);
  }

  if (fields.length === 0) return getTrafficPoolById(db, id);

  fields.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);

  await db
    .prepare(`UPDATE traffic_pools SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return getTrafficPoolById(db, id);
}

export async function deleteTrafficPool(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM traffic_pools WHERE id = ?`).bind(id).run();
}

// =============================================================================
// Pool Accounts — multiple LINE accounts per pool for distribution
// =============================================================================

export interface PoolAccount {
  id: string;
  pool_id: string;
  line_account_id: string;
  is_active: number;
  created_at: string;
}

export interface PoolAccountWithDetails extends PoolAccount {
  account_name: string;
  liff_id: string | null;
  login_channel_id: string | null;
  login_channel_secret: string | null;
  channel_access_token: string | null;
  channel_id: string | null;
}

const POOL_ACCOUNT_JOIN = `
  SELECT pa.*, la.name as account_name, la.liff_id, la.login_channel_id, la.login_channel_secret, la.channel_access_token, la.channel_id
  FROM pool_accounts pa
  JOIN line_accounts la ON la.id = pa.line_account_id`;

export async function getPoolAccounts(db: D1Database, poolId: string): Promise<PoolAccountWithDetails[]> {
  const result = await db
    .prepare(`${POOL_ACCOUNT_JOIN} WHERE pa.pool_id = ? ORDER BY pa.created_at ASC`)
    .bind(poolId)
    .all<PoolAccountWithDetails>();
  return result.results;
}

export async function getRandomPoolAccount(db: D1Database, poolId: string): Promise<PoolAccountWithDetails | null> {
  return db
    .prepare(`${POOL_ACCOUNT_JOIN} WHERE pa.pool_id = ? AND pa.is_active = 1 ORDER BY RANDOM() LIMIT 1`)
    .bind(poolId)
    .first<PoolAccountWithDetails>();
}

export async function addPoolAccount(db: D1Database, poolId: string, lineAccountId: string): Promise<PoolAccount> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const result = await db
    .prepare('INSERT INTO pool_accounts (id, pool_id, line_account_id, is_active, created_at) VALUES (?, ?, ?, 1, ?) RETURNING *')
    .bind(id, poolId, lineAccountId, now)
    .first<PoolAccount>();
  return result!;
}

export async function removePoolAccount(db: D1Database, id: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM pool_accounts WHERE id = ?').bind(id).run();
  return result.meta.changes > 0;
}

export async function togglePoolAccount(db: D1Database, id: string, isActive: boolean): Promise<PoolAccount | null> {
  return db
    .prepare('UPDATE pool_accounts SET is_active = ? WHERE id = ? RETURNING *')
    .bind(isActive ? 1 : 0, id)
    .first<PoolAccount>();
}
