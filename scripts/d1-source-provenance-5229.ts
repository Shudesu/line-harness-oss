#!/usr/bin/env tsx
/** Hash-bindable, one-query D1 provenance check for #5229 Packet P0. */

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

const APPROVAL_ID = '5229-P0-20260901';
const ACCOUNT_ID = '67907592fdf596376bc2097e14a6563a';
const DATABASE_ID = 'c19584d7-e9f1-4d46-83c5-6c0ba96561d1';
const SOURCE_DIR = '/Users/kensmba/.line-harness-5229-A0-R4-20260901';
const TOKEN_FILE = '/Users/kensmba/.line-harness/.env.local';
const OUTPUT_DIR = '/Users/kensmba/.line-harness-5229-P0-20260901';
const EXPECTED_N = 77;
const EXPECTED_B = 27_625_839;
const MAX_RESPONSE_BYTES = 65_536;
const SOURCE_HASHES = {
  'd1-candidates.json': '06998bb58bd04fe1d64b437c9770c6a7ee9d85684c5a3b6791dd4e6a372e2cf9',
  'sanitized-summary.json': 'd6c6394e606ce60282d5a0c3442c534704208d2af5b3eed4f23b0119e3bc24fd',
} as const;

export interface FrozenCandidate {
  id: string;
  friend_id: string;
  line_user_id: string;
  authoritative_line_account_id: string;
  messages_log_line_account_id: null;
  content: string;
  record_type: 'message';
}

export interface ProvenanceAggregate {
  frozen_rows: number;
  message_rows: number;
  message_shape_rows: number;
  source_user_rows: number;
  historical_account_null_rows: number;
  friend_rows: number;
  friend_identity_rows: number;
  account_fk_rows: number;
  fully_matched_rows: number;
}

export interface QueryPlan {
  sql: string;
  params: string[];
}

export type RequestFunction = (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;

export interface RunDependencies {
  now: () => number;
  loadCandidates: () => FrozenCandidate[];
  loadToken: () => string;
  outputDir: string;
  query: (plan: QueryPlan, token: string, expiresAt: number) => Promise<{ aggregate: ProvenanceAggregate; cfRay: string | null }>;
}

export class ProvenanceStop extends Error {
  constructor(readonly code: string) { super(code); }
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertRealPath(path: string, kind: 'directory' | 'file', mode: number): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new ProvenanceStop(`${kind}_symlink`);
  if (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) {
    throw new ProvenanceStop(`${kind}_type`);
  }
  if ((stat.mode & 0o777) !== mode) throw new ProvenanceStop(`${kind}_mode`);
}

function checkedJson(name: keyof typeof SOURCE_HASHES): unknown {
  const path = `${SOURCE_DIR}/${name}`;
  assertRealPath(path, 'file', 0o600);
  const bytes = readFileSync(path);
  if (sha256(bytes) !== SOURCE_HASHES[name]) throw new ProvenanceStop('source_hash');
  return JSON.parse(bytes.toString('utf8')) as unknown;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0');
}

export function validateFrozenCandidates(input: unknown, summary: unknown): FrozenCandidate[] {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ProvenanceStop('source_shape');
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)) throw new ProvenanceStop('summary_shape');
  const evidence = input as { eligible_rows?: unknown[]; excluded_h_rows?: unknown[] };
  const a0 = summary as { approval_id?: unknown; status?: unknown; aggregates?: { N?: unknown; E?: unknown; B?: unknown } };
  if (a0.approval_id !== '5229-A0-R4-20260901' || a0.status !== 'completed' ||
      a0.aggregates?.N !== EXPECTED_N || a0.aggregates.E !== 0 || a0.aggregates.B !== EXPECTED_B) {
    throw new ProvenanceStop('summary_state');
  }
  if (!Array.isArray(evidence.eligible_rows) || evidence.eligible_rows.length !== EXPECTED_N ||
      !Array.isArray(evidence.excluded_h_rows) || evidence.excluded_h_rows.length !== 0) {
    throw new ProvenanceStop('candidate_count');
  }
  const seen = new Set<string>();
  const candidates = evidence.eligible_rows.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProvenanceStop('candidate_shape');
    const row = value as Record<string, unknown>;
    if (row.record_type !== 'message' || !nonempty(row.id) || !nonempty(row.friend_id) ||
        !nonempty(row.line_user_id) || !nonempty(row.authoritative_line_account_id) ||
        row.messages_log_line_account_id !== null || !nonempty(row.content)) {
      throw new ProvenanceStop('candidate_field');
    }
    if (seen.has(row.id)) throw new ProvenanceStop('candidate_duplicate');
    seen.add(row.id);
    return row as unknown as FrozenCandidate;
  });
  if (new Set(candidates.map((row) => row.authoritative_line_account_id)).size !== 1) {
    throw new ProvenanceStop('account_cardinality');
  }
  return candidates;
}

