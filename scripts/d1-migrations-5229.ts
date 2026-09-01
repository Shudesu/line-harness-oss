#!/usr/bin/env tsx
/** Exact, approval-bound D1 migration executor for #5229 Packet B2. */

import { createHash } from 'node:crypto';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request, type RequestOptions } from 'node:https';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { argv, exit, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const APPROVAL_ID = '5229-B2-20260901';
const ACCOUNT_ID = '67907592fdf596376bc2097e14a6563a';
const DATABASE_ID = 'c19584d7-e9f1-4d46-83c5-6c0ba96561d1';
const TOKEN_FILE = '/Users/kensmba/.line-harness/.env.local';
const OUTPUT_DIR = '/Users/kensmba/.line-harness-5229-B2-20260901';
const MAX_RESPONSE_BYTES = 65_536;
const LEDGER_TABLE = '_line_harness_migrations';

export const MIGRATION_SPECS = [
  {
    name: '071_incoming_media.sql',
    path: 'packages/db/migrations/071_incoming_media.sql',
    sha256: 'c65203ce28e750b6cf612ad17029bc195fd2e6253a379cf62e642e3c5a8ae5d6',
    table: 'incoming_media',
    index: 'idx_incoming_media_status_updated',
  },
  {
    name: '072_incoming_media_service_credentials.sql',
    path: 'packages/db/migrations/072_incoming_media_service_credentials.sql',
    sha256: 'be4b1730fadd497d0a0d9677bda8626d174aaa08946d1c27e9e68e1549049937',
    table: 'incoming_media_service_credentials',
    index: 'idx_incoming_media_service_credentials_account_active',
  },
] as const;

export interface MigrationSource {
  name: string;
  path: string;
  sha256: string;
  table: string;
  index: string;
  sql: string;
}

export interface D1Statement { sql: string; params?: string[] }
export interface D1BatchBody { batch: D1Statement[] }
export interface D1HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}
export type RequestFunction = (
  options: RequestOptions,
  callback: (response: IncomingMessage) => void,
) => ClientRequest;

export interface RunDependencies {
  now: () => number;
  loadMigrations: () => MigrationSource[];
  loadToken: () => string;
  outputDir: string;
  post: (body: D1BatchBody, token: string, expiresAt: number) => Promise<D1HttpResponse>;
}

export interface SchemaReadback {
  tables: string[];
  indexes: string[];
  ledger: Array<{ name: string; checksum: string }>;
}

export class MigrationStop extends Error {
  constructor(readonly code: string) { super(code); }
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertRealPath(path: string, kind: 'directory' | 'file', mode: number): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new MigrationStop(`${kind}_symlink`);
  if (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) {
    throw new MigrationStop(`${kind}_type`);
  }
  if ((stat.mode & 0o777) !== mode) throw new MigrationStop(`${kind}_mode`);
}

export function validateMigrationSources(sources: MigrationSource[]): MigrationSource[] {
  if (sources.length !== MIGRATION_SPECS.length) throw new MigrationStop('migration_count');
  for (let index = 0; index < MIGRATION_SPECS.length; index += 1) {
    const expected = MIGRATION_SPECS[index];
    const actual = sources[index];
    if (!actual || actual.name !== expected.name || actual.path !== expected.path ||
        actual.sha256 !== expected.sha256 || actual.table !== expected.table ||
        actual.index !== expected.index || sha256(Buffer.from(actual.sql, 'utf8')) !== expected.sha256) {
      throw new MigrationStop('migration_hash');
    }
    const statements = splitSql(actual.sql);
    if (statements.length !== 2 ||
        !/^CREATE TABLE IF NOT EXISTS\b/i.test(stripComments(statements[0])) ||
        !/^CREATE INDEX IF NOT EXISTS\b/i.test(stripComments(statements[1]))) {
      throw new MigrationStop('migration_shape');
    }
  }
  return sources;
}

