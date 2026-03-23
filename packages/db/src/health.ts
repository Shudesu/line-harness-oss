import { jstNow } from './utils.js';
// BAN検知 & リカバリ クエリヘルパー

export interface AccountHealthLogRow {
  id: string;
  line_account_id: string;
  error_code: number | null;
  error_count: number;
  check_period: string;
  risk_level: string;
  created_at: string;
}

export interface AccountMigrationRow {
  id: string;
  from_account_id: string;
  to_account_id: string;
  status: string;
  migrated_count: number;
  total_count: number;
  created_at: string;
  completed_at: string | null;
}

// --- ヘルスログ ---

export async function getAccountHealthLogs(db: D1Database, lineAccountId: string, limit = 50): Promise<AccountHealthLogRow[]> {
  const result = await db.prepare(`SELECT * FROM account_health_logs WHERE line_account_id = ? ORDER BY created_at DESC LIMIT ?`)
    .bind(lineAccountId, limit).all<AccountHealthLogRow>();
  return result.results;
}

export async function createAccountHealthLog(
  db: D1Database,
  input: { lineAccountId: string; errorCode?: number; errorCount: number; checkPeriod: string; riskLevel: string },
): Promise<AccountHealthLogRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO account_health_logs (id, line_account_id, error_code, error_count, check_period, risk_level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.lineAccountId, input.errorCode ?? null, input.errorCount, input.checkPeriod, input.riskLevel, now).run();
  return (await db.prepare(`SELECT * FROM account_health_logs WHERE id = ?`).bind(id).first<AccountHealthLogRow>())!;
}

/** 最新のリスクレベルを取得 */
export async function getLatestRiskLevel(db: D1Database, lineAccountId: string): Promise<string> {
  const row = await db.prepare(`SELECT risk_level FROM account_health_logs WHERE line_account_id = ? ORDER BY created_at DESC LIMIT 1`)
    .bind(lineAccountId).first<{ risk_level: string }>();
  return row?.risk_level ?? 'normal';
}

// --- マイグレーション ---

export async function getAccountMigrations(db: D1Database): Promise<AccountMigrationRow[]> {
  const result = await db.prepare(`SELECT * FROM account_migrations ORDER BY created_at DESC`).all<AccountMigrationRow>();
  return result.results;
}

export async function getAccountMigrationById(db: D1Database, id: string): Promise<AccountMigrationRow | null> {
  return db.prepare(`SELECT * FROM account_migrations WHERE id = ?`).bind(id).first<AccountMigrationRow>();
}

export async function createAccountMigration(
  db: D1Database,
  input: { fromAccountId: string; toAccountId: string; totalCount: number },
): Promise<AccountMigrationRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db.prepare(`INSERT INTO account_migrations (id, from_account_id, to_account_id, total_count, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(id, input.fromAccountId, input.toAccountId, input.totalCount, now).run();
  return (await getAccountMigrationById(db, id))!;
}

export async function updateAccountMigration(
  db: D1Database,
  id: string,
  updates: Partial<{ status: string; migratedCount: number; completedAt: string }>,
): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  if (updates.status !== undefined) { sets.push('status = ?'); values.push(updates.status); }
  if (updates.migratedCount !== undefined) { sets.push('migrated_count = ?'); values.push(updates.migratedCount); }
  if (updates.completedAt !== undefined) { sets.push('completed_at = ?'); values.push(updates.completedAt); }
  if (sets.length === 0) return;
  values.push(id);
  await db.prepare(`UPDATE account_migrations SET ${sets.join(', ')} WHERE id = ?`).bind(...values).run();
}
