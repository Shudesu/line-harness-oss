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
  /**
   * Failures bucketed by JST minute ("2026-11-16T13:07"). Minute buckets are
   * the only way to answer "failures in the last 60 minutes" correctly: with
   * hour buckets alone a 12:59 failure vanished from the window at 13:01
   * because only the bucket-start time was compared. Written alongside the
   * hour buckets (which stay for the coarse 24h token-refresh window) since
   * the first record that carries them. Readers treat this as optional
   * (Partial<FailureRecord>) for documents written before it existed.
   */
  minutes: Record<string, number>;
  /** Coarse failure classification (HTTP status / 'network'). Never a body. */
  lastReason?: string;
}

function failureBucketHour(now: string): string {
  // jstNow() is "YYYY-MM-DDTHH:mm:ss.sss+09:00" — hour bucket = first 13 chars.
  return now.slice(0, 13);
}

function failureBucketMinute(now: string): string {
  return now.slice(0, 16);
}

function pruneOldHours(hours: Record<string, number>, currentHour: string, keepHours: number): void {
  for (const hour of Object.keys(hours)) {
    const age =
      new Date(`${currentHour}:00+09:00`).getTime() - new Date(`${hour}:00+09:00`).getTime();
    if (!Number.isFinite(age) || age > keepHours * 60 * 60_000) delete hours[hour];
  }
}

function pruneOldMinutes(
  minutes: Record<string, number>,
  currentMinute: string,
  keepMinutes: number,
): void {
  for (const minute of Object.keys(minutes)) {
    const age =
      new Date(`${currentMinute}:00+09:00`).getTime() - new Date(`${minute}:00+09:00`).getTime();
    if (!Number.isFinite(age) || age > keepMinutes * 60_000) delete minutes[minute];
  }
}

/**
 * Minute buckets are only consumed by sub-hour windows (the 1h signature and
 * 401 checks), so keeping a bit more than 2h of them bounds the document size
 * while leaving headroom for the bucket-start boundary.
 */
const MINUTE_KEEP_MINUTES = 121;
/** Hour buckets kept for the coarse 24h token-refresh window. */
const HOUR_KEEP_HOURS = 26;

/**
 * The atomic SQL bump below never removes stale buckets, so bound the document
 * by rewriting it without old keys every N bumps (per isolate — module scope
 * matches the throttle pattern in the webhook route). The rewrite is a plain
 * read-modify-write, so a concurrent bump can be lost to it — rare, and the
 * counters are advisory only.
 */
const BUMPS_BETWEEN_PRUNES = 25;
let bumpsSincePrune = 0;

/**
 * Legacy read-modify-write bump: used only as the fallback when the atomic
 * SQL statement fails (corrupt stored value). Starts a fresh record when the
 * stored value cannot be parsed.
 */
async function bumpFailureBucketLegacy(
  db: D1Database,
  accountId: string,
  key: string,
  now: string,
  reason?: string,
): Promise<void> {
  const hour = failureBucketHour(now);
  const minute = failureBucketMinute(now);
  let record: FailureRecord = { total: 0, lastAt: now, hours: {}, minutes: {} };
  const raw = await getAccountSetting(db, accountId, key);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Partial<FailureRecord>;
      record = {
        total: typeof parsed.total === 'number' ? parsed.total : 0,
        lastAt: typeof parsed.lastAt === 'string' ? parsed.lastAt : now,
        hours: parsed.hours && typeof parsed.hours === 'object' ? parsed.hours : {},
        minutes: parsed.minutes && typeof parsed.minutes === 'object' ? parsed.minutes : {},
      };
      if (parsed.lastReason !== undefined) record.lastReason = parsed.lastReason;
    } catch {
      // Corrupted value → start a fresh record; counters are advisory only.
    }
  }
  record.total += 1;
  record.lastAt = now;
  record.hours[hour] = (record.hours[hour] ?? 0) + 1;
  record.minutes[minute] = (record.minutes[minute] ?? 0) + 1;
  if (reason !== undefined) record.lastReason = reason;
  pruneOldHours(record.hours, hour, HOUR_KEEP_HOURS);
  pruneOldMinutes(record.minutes, minute, MINUTE_KEEP_MINUTES);
  await setAccountSetting(db, accountId, key, JSON.stringify(record));
}

/**
 * Bump the failure counters with an atomic SQL upsert so concurrent requests
 * cannot lose increments (the previous read-modify-write of the whole JSON
 * dropped failures recorded at the same moment). json_set creates missing
 * intermediate objects and json_extract yields NULL on missing paths, so
 * legacy documents without `minutes` (or without any buckets) bump correctly.
 * The bucket keys are server-generated timestamps, never user input.
 */
