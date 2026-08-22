import { describe, expect, test, vi } from 'vitest';
import {
  deliverQueuedLineWebhookById,
  enqueueLineWebhookForward,
  validateLstepWebhookUrl,
} from './line-webhook-forwarder.js';

interface MemRow {
  id: string;
  line_account_id: string | null;
  raw_body: string;
  line_signature: string;
  status: 'pending' | 'sending' | 'delivered' | 'dead';
  attempt_count: number;
  next_attempt_at: string;
  locked_until: string | null;
  last_http_status: number | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
  delivered_at: string | null;
}

function memDb(): { db: D1Database; rows: Map<string, MemRow> } {
  const rows = new Map<string, MemRow>();
  const db = {
    prepare(sql: string) {
      let args: unknown[] = [];
      const stmt = {
        bind(...values: unknown[]) {
          args = values;
          return stmt;
        },
        async first<T>() {
          if (sql.includes('FROM line_webhook_forward_queue') && sql.includes('WHERE id = ?')) {
            return (rows.get(String(args[0])) ?? null) as T | null;
          }
          return null;
        },
        async all<T>() {
          return { results: [] as T[] };
        },
        async run() {
          if (sql.startsWith('INSERT OR IGNORE')) {
            const [id, accountId, rawBody, signature, nextAt, createdAt, updatedAt] = args;
            if (rows.has(String(id))) return { success: true, meta: { changes: 0 } };
            rows.set(String(id), {
              id: String(id),
              line_account_id: accountId == null ? null : String(accountId),
              raw_body: String(rawBody),
              line_signature: String(signature),
              status: 'pending',
              attempt_count: 0,
              next_attempt_at: String(nextAt),
              locked_until: null,
              last_http_status: null,
              last_error: null,
              created_at: String(createdAt),
              updated_at: String(updatedAt),
              delivered_at: null,
            });
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("SET status = 'sending'")) {
            const [lockedUntil, updatedAt, id, dueAt, expiredAt] = args;
            const row = rows.get(String(id));
            const claimable = row && (
              (row.status === 'pending' && row.next_attempt_at <= String(dueAt))
              || (row.status === 'sending' && !!row.locked_until && row.locked_until <= String(expiredAt))
            );
            if (!row || !claimable) return { success: true, meta: { changes: 0 } };
            row.status = 'sending';
            row.locked_until = String(lockedUntil);
            row.updated_at = String(updatedAt);
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes("SET status = 'delivered'")) {
            const [httpStatus, deliveredAt, updatedAt, id] = args;
            const row = rows.get(String(id));
            if (!row || row.status !== 'sending') return { success: true, meta: { changes: 0 } };
            row.status = 'delivered';
            row.attempt_count += 1;
            row.locked_until = null;
            row.last_http_status = Number(httpStatus);
            row.last_error = null;
            row.delivered_at = String(deliveredAt);
            row.updated_at = String(updatedAt);
            return { success: true, meta: { changes: 1 } };
          }

          if (sql.includes('SET status = ?, attempt_count = ?')) {
            const [status, attempts, nextAt, httpStatus, lastError, updatedAt, id] = args;
            const row = rows.get(String(id));
            if (!row || row.status !== 'sending') return { success: true, meta: { changes: 0 } };
            row.status = status as MemRow['status'];
            row.attempt_count = Number(attempts);
            row.next_attempt_at = String(nextAt);
            row.locked_until = null;
            row.last_http_status = httpStatus == null ? null : Number(httpStatus);
            row.last_error = lastError == null ? null : String(lastError);
            row.updated_at = String(updatedAt);
            return { success: true, meta: { changes: 1 } };
          }

          return { success: true, meta: { changes: 0 } };
        },
      };
      return stmt;
    },
  } as unknown as D1Database;
  return { db, rows };
}

describe('LINE webhook forwarding target validation', () => {
  test('accepts HTTPS and rejects insecure or looping targets', () => {
    expect(validateLstepWebhookUrl('https://legacy.example.test/webhook')?.hostname)
      .toBe('legacy.example.test');
    expect(validateLstepWebhookUrl(undefined)).toBeNull();
    expect(() => validateLstepWebhookUrl('http://legacy.example.test/webhook'))
      .toThrow('must use HTTPS');
    expect(() => validateLstepWebhookUrl(
      'https://worker.example.test/webhook',
      'https://worker.example.test/webhook',
    )).toThrow('must not point back');
  });
});

describe('durable LINE webhook forwarding', () => {
  test('deduplicates real LINE redelivery by webhookEventId', async () => {
    const { db, rows } = memDb();
    const input = {
      rawBody: '{"events":[{"webhookEventId":"evt-1"}]}',
      signature: 'signature',
      eventIds: ['evt-1'],
      now: new Date('2026-08-23T00:00:00.000Z'),
    };
    const first = await enqueueLineWebhookForward(db, input);
    const second = await enqueueLineWebhookForward(db, { ...input, rawBody: '{"redelivery":true}' });
    expect(second).toBe(first);
    expect(rows.size).toBe(1);
  });

  test('forwards the exact raw body and signature, then marks the row delivered', async () => {
    const { db, rows } = memDb();
    const rawBody = '{"destination":"bot","events":[]}';
    const signature = 'original-line-signature';
    const now = new Date('2026-08-23T00:00:00.000Z');
    const id = await enqueueLineWebhookForward(db, {
      rawBody,
      signature,
      eventIds: [],
      now,
    });
    const fetcher = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));

    const result = await deliverQueuedLineWebhookById(
      db,
      new URL('https://legacy.example.test/webhook'),
      id,
      { now, fetcher },
    );

    expect(result).toEqual({ id, outcome: 'delivered', httpStatus: 200 });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe('https://legacy.example.test/webhook');
    expect(init.body).toBe(rawBody);
    expect(new Headers(init.headers).get('X-Line-Signature')).toBe(signature);
    expect(init.redirect).toBe('manual');
    expect(rows.get(id)?.status).toBe('delivered');
  });

  test('keeps a failed delivery pending for cron retry', async () => {
    const { db, rows } = memDb();
    const now = new Date('2026-08-23T00:00:00.000Z');
    const id = await enqueueLineWebhookForward(db, {
      rawBody: '{"events":[]}',
      signature: 'signature',
      eventIds: [],
      now,
    });

    const result = await deliverQueuedLineWebhookById(
      db,
      new URL('https://legacy.example.test/webhook'),
      id,
      { now, fetcher: vi.fn().mockResolvedValue(new Response('bad', { status: 503 })) },
    );

    expect(result).toEqual({ id, outcome: 'retry_scheduled', httpStatus: 503 });
    expect(rows.get(id)).toMatchObject({
      status: 'pending',
      attempt_count: 1,
      last_http_status: 503,
    });
    expect(rows.get(id)?.next_attempt_at).toBe('2026-08-23T00:01:00.000Z');
  });
});