export function loadFrozenCandidates(): FrozenCandidate[] {
  assertRealPath(SOURCE_DIR, 'directory', 0o700);
  return validateFrozenCandidates(checkedJson('d1-candidates.json'), checkedJson('sanitized-summary.json'));
}

export function parseTokenFile(text: string): string {
  const values: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^CLOUDFLARE_API_TOKEN=(.*)$/.exec(line);
    if (!match) {
      if (line.startsWith('CLOUDFLARE_API_TOKEN')) throw new ProvenanceStop('token_format');
      continue;
    }
    let value = match[1];
    const singleQuoted = value.startsWith("'") || value.endsWith("'");
    const doubleQuoted = value.startsWith('"') || value.endsWith('"');
    if (singleQuoted || doubleQuoted) {
      if (!((value.startsWith("'") && value.endsWith("'")) ||
            (value.startsWith('"') && value.endsWith('"')))) throw new ProvenanceStop('token_format');
      value = value.slice(1, -1);
    }
    if (!value || /[\r\n\0]/.test(value)) throw new ProvenanceStop('token_format');
    values.push(value);
  }
  if (values.length !== 1) throw new ProvenanceStop('token_count');
  return values[0];
}

export function loadToken(): string {
  assertRealPath(TOKEN_FILE, 'file', 0o600);
  return parseTokenFile(readFileSync(TOKEN_FILE, 'utf8'));
}

export function buildQueryPlan(candidates: FrozenCandidate[]): QueryPlan {
  if (candidates.length !== EXPECTED_N) throw new ProvenanceStop('candidate_count');
  // D1 allows at most 100 bound parameters per query. One JSON parameter keeps
  // all 77 frozen tuples parameterized without embedding private values in SQL.
  const params = [JSON.stringify(candidates.map((row) => ({
    id: row.id, friend_id: row.friend_id, line_user_id: row.line_user_id,
    account_id: row.authoritative_line_account_id, content: row.content,
  })))];
  const sql = `WITH frozen AS (
  SELECT
    json_extract(value, '$.id') AS id,
    json_extract(value, '$.friend_id') AS friend_id,
    json_extract(value, '$.line_user_id') AS line_user_id,
    json_extract(value, '$.account_id') AS account_id,
    json_extract(value, '$.content') AS content
  FROM json_each(?)
),
matched AS (
  SELECT frozen.*,
    ml.id AS matched_message_id, ml.direction, ml.message_type, ml.source,
    ml.line_account_id AS historical_account_id, ml.friend_id AS logged_friend_id,
    ml.content AS logged_content, f.id AS matched_friend_id,
    f.line_user_id AS current_line_user_id, f.line_account_id AS current_account_id,
    la.id AS matched_account_id
  FROM frozen
  LEFT JOIN messages_log ml ON ml.id = frozen.id
  LEFT JOIN friends f ON f.id = frozen.friend_id
  LEFT JOIN line_accounts la ON la.id = frozen.account_id
)
SELECT
  COUNT(*) AS frozen_rows,
  SUM(CASE WHEN matched_message_id IS NOT NULL THEN 1 ELSE 0 END) AS message_rows,
  SUM(CASE WHEN direction = 'incoming' AND message_type = 'image'
            AND logged_friend_id = friend_id AND logged_content = content THEN 1 ELSE 0 END) AS message_shape_rows,
  SUM(CASE WHEN source = 'user' THEN 1 ELSE 0 END) AS source_user_rows,
  SUM(CASE WHEN historical_account_id IS NULL THEN 1 ELSE 0 END) AS historical_account_null_rows,
  SUM(CASE WHEN matched_friend_id IS NOT NULL THEN 1 ELSE 0 END) AS friend_rows,
  SUM(CASE WHEN current_line_user_id = line_user_id AND current_account_id = account_id THEN 1 ELSE 0 END) AS friend_identity_rows,
  SUM(CASE WHEN matched_account_id = account_id THEN 1 ELSE 0 END) AS account_fk_rows,
  SUM(CASE WHEN matched_message_id IS NOT NULL AND direction = 'incoming' AND message_type = 'image'
            AND logged_friend_id = friend_id AND logged_content = content AND source = 'user'
            AND historical_account_id IS NULL AND matched_friend_id IS NOT NULL
            AND current_line_user_id = line_user_id AND current_account_id = account_id
            AND matched_account_id = account_id THEN 1 ELSE 0 END) AS fully_matched_rows
FROM matched`;
  return { sql, params };
}