async function bumpFailureBucket(
  db: D1Database,
  accountId: string,
  key: string,
  reason?: string,
): Promise<void> {
  const now = jstNow();
  const hour = failureBucketHour(now);
  const minute = failureBucketMinute(now);
  const initial: FailureRecord = {
    total: 1,
    lastAt: now,
    hours: { [hour]: 1 },
    minutes: { [minute]: 1 },
    ...(reason !== undefined ? { lastReason: reason } : {}),
  };
  try {
    await db
      .prepare(
        `INSERT INTO account_settings (id, line_account_id, key, value, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (line_account_id, key) DO UPDATE SET
           updated_at = excluded.updated_at,
           value = json_set(
             json_set(
               json_set(
                 json_set(
                   json_set(
                     account_settings.value,
                     '$.total', COALESCE(json_extract(account_settings.value, '$.total'), 0) + 1
                   ),
                   '$.lastAt', ?
                 ),
                 '$."hours"."' || ? || '"',
                 COALESCE(json_extract(account_settings.value, '$."hours"."' || ? || '"'), 0) + 1
               ),
               '$."minutes"."' || ? || '"',
               COALESCE(json_extract(account_settings.value, '$."minutes"."' || ? || '"'), 0) + 1
             ),
             '$."lastReason"', ?
           )`,
      )
      .bind(
        crypto.randomUUID(),
        accountId,
        key,
        JSON.stringify(initial),
        now,
        now,
        now,
        hour,
        hour,
        minute,
        minute,
        reason ?? null,
      )
      .run();
  } catch {
    // Corrupt stored value or D1 error → legacy path (fresh record on garbage).
    await bumpFailureBucketLegacy(db, accountId, key, now, reason);
  }
  await pruneFailureBucketsIfDue(db, accountId, key, now);
}

/**
 * Occasionally strip buckets older than the keep windows so the KVS document
 * stays small. Cheap: one read (+write only when due) per bump, and the write
 * happens at most every BUMPS_BETWEEN_PRUNES bumps per isolate.
 */
async function pruneFailureBucketsIfDue(
  db: D1Database,
  accountId: string,
  key: string,
  now: string,
): Promise<void> {
  bumpsSincePrune += 1;
  if (bumpsSincePrune < BUMPS_BETWEEN_PRUNES) return;
  bumpsSincePrune = 0;
  try {
    const raw = await getAccountSetting(db, accountId, key);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<FailureRecord>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.total !== 'number') return;
    const hours = { ...(parsed.hours ?? {}) };
    const minutes = { ...(parsed.minutes ?? {}) };
    pruneOldHours(hours, failureBucketHour(now), HOUR_KEEP_HOURS);
    pruneOldMinutes(minutes, failureBucketMinute(now), MINUTE_KEEP_MINUTES);
    const pruned: FailureRecord = {
      total: parsed.total,
      lastAt: typeof parsed.lastAt === 'string' ? parsed.lastAt : now,
      hours,
      minutes,
      ...(parsed.lastReason !== undefined ? { lastReason: parsed.lastReason } : {}),
    };
    await setAccountSetting(db, accountId, key, JSON.stringify(pruned));
  } catch {
    // Pruning is best-effort storage hygiene; never fail the recording.
  }
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
  const windowMs = windowHours * 60 * 60_000;
  let failures = 0;
  // Sub-hour windows need minute buckets: hour buckets only carry the bucket
  // start time, so a 12:59 failure was invisible to "last 60 minutes" at
  // 13:01. Documents written before minute buckets fall back to the coarse
  // hour count until the next failure creates minute buckets.
  if (windowHours <= 2 && record.minutes) {
    const nowMs = new Date(`${failureBucketMinute(now)}:00+09:00`).getTime();
    for (const [minute, count] of Object.entries(record.minutes)) {
      const age = nowMs - new Date(`${minute}:00+09:00`).getTime();
      if (Number.isFinite(age) && age < windowMs) failures += count;
    }
  } else {
    const nowMs = new Date(`${failureBucketHour(now)}:00+09:00`).getTime();
    for (const [hour, count] of Object.entries(record.hours ?? {})) {
      const age = nowMs - new Date(`${hour}:00+09:00`).getTime();
      if (Number.isFinite(age) && age < windowMs) failures += count;
    }
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
  /**
   * true/false = LINE reported test success/failure;
   * null = the test could not be executed (LINE API error / network failure) —
   * an execution failure must not read as "test failed" downstream.
   */
  success: boolean | null;
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