export function loadMigrations(): MigrationSource[] {
  const sources = MIGRATION_SPECS.map((spec) => {
    assertRealPath(spec.path, 'file', 0o644);
    const bytes = readFileSync(spec.path);
    if (sha256(bytes) !== spec.sha256) throw new MigrationStop('migration_hash');
    return { ...spec, sql: bytes.toString('utf8') };
  });
  return validateMigrationSources(sources);
}

export function parseTokenFile(text: string): string {
  const values: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^CLOUDFLARE_API_TOKEN=(.*)$/.exec(line);
    if (!match) {
      if (line.startsWith('CLOUDFLARE_API_TOKEN')) throw new MigrationStop('token_format');
      continue;
    }
    let value = match[1];
    const singleQuoted = value.startsWith("'") || value.endsWith("'");
    const doubleQuoted = value.startsWith('"') || value.endsWith('"');
    if (singleQuoted || doubleQuoted) {
      if (!((value.startsWith("'") && value.endsWith("'")) ||
            (value.startsWith('"') && value.endsWith('"')))) throw new MigrationStop('token_format');
      value = value.slice(1, -1);
    }
    if (!value || /[\r\n\0]/.test(value)) throw new MigrationStop('token_format');
    values.push(value);
  }
  if (values.length !== 1) throw new MigrationStop('token_count');
  return values[0];
}

export function loadToken(): string {
  assertRealPath(TOKEN_FILE, 'file', 0o600);
  return parseTokenFile(readFileSync(TOKEN_FILE, 'utf8'));
}

function assertion(expression: string): string {
  return `SELECT CASE WHEN (${expression}) THEN 1 ELSE json_extract('{}', '$[') END AS assertion`;
}

export function buildApplyBatch(sources: MigrationSource[]): D1BatchBody {
  validateMigrationSources(sources);
  const [m071, m072] = sources;
  const statements071 = splitSql(m071.sql);
  const statements072 = splitSql(m072.sql);
  const targets = [LEDGER_TABLE, m071.table, m071.index, m072.table, m072.index];
  const quotedTargets = targets.map((name) => `'${name}'`).join(', ');
  const batch: D1Statement[] = [
    { sql: assertion(`(SELECT COUNT(*) FROM sqlite_master WHERE name IN (${quotedTargets})) = 0`) },
    { sql: `CREATE TABLE IF NOT EXISTS ${LEDGER_TABLE} (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL)` },
    {
      sql: assertion(`(SELECT COUNT(*) FROM ${LEDGER_TABLE} WHERE name IN (?, ?)) = 0`),
      params: [m071.name, m072.name],
    },
    { sql: statements071[0] },
    { sql: statements071[1] },
    { sql: assertion(`(SELECT COUNT(*) FROM sqlite_master WHERE name IN ('${m071.table}', '${m071.index}')) = 2`) },
    {
      sql: `INSERT INTO ${LEDGER_TABLE} (name, checksum, applied_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      params: [m071.name, `sha256:${m071.sha256}`],
    },
    { sql: assertion('changes() = 1') },
    { sql: statements072[0] },
    { sql: statements072[1] },
    { sql: assertion(`(SELECT COUNT(*) FROM sqlite_master WHERE name IN ('${m072.table}', '${m072.index}')) = 2`) },
    {
      sql: `INSERT INTO ${LEDGER_TABLE} (name, checksum, applied_at) VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
      params: [m072.name, `sha256:${m072.sha256}`],
    },
    { sql: assertion('changes() = 1') },
  ];
  return { batch };
}