export function validateAggregate(value: unknown): ProvenanceAggregate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ProvenanceStop('aggregate_shape');
  const row = value as Record<string, unknown>;
  const fields: (keyof ProvenanceAggregate)[] = [
    'frozen_rows', 'message_rows', 'message_shape_rows', 'source_user_rows',
    'historical_account_null_rows', 'friend_rows', 'friend_identity_rows',
    'account_fk_rows', 'fully_matched_rows',
  ];
  for (const field of fields) {
    if (typeof row[field] !== 'number' || !Number.isInteger(row[field]) || row[field] !== EXPECTED_N) {
      throw new ProvenanceStop(`aggregate_${field}`);
    }
  }
  return Object.fromEntries(fields.map((field) => [field, EXPECTED_N])) as unknown as ProvenanceAggregate;
}

export function validateApprovalWindow(received: string, expires: string, now: number): void {
  const start = Date.parse(received);
  const end = Date.parse(expires);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end - start !== 7_200_000) {
    throw new ProvenanceStop('approval_window');
  }
  if (now < start || now >= end) throw new ProvenanceStop('approval_inactive');
}

export async function queryD1(
  plan: QueryPlan,
  token: string,
  expiresAt: number,
  requestImpl: RequestFunction = request,
): Promise<{ aggregate: ProvenanceAggregate; cfRay: string | null }> {
  const body = Buffer.from(JSON.stringify({ sql: plan.sql, params: plan.params }), 'utf8');
  const response = await new Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }>((resolve, reject) => {
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const clearExpiry = (): void => { if (expiryTimer) clearTimeout(expiryTimer); };
    const fail = (error: unknown): void => {
      if (settled) return;
      settled = true;
      clearExpiry();
      reject(error);
    };
    const succeed = (value: { status: number; headers: Record<string, string | string[] | undefined>; body: Buffer }): void => {
      if (settled) return;
      settled = true;
      clearExpiry();
      resolve(value);
    };
    if (Date.now() >= expiresAt) {
      fail(new ProvenanceStop('approval_expired'));
      return;
    }
    const req = requestImpl({
      protocol: 'https:', hostname: 'api.cloudflare.com', port: 443,
      method: 'POST',
      path: `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept-Encoding': 'identity', 'Content-Length': body.length },
      agent: false,
    }, (res) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      let stopped = false;
      res.once('error', (error) => { stopped = true; fail(error); });
      res.once('aborted', () => { stopped = true; fail(new ProvenanceStop('response_aborted')); });
      res.on('readable', () => {
        if (stopped) return;
        let chunk: Buffer | null;
        while ((chunk = res.read(Math.min(16_384, MAX_RESPONSE_BYTES - bytes + 1)) as Buffer | null) !== null) {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) {
            stopped = true;
            req.destroy(new ProvenanceStop('response_oversize'));
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
    if (remaining <= 0) { req.destroy(new ProvenanceStop('approval_expired')); return; }
    expiryTimer = setTimeout(() => req.destroy(new ProvenanceStop('approval_expired')), remaining);
    req.end(body);
  });
  return parseD1Response(response.status, response.headers, response.body);
}

export function parseD1Response(
  status: number,
  headers: Record<string, string | string[] | undefined>,
  body: Buffer,
): { aggregate: ProvenanceAggregate; cfRay: string | null } {
  if (status !== 200) throw new ProvenanceStop('http_status');
  const contentType = headers['content-type'];
  const mediaType = typeof contentType === 'string' ? contentType.split(';', 1)[0].trim().toLowerCase() : '';
  if (mediaType !== 'application/json') {
    throw new ProvenanceStop('content_type');
  }
  const encoding = headers['content-encoding'];
  if (encoding !== undefined && encoding !== 'identity') throw new ProvenanceStop('content_encoding');
  let parsed: unknown;
  try { parsed = JSON.parse(body.toString('utf8')); } catch { throw new ProvenanceStop('response_json'); }
  const envelope = parsed as { success?: unknown; result?: Array<{ results?: unknown[] }> };
  if (envelope.success !== true || !Array.isArray(envelope.result) || envelope.result.length !== 1 ||
      !Array.isArray(envelope.result[0]?.results) || envelope.result[0].results?.length !== 1) {
    throw new ProvenanceStop('response_shape');
  }
  const ray = headers['cf-ray'];
  return { aggregate: validateAggregate(envelope.result[0].results?.[0]), cfRay: typeof ray === 'string' ? ray : null };
}

function createOutput(path: string): { dev: number; ino: number } {
  if (existsSync(path)) throw new ProvenanceStop('output_exists');
  mkdirSync(path, { mode: 0o700 });
  assertRealPath(path, 'directory', 0o700);
  const stat = lstatSync(path);
  if (readdirSync(path).length !== 0) throw new ProvenanceStop('output_entries');
  return { dev: stat.dev, ino: stat.ino };
}

function writeSummary(path: string, identity: { dev: number; ino: number }, value: unknown): void {
  assertPinnedOutput(path, identity, []);
  const target = `${path}/sanitized-summary.json`;
  writeFileSync(target, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  assertRealPath(target, 'file', 0o600);
  assertPinnedOutput(path, identity, ['sanitized-summary.json']);
}

function assertPinnedOutput(path: string, identity: { dev: number; ino: number }, expectedNames: string[]): void {
  assertRealPath(path, 'directory', 0o700);
  const stat = lstatSync(path);
  const names = readdirSync(path).sort();
  if (stat.dev !== identity.dev || stat.ino !== identity.ino ||
      JSON.stringify(names) !== JSON.stringify([...expectedNames].sort())) {
    throw new ProvenanceStop('output_drift');
  }
}

export function parseArgs(raw: string[]): { preflightOnly: boolean; received: string; expires: string } {
  if (raw.length === 1 && raw[0] === '--preflight-only') return { preflightOnly: true, received: '', expires: '' };
  if (raw.length === 4 && raw[0] === '--approval-received' && raw[2] === '--approval-expires') {
    return { preflightOnly: false, received: raw[1], expires: raw[3] };
  }
  throw new ProvenanceStop('arguments');
}

export async function run(raw: string[], deps: RunDependencies): Promise<Record<string, unknown>> {
  const args = parseArgs(raw);
  const candidates = deps.loadCandidates();
  const token = deps.loadToken();
  const plan = buildQueryPlan(candidates);
  if (args.preflightOnly) {
    if (existsSync(deps.outputDir)) throw new ProvenanceStop('output_exists');
    return { approval_id: APPROVAL_ID, status: 'preflight_passed', source_count: EXPECTED_N, token_present: token.length > 0, provider_requests: 0, local_writes: 0 };
  }
  validateApprovalWindow(args.received, args.expires, deps.now());
  const identity = createOutput(deps.outputDir);
  const startedAt = new Date(deps.now()).toISOString();
  try {
    const result = await deps.query(plan, token, Date.parse(args.expires));
    validateApprovalWindow(args.received, args.expires, deps.now());
    const summary = {
      schema_version: 1, approval_id: APPROVAL_ID, approval_received: args.received,
      approval_expires: args.expires, started_at: startedAt,
      completed_at: new Date(deps.now()).toISOString(), status: 'completed',
      provenance_basis: 'legacy_user_path_reconstruction', raw_event_snapshot: false,
      aggregates: result.aggregate,
      request_counts: { d1_query_post: 1, provider_total: 1, provider_writes: 0, retry: 0 },
      cf_ray: result.cfRay,
    };
    writeSummary(deps.outputDir, identity, summary);
    return summary;
  } catch (error) {
    const reason = error instanceof ProvenanceStop ? error.code : 'unexpected_local_error';
    if (readdirSync(deps.outputDir).length === 0) {
      writeSummary(deps.outputDir, identity, {
        schema_version: 1, approval_id: APPROVAL_ID, approval_received: args.received,
        approval_expires: args.expires, started_at: startedAt,
        completed_at: new Date(deps.now()).toISOString(), status: 'stopped', stop_reason: reason,
        provenance_basis: 'legacy_user_path_reconstruction', raw_event_snapshot: false,
        request_counts: { d1_query_post: 1, provider_total: 1, provider_writes: 0, retry: 0 },
      });
    }
    throw new ProvenanceStop(reason);
  }
}

const defaultDeps: RunDependencies = {
  now: () => Date.now(), loadCandidates: loadFrozenCandidates, loadToken,
  outputDir: OUTPUT_DIR, query: queryD1,
};

const isCliEntry = (() => {
  if (!argv[1]) return false;
  try { return fileURLToPath(import.meta.url) === argv[1]; } catch { return false; }
})();

if (isCliEntry) {
  run(argv.slice(2), defaultDeps).then((result) => stdout.write(`${JSON.stringify(result)}\n`)).catch((error: unknown) => {
    const reason = error instanceof ProvenanceStop ? error.code : 'unexpected_local_error';
    stdout.write(`${JSON.stringify({ approval_id: APPROVAL_ID, status: 'stopped', stop_reason: reason, provider_writes: 0, retry: 0 })}\n`);
    exit(1);
  });
}
