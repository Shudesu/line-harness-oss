import { jstNow } from './utils.js';

export interface GmailImportRule {
  id: string;
  connection_id: string;
  source_name: 'jalan';
  name: string;
  from_email: string | null;
  query: string | null;
  unprocessed_label_id: string;
  processed_label_id: string;
  review_label_id: string;
  failed_label_id: string;
  resource_id: string | null;
  menu_id: string | null;
  max_results: number;
  is_active: number;
  last_run_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GmailImportRun {
  id: string;
  rule_id: string;
  started_at: string;
  finished_at: string | null;
  status: 'running' | 'success' | 'partial_failed' | 'failed';
  fetched_count: number;
  imported_count: number;
  review_count: number;
  failed_count: number;
  last_error: string | null;
}

export interface CreateGmailImportRuleInput {
  connectionId: string;
  name: string;
  fromEmail?: string | null;
  query?: string | null;
  unprocessedLabelId: string;
  processedLabelId: string;
  reviewLabelId: string;
  failedLabelId: string;
  resourceId?: string | null;
  menuId?: string | null;
  maxResults?: number;
  isActive?: boolean;
}

export interface UpdateGmailImportRuleInput extends Partial<CreateGmailImportRuleInput> {}

export async function listGmailImportRules(db: D1Database, opts: { activeOnly?: boolean } = {}): Promise<GmailImportRule[]> {
  const sql = opts.activeOnly
    ? `SELECT * FROM gmail_import_rules WHERE is_active = 1 ORDER BY created_at DESC`
    : `SELECT * FROM gmail_import_rules ORDER BY created_at DESC`;
  const result = await db.prepare(sql).all<GmailImportRule>();
  return result.results;
}

export async function getGmailImportRuleById(db: D1Database, id: string): Promise<GmailImportRule | null> {
  return db.prepare(`SELECT * FROM gmail_import_rules WHERE id = ?`).bind(id).first<GmailImportRule>();
}

export async function createGmailImportRule(db: D1Database, input: CreateGmailImportRuleInput): Promise<GmailImportRule> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO gmail_import_rules
         (id, connection_id, source_name, name, from_email, query, unprocessed_label_id,
          processed_label_id, review_label_id, failed_label_id, resource_id, menu_id,
          max_results, is_active, created_at, updated_at)
       VALUES (?, ?, 'jalan', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.connectionId,
      input.name,
      emptyToNull(input.fromEmail),
      emptyToNull(input.query),
      input.unprocessedLabelId,
      input.processedLabelId,
      input.reviewLabelId,
      input.failedLabelId,
      emptyToNull(input.resourceId),
      emptyToNull(input.menuId),
      normalizeMaxResults(input.maxResults),
      input.isActive === false ? 0 : 1,
      now,
      now,
    )
    .run();
  return (await getGmailImportRuleById(db, id))!;
}

export async function updateGmailImportRule(
  db: D1Database,
  id: string,
  input: UpdateGmailImportRuleInput,
): Promise<GmailImportRule | null> {
  const existing = await getGmailImportRuleById(db, id);
  if (!existing) return null;
  await db
    .prepare(
      `UPDATE gmail_import_rules
       SET connection_id = ?,
           name = ?,
           from_email = ?,
           query = ?,
           unprocessed_label_id = ?,
           processed_label_id = ?,
           review_label_id = ?,
           failed_label_id = ?,
           resource_id = ?,
           menu_id = ?,
           max_results = ?,
           is_active = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.connectionId ?? existing.connection_id,
      input.name ?? existing.name,
      input.fromEmail === undefined ? existing.from_email : emptyToNull(input.fromEmail),
      input.query === undefined ? existing.query : emptyToNull(input.query),
      input.unprocessedLabelId ?? existing.unprocessed_label_id,
      input.processedLabelId ?? existing.processed_label_id,
      input.reviewLabelId ?? existing.review_label_id,
      input.failedLabelId ?? existing.failed_label_id,
      input.resourceId === undefined ? existing.resource_id : emptyToNull(input.resourceId),
      input.menuId === undefined ? existing.menu_id : emptyToNull(input.menuId),
      input.maxResults === undefined ? existing.max_results : normalizeMaxResults(input.maxResults),
      input.isActive === undefined ? existing.is_active : input.isActive ? 1 : 0,
      jstNow(),
      id,
    )
    .run();
  return getGmailImportRuleById(db, id);
}

export async function softDeleteGmailImportRule(db: D1Database, id: string): Promise<GmailImportRule | null> {
  return updateGmailImportRule(db, id, { isActive: false });
}

export async function markGmailImportRuleRunAt(db: D1Database, id: string, at = jstNow()): Promise<void> {
  await db.prepare(`UPDATE gmail_import_rules SET last_run_at = ?, updated_at = ? WHERE id = ?`).bind(at, at, id).run();
}

export async function createGmailImportRun(db: D1Database, ruleId: string): Promise<GmailImportRun> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO gmail_import_runs
         (id, rule_id, started_at, status)
       VALUES (?, ?, ?, 'running')`,
    )
    .bind(id, ruleId, now)
    .run();
  return (await getGmailImportRunById(db, id))!;
}

export async function getGmailImportRunById(db: D1Database, id: string): Promise<GmailImportRun | null> {
  return db.prepare(`SELECT * FROM gmail_import_runs WHERE id = ?`).bind(id).first<GmailImportRun>();
}

export async function listGmailImportRuns(db: D1Database, ruleId?: string, limit = 20): Promise<GmailImportRun[]> {
  const capped = Math.min(Math.max(1, Math.floor(limit)), 100);
  const stmt = ruleId
    ? db.prepare(`SELECT * FROM gmail_import_runs WHERE rule_id = ? ORDER BY started_at DESC LIMIT ?`).bind(ruleId, capped)
    : db.prepare(`SELECT * FROM gmail_import_runs ORDER BY started_at DESC LIMIT ?`).bind(capped);
  const result = await stmt.all<GmailImportRun>();
  return result.results;
}

export async function finishGmailImportRun(
  db: D1Database,
  id: string,
  input: {
    status: GmailImportRun['status'];
    fetchedCount: number;
    importedCount: number;
    reviewCount: number;
    failedCount: number;
    lastError?: string | null;
  },
): Promise<GmailImportRun | null> {
  await db
    .prepare(
      `UPDATE gmail_import_runs
       SET finished_at = ?,
           status = ?,
           fetched_count = ?,
           imported_count = ?,
           review_count = ?,
           failed_count = ?,
           last_error = ?
       WHERE id = ?`,
    )
    .bind(
      jstNow(),
      input.status,
      input.fetchedCount,
      input.importedCount,
      input.reviewCount,
      input.failedCount,
      input.lastError ?? null,
      id,
    )
    .run();
  return getGmailImportRunById(db, id);
}

function emptyToNull(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function normalizeMaxResults(value?: number): number {
  const n = Math.floor(value ?? 10);
  if (!Number.isFinite(n)) return 10;
  return Math.min(Math.max(n, 1), 50);
}
