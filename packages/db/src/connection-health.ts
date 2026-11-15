/**
 * Connection-health records stored in the account_settings KVS.
 *
 * PLAN.md 1-1 (onboarding-screening) defines a shared health contract across
 * the harnesses. For LINE, the observable "silent discard" signals are:
 *
 *  - signature verification failures (webhook answers 200 but drops the event)
 *  - channel token refresh failures (token-refresh cron, console-only before)
 *  - 401 from bot/info (revoked/expired token — ban-monitor only treated 403)
 *  - webhook endpoint URL mismatch / inactive / test failure (B-10)
 *
 * Each signal is stored per account as JSON under a stable `health:*` key so
 * the connection-health endpoint and MCP account_summary can read them without
 * touching logs. Values never contain request bodies or secrets.
 *
 * Failure counts use per-JST-hour buckets so "failures in the last hour"
 * can be answered from a single small JSON document instead of one row per
 * failure.
 */

import { getAccountSetting, setAccountSetting } from './account-settings.js';
import { jstNow } from './utils.js';

// ── Stable key names ─────────────────────────────────────────────────────────

export const SIG_FAILURE_KEY = 'health:sig_fail';
export const SIG_SUCCESS_KEY = 'health:sig_ok';
export const TOKEN_REFRESH_FAILURE_KEY = 'health:token_refresh_fail';
export const TOKEN_UNAUTHORIZED_KEY = 'health:token_unauthorized';
export const WEBHOOK_ENDPOINT_CHECK_KEY = 'health:webhook_endpoint';
export const WEBHOOK_TEST_KEY = 'health:webhook_test';

/**
 * Pseudo account id used when a failure cannot be tied to a specific LINE
 * account (e.g. an unsigned/malformed request whose origin channel is unknown,
 * or a signature that matches none of the registered secrets on a
 * multi-account install). Stored in account_settings.line_account_id — the
 * column has no foreign key, so a sentinel value is safe.
 */
export const UNATTRIBUTED_ACCOUNT_ID = '__unattributed__';

// ── Failure buckets ──────────────────────────────────────────────────────────

interface FailureRecord {
  /** Cumulative count since the key was first written. */
  total: number;
  /** JST timestamp of the most recent failure. */
  lastAt: string;
  /** Failures bucketed by JST hour ("2026-11-16T03" of the +09:00 string). */
  hours: Record<string, number>;
  /** Coarse failure classification (HTTP status / 'network'). Never a body. */
  lastReason?: string;
}

function failureBucketHour(now: string): string {
  // jstNow() is "YYYY-MM-DDTHH:mm:ss.sss+09:00" — hour bucket = first 13 chars.
  return now.slice(0, 13);
}

function pruneOldHours(hours: Record<string, number>, currentHour: string, keepHours: number): void {
  for (const hour of Object.keys(hours)) {
    const age =
      new Date(`${currentHour}:00+09:00`).getTime() - new Date(`${hour}:00+09:00`).getTime();
    if (!Number.isFinite(age) || age > keepHours * 60 * 60_000) delete hours[hour];
  }
}

async function bumpFailureBucket(
  db: D1Database,
  accountId: string,
  key: string,
  reason?: string,
): Promise<void> {
  const now = jstNow();
  const hour = failureBucketHour(now);
  let record: FailureRecord = { total: 0, lastAt: now, hours: {} };
  const raw = await getAccountSetting(db, accountId, key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<FailureRecord>;
      record = {
        total: typeof parsed.total === 'number' ? parsed.total : 0,
        lastAt: typeof parsed.lastAt === 'string' ? parsed.lastAt : now,
        hours: parsed.hours && typeof parsed.hours === 'object' ? parsed.hours : {},
      };
      if (parsed.lastReason !== undefined) record.lastReason = parsed.lastReason;
    } catch {
      // Corrupted value → start a fresh record; counters are advisory only.
    }
  }
  record.total += 1;
  record.lastAt = now;
  record.hours[hour] = (record.hours[hour] ?? 0) + 1;
  if (reason !== undefined) record.lastReason = reason;
  pruneOldHours(record.hours, hour, 26);
  await setAccountSetting(db, accountId, key, JSON.stringify(record));
}

export interface FailureWindow {
  failures: number;
  lastAt: string | null;
  lastReason: string | null;
}

async function countFailureWindow(
  db: D1Database,
  accountId: string,
  key: string,
  windowHours: number,
): Promise<FailureWindow> {
  const raw = await getAccountSetting(db, accountId, key);
  if (!raw) return { failures: 0, lastAt: null, lastReason: null };
  let record: Partial<FailureRecord>;
  try {
    record = JSON.parse(raw) as Partial<FailureRecord>;
  } catch {
    return { failures: 0, lastAt: null, lastReason: null };
  }
  const now = jstNow();
  const currentHour = failureBucketHour(now);
  let failures = 0;
  for (const [hour, count] of Object.entries(record.hours ?? {})) {
    const age =
      new Date(`${currentHour}:00+09:00`).getTime() - new Date(`${hour}:00+09:00`).getTime();
    if (Number.isFinite(age) && age < windowHours * 60 * 60_000) failures += count;
  }
  return {
    failures,
    lastAt: typeof record.lastAt === 'string' ? record.lastAt : null,
    lastReason: typeof record.lastReason === 'string' ? record.lastReason : null,
  };
}

