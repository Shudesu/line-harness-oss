import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, test, vi } from 'vitest';
import {
  APPROVAL_EXPIRES,
  APPROVAL_RECEIVED,
  BackfillStop,
  buildReadbackBatch,
  parseApplyResponse,
  parseArgs,
  parsePreflightResponse,
  parseReadbackResponse,
  parseTokenFile,
  postD1,
  run,
  validateApprovalWindow,
  validateB1Receipt,
  validateB2Receipt,
  validateV1Receipt,
  type D1BatchBody,
  type D1HttpResponse,
  type PinnedInput,
  type RequestFunction,
} from './incoming-media-backfill-apply-5229.js';

const HEAD = 'a'.repeat(40);
const N = 77;
const B = 27_625_839;

function pinned(): PinnedInput {
  const base = Math.floor(B / N);
  const entries = Array.from({ length: N }, (_, index) => {
    const account = 'account-safe';
    const message = `message-${index}`;
    return {
      incoming_media_id: `legacy-log-${index}`, messages_log_id: `log-${index}`,
      messages_log_created_at: '2026-09-01T00:00:00+09:00', line_account_id: account,
      line_message_id: message, source_type: 'user' as const, source_id: `user-${index % 3}`,
      sender_user_id: `user-${index % 3}`, r2_key: `incoming-${account}-${message}.jpg`,
      mime_type: 'image/jpeg', byte_size: base + (index < B % N ? 1 : 0),
      sha256: index.toString(16).padStart(64, '0'),
      messages_log_content_preimage: '{}',
    };
  });
  return {
    manifest: {
      schema_version: 1, issue: 5229, verified: true, worker_url: 'https://worker.example',
      backfill_at: '2026-09-01T03:20:58.688Z', provenance_basis: 'legacy_user_path_reconstruction',
      raw_event_snapshot: false, entries,
    },
    preflight: {
      mode: 'read-only', manifest_sha256: 'b'.repeat(64), entry_count: N,
      operations: Array.from({ length: N * 2 }, (_, index) => ({
        name: `preflight-${index}`, sql: 'SELECT id FROM source WHERE id = 1', expected_rows: index % 2 === 0 ? 1 : 0,
      })),
    },
    apply: {
      mode: 'external-write-requires-KEN-approval', manifest_sha256: 'b'.repeat(64), entry_count: N,
      operations: Array.from({ length: N }, (_, index) => [
        { name: `insert-${index}`, sql: 'INSERT INTO incoming_media DEFAULT VALUES', expected_changes: 1 },
        { name: `assert-insert-${index}`, sql: 'SELECT 1 AS exact_change_count', expected_rows: 1 },
        { name: `update-${index}`, sql: 'UPDATE messages_log SET content = content', expected_changes: 1 },
        { name: `assert-update-${index}`, sql: 'SELECT 1 AS exact_change_count', expected_rows: 1 },
      ]).flat(),
    },
  };
}

function response(results: unknown[], ray = 'ray-safe'): D1HttpResponse {
  return {
    status: 200, headers: { 'content-type': 'application/json', 'cf-ray': ray },
    body: Buffer.from(JSON.stringify({ success: true, result: results })),
  };
}

function preflightResponse(input: PinnedInput): D1HttpResponse {
  return response(input.preflight.operations.map((operation) => ({
    success: true, results: Array.from({ length: operation.expected_rows ?? 0 }, () => ({ id: 'private' })),
  })), 'preflight-ray');
}

function applyResponse(input: PinnedInput): D1HttpResponse {
  return response(input.apply.operations.map((operation) => operation.expected_changes === 1
    ? { success: true, results: [], meta: { changes: 1 } }
    : { success: true, results: [{ exact_change_count: 1 }], meta: { changes: 0 } }), 'apply-ray');
}

function readbackResponse(): D1HttpResponse {
  return response(Array.from({ length: N * 2 }, () => ({ success: true, results: [{ exact_rows: 1 }] })), 'readback-ray');
}

