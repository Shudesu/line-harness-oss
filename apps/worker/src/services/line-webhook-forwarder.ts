const MAX_DELIVERY_ATTEMPTS = 12;
const CLAIM_TTL_MS = 30_000;
const DELIVERED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface ForwardQueueRow {
  id: string;
  raw_body: string;
  line_signature: string;
  status: 'pending' | 'sending' | 'delivered' | 'dead';
  attempt_count: number;
  next_attempt_at: string;
  locked_until: string | null;
}

export interface ForwardDeliveryResult {
  id: string;
  outcome: 'delivered' | 'retry_scheduled' | 'dead' | 'skipped';
  httpStatus?: number;
}

function iso(date: Date): string {
  return date.toISOString();
}

function boundedError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/[\r\n]+/g, ' ').slice(0, 500);
}

function retryDelayMs(attempt: number): number {
  const minutes = [1, 2, 5, 10, 30, 60, 180, 360, 720, 1_440, 2_880, 5_760];
  return minutes[Math.min(Math.max(attempt - 1, 0), minutes.length - 1)] * 60_000;
}

async function eventBatchId(eventIds: string[]): Promise<string> {
  if (eventIds.length === 0) return `line-wh-${crypto.randomUUID()}`;
  const normalized = [...new Set(eventIds)].sort().join('\n');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `line-wh-${hex}`;
}

/**
 * Validate the operator-controlled forwarding destination without ever
 * returning/logging it from a public endpoint. Redirects are disabled during
 * delivery so a compromised destination cannot bounce the signed payload to a
 * third party.
 */
export function validateLstepWebhookUrl(raw: string | undefined, workerUrl?: string): URL | null {
  const value = raw?.trim();
  if (!value) return null;
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    throw new Error('LSTEP_WEBHOOK_URL is not a valid URL');
  }
  if (target.protocol !== 'https:') {
    throw new Error('LSTEP_WEBHOOK_URL must use HTTPS');
  }
  if (target.username || target.password) {
    throw new Error('LSTEP_WEBHOOK_URL must not contain URL credentials');
  }
  if (workerUrl) {
    try {
      const worker = new URL(workerUrl);
      const workerWebhookPath = worker.pathname === '/' ? '/webhook' : worker.pathname;
      if (worker.origin === target.origin && workerWebhookPath === target.pathname) {
        throw new Error('LSTEP_WEBHOOK_URL must not point back to the L Harness webhook');
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith('LSTEP_WEBHOOK_URL')) throw error;
      // An invalid optional worker URL must not disable a valid forwarding target.
    }
  }
  return target;
}

/** Persist before returning 200 to LINE. Event IDs make LINE redelivery idempotent. */
export async function enqueueLineWebhookForward(
  db: D1Database,
  input: {
    rawBody: string;
    signature: string;
    eventIds: string[];
    lineAccountId?: string | null;
    now?: Date;
  },
): Promise<string> {
  const id = await eventBatchId(input.eventIds);
  const now = iso(input.now ?? new Date());
  await db
    .prepare(
      `INSERT OR IGNORE INTO line_webhook_forward_queue
         (id, line_account_id, raw_body, line_signature, status, attempt_count,
          next_attempt_at, locked_until, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'pending', 0, ?, NULL, ?, ?)`,
    )
    .bind(
      id,
      input.lineAccountId ?? null,
      input.rawBody,
      input.signature,
      now,
      now,
      now,
    )
    .run();
  return id;
}

async function postExactLineWebhook(
  target: URL,
  row: Pick<ForwardQueueRow, 'raw_body' | 'line_signature'>,
  fetcher: Fetcher,
): Promise<Response> {
  return fetcher(target, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Line-Signature': row.line_signature,
      'X-Line-Harness-Forwarded': '1',
    },
    body: row.raw_body,
    redirect: 'manual',
  });
}