export function buildReadbackBatch(): D1BatchBody {
  return { batch: [
    {
      sql: `SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name IN (?, ?, ?, ?) ORDER BY type, name`,
      params: MIGRATION_SPECS.flatMap((spec) => [spec.table, spec.index]),
    },
    {
      sql: `SELECT name, checksum FROM ${LEDGER_TABLE} WHERE name IN (?, ?) ORDER BY name`,
      params: MIGRATION_SPECS.map((spec) => spec.name),
    },
    { sql: `PRAGMA table_info('${MIGRATION_SPECS[0].table}')` },
    { sql: `PRAGMA foreign_key_list('${MIGRATION_SPECS[0].table}')` },
    { sql: `PRAGMA index_list('${MIGRATION_SPECS[0].table}')` },
    { sql: `PRAGMA index_info('${MIGRATION_SPECS[0].index}')` },
    { sql: `PRAGMA table_info('${MIGRATION_SPECS[1].table}')` },
    { sql: `PRAGMA foreign_key_list('${MIGRATION_SPECS[1].table}')` },
    { sql: `PRAGMA index_list('${MIGRATION_SPECS[1].table}')` },
    { sql: `PRAGMA index_info('${MIGRATION_SPECS[1].index}')` },
  ] };
}

export function validateApprovalWindow(received: string, expires: string, now: number): void {
  const start = Date.parse(received);
  const end = Date.parse(expires);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== 7_200_000) {
    throw new MigrationStop('approval_window');
  }
  if (now < start || now >= end) throw new MigrationStop('approval_inactive');
}