/** Drop the stored record (e.g. the condition has been confirmed fixed). */
async function clearFailureRecord(db: D1Database, accountId: string, key: string): Promise<void> {
  await db
    .prepare(`DELETE FROM account_settings WHERE line_account_id = ? AND key = ?`)
    .bind(accountId, key)
    .run();
}

// ── Webhook signature verification ───────────────────────────────────────────

/** Record one webhook whose signature was missing or failed verification. */
export async function recordSignatureFailure(
  db: D1Database,
  lineAccountId: string | null,
  reason?: string,
): Promise<void> {
  await bumpFailureBucket(db, lineAccountId ?? UNATTRIBUTED_ACCOUNT_ID, SIG_FAILURE_KEY, reason);
}

export async function getSignatureFailureWindow(
  db: D1Database,
  lineAccountId: string | null,
  windowHours = 1,
): Promise<FailureWindow> {
  return countFailureWindow(
    db,
    lineAccountId ?? UNATTRIBUTED_ACCOUNT_ID,
    SIG_FAILURE_KEY,
    windowHours,
  );
}

export interface SignatureSuccessRecord {
  lastAt: string;
}

/** Record that a webhook request passed signature verification (throttle at the call site). */
export async function recordSignatureSuccess(
  db: D1Database,
  lineAccountId: string,
): Promise<SignatureSuccessRecord> {
  const lastAt = jstNow();
  await setAccountSetting(db, lineAccountId, SIG_SUCCESS_KEY, JSON.stringify({ lastAt }));
  return { lastAt };
}

export async function getSignatureSuccessAt(
  db: D1Database,
  lineAccountId: string,
): Promise<string | null> {
  const raw = await getAccountSetting(db, lineAccountId, SIG_SUCCESS_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SignatureSuccessRecord>;
    return typeof parsed.lastAt === 'string' ? parsed.lastAt : null;
  } catch {
    return null;
  }
}

// ── Channel token refresh failures (token-refresh cron) ──────────────────────

export async function recordTokenRefreshFailure(
  db: D1Database,
  lineAccountId: string,
  reason?: string,
): Promise<void> {
  await bumpFailureBucket(db, lineAccountId, TOKEN_REFRESH_FAILURE_KEY, reason);
}

export async function getTokenRefreshFailureWindow(
  db: D1Database,
  lineAccountId: string,
  windowHours = 24,
): Promise<FailureWindow> {
  return countFailureWindow(db, lineAccountId, TOKEN_REFRESH_FAILURE_KEY, windowHours);
}

export async function clearTokenRefreshFailure(db: D1Database, lineAccountId: string): Promise<void> {
  await clearFailureRecord(db, lineAccountId, TOKEN_REFRESH_FAILURE_KEY);
}

// ── 401 (revoked/expired token) seen by the bot/info monitor ─────────────────

export async function recordTokenUnauthorized(
  db: D1Database,
  lineAccountId: string,
): Promise<void> {
  await bumpFailureBucket(db, lineAccountId, TOKEN_UNAUTHORIZED_KEY);
}

export async function getTokenUnauthorizedWindow(
  db: D1Database,
  lineAccountId: string,
  windowHours = 1,
): Promise<FailureWindow> {
  return countFailureWindow(db, lineAccountId, TOKEN_UNAUTHORIZED_KEY, windowHours);
}

export async function clearTokenUnauthorized(db: D1Database, lineAccountId: string): Promise<void> {
  await clearFailureRecord(db, lineAccountId, TOKEN_UNAUTHORIZED_KEY);
}

// ── Webhook endpoint / test probe results (B-10) ─────────────────────────────

export interface WebhookEndpointCheckRecord {
  checkedAt: string;
  /** URL currently registered on the channel ("" when LINE reports none). */
  endpoint: string;
  /** URL this Worker expects (`${WORKER_URL}/webhook`). */
  expectedUrl: string;
  /** null = probe itself failed (unknown), otherwise endpoint === expectedUrl. */
  matches: boolean | null;
  /** null = probe itself failed, otherwise the "Webhookの利用" toggle state. */
  active: boolean | null;
  /** LINE API status code when the probe failed. */
  errorStatus?: number;
}

export async function recordWebhookEndpointCheck(
  db: D1Database,
  lineAccountId: string,
  record: WebhookEndpointCheckRecord,
): Promise<void> {
  await setAccountSetting(db, lineAccountId, WEBHOOK_ENDPOINT_CHECK_KEY, JSON.stringify(record));
}

export async function getWebhookEndpointCheck(
  db: D1Database,
  lineAccountId: string,
): Promise<WebhookEndpointCheckRecord | null> {
  const raw = await getAccountSetting(db, lineAccountId, WEBHOOK_ENDPOINT_CHECK_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WebhookEndpointCheckRecord;
  } catch {
    return null;
  }
}

export interface WebhookTestRecord {
  checkedAt: string;
  success: boolean;
  /** LINE's own message about the test result (no secrets; bounded). */
  message: string | null;
  errorStatus?: number;
}

export async function recordWebhookTest(
  db: D1Database,
  lineAccountId: string,
  record: WebhookTestRecord,
): Promise<void> {
  await setAccountSetting(db, lineAccountId, WEBHOOK_TEST_KEY, JSON.stringify(record));
}

export async function getWebhookTest(
  db: D1Database,
  lineAccountId: string,
): Promise<WebhookTestRecord | null> {
  const raw = await getAccountSetting(db, lineAccountId, WEBHOOK_TEST_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WebhookTestRecord;
  } catch {
    return null;
  }
}