export async function deliverQueuedLineWebhookById(
  db: D1Database,
  target: URL,
  id: string,
  options: { now?: Date; fetcher?: Fetcher } = {},
): Promise<ForwardDeliveryResult> {
  const nowDate = options.now ?? new Date();
  const now = iso(nowDate);
  const row = await db
    .prepare(
      `SELECT id, raw_body, line_signature, status, attempt_count,
              next_attempt_at, locked_until
         FROM line_webhook_forward_queue
        WHERE id = ?`,
    )
    .bind(id)
    .first<ForwardQueueRow>();
  if (!row || row.status === 'delivered' || row.status === 'dead') {
    return { id, outcome: 'skipped' };
  }

  const lockedUntil = iso(new Date(nowDate.getTime() + CLAIM_TTL_MS));
  const claim = await db
    .prepare(
      `UPDATE line_webhook_forward_queue
          SET status = 'sending', locked_until = ?, updated_at = ?
        WHERE id = ?
          AND (
            (status = 'pending' AND next_attempt_at <= ?)
            OR (status = 'sending' AND locked_until <= ?)
          )`,
    )
    .bind(lockedUntil, now, id, now, now)
    .run();
  if ((claim.meta.changes ?? 0) === 0) return { id, outcome: 'skipped' };

  let response: Response | null = null;
  let errorMessage: string | null = null;
  try {
    response = await postExactLineWebhook(target, row, options.fetcher ?? fetch);
    if (response.ok) {
      await db
        .prepare(
          `UPDATE line_webhook_forward_queue
              SET status = 'delivered', attempt_count = attempt_count + 1,
                  locked_until = NULL, last_http_status = ?, last_error = NULL,
                  delivered_at = ?, updated_at = ?
            WHERE id = ? AND status = 'sending'`,
        )
        .bind(response.status, now, now, id)
        .run();
      return { id, outcome: 'delivered', httpStatus: response.status };
    }
    errorMessage = `L-Step returned HTTP ${response.status}`;
  } catch (error) {
    errorMessage = boundedError(error);
  }

  const nextAttempt = row.attempt_count + 1;
  const dead = nextAttempt >= MAX_DELIVERY_ATTEMPTS;
  const nextAttemptAt = iso(new Date(nowDate.getTime() + retryDelayMs(nextAttempt)));
  await db
    .prepare(
      `UPDATE line_webhook_forward_queue
          SET status = ?, attempt_count = ?, next_attempt_at = ?,
              locked_until = NULL, last_http_status = ?, last_error = ?, updated_at = ?
        WHERE id = ? AND status = 'sending'`,
    )
    .bind(
      dead ? 'dead' : 'pending',
      nextAttempt,
      nextAttemptAt,
      response?.status ?? null,
      errorMessage,
      now,
      id,
    )
    .run();
  return {
    id,
    outcome: dead ? 'dead' : 'retry_scheduled',
    ...(response ? { httpStatus: response.status } : {}),
  };
}

export async function drainLineWebhookForwardQueue(
  db: D1Database,
  target: URL,
  options: { now?: Date; limit?: number; fetcher?: Fetcher } = {},
): Promise<{ delivered: number; retried: number; dead: number }> {
  const nowDate = options.now ?? new Date();
  const now = iso(nowDate);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const due = await db
    .prepare(
      `SELECT id
         FROM line_webhook_forward_queue
        WHERE (status = 'pending' AND next_attempt_at <= ?)
           OR (status = 'sending' AND locked_until <= ?)
        ORDER BY created_at
        LIMIT ?`,
    )
    .bind(now, now, limit)
    .all<{ id: string }>();

  const results = await Promise.all(
    (due.results ?? []).map((row) =>
      deliverQueuedLineWebhookById(db, target, row.id, {
        now: nowDate,
        fetcher: options.fetcher,
      }),
    ),
  );

  const retentionCutoff = iso(new Date(nowDate.getTime() - DELIVERED_RETENTION_MS));
  await db
    .prepare(
      `DELETE FROM line_webhook_forward_queue
        WHERE status = 'delivered' AND delivered_at < ?`,
    )
    .bind(retentionCutoff)
    .run();

  return {
    delivered: results.filter((result) => result.outcome === 'delivered').length,
    retried: results.filter((result) => result.outcome === 'retry_scheduled').length,
    dead: results.filter((result) => result.outcome === 'dead').length,
  };
}
