/**
 * Message-log retention: archive rows older than LOG_RETENTION_DAYS to R2
 * (NDJSON), then delete them from D1. Retention is disabled unless the
 * env var is a positive integer — unset keeps today's unlimited behavior.
 */

import { monthStartJst, quotaConfig } from './quota.js';

/** Parse LOG_RETENTION_DAYS. 0 = disabled (default). */
export function logRetentionDays(env: { LOG_RETENTION_DAYS?: string }): number {
  const n = Number((env.LOG_RETENTION_DAYS ?? '').trim());
  return Number.isInteger(n) && n > 0 ? n : 0;
}

export const RETENTION_BATCH_SIZE = 90; // < D1's 100-bind-variable limit
export const RETENTION_MAX_BATCHES = 10; // ≤900 rows per run; backlog drains gradually

/**
 * Cutoff string in the exact created_at format:
 * strftime('%Y-%m-%dT%H:%M:%f','now','+9 hours') — JST, T-separated, 3-digit
 * millis, no timezone suffix. Lexicographic compare is therefore safe.
 */
export function retentionCutoff(now: Date, days: number): string {
  const jst = new Date(now.getTime() + 9 * 3600_000 - days * 86_400_000);
  return jst.toISOString().slice(0, 23);
}

type LogRow = Record<string, unknown> & { id: string; created_at: string };

export async function runLogRetention(
  db: D1Database,
  r2: R2Bucket,
  env: { LOG_RETENTION_DAYS?: string; QUOTA_MONTHLY_MESSAGES_MAX?: string },
  now: Date = new Date(),
): Promise<{ archived: number; batches: number }> {
  const days = logRetentionDays(env);
  if (days === 0) return { archived: 0, batches: 0 };

  // When a monthly send limit is active, clamp the cutoff to the start of the
  // current JST month: the usage tally (services/quota.ts) counts this
  // month's messages_log rows, and a retention window shorter than the month
  // would silently shrink that count mid-month. Without a monthly limit the
  // configured window applies as-is — deployments that keep a short window
  // purely to limit stored history must not have their retention behavior
  // changed underneath them. Both strings share the created_at format, so
  // the lexicographic min is the earlier moment.
  const windowCutoff = retentionCutoff(now, days);
  const monthlyQuotaActive = quotaConfig(env).monthlyMessagesMax > 0;
  const monthStart = monthStartJst(now);
  const cutoff = monthlyQuotaActive && monthStart < windowCutoff ? monthStart : windowCutoff;
  let archived = 0;
  let batches = 0;

  for (let i = 0; i < RETENTION_MAX_BATCHES; i += 1) {
    const { results } = await db
      .prepare(
        `SELECT id, friend_id, direction, message_type, content, broadcast_id,
                scenario_step_id, template_id_at_send, delivery_type, source,
                line_account_id, created_at
           FROM messages_log WHERE created_at < ? ORDER BY created_at LIMIT ?`,
      )
      .bind(cutoff, RETENTION_BATCH_SIZE)
      .all<LogRow>();
    if (!results || results.length === 0) break;

    // Archive first: a crash after put but before delete re-archives the same
    // rows to the same key next run (overwrite, harmless). Rows are never
    // deleted unless their archive object was written.
    const first = results[0]!;
    const key = `archive/messages_log/${first.created_at.slice(0, 10)}/${first.id}.ndjson`;
    const ndjson = results.map((r) => JSON.stringify(r)).join('\n') + '\n';
    await r2.put(key, ndjson);

    const ids = results.map((r) => r.id);
    await db
      .prepare(
        `DELETE FROM messages_log WHERE id IN (${ids.map(() => '?').join(',')})`,
      )
      .bind(...ids)
      .run();

    archived += results.length;
    batches += 1;
    if (results.length < RETENTION_BATCH_SIZE) break;
  }

  return { archived, batches };
}