describe('incoming media D1 backfill #5229 B3', () => {
  test('fixes the blanket interval and exact CLI shape', () => {
    expect(parseArgs(['--preflight-only', '--approved-harness-head', HEAD])).toMatchObject({ preflightOnly: true, approvedHead: HEAD });
    expect(parseArgs(['--approval-received', APPROVAL_RECEIVED, '--approval-expires', APPROVAL_EXPIRES, '--approved-harness-head', HEAD]))
      .toMatchObject({ preflightOnly: false, approvedHead: HEAD });
    expect(() => parseArgs(['--approval-received', '2026-09-03T05:51:47.737Z', '--approval-expires', APPROVAL_EXPIRES, '--approved-harness-head', HEAD]))
      .toThrow(/arguments/);
    expect(() => validateApprovalWindow(APPROVAL_RECEIVED, APPROVAL_EXPIRES, Date.parse(APPROVAL_RECEIVED))).not.toThrow();
    expect(() => validateApprovalWindow(APPROVAL_RECEIVED, APPROVAL_EXPIRES, Date.parse(APPROVAL_EXPIRES))).toThrow(/approval_inactive/);
  });

  test('builds exactly 154 parameterized readback checks with no mutation SQL', () => {
    const batch = buildReadbackBatch(pinned().manifest);
    expect(batch.batch).toHaveLength(154);
    expect(batch.batch.every((statement) => /^SELECT\b/.test(statement.sql))).toBe(true);
    expect(batch.batch.every((statement) => !/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|PRAGMA)\b/i.test(statement.sql))).toBe(true);
    expect(JSON.stringify(batch)).toContain('legacy-log-0');
    expect(batch.batch[0].sql).not.toContain('legacy-log-0');
  });

  test('strictly validates all 154 preflight, 308 apply, and 154 readback results', () => {
    const input = pinned();
    expect(parsePreflightResponse(preflightResponse(input), input.preflight)).toEqual({ cfRay: 'preflight-ray' });
    expect(parseApplyResponse(applyResponse(input), input.apply)).toEqual({ cfRay: 'apply-ray' });
    expect(parseReadbackResponse(readbackResponse())).toEqual({ cfRay: 'readback-ray' });
    const stale = preflightResponse(input);
    const body = JSON.parse(stale.body.toString('utf8'));
    body.result[0].results = [];
    stale.body = Buffer.from(JSON.stringify(body));
    expect(() => parsePreflightResponse(stale, input.preflight)).toThrow(/preflight_expectation/);
    const partial = applyResponse(input);
    const applyBody = JSON.parse(partial.body.toString('utf8'));
    applyBody.result[0].meta.changes = 0;
    partial.body = Buffer.from(JSON.stringify(applyBody));
    expect(() => parseApplyResponse(partial, input.apply)).toThrow(/apply_change_count/);
  });

  test('accepts only one nonempty token assignment', () => {
    expect(parseTokenFile('IGNORED=x\nCLOUDFLARE_API_TOKEN="secret"\n')).toBe('secret');
    expect(() => parseTokenFile('')).toThrow(/token_count/);
    expect(() => parseTokenFile('CLOUDFLARE_API_TOKEN=a\nCLOUDFLARE_API_TOKEN=b')).toThrow(/token_count/);
  });

  test('pins completed B1/V1/B2 receipts and rejects semantic drift', () => {
    const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
    const b1 = read('/Users/kensmba/.line-harness-5229-B1-R1-20260903/sanitized-summary.json');
    const v1 = read('/Users/kensmba/.line-harness-5229-B1-V1-20260903/sanitized-summary.json');
    const b2 = read('/Users/kensmba/.line-harness-5229-B2-20260901/sanitized-summary.json');
    expect(() => validateB1Receipt(b1)).not.toThrow();
    expect(() => validateV1Receipt(v1)).not.toThrow();
    expect(() => validateB2Receipt(b2)).not.toThrow();
    v1.disposition = 'drift';
    expect(() => validateV1Receipt(v1)).toThrow(/v1_receipt_state/);
  });

  test('preflight makes zero provider requests and zero local writes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'backfill-preflight-'));
    const output = join(root, 'evidence');
    const post = vi.fn();
    try {
      const result = await run(['--preflight-only', '--approved-harness-head', HEAD], {
        validateLocalState: () => pinned(), loadToken: () => 'secret', outputDir: output, post,
      });
      expect(result).toMatchObject({ status: 'preflight_passed', preflight_expectations: 154, apply_operations: 308, provider_requests: 0, local_writes: 0 });
      expect(post).not.toHaveBeenCalled();
      expect(() => lstatSync(output)).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('executes exactly three batches in order and writes one sanitized owner-only receipt', async () => {
    const root = mkdtempSync(join(tmpdir(), 'backfill-success-'));
    const output = join(root, 'evidence');
    const input = pinned();
    const bodies: D1BatchBody[] = [];
    const replies = [preflightResponse(input), applyResponse(input), readbackResponse()];
    const post = vi.fn(async (body: D1BatchBody) => { bodies.push(body); return replies[bodies.length - 1]; });
    try {
      const result = await run(['--approval-received', APPROVAL_RECEIVED, '--approval-expires', APPROVAL_EXPIRES, '--approved-harness-head', HEAD], {
        now: () => Date.parse('2026-09-03T06:30:00Z'), validateLocalState: () => input,
        loadToken: () => 'secret', outputDir: output, post,
      });
      expect(bodies.map((body) => body.batch.length)).toEqual([154, 308, 154]);
      expect(result).toMatchObject({ status: 'completed', rollback_required: false, request_counts: { provider_total: 3, provider_write_batches: 1 } });
      expect(lstatSync(output).mode & 0o777).toBe(0o700);
      expect(readdirSync(output)).toEqual(['sanitized-summary.json']);
      const file = join(output, 'sanitized-summary.json');
      expect(lstatSync(file).mode & 0o777).toBe(0o600);
      const text = readFileSync(file, 'utf8');
      for (const value of ['account-safe', 'message-0', 'user-0', 'legacy-log-0', 'worker.example']) expect(text).not.toContain(value);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('stops before write on stale preflight and never retries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'backfill-stale-'));
    const output = join(root, 'evidence');
    const input = pinned();
    const stale = preflightResponse(input);
    const body = JSON.parse(stale.body.toString('utf8'));
    body.result[0].results = [];
    stale.body = Buffer.from(JSON.stringify(body));
    const post = vi.fn().mockResolvedValue(stale);
    try {
      await expect(run(['--approval-received', APPROVAL_RECEIVED, '--approval-expires', APPROVAL_EXPIRES, '--approved-harness-head', HEAD], {
        now: () => Date.parse('2026-09-03T06:30:00Z'), validateLocalState: () => input,
        loadToken: () => 'secret', outputDir: output, post,
      })).rejects.toThrow(/preflight_expectation/);
      expect(post).toHaveBeenCalledTimes(1);
      expect(JSON.parse(readFileSync(join(output, 'sanitized-summary.json'), 'utf8')))
        .toMatchObject({ status: 'stopped', stop_stage: 'preflight', rollback_required: false });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('uses only the exact D1 POST endpoint and rejects oversized responses', async () => {
    const calls: Array<{ options: Record<string, unknown>; body?: Buffer }> = [];
    const requestImpl = ((options: RequestOptions, callback: (response: IncomingMessage) => void) => {
      const emitter = new EventEmitter();
      const req = emitter as unknown as ClientRequest;
      req.end = ((body?: Buffer) => {
        calls[0].body = body;
        queueMicrotask(() => {
          const res = Readable.from([Buffer.alloc(262_145)]) as unknown as IncomingMessage;
          res.statusCode = 200;
          res.headers = { 'content-type': 'application/json' };
          callback(res);
        });
        return req;
      }) as ClientRequest['end'];
      req.destroy = ((error?: Error) => { if (error) queueMicrotask(() => emitter.emit('error', error)); return req; }) as ClientRequest['destroy'];
      calls.push({ options: options as Record<string, unknown> });
      return req;
    }) as RequestFunction;
    await expect(postD1({ batch: [{ sql: 'SELECT 1' }] }, 'secret', Date.now() + 5_000, requestImpl))
      .rejects.toThrow(/response_oversize/);
    expect(calls).toHaveLength(1);
    expect(calls[0].options).toMatchObject({ hostname: 'api.cloudflare.com', method: 'POST', agent: false });
    expect(String(calls[0].options.path)).toMatch(/\/d1\/database\/.+\/query$/);
  });
});