export async function postD1(
  bodyValue: D1BatchBody,
  token: string,
  expiresAt: number,
  requestImpl: RequestFunction = request,
): Promise<D1HttpResponse> {
  const body = Buffer.from(JSON.stringify(bodyValue), 'utf8');
  return await new Promise<D1HttpResponse>((resolve, reject) => {
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const clearExpiry = (): void => { if (expiryTimer) clearTimeout(expiryTimer); };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      clearExpiry();
      reject(error);
    };
    const succeed = (value: D1HttpResponse): void => {
      if (settled) return;
      settled = true;
      clearExpiry();
      resolve(value);
    };
    if (Date.now() >= expiresAt) {
      fail(new MigrationStop('approval_expired'));
      return;
    }
    const req = requestImpl({
      protocol: 'https:', hostname: 'api.cloudflare.com', port: 443,
      method: 'POST',
      path: `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept-Encoding': 'identity',
        'Content-Length': body.length,
      },
      agent: false,
    }, (res) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      let stopped = false;
      res.once('error', (error) => { stopped = true; fail(error); });
      res.once('aborted', () => { stopped = true; fail(new MigrationStop('response_aborted')); });
      res.on('readable', () => {
        if (stopped) return;
        let chunk: Buffer | null;
        while ((chunk = res.read(Math.min(16_384, MAX_RESPONSE_BYTES - bytes + 1)) as Buffer | null) !== null) {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            stopped = true;
            req.destroy(new MigrationStop('response_oversize'));
            return;
          }
          chunks.push(chunk);
        }
      });
      res.on('end', () => {
        if (stopped) return;
        succeed({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) });
      });
    });
    req.once('error', fail);
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      req.destroy(new MigrationStop('approval_expired'));
      return;
    }
    expiryTimer = setTimeout(() => req.destroy(new MigrationStop('approval_expired')), remaining);
    req.end(body);
  });
}

interface QueryResult { success?: unknown; results?: unknown[] }

function parseEnvelope(response: D1HttpResponse, expectedResults: number): { results: QueryResult[]; cfRay: string | null } {
  if (response.status !== 200) throw new MigrationStop('http_status');
  const contentType = response.headers['content-type'];
  const mediaType = typeof contentType === 'string' ? contentType.split(';', 1)[0].trim().toLowerCase() : '';
  if (mediaType !== 'application/json') throw new MigrationStop('content_type');
  const encoding = response.headers['content-encoding'];
  if (encoding !== undefined && encoding !== 'identity') throw new MigrationStop('content_encoding');
  let parsed: unknown;
  try { parsed = JSON.parse(response.body.toString('utf8')); } catch { throw new MigrationStop('response_json'); }
  const envelope = parsed as { success?: unknown; result?: unknown };
  if (envelope.success !== true || !Array.isArray(envelope.result) || envelope.result.length !== expectedResults ||
      envelope.result.some((item) => !item || typeof item !== 'object' || (item as QueryResult).success !== true ||
        !Array.isArray((item as QueryResult).results))) {
    throw new MigrationStop('response_shape');
  }
  const ray = response.headers['cf-ray'];
  return { results: envelope.result as QueryResult[], cfRay: typeof ray === 'string' ? ray : null };
}

export function parseApplyResponse(response: D1HttpResponse, expectedResults = 13): { cfRay: string | null } {
  const parsed = parseEnvelope(response, expectedResults);
  for (const index of [0, 2, 5, 7, 10, 12]) {
    const rows = parsed.results[index]?.results;
    if (!Array.isArray(rows) || rows.length !== 1 ||
        !rows[0] || typeof rows[0] !== 'object' || (rows[0] as Record<string, unknown>).assertion !== 1) {
      throw new MigrationStop('apply_assertion');
    }
  }
  return { cfRay: parsed.cfRay };
}

function stripComments(sql: string): string {
  return sql.replace(/--[^\r\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
}

function splitSql(sql: string): string[] {
  return stripComments(sql).split(';').map((value) => value.trim()).filter(Boolean);
}

function normalizeSql(sql: string): string {
  return stripComments(sql)
    .replace(/\bCREATE\s+(TABLE|INDEX)\s+IF\s+NOT\s+EXISTS\b/gi, 'CREATE $1')
    .replace(/;\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function exactRows(value: unknown[] | undefined): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((row) => !row || typeof row !== 'object' || Array.isArray(row))) {
    throw new MigrationStop('readback_rows');
  }
  return value as Record<string, unknown>[];
}

function expectExact(actual: unknown, expected: unknown, code: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new MigrationStop(code);
}

const INCOMING_COLUMNS = [
  ['id', 'TEXT', 0, null, 1], ['line_account_id', 'TEXT', 1, null, 0],
  ['line_message_id', 'TEXT', 1, null, 0], ['source_type', 'TEXT', 1, null, 0],
  ['source_id', 'TEXT', 1, null, 0], ['sender_user_id', 'TEXT', 0, null, 0],
  ['r2_key', 'TEXT', 1, null, 0], ['mime_type', 'TEXT', 0, null, 0],
  ['byte_size', 'INTEGER', 0, null, 0], ['sha256', 'TEXT', 0, null, 0],
  ['status', 'TEXT', 1, "'pending'", 0], ['stored_at', 'TEXT', 0, null, 0],
  ['created_at', 'TEXT', 1, null, 0], ['updated_at', 'TEXT', 1, null, 0],
] as const;

const CREDENTIAL_COLUMNS = [
  ['id', 'TEXT', 0, null, 1], ['line_account_id', 'TEXT', 1, null, 0],
  ['scope', 'TEXT', 1, "'incoming_media_read'", 0], ['token_sha256', 'TEXT', 1, null, 0],
  ['label', 'TEXT', 1, null, 0], ['not_before', 'TEXT', 1, null, 0],
  ['expires_at', 'TEXT', 1, null, 0], ['revoked_at', 'TEXT', 0, null, 0],
  ['created_at', 'TEXT', 1, null, 0],
] as const;

function validateColumns(rows: Record<string, unknown>[], expected: readonly (readonly unknown[])[], code: string): void {
  const projected = rows.map((row) => [row.name, row.type, row.notnull, row.dflt_value, row.pk]);
  expectExact(projected, expected, code);
  expectExact(rows.map((row) => row.cid), expected.map((_row, index) => index), code);
}

function validateForeignKey(rows: Record<string, unknown>[], code: string): void {
  expectExact(rows.map((row) => [row.id, row.seq, row.table, row.from, row.to, row.on_update, row.on_delete, row.match]),
    [[0, 0, 'line_accounts', 'line_account_id', 'id', 'NO ACTION', 'CASCADE', 'NONE']], code);
}

function validateIndexes(rows: Record<string, unknown>[], table: string, explicit: string, code: string): void {
  const normalized = rows.map((row) => [row.name, row.unique, row.origin, row.partial]).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const expected = [
    [explicit, 0, 'c', 0],
    [`sqlite_autoindex_${table}_1`, 1, 'pk', 0],
    [`sqlite_autoindex_${table}_2`, 1, 'u', 0],
  ].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  expectExact(normalized, expected, code);
}

export function parseReadbackResponse(response: D1HttpResponse, sources: MigrationSource[]): { readback: SchemaReadback; cfRay: string | null } {
  validateMigrationSources(sources);
  const parsed = parseEnvelope(response, 10);
  const sets = parsed.results.map((result) => exactRows(result.results));
  const master = sets[0];
  if (master.length !== 4) throw new MigrationStop('schema_objects');
  const byName = new Map(master.map((row) => [row.name, row]));
  for (const source of sources) {
    const statements = splitSql(source.sql);
    const table = byName.get(source.table);
    const index = byName.get(source.index);
    if (!table || table.type !== 'table' || table.tbl_name !== source.table || typeof table.sql !== 'string' ||
        normalizeSql(table.sql) !== normalizeSql(statements[0])) throw new MigrationStop('table_sql');
    if (!index || index.type !== 'index' || index.tbl_name !== source.table || typeof index.sql !== 'string' ||
        normalizeSql(index.sql) !== normalizeSql(statements[1])) throw new MigrationStop('index_sql');
  }
  const ledger = sets[1].map((row) => ({ name: row.name, checksum: row.checksum }));
  expectExact(ledger, sources.map((source) => ({ name: source.name, checksum: `sha256:${source.sha256}` })), 'ledger_rows');
  validateColumns(sets[2], INCOMING_COLUMNS, 'incoming_columns');
  validateForeignKey(sets[3], 'incoming_fk');
  validateIndexes(sets[4], sources[0].table, sources[0].index, 'incoming_indexes');
  expectExact(sets[5].map((row) => [row.seqno, row.cid, row.name]), [[0, 10, 'status'], [1, 13, 'updated_at']], 'incoming_index_columns');
  validateColumns(sets[6], CREDENTIAL_COLUMNS, 'credential_columns');
  validateForeignKey(sets[7], 'credential_fk');
  validateIndexes(sets[8], sources[1].table, sources[1].index, 'credential_indexes');
  expectExact(sets[9].map((row) => [row.seqno, row.cid, row.name]), [[0, 1, 'line_account_id'], [1, 7, 'revoked_at'], [2, 6, 'expires_at']], 'credential_index_columns');
  return {
    readback: {
      tables: sources.map((source) => source.table),
      indexes: sources.map((source) => source.index),
      ledger: ledger as Array<{ name: string; checksum: string }>,
    },
    cfRay: parsed.cfRay,
  };
}

function createOutput(path: string): { dev: number; ino: number } {
  if (existsSync(path)) throw new MigrationStop('output_exists');
  mkdirSync(path, { mode: 0o700 });
  assertRealPath(path, 'directory', 0o700);
  const stat = lstatSync(path);
  if (readdirSync(path).length !== 0) throw new MigrationStop('output_entries');
  return { dev: stat.dev, ino: stat.ino };
}

function assertPinnedOutput(path: string, identity: { dev: number; ino: number }, names: string[]): void {
  assertRealPath(path, 'directory', 0o700);
  const stat = lstatSync(path);
  if (stat.dev !== identity.dev || stat.ino !== identity.ino ||
      JSON.stringify(readdirSync(path).sort()) !== JSON.stringify([...names].sort())) {
    throw new MigrationStop('output_drift');
  }
}

function writeSummary(path: string, identity: { dev: number; ino: number }, summary: unknown): void {
  assertPinnedOutput(path, identity, []);
  const target = `${path}/sanitized-summary.json`;
  writeFileSync(target, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  assertRealPath(target, 'file', 0o600);
  assertPinnedOutput(path, identity, ['sanitized-summary.json']);
}

export function parseArgs(raw: string[]): { preflightOnly: boolean; received: string; expires: string } {
  if (raw.length === 1 && raw[0] === '--preflight-only') return { preflightOnly: true, received: '', expires: '' };
  if (raw.length === 4 && raw[0] === '--approval-received' && raw[2] === '--approval-expires') {
    return { preflightOnly: false, received: raw[1], expires: raw[3] };
  }
  throw new MigrationStop('arguments');
}

export async function run(raw: string[], deps: RunDependencies): Promise<Record<string, unknown>> {
  const args = parseArgs(raw);
  const migrations = validateMigrationSources(deps.loadMigrations());
  const token = deps.loadToken();
  const apply = buildApplyBatch(migrations);
  const readback = buildReadbackBatch();
  if (args.preflightOnly) {
    if (existsSync(deps.outputDir)) throw new MigrationStop('output_exists');
    return {
      approval_id: APPROVAL_ID, status: 'preflight_passed', migration_count: 2,
      token_present: token.length > 0, provider_requests: 0, provider_writes: 0, local_writes: 0,
    };
  }
  validateApprovalWindow(args.received, args.expires, deps.now());
  const identity = createOutput(deps.outputDir);
  const startedAt = new Date(deps.now()).toISOString();
  let requests = 0;
  let writeBatches = 0;
  try {
    requests += 1;
    writeBatches += 1;
    const applied = parseApplyResponse(await deps.post(apply, token, Date.parse(args.expires)), apply.batch.length);
    validateApprovalWindow(args.received, args.expires, deps.now());
    requests += 1;
    const verified = parseReadbackResponse(await deps.post(readback, token, Date.parse(args.expires)), migrations);
    validateApprovalWindow(args.received, args.expires, deps.now());
    const summary = {
      schema_version: 1, approval_id: APPROVAL_ID, approval_received: args.received,
      approval_expires: args.expires, started_at: startedAt,
      completed_at: new Date(deps.now()).toISOString(), status: 'completed',
      migrations: migrations.map((source) => ({ name: source.name, checksum: `sha256:${source.sha256}` })),
      readback: verified.readback,
      request_counts: { d1_query_post: requests, provider_total: requests, provider_write_batches: writeBatches, retry: 0 },
      cf_rays: [applied.cfRay, verified.cfRay],
      forbidden_actions: { deploy: 0, r2: 0, secret_change: 0, line_send: 0 },
    };
    writeSummary(deps.outputDir, identity, summary);
    return summary;
  } catch (error) {
    const reason = error instanceof MigrationStop ? error.code : 'unexpected_local_error';
    if (readdirSync(deps.outputDir).length === 0) {
      writeSummary(deps.outputDir, identity, {
        schema_version: 1, approval_id: APPROVAL_ID, approval_received: args.received,
        approval_expires: args.expires, started_at: startedAt,
        completed_at: new Date(deps.now()).toISOString(), status: 'stopped', stop_reason: reason,
        request_counts: { d1_query_post: requests, provider_total: requests, provider_write_batches: writeBatches, retry: 0 },
        forbidden_actions: { deploy: 0, r2: 0, secret_change: 0, line_send: 0 },
      });
    }
    throw new MigrationStop(reason);
  }
}

const defaultDeps: RunDependencies = {
  now: () => Date.now(), loadMigrations, loadToken, outputDir: OUTPUT_DIR, post: postD1,
};

const isCliEntry = (() => {
  if (!argv[1]) return false;
  try { return fileURLToPath(import.meta.url) === argv[1]; } catch { return false; }
})();

if (isCliEntry) {
  run(argv.slice(2), defaultDeps).then((result) => stdout.write(`${JSON.stringify(result)}\n`)).catch((error: unknown) => {
    const reason = error instanceof MigrationStop ? error.code : 'unexpected_local_error';
    stdout.write(`${JSON.stringify({ approval_id: APPROVAL_ID, status: 'stopped', stop_reason: reason, retry: 0 })}\n`);
    exit(1);
  });
}
