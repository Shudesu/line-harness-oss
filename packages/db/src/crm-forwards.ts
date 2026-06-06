/**
 * 監査 H1 対応: CRM forward (外部 CRM への webhook 転送) の DB ヘルパ。
 * エルメ等への並行運用用。
 */

import { jstNow } from './utils.js';

export interface CrmForward {
  id: string;
  line_account_id: string;
  name: string;
  webhook_url: string;
  is_enabled: number;
  attach_line_signature: number;
  max_retries: number;
  memo: string | null;
  created_at: string;
  updated_at: string;
}

export interface CrmForwardLog {
  id: string;
  crm_forward_id: string;
  status: 'sent' | 'failed' | 'timeout';
  http_status: number | null;
  duration_ms: number | null;
  error_message: string | null;
  created_at: string;
}

export async function getEnabledCrmForwards(
  db: D1Database,
  lineAccountId: string,
): Promise<CrmForward[]> {
  const r = await db
    .prepare(
      `SELECT * FROM crm_forwards
        WHERE line_account_id = ? AND is_enabled = 1
        ORDER BY created_at ASC`,
    )
    .bind(lineAccountId)
    .all<CrmForward>();
  return r.results;
}

export async function listCrmForwards(
  db: D1Database,
  opts: { lineAccountId?: string | null } = {},
): Promise<CrmForward[]> {
  if (opts.lineAccountId) {
    const r = await db
      .prepare(
        `SELECT * FROM crm_forwards
          WHERE line_account_id = ?
          ORDER BY created_at DESC`,
      )
      .bind(opts.lineAccountId)
      .all<CrmForward>();
    return r.results;
  }
  const r = await db
    .prepare(`SELECT * FROM crm_forwards ORDER BY created_at DESC`)
    .all<CrmForward>();
  return r.results;
}

export async function createCrmForward(
  db: D1Database,
  input: {
    lineAccountId: string;
    name: string;
    webhookUrl: string;
    attachLineSignature?: boolean;
    maxRetries?: number;
    memo?: string | null;
  },
): Promise<CrmForward> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO crm_forwards
         (id, line_account_id, name, webhook_url, is_enabled,
          attach_line_signature, max_retries, memo, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.lineAccountId,
      input.name,
      input.webhookUrl,
      input.attachLineSignature === false ? 0 : 1,
      input.maxRetries ?? 0,
      input.memo ?? null,
      now,
      now,
    )
    .run();
  return (await db.prepare(`SELECT * FROM crm_forwards WHERE id = ?`).bind(id).first<CrmForward>())!;
}

export async function updateCrmForward(
  db: D1Database,
  id: string,
  input: Partial<{
    name: string;
    webhookUrl: string;
    isEnabled: boolean;
    attachLineSignature: boolean;
    maxRetries: number;
    memo: string | null;
  }>,
): Promise<CrmForward | null> {
  const now = jstNow();
  const fields: string[] = ['updated_at = ?'];
  const values: unknown[] = [now];
  if (input.name !== undefined) {
    fields.push('name = ?');
    values.push(input.name);
  }
  if (input.webhookUrl !== undefined) {
    fields.push('webhook_url = ?');
    values.push(input.webhookUrl);
  }
  if (input.isEnabled !== undefined) {
    fields.push('is_enabled = ?');
    values.push(input.isEnabled ? 1 : 0);
  }
  if (input.attachLineSignature !== undefined) {
    fields.push('attach_line_signature = ?');
    values.push(input.attachLineSignature ? 1 : 0);
  }
  if (input.maxRetries !== undefined) {
    fields.push('max_retries = ?');
    values.push(input.maxRetries);
  }
  if (input.memo !== undefined) {
    fields.push('memo = ?');
    values.push(input.memo);
  }
  values.push(id);
  await db
    .prepare(`UPDATE crm_forwards SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();
  return db.prepare(`SELECT * FROM crm_forwards WHERE id = ?`).bind(id).first<CrmForward>();
}

export async function deleteCrmForward(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM crm_forwards WHERE id = ?`).bind(id).run();
}

export async function logCrmForwardResult(
  db: D1Database,
  input: {
    crmForwardId: string;
    status: 'sent' | 'failed' | 'timeout';
    httpStatus?: number | null;
    durationMs?: number | null;
    errorMessage?: string | null;
  },
): Promise<void> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO crm_forward_logs
         (id, crm_forward_id, status, http_status, duration_ms, error_message, created_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now', '+9 hours'))`,
    )
    .bind(
      id,
      input.crmForwardId,
      input.status,
      input.httpStatus ?? null,
      input.durationMs ?? null,
      input.errorMessage ?? null,
    )
    .run();
}

/**
 * 古い log を削除（最新100件のみ保持）。定期 cron 推奨。
 */
export async function pruneCrmForwardLogs(db: D1Database, keepLast = 100): Promise<void> {
  await db
    .prepare(
      `DELETE FROM crm_forward_logs
        WHERE id NOT IN (
          SELECT id FROM crm_forward_logs
           ORDER BY created_at DESC
           LIMIT ?
        )`,
    )
    .bind(keepLast)
    .run();
}

export async function getCrmForwardLogs(
  db: D1Database,
  crmForwardId: string,
  limit: number = 50,
): Promise<CrmForwardLog[]> {
  const r = await db
    .prepare(
      `SELECT * FROM crm_forward_logs
        WHERE crm_forward_id = ?
        ORDER BY created_at DESC
        LIMIT ?`,
    )
    .bind(crmForwardId, limit)
    .all<CrmForwardLog>();
  return r.results;
}
