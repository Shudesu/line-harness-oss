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
  // 'failed_permanent' は P1 (2026-06-07) で追加。retry queue が 6回失敗した DLQ 状態。
  status: 'sent' | 'failed' | 'timeout' | 'failed_permanent';
  http_status: number | null;
  duration_ms: number | null;
  error_message: string | null;
  created_at: string;
}

/**
 * P1 (2026-06-07): CRM forward 失敗時の retry queue row。
 * 066_crm_forward_queue.sql 参照。
 */
export interface CrmForwardQueueItem {
  id: string;
  crm_forward_id: string;
  raw_body: string;
  signature: string | null;
  attempt: number;
  next_retry_at: string;
  last_error: string | null;
  created_at: string;
}

/**
 * 指数バックオフのテーブル。attempt が配列長を超えたら DLQ。
 * 1分 → 5分 → 15分 → 1時間 → 6時間 → 24時間 = 計 6 試行。
 */
export const CRM_FORWARD_BACKOFF_SECONDS = [60, 300, 900, 3600, 21600, 86400] as const;
export const CRM_FORWARD_MAX_ATTEMPTS = CRM_FORWARD_BACKOFF_SECONDS.length;

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
    // 'failed_permanent' は P1 (2026-06-07) で追加 (retry queue が DLQ 化したとき)。
    status: 'sent' | 'failed' | 'timeout' | 'failed_permanent';
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

// ─── P1 (2026-06-07): CRM forward retry queue helpers ──────────────────

/**
 * 次回 due 時刻を attempt から計算する (ISO 8601, JST naive)。
 * attempt=0 は「これから初回 retry」= 1分後、以降は backoff テーブル。
 * 配列範囲外 (DLQ 直前のセーフティ) は最後の値を使う。
 */
function computeNextRetryAt(attempt: number): string {
  const idx = Math.min(attempt, CRM_FORWARD_BACKOFF_SECONDS.length - 1);
  const seconds = CRM_FORWARD_BACKOFF_SECONDS[idx];
  const future = new Date(Date.now() + seconds * 1000);
  // jstNow と同じ JST naive 形式に揃える (datetime('now','+9 hours') 互換)。
  const jstMs = future.getTime() + 9 * 60 * 60 * 1000;
  return new Date(jstMs).toISOString().replace('Z', '');
}

/**
 * forward 失敗時に queue へ enqueue。次回 retry は 1分後 (attempt=0)。
 * 既に同じ payload + forward の row が残っている場合でも別 row として
 * 投入する (race を恐れて UNIQUE 制約は付けない; payload bytes 完全一致は
 * ほぼ起きないため重複コストは無視できる)。
 */
export async function enqueueCrmForwardRetry(
  db: D1Database,
  input: {
    crmForwardId: string;
    rawBody: string;
    signature?: string | null;
    initialError?: string | null;
  },
): Promise<void> {
  const id = crypto.randomUUID();
  const nextRetryAt = computeNextRetryAt(0);
  await db
    .prepare(
      `INSERT INTO crm_forward_queue
         (id, crm_forward_id, raw_body, signature, attempt, next_retry_at, last_error, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?, datetime('now', '+9 hours'))`,
    )
    .bind(
      id,
      input.crmForwardId,
      input.rawBody,
      input.signature ?? null,
      nextRetryAt,
      input.initialError ?? null,
    )
    .run();
}

/**
 * 5min cron で due な queue row を取得する。
 * next_retry_at <= now AND attempt < MAX で fetch、古いものから処理。
 * limit は 1 tick あたりの処理上限 (Worker のサブリクエスト 1k 制限を考慮)。
 */
export async function getDueCrmForwardQueueItems(
  db: D1Database,
  limit = 50,
): Promise<CrmForwardQueueItem[]> {
  const nowIso = jstNow();
  const r = await db
    .prepare(
      `SELECT * FROM crm_forward_queue
        WHERE next_retry_at <= ? AND attempt < ?
        ORDER BY next_retry_at ASC
        LIMIT ?`,
    )
    .bind(nowIso, CRM_FORWARD_MAX_ATTEMPTS, limit)
    .all<CrmForwardQueueItem>();
  return r.results;
}

/**
 * 成功時: queue から削除。crm_forward_logs には呼び出し側で 'sent' を残す前提。
 */
export async function deleteCrmForwardQueueItem(
  db: D1Database,
  id: string,
): Promise<void> {
  await db.prepare(`DELETE FROM crm_forward_queue WHERE id = ?`).bind(id).run();
}

/**
 * 失敗時: attempt++ して next_retry_at を更新。
 * attempt が MAX に達したら queue から削除 (DLQ) して caller 側で
 * 'failed_permanent' を logs に書く設計。
 *
 * 戻り値: 'requeued' = まだ retry 余地あり / 'dlq' = 6回失敗で削除済
 */
export async function bumpCrmForwardQueueItem(
  db: D1Database,
  id: string,
  currentAttempt: number,
  error: string,
): Promise<'requeued' | 'dlq'> {
  const nextAttempt = currentAttempt + 1;
  if (nextAttempt >= CRM_FORWARD_MAX_ATTEMPTS) {
    await db.prepare(`DELETE FROM crm_forward_queue WHERE id = ?`).bind(id).run();
    return 'dlq';
  }
  const nextRetryAt = computeNextRetryAt(nextAttempt);
  await db
    .prepare(
      `UPDATE crm_forward_queue
          SET attempt = ?, next_retry_at = ?, last_error = ?
        WHERE id = ?`,
    )
    .bind(nextAttempt, nextRetryAt, error.slice(0, 500), id)
    .run();
  return 'requeued';
}

/**
 * P1 (2026-06-07 修正): 「is_enabled=0 で skip する」ような attempt を増やしたく
 * ない遅延ケース用。next_retry_at だけを deferSeconds 後に伸ばし、attempt は
 * 据え置く (バックオフ bucket を退行させない / DLQ 判定に影響を与えない)。
 */
export async function deferCrmForwardQueueItem(
  db: D1Database,
  id: string,
  deferSeconds: number,
  reason: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE crm_forward_queue
          SET next_retry_at = datetime('now', '+' || ? || ' seconds'),
              last_error = ?
        WHERE id = ?`,
    )
    .bind(deferSeconds, reason.slice(0, 500), id)
    .run();
}
