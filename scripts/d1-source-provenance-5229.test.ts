import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, test, vi } from 'vitest';
import {
  buildQueryPlan,
  parseD1Response,
  queryD1,
  parseTokenFile,
  run,
  validateAggregate,
  validateApprovalWindow,
  validateFrozenCandidates,
  type FrozenCandidate,
  type ProvenanceAggregate,
  type RequestFunction,
} from './d1-source-provenance-5229.js';

const N = 77;

function candidates(): FrozenCandidate[] {
  return Array.from({ length: N }, (_, index) => ({
    id: `log-private-${index}`,
    friend_id: `friend-private-${index % 5}`,
    line_user_id: `user-private-${index % 5}`,
    authoritative_line_account_id: 'account-private',
    messages_log_line_account_id: null,
    content: JSON.stringify({ originalContentUrl: `https://private/${index}`, previewImageUrl: `https://private/${index}` }),
    record_type: 'message',
  }));
}

function aggregate(value = N): ProvenanceAggregate {
  return {
    frozen_rows: value, message_rows: value, message_shape_rows: value,
    source_user_rows: value, historical_account_null_rows: value,
    friend_rows: value, friend_identity_rows: value, account_fk_rows: value,
    fully_matched_rows: value,
  };
}

describe('d1 source provenance #5229', () => {
  test('builds one parameterized SELECT plan without private values in SQL', () => {
    const rows = candidates();
    const plan = buildQueryPlan(rows);
    expect(plan.sql).toMatch(/^WITH frozen/);
    expect(plan.sql).toContain('SELECT');
    expect(plan.sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|PRAGMA)\b/i);
    expect(plan.sql).not.toContain(rows[0].id);
    expect(plan.sql).not.toContain(rows[0].content);
    expect(plan.params).toHaveLength(1);
    expect(JSON.parse(plan.params[0])).toHaveLength(N);
  });

  test('validates the frozen candidate and A0 aggregate contract', () => {
    const rows = candidates();
    const result = validateFrozenCandidates(
      { eligible_rows: rows, excluded_h_rows: [] },
      { approval_id: '5229-A0-R4-20260901', status: 'completed', aggregates: { N, E: 0, B: 27_625_839 } },
    );
    expect(result).toHaveLength(N);
    expect(() => validateFrozenCandidates(
      { eligible_rows: rows.map((row, index) => index === 0 ? { ...row, messages_log_line_account_id: 'drift' } : row), excluded_h_rows: [] },
      { approval_id: '5229-A0-R4-20260901', status: 'completed', aggregates: { N, E: 0, B: 27_625_839 } },
    )).toThrow(/candidate_field/);
  });

  test('requires exactly one nonempty token assignment', () => {
    expect(parseTokenFile('IGNORED=x\nCLOUDFLARE_API_TOKEN="secret"\n')).toBe('secret');
    expect(() => parseTokenFile('')).toThrow(/token_count/);
    expect(() => parseTokenFile('CLOUDFLARE_API_TOKEN=a\nCLOUDFLARE_API_TOKEN=b')).toThrow(/token_count/);
    expect(() => parseTokenFile('CLOUDFLARE_API_TOKEN =a')).toThrow(/token_format/);
    expect(() => parseTokenFile('CLOUDFLARE_API_TOKEN="unterminated')).toThrow(/token_format/);
  });

  test('requires an exact active two-hour approval window', () => {
    const start = '2026-09-01T00:00:00Z';
    const end = '2026-09-01T02:00:00Z';
    expect(() => validateApprovalWindow(start, end, Date.parse(start))).not.toThrow();
    expect(() => validateApprovalWindow(start, end, Date.parse(end))).toThrow(/approval_inactive/);
    expect(() => validateApprovalWindow(start, '2026-09-01T02:00:01Z', Date.parse(start))).toThrow(/approval_window/);
  });

  test('accepts only an all-77 aggregate', () => {
    expect(validateAggregate(aggregate())).toEqual(aggregate());
    expect(() => validateAggregate({ ...aggregate(), source_user_rows: 76 })).toThrow(/aggregate_source_user_rows/);
    expect(() => validateAggregate({ ...aggregate(), source_user_rows: '77' })).toThrow(/aggregate_source_user_rows/);
  });

  test('strictly parses the one-row D1 REST response envelope', () => {
    const body = Buffer.from(JSON.stringify({ success: true, result: [{ results: [aggregate()] }] }));
    expect(parseD1Response(200, { 'content-type': 'application/json; charset=UTF-8', 'cf-ray': 'ray-safe' }, body))
      .toMatchObject({ aggregate: aggregate(), cfRay: 'ray-safe' });
    expect(() => parseD1Response(302, { 'content-type': 'application/json' }, body)).toThrow(/http_status/);
    expect(() => parseD1Response(200, { 'content-type': 'text/html' }, body)).toThrow(/content_type/);
    expect(() => parseD1Response(200, { 'content-type': 'application/jsonp' }, body)).toThrow(/content_type/);
    expect(() => parseD1Response(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' }, body)).toThrow(/content_encoding/);
    expect(() => parseD1Response(200, { 'content-type': 'application/json' }, Buffer.from('{}'))).toThrow(/response_shape/);
  });

  test('uses the exact one-POST transport and rejects a 65,537-byte response without retry', async () => {
    const makeRequest = (responseBody: Buffer, contentType = 'application/json') => {
      const calls: Array<{ options: Record<string, unknown>; body?: Buffer }> = [];
      const requestImpl: RequestFunction = ((options, callback) => {
        const emitter = new EventEmitter();
        const req = emitter as unknown as ClientRequest;
        req.end = ((body?: Buffer) => {
          calls[0].body = body;
          queueMicrotask(() => {
            const res = Readable.from([responseBody]) as unknown as IncomingMessage;
            res.statusCode = 200;
            res.headers = { 'content-type': contentType, 'cf-ray': 'ray-safe' };
            callback(res);
          });
          return req;
        }) as ClientRequest['end'];
        req.destroy = ((error?: Error) => {
          if (error) queueMicrotask(() => emitter.emit('error', error));
          return req;
        }) as ClientRequest['destroy'];
        calls.push({ options: options as Record<string, unknown> });
        return req;
      }) as RequestFunction;
      return { requestImpl, calls };
    };

    const okBody = Buffer.from(JSON.stringify({ success: true, result: [{ results: [aggregate()] }] }));
    const ok = makeRequest(okBody);
    await expect(queryD1(buildQueryPlan(candidates()), 'secret', Date.now() + 5_000, ok.requestImpl))
      .resolves.toMatchObject({ aggregate: aggregate(), cfRay: 'ray-safe' });
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0].options).toMatchObject({
      protocol: 'https:', hostname: 'api.cloudflare.com', port: 443, method: 'POST',
      path: '/client/v4/accounts/67907592fdf596376bc2097e14a6563a/d1/database/c19584d7-e9f1-4d46-83c5-6c0ba96561d1/query',
      agent: false,
    });
    const headers = ok.calls[0].options.headers as Record<string, unknown>;
    expect(headers).toEqual({
      Authorization: 'Bearer secret',
      'Content-Type': 'application/json',
      'Accept-Encoding': 'identity',
      'Content-Length': ok.calls[0].body?.length,
    });
    expect(JSON.parse(ok.calls[0].body?.toString('utf8') ?? '{}').params).toHaveLength(1);

    const oversized = makeRequest(Buffer.alloc(65_537, 0x20), 'application/json');
    await expect(queryD1(buildQueryPlan(candidates()), 'secret', Date.now() + 5_000, oversized.requestImpl))
      .rejects.toThrow(/response_oversize/);
    expect(oversized.calls).toHaveLength(1);
  });

  test('aborts one in-flight request at the absolute approval expiry without retry', async () => {
    let calls = 0;
    const requestImpl: RequestFunction = ((_options, _callback) => {
      calls += 1;
      const emitter = new EventEmitter();
      const req = emitter as unknown as ClientRequest;
      req.end = (() => req) as ClientRequest['end'];
      req.destroy = ((error?: Error) => {
        if (error) queueMicrotask(() => emitter.emit('error', error));
        return req;
      }) as ClientRequest['destroy'];
      return req;
    }) as RequestFunction;
    await expect(queryD1(buildQueryPlan(candidates()), 'secret', Date.now() + 5, requestImpl))
      .rejects.toThrow(/approval_expired/);
    expect(calls).toBe(1);
  });

  test('does not construct a provider request when approval is already expired', async () => {
    let calls = 0;
    const requestImpl: RequestFunction = ((_options, _callback) => {
      calls += 1;
      throw new Error('must not be called');
    }) as RequestFunction;
    await expect(queryD1(buildQueryPlan(candidates()), 'secret', Date.now() - 1, requestImpl))
      .rejects.toThrow(/approval_expired/);
    expect(calls).toBe(0);
  });

  test('preflight performs zero provider requests and zero local writes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'provenance-preflight-'));
    const output = join(root, 'evidence');
    const query = vi.fn();
    try {
      const result = await run(['--preflight-only'], {
        now: () => Date.parse('2026-09-01T00:30:00Z'), loadCandidates: candidates,
        loadToken: () => 'secret', outputDir: output, query,
      });
      expect(result).toMatchObject({ status: 'preflight_passed', provider_requests: 0, local_writes: 0 });
      expect(query).not.toHaveBeenCalled();
      expect(() => lstatSync(output)).toThrow();
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('runs exactly one query and writes one owner-only sanitized summary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'provenance-success-'));
    const output = join(root, 'evidence');
    const query = vi.fn().mockResolvedValue({ aggregate: aggregate(), cfRay: 'ray-safe' });
    try {
      const result = await run([
        '--approval-received', '2026-09-01T00:00:00Z', '--approval-expires', '2026-09-01T02:00:00Z',
      ], {
        now: () => Date.parse('2026-09-01T00:30:00Z'), loadCandidates: candidates,
        loadToken: () => 'secret', outputDir: output, query,
      });
      expect(result).toMatchObject({ status: 'completed', provenance_basis: 'legacy_user_path_reconstruction' });
      expect(query).toHaveBeenCalledTimes(1);
      expect(lstatSync(output).mode & 0o777).toBe(0o700);
      expect(readdirSync(output)).toEqual(['sanitized-summary.json']);
      const file = join(output, 'sanitized-summary.json');
      expect(lstatSync(file).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({ status: 'completed', raw_event_snapshot: false });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('stops after the first failed query with no retry and preserves one safe summary', async () => {
    const root = mkdtempSync(join(tmpdir(), 'provenance-stop-'));
    const output = join(root, 'evidence');
    const query = vi.fn().mockRejectedValue(new Error('provider body must not leak'));
    try {
      await expect(run([
        '--approval-received', '2026-09-01T00:00:00Z', '--approval-expires', '2026-09-01T02:00:00Z',
      ], {
        now: () => Date.parse('2026-09-01T00:30:00Z'), loadCandidates: candidates,
        loadToken: () => 'secret', outputDir: output, query,
      })).rejects.toThrow(/unexpected_local_error/);
      expect(query).toHaveBeenCalledTimes(1);
      expect(readdirSync(output)).toEqual(['sanitized-summary.json']);
      const summary = JSON.parse(readFileSync(join(output, 'sanitized-summary.json'), 'utf8'));
      expect(summary).toMatchObject({ status: 'stopped', stop_reason: 'unexpected_local_error' });
      expect(JSON.stringify(summary)).not.toContain('provider body must not leak');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
