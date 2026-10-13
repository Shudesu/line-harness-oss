import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, test, vi } from 'vitest';
import {
  buildInsertBatch, buildReadbackBatch, parseInsertResponse, parseOfflineCredential,
  parseReadbackResponse, postD1, run, validateApprovalWindow,
  type BoundCredential, type D1BatchBody, type HttpResponse, type RequestFunction,
} from './incoming-media-credential-issue-5229.js';

const CREDENTIAL_DIR = '/Users/kensmba/.line-harness-5229-B0-CREDENTIAL-20260903';
const PROTECTED_MANIFEST = '/Users/kensmba/.line-harness-5229-M0-20260901/incoming-media-backfill-manifest.json';

function bound(): BoundCredential {
  return parseOfflineCredential(
    readFileSync(`${CREDENTIAL_DIR}/manifest.json`),
    readFileSync(`${CREDENTIAL_DIR}/credential.env`),
    readFileSync(PROTECTED_MANIFEST),
  );
}

function response(result: Array<{ success: boolean; results: unknown[] }>, ray = 'ray-safe'): HttpResponse {
  return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8', 'cf-ray': ray },
    body: Buffer.from(JSON.stringify({ success: true, result })) };
}

function insertResponse(): HttpResponse {
  return response([
    { success: true, results: [{ assertion: 1 }] }, { success: true, results: [] },
    { success: true, results: [{ assertion: 1 }] },
  ]);
}

function readbackResponse(value: BoundCredential): HttpResponse {
  return response([{ success: true, results: [{ id: value.credentialId, scope: value.scope,
    not_before: value.notBefore, expires_at: value.expiresAt, created_at: value.createdAt, revoked_at: null }] }]);
}

