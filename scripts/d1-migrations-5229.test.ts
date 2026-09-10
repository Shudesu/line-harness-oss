import { EventEmitter } from 'node:events';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, test, vi } from 'vitest';
import {
  MIGRATION_SPECS,
  buildApplyBatch,
  buildReadbackBatch,
  loadMigrations,
  parseApplyResponse,
  parseReadbackResponse,
  postD1,
  run,
  validateApprovalWindow,
  validateMigrationSources,
  type D1BatchBody,
  type D1HttpResponse,
  type MigrationSource,
  type RequestFunction,
} from './d1-migrations-5229.js';

function response(result: Array<{ success: boolean; results: unknown[] }>, cfRay = 'ray-safe'): D1HttpResponse {
  return {
    status: 200,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cf-ray': cfRay },
    body: Buffer.from(JSON.stringify({ success: true, result })),
  };
}

function applyResponse(): D1HttpResponse {
  const assertionIndexes = new Set([0, 2, 5, 7, 10, 12]);
  return response(Array.from({ length: 13 }, (_, index) => ({
    success: true,
    results: assertionIndexes.has(index) ? [{ assertion: 1 }] : [],
  }))) as D1HttpResponse;
}

function cleanStatements(source: MigrationSource): string[] {
  return source.sql.replace(/--[^\r\n]*/g, '').split(';').map((value) => value.trim()).filter(Boolean);
}

function columns(specs: readonly (readonly unknown[])[]): Record<string, unknown>[] {
  return specs.map((row, cid) => ({ cid, name: row[0], type: row[1], notnull: row[2], dflt_value: row[3], pk: row[4] }));
}

const incomingColumns = [
  ['id', 'TEXT', 0, null, 1], ['line_account_id', 'TEXT', 1, null, 0], ['line_message_id', 'TEXT', 1, null, 0],
  ['source_type', 'TEXT', 1, null, 0], ['source_id', 'TEXT', 1, null, 0], ['sender_user_id', 'TEXT', 0, null, 0],
  ['r2_key', 'TEXT', 1, null, 0], ['mime_type', 'TEXT', 0, null, 0], ['byte_size', 'INTEGER', 0, null, 0],
  ['sha256', 'TEXT', 0, null, 0], ['status', 'TEXT', 1, "'pending'", 0], ['stored_at', 'TEXT', 0, null, 0],
  ['created_at', 'TEXT', 1, null, 0], ['updated_at', 'TEXT', 1, null, 0],
] as const;
const credentialColumns = [
  ['id', 'TEXT', 0, null, 1], ['line_account_id', 'TEXT', 1, null, 0], ['scope', 'TEXT', 1, "'incoming_media_read'", 0],
  ['token_sha256', 'TEXT', 1, null, 0], ['label', 'TEXT', 1, null, 0], ['not_before', 'TEXT', 1, null, 0],
  ['expires_at', 'TEXT', 1, null, 0], ['revoked_at', 'TEXT', 0, null, 0], ['created_at', 'TEXT', 1, null, 0],
] as const;

function fk(): Record<string, unknown>[] {
  return [{ id: 0, seq: 0, table: 'line_accounts', from: 'line_account_id', to: 'id', on_update: 'NO ACTION', on_delete: 'CASCADE', match: 'NONE' }];
}

function indexes(table: string, explicit: string): Record<string, unknown>[] {
  return [
    { seq: 0, name: explicit, unique: 0, origin: 'c', partial: 0 },
    { seq: 1, name: `sqlite_autoindex_${table}_2`, unique: 1, origin: 'u', partial: 0 },
    { seq: 2, name: `sqlite_autoindex_${table}_1`, unique: 1, origin: 'pk', partial: 0 },
  ];
}

function readbackResponse(sources: MigrationSource[]): D1HttpResponse {
  const master = sources.flatMap((source) => {
    const [tableSql, indexSql] = cleanStatements(source);
    return [
      { type: 'table', name: source.table, tbl_name: source.table, sql: tableSql },
      { type: 'index', name: source.index, tbl_name: source.table, sql: indexSql },
    ];
  });
  return response([
    { success: true, results: master },
    { success: true, results: sources.map((source) => ({ name: source.name, checksum: `sha256:${source.sha256}` })) },
    { success: true, results: columns(incomingColumns) },
    { success: true, results: fk() },
    { success: true, results: indexes(sources[0].table, sources[0].index) },
    { success: true, results: [{ seqno: 0, cid: 10, name: 'status' }, { seqno: 1, cid: 13, name: 'updated_at' }] },
    { success: true, results: columns(credentialColumns) },
    { success: true, results: fk() },
    { success: true, results: indexes(sources[1].table, sources[1].index) },
    { success: true, results: [{ seqno: 0, cid: 1, name: 'line_account_id' }, { seqno: 1, cid: 7, name: 'revoked_at' }, { seqno: 2, cid: 6, name: 'expires_at' }] },
  ]);
}

describe('exact D1 migrations #5229 B2', () => {
  test('binds exact migration bytes and rejects drift', () => {
    const sources = loadMigrations();
    expect(sources.map((source) => source.sha256)).toEqual(MIGRATION_SPECS.map((spec) => spec.sha256));
    expect(() => validateMigrationSources(sources.map((source, index) => index ? source : { ...source, sql: `${source.sql}\n` })))
      .toThrow(/migration_hash/);
  });

  test('requires the exact active two-hour approval window', () => {
    const start = '2026-09-01T00:00:00Z';
    const end = '2026-09-01T02:00:00Z';
    expect(() => validateApprovalWindow(start, end, Date.parse(start))).not.toThrow();
    expect(() => validateApprovalWindow(start, end, Date.parse(end))).toThrow(/approval_inactive/);
    expect(() => validateApprovalWindow(start, '2026-09-01T02:00:01Z', Date.parse(start))).toThrow(/approval_window/);
  });

  test('builds one ordered rollback-causing transactional batch', () => {
    const sources = loadMigrations();
    const body = buildApplyBatch(sources);
    expect(body.batch).toHaveLength(13);
    expect(body.batch[0].sql).toContain('sqlite_master');
    expect(body.batch[0].sql).toContain('_line_harness_migrations');
    expect(body.batch[1].sql).toContain('CREATE TABLE IF NOT EXISTS _line_harness_migrations');
    expect(body.batch[2].sql).toContain('_line_harness_migrations');
    expect(body.batch[3].sql).toBe(cleanStatements(sources[0])[0]);
    expect(body.batch[4].sql).toBe(cleanStatements(sources[0])[1]);
    expect(body.batch[6].params).toEqual([sources[0].name, `sha256:${sources[0].sha256}`]);
    expect(body.batch[7].sql).toContain('changes() = 1');
    expect(body.batch[8].sql).toBe(cleanStatements(sources[1])[0]);
    expect(body.batch[9].sql).toBe(cleanStatements(sources[1])[1]);
    expect(body.batch[11].params).toEqual([sources[1].name, `sha256:${sources[1].sha256}`]);
    for (const index of [0, 2, 5, 7, 10, 12]) expect(body.batch[index].sql).toContain("json_extract('{}', '$[')");
    expect(buildReadbackBatch().batch).toHaveLength(10);
  });

  test('strictly accepts exact apply/readback and rejects drift', () => {
    const sources = loadMigrations();
    expect(parseApplyResponse(applyResponse())).toEqual({ cfRay: 'ray-safe' });
    expect(parseReadbackResponse(readbackResponse(sources), sources).readback.tables).toEqual(sources.map((source) => source.table));
    const drift = readbackResponse(sources);
    const parsed = JSON.parse(drift.body.toString('utf8'));
    parsed.result[1].results[0].checksum = 'sha256:drift';
    drift.body = Buffer.from(JSON.stringify(parsed));
    expect(() => parseReadbackResponse(drift, sources)).toThrow(/ledger_rows/);
    const failed = applyResponse();
    const failedParsed = JSON.parse(failed.body.toString('utf8'));
    failedParsed.result[7].results[0].assertion = 0;
    failed.body = Buffer.from(JSON.stringify(failedParsed));
    expect(() => parseApplyResponse(failed)).toThrow(/apply_assertion/);
  });

  test('uses exact direct HTTPS request headers and rejects oversized response', async () => {
    const calls: Array<{ options: Record<string, unknown>; body?: Buffer }> = [];
    const make = (body: Buffer): RequestFunction => ((options, callback) => {
      const emitter = new EventEmitter();
      const req = emitter as unknown as ClientRequest;
      req.end = ((written?: Buffer) => {
        calls.push({ options: options as Record<string, unknown>, body: written });
        queueMicrotask(() => {
          const res = Readable.from([body]) as unknown as IncomingMessage;
          res.statusCode = 200;
          res.headers = { 'content-type': 'application/json' };
          callback(res);
        });
        return req;
      }) as ClientRequest['end'];
      req.destroy = ((error?: Error) => { if (error) queueMicrotask(() => emitter.emit('error', error)); return req; }) as ClientRequest['destroy'];
      return req;
    }) as RequestFunction;
    const body: D1BatchBody = { batch: [{ sql: 'SELECT 1' }] };
    await postD1(body, 'secret', Date.now() + 5_000, make(Buffer.from('{}')));
    expect(calls[0].options).toMatchObject({
      protocol: 'https:', hostname: 'api.cloudflare.com', port: 443, method: 'POST', agent: false,
      path: '/client/v4/accounts/67907592fdf596376bc2097e14a6563a/d1/database/c19584d7-e9f1-4d46-83c5-6c0ba96561d1/query',
    });
    expect(calls[0].options.headers).toEqual({ Authorization: 'Bearer secret', 'Content-Type': 'application/json', 'Accept-Encoding': 'identity', 'Content-Length': calls[0].body?.length });
    await expect(postD1(body, 'secret', Date.now() + 5_000, make(Buffer.alloc(65_537, 0x20)))).rejects.toThrow(/response_oversize/);
    expect(calls).toHaveLength(2);
  });

  test('preflight is zero-write and execution is exactly two requests with owner-only receipt', async () => {
    const sources = loadMigrations();
    const root = mkdtempSync(join(tmpdir(), 'd1-migrations-5229-'));
    const preflightOutput = join(root, 'preflight');
    const output = join(root, 'evidence');
    const post = vi.fn()
      .mockResolvedValueOnce(applyResponse())
      .mockResolvedValueOnce(readbackResponse(sources));
    const deps = { now: () => Date.parse('2026-09-01T00:30:00Z'), loadMigrations: () => sources, loadToken: () => 'secret', outputDir: preflightOutput, post };
    try {
      await expect(run(['--preflight-only'], deps)).resolves.toMatchObject({ provider_requests: 0, provider_writes: 0, local_writes: 0 });
      expect(post).not.toHaveBeenCalled();
      expect(() => lstatSync(preflightOutput)).toThrow();
      const result = await run(['--approval-received', '2026-09-01T00:00:00Z', '--approval-expires', '2026-09-01T02:00:00Z'], { ...deps, outputDir: output });
      expect(post).toHaveBeenCalledTimes(2);
      expect(post.mock.calls[0][0]).toEqual(buildApplyBatch(sources));
      expect(post.mock.calls[1][0]).toEqual(buildReadbackBatch());
      expect(result).toMatchObject({ status: 'completed', request_counts: { d1_query_post: 2, provider_write_batches: 1, retry: 0 } });
      expect(lstatSync(output).mode & 0o777).toBe(0o700);
      expect(readdirSync(output)).toEqual(['sanitized-summary.json']);
      const summaryPath = join(output, 'sanitized-summary.json');
      expect(lstatSync(summaryPath).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(summaryPath, 'utf8'))).toMatchObject({ status: 'completed' });
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