describe('incoming media credential issue #5229', () => {
  test('loads the pinned offline credential and binds it to the protected manifest account', () => {
    const value = bound();
    expect(value).toMatchObject({ credentialId: 'a6f8d1124f07d9ab81d0aa3b8ee080fb', scope: 'incoming_media_read',
      notBefore: '2026-09-03T06:30:00.000Z', expiresAt: '2026-12-02T06:30:00.000Z' });
    const bad = Buffer.from(readFileSync(`${CREDENTIAL_DIR}/credential.env`, 'utf8').replace('lhim_v1.', 'lhim_v2.'));
    expect(() => parseOfflineCredential(readFileSync(`${CREDENTIAL_DIR}/manifest.json`), bad,
      readFileSync(PROTECTED_MANIFEST))).toThrow(/credential_env_state/);
  });

  test('uses one INSERT inside one fail-closed batch and one exact readback', () => {
    const value = bound();
    const write = buildInsertBatch(value);
    expect(write.batch).toHaveLength(3);
    expect(write.batch.filter((item) => /^INSERT INTO/i.test(item.sql.trim()))).toHaveLength(1);
    expect(write.batch[0].sql).toContain("json_extract('{}', '$[')");
    expect(write.batch[2].sql).toContain('changes() = 1');
    expect(write.batch[1].sql).not.toContain(value.accountId);
    expect(write.batch[1].sql).not.toContain(value.tokenSha256);
    const read = buildReadbackBatch(value);
    expect(read.batch).toHaveLength(1);
    expect(read.batch[0].sql).not.toContain(value.accountId);
    expect(read.batch[0].sql).not.toContain(value.tokenSha256);
  });

  test('pins the blanket half-open interval', () => {
    expect(() => validateApprovalWindow(Date.parse('2026-09-03T05:51:46.737Z'))).not.toThrow();
    expect(() => validateApprovalWindow(Date.parse('2026-09-03T07:51:46.737Z'))).toThrow(/approval_inactive/);
  });

  test('strictly validates insert and account-bound readback without returning account or token hash', () => {
    const value = bound();
    expect(parseInsertResponse(insertResponse())).toBe('ray-safe');
    const parsed = parseReadbackResponse(readbackResponse(value), value);
    expect(parsed.receipt).toMatchObject({ credential_id: value.credentialId, scope: value.scope,
      account_match: true, revoked: false });
    const text = JSON.stringify(parsed.receipt);
    expect(text).not.toContain(value.accountId);
    expect(text).not.toContain(value.tokenSha256);
    const drift = readbackResponse(value);
    const body = JSON.parse(drift.body.toString('utf8'));
    body.result[0].results[0].scope = 'other';
    drift.body = Buffer.from(JSON.stringify(body));
    expect(() => parseReadbackResponse(drift, value)).toThrow(/readback_state/);
  });

  test('preflight is zero-write; execution is exactly two requests and owner-only sanitized receipt', async () => {
    const value = bound();
    const root = mkdtempSync(join(tmpdir(), 'credential-issue-5229-'));
    const preflight = join(root, 'preflight');
    const output = join(root, 'output');
    const post = vi.fn().mockResolvedValueOnce(insertResponse()).mockResolvedValueOnce(readbackResponse(value));
    const base = { now: () => Date.parse('2026-09-03T06:45:00Z'), validateLocalState: () => value,
      loadToken: () => 'management-secret', outputDir: preflight, post };
    try {
      await expect(run(['--preflight-only', '--approved-harness-head', 'f'.repeat(40)], base))
        .resolves.toMatchObject({ provider_requests: 0, provider_writes: 0, local_writes: 0 });
      expect(post).not.toHaveBeenCalled();
      expect(() => lstatSync(preflight)).toThrow();
      const result = await run(['--execute', '--approved-harness-head', 'f'.repeat(40)], { ...base, outputDir: output });
      expect(post).toHaveBeenCalledTimes(2);
      expect(result).toMatchObject({ status: 'completed', request_counts: { provider_total: 2,
        provider_write_batches: 1, inserted_rows: 1, retry: 0, redirect: 0 },
        mutation_stage: 'readback_verified', mutation_outcome: 'accepted', reconciliation_required: false });
      expect(lstatSync(output).mode & 0o777).toBe(0o700);
      expect(readdirSync(output)).toEqual(['sanitized-summary.json']);
      const file = join(output, 'sanitized-summary.json');
      expect(lstatSync(file).mode & 0o777).toBe(0o600);
      const receipt = readFileSync(file, 'utf8');
      expect(receipt).not.toContain(value.accountId);
      expect(receipt).not.toContain(value.tokenSha256);
      expect(receipt).not.toContain('management-secret');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('marks a failed insert response unknown and requires reconciliation', async () => {
    const value = bound();
    const root = mkdtempSync(join(tmpdir(), 'credential-insert-failure-'));
    const output = join(root, 'output');
    const post = vi.fn().mockResolvedValue(response([
      { success: true, results: [{ assertion: 0 }] }, { success: true, results: [] },
      { success: true, results: [{ assertion: 1 }] },
    ]));
    try {
      await expect(run(['--execute', '--approved-harness-head', 'f'.repeat(40)], {
        now: () => Date.parse('2026-09-03T06:45:00Z'), validateLocalState: () => value,
        loadToken: () => 'secret', outputDir: output, post,
      })).rejects.toThrow(/insert_assertion/);
      expect(post).toHaveBeenCalledTimes(1);
      expect(JSON.parse(readFileSync(join(output, 'sanitized-summary.json'), 'utf8'))).toMatchObject({
        status: 'stopped', mutation_stage: 'write_request_started', mutation_outcome: 'unknown',
        reconciliation_required: true, request_counts: { provider_total: 1, provider_write_batches: 1 },
      });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('marks post-accept readback failure accepted and requires reconciliation', async () => {
    const value = bound();
    const root = mkdtempSync(join(tmpdir(), 'credential-readback-failure-'));
    const output = join(root, 'output');
    const post = vi.fn().mockResolvedValueOnce(insertResponse()).mockResolvedValueOnce(response([
      { success: true, results: [] },
    ]));
    try {
      await expect(run(['--execute', '--approved-harness-head', 'f'.repeat(40)], {
        now: () => Date.parse('2026-09-03T06:45:00Z'), validateLocalState: () => value,
        loadToken: () => 'secret', outputDir: output, post,
      })).rejects.toThrow(/readback_rows/);
      expect(post).toHaveBeenCalledTimes(2);
      expect(JSON.parse(readFileSync(join(output, 'sanitized-summary.json'), 'utf8'))).toMatchObject({
        status: 'stopped', mutation_stage: 'readback_started', mutation_outcome: 'accepted',
        reconciliation_required: true, request_counts: { provider_total: 2, provider_write_batches: 1 },
      });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('marks expiry after accepted INSERT as reconciliation required without readback request', async () => {
    const value = bound();
    const root = mkdtempSync(join(tmpdir(), 'credential-expiry-'));
    const output = join(root, 'output');
    const active = Date.parse('2026-09-03T06:45:00Z');
    const expired = Date.parse('2026-09-03T07:51:46.737Z');
    const times = [active, active, active, expired, expired];
    let index = 0;
    const post = vi.fn().mockResolvedValue(insertResponse());
    try {
      await expect(run(['--execute', '--approved-harness-head', 'f'.repeat(40)], {
        now: () => times[Math.min(index++, times.length - 1)], validateLocalState: () => value,
        loadToken: () => 'secret', outputDir: output, post,
      })).rejects.toThrow(/approval_inactive/);
      expect(post).toHaveBeenCalledTimes(1);
      expect(JSON.parse(readFileSync(join(output, 'sanitized-summary.json'), 'utf8'))).toMatchObject({
        status: 'stopped', mutation_stage: 'write_response_accepted', mutation_outcome: 'accepted',
        reconciliation_required: true, request_counts: { provider_total: 1, provider_write_batches: 1 },
      });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('uses exact direct HTTPS transport, no redirect/retry, and rejects oversized responses', async () => {
    const calls: Array<{ options: Record<string, unknown>; body?: Buffer }> = [];
    const fake = (responseBody: Buffer): RequestFunction => ((options, callback) => {
      const emitter = new EventEmitter();
      const req = emitter as unknown as ClientRequest;
      req.end = ((body?: Buffer) => { calls.push({ options: options as Record<string, unknown>, body }); queueMicrotask(() => {
        const res = Readable.from([responseBody]) as unknown as IncomingMessage;
        res.statusCode = 200; res.headers = { 'content-type': 'application/json' }; callback(res);
      }); return req; }) as ClientRequest['end'];
      req.destroy = ((error?: Error) => { if (error) queueMicrotask(() => emitter.emit('error', error)); return req; }) as ClientRequest['destroy'];
      return req;
    }) as RequestFunction;
    const body: D1BatchBody = { batch: [{ sql: 'SELECT 1' }] };
    await postD1(body, 'secret', Date.now() + 5_000, fake(Buffer.from('{}')));
    expect(calls[0].options).toMatchObject({ protocol: 'https:', hostname: 'api.cloudflare.com', port: 443,
      method: 'POST', agent: false, path: '/client/v4/accounts/67907592fdf596376bc2097e14a6563a/d1/database/c19584d7-e9f1-4d46-83c5-6c0ba96561d1/query' });
    expect(calls[0].options.headers).toEqual({ Authorization: 'Bearer secret', 'Content-Type': 'application/json',
      'Accept-Encoding': 'identity', 'Content-Length': calls[0].body?.length });
    await expect(postD1(body, 'secret', Date.now() + 5_000, fake(Buffer.alloc(65_537))))
      .rejects.toThrow(/response_oversize/);
    expect(calls).toHaveLength(2);
  });
});
