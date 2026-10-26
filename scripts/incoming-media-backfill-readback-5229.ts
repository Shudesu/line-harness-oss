#!/usr/bin/env tsx
/** Bounded post-backfill D1 and private-media functional readback for #5229. */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { argv, exit, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { exactHttpsRequest, type ExactRequest, type HttpResponse } from './worker-b1-deploy-5229.js';

const APPROVAL_ID = '5229-B3-R1-20260903';
const APPROVAL_RECEIVED = '2026-09-03T05:51:46.737Z';
const APPROVAL_EXPIRES = '2026-09-03T07:51:46.737Z';
const ACCOUNT_ID = '67907592fdf596376bc2097e14a6563a';
const DATABASE_ID = 'c19584d7-e9f1-4d46-83c5-6c0ba96561d1';
const WORKER_HOST = 'line-harness.family8office.workers.dev';
const WORKTREE = '/Users/kensmba/.line-harness-wt/5229-private-incoming-media';
const ACCOUNTING_WORKTREE = '/Users/kensmba/scripts-wt/5230-line-recovery-deploy';
const ACCOUNTING_HEAD = 'ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f';
const TOKEN_FILE = '/Users/kensmba/.line-harness/.env.local';
const OUTPUT_DIR = '/Users/kensmba/.line-harness-5229-B3-R1-20260903';
const B0_DIR = '/Users/kensmba/.line-harness-5229-B0-CREDENTIAL-20260903';
const B0_RECEIPT_DIR = '/Users/kensmba/.line-harness-5229-B0-20260903';
const B0_RECEIPT_FILE = `${B0_RECEIPT_DIR}/sanitized-summary.json`;
const B3_RECEIPT_DIR = '/Users/kensmba/.line-harness-5229-B3-20260903';
const B3_RECEIPT_FILE = `${B3_RECEIPT_DIR}/sanitized-summary.json`;
const MANIFEST_DIR = '/Users/kensmba/.line-harness-5229-M0-20260901';
const MANIFEST_FILE = `${MANIFEST_DIR}/incoming-media-backfill-manifest.json`;
const PLAN_DIR = '/Users/kensmba/.line-harness-5229-M0-PLAN-20260901';
const B2_DIR = '/Users/kensmba/.line-harness-5229-B2-20260901';
const B1_DIR = '/Users/kensmba/.line-harness-5229-B1-R1-20260903';
const V1_DIR = '/Users/kensmba/.line-harness-5229-B1-V1-20260903';
const EXECUTOR_FILE = `${WORKTREE}/scripts/incoming-media-backfill-readback-5229.ts`;
const TEST_FILE = `${WORKTREE}/scripts/incoming-media-backfill-readback-5229.test.ts`;
const EXPECTED_N = 77;
const EXPECTED_B = 27_625_839;
const MAX_D1_BYTES = 65_536;
const EXPECTED_WORKER_READS = EXPECTED_N * 2 + 4;

const FILE_ANCHORS = [
  [`${B0_DIR}/credential.env`, '1cd16cce53562f4e33747fc82f93b5052eae9f75216bdb04a5eac2034dd84d89'],
  [`${B0_DIR}/manifest.json`, 'ce9ccea487842fb7c9f0d38e3cb969faebeee7f0df6e1bac75420fdcf551b4ea'],
  [`${B0_DIR}/apply.sql`, '45cd7b35a13b095119288986a5d4ec3afcd0fc3a35f50b7445086cf665874d6d'],
  [`${B2_DIR}/sanitized-summary.json`, '5f393930c545582d656c0068ee1d854a01ef8d60e66e1d04e4dca49a0beda95f'],
  [`${B1_DIR}/sanitized-summary.json`, 'a3f5e2c411f5b8656427f363549d5ed0952da3937a1c47e47185ea78faa3f785'],
  [`${V1_DIR}/sanitized-summary.json`, '5e3dcbf0a5ae7b5e883788cfa7ce87f9bb411fa1935d885ae2bb10a2f769d3a6'],
  [MANIFEST_FILE, 'cf35a1045040a265019a5afad8c2cefb8994edba684eeaa5dd2fad0b17b1663e'],
  [`${PLAN_DIR}/apply.json`, '38d616248dfce3db08f4340817278758445d574b9d405e29b4def5e066e974ce'],
  [`${PLAN_DIR}/preflight.json`, 'cf6d513dc2712192f5739b90cf50212aae80d3cb5684b6065af6bae1921af077'],
  [`${PLAN_DIR}/purge.json`, '3fb15f8bee9135e4459b82f69df04f1df2b0fb7933b83ea6dee8f876a66c65f1'],
  [`${PLAN_DIR}/readback.json`, '7716f07a95ac9aad488cc7fbe3602328599f9afd78b4769dafeaab7e0b1ed59e'],
  [`${PLAN_DIR}/rollback.json`, '4b77fd9c7dfada52d2b6746f054d6205840bb3f1d8da7978e8e7bdab32dd785e'],
] as const;

export interface Entry {
  incoming_media_id: string; messages_log_id: string; messages_log_created_at: string;
  line_account_id: string; line_message_id: string; source_type: string;
  source_id: string; sender_user_id: string; r2_key: string; mime_type: string;
  byte_size: number; sha256: string; replacement_content: string;
}
export interface Inputs { entries: Entry[]; cloudflareToken: string; serviceToken: string; }
export interface Aggregate { frozen_rows: number; ledger_rows: number; ledger_exact_rows: number; rewritten_message_rows: number; fully_matched_rows: number; }
export interface QueryPlan { sql: string; params: string[]; }
export interface Dependencies {
  now: () => number;
  validateLocalState: (head: string) => string;
  loadInputs: (approvedHead: string, b0ReceiptSha256: string, b3ReceiptSha256: string) => Inputs;
  outputDir: string;
  queryD1: (plan: QueryPlan, token: string, expiresAt: number) => Promise<Aggregate>;
  workerRequest: (spec: ExactRequest, expiresAt: number) => Promise<HttpResponse>;
}
export class ReadbackStop extends Error { constructor(readonly code: string) { super(code); } }

function sha256(value: Buffer | string): string { return createHash('sha256').update(value).digest('hex'); }
function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReadbackStop(code);
  return value as Record<string, unknown>;
}
function jsonObject(bytes: Buffer, code: string): Record<string, unknown> {
  try { return object(JSON.parse(bytes.toString('utf8')), code); } catch (error) {
    if (error instanceof ReadbackStop) throw error;
    throw new ReadbackStop(code);
  }
}
function assertPath(path: string, kind: 'file' | 'directory', mode: number): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (kind === 'file' ? !stat.isFile() : !stat.isDirectory()) ||
      (stat.mode & 0o777) !== mode) throw new ReadbackStop(`${kind}_state`);
}
function exactEntries(path: string, names: string[]): void {
  assertPath(path, 'directory', 0o700);
  if (JSON.stringify(readdirSync(path).sort()) !== JSON.stringify([...names].sort())) {
    throw new ReadbackStop('anchor_entries');
  }
}
function parseOneToken(text: string, name: string): string {
  const values = text.split(/\r?\n/).map((line) => line.trim())
    .filter((line) => line.startsWith(`${name}=`)).map((line) => line.slice(name.length + 1));
  if (values.length !== 1) throw new ReadbackStop('token_count');
  let value = values[0];
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    value = value.slice(1, -1);
  }
  if (!value || /[\0\r\n]/.test(value)) throw new ReadbackStop('token_format');
  return value;
}

export function validateCompletedReceipts(
  b0Value: unknown, b3Value: unknown, approvedHead: string, credential: Record<string, unknown>,
): void {
  const b0 = object(b0Value, 'b0_receipt_shape');
  const b0Credential = object(b0.credential, 'b0_receipt_shape');
  const b0Counts = object(b0.request_counts, 'b0_receipt_shape');
  if (b0.approval_id !== '5229-B0-20260903' || b0.approval_received !== APPROVAL_RECEIVED ||
      b0.approval_expires !== APPROVAL_EXPIRES || b0.approved_harness_head !== approvedHead ||
      b0.status !== 'completed' || b0Credential.credential_id !== credential.credential_id ||
      b0Credential.scope !== 'incoming_media_read' || b0Credential.not_before !== credential.not_before ||
      b0Credential.expires_at !== credential.expires_at || b0Credential.created_at !== credential.created_at ||
      b0Credential.revoked !== false || b0Credential.account_match !== true ||
      b0Counts.d1_query_post !== 2 || b0Counts.provider_total !== 2 ||
      b0Counts.provider_write_batches !== 1 || b0Counts.inserted_rows !== 1 ||
      b0Counts.retry !== 0 || b0Counts.redirect !== 0 || b0.mutation_stage !== 'readback_verified' ||
      b0.mutation_outcome !== 'accepted' || b0.reconciliation_required !== false) {
    throw new ReadbackStop('b0_receipt_state');
  }
  const b3 = object(b3Value, 'b3_receipt_shape');
  const b3Counts = object(b3.counts, 'b3_receipt_shape');
  const b3Result = object(b3.result, 'b3_receipt_shape');
  const b3Requests = object(b3.request_counts, 'b3_receipt_shape');
  const b3Anchors = object(b3.anchors, 'b3_receipt_shape');
  if (b3.approval_id !== '5229-B3-20260903' || b3.approval_received !== APPROVAL_RECEIVED ||
      b3.approval_expires !== APPROVAL_EXPIRES || b3.approved_harness_head !== approvedHead ||
      b3.status !== 'completed' || b3Counts.entries !== EXPECTED_N || b3Counts.bytes !== EXPECTED_B ||
      b3Counts.preflight_expectations !== EXPECTED_N * 2 || b3Counts.apply_operations !== EXPECTED_N * 4 ||
      b3Counts.readback_expectations !== EXPECTED_N * 2 || b3Result.preflight_passed !== EXPECTED_N * 2 ||
      b3Result.ledger_inserted !== EXPECTED_N || b3Result.messages_rewritten !== EXPECTED_N ||
      b3Result.readback_passed !== EXPECTED_N * 2 || b3Requests.d1_query_post !== 3 ||
      b3Requests.provider_total !== 3 || b3Requests.provider_write_batches !== 1 || b3Requests.retry !== 0 ||
      b3.rollback_required !== false || b3Anchors.manifest_raw_sha256 !== FILE_ANCHORS[6][1]) {
    throw new ReadbackStop('b3_receipt_state');
  }
}

export function loadInputs(approvedHead: string, b0ReceiptSha256: string, b3ReceiptSha256: string): Inputs {
  exactEntries(B0_DIR, ['apply.sql', 'credential.env', 'manifest.json']);
  exactEntries(B0_RECEIPT_DIR, ['sanitized-summary.json']);
  exactEntries(B3_RECEIPT_DIR, ['sanitized-summary.json']);
  exactEntries(MANIFEST_DIR, ['incoming-media-backfill-manifest.json']);
  exactEntries(PLAN_DIR, ['apply.json', 'preflight.json', 'purge.json', 'readback.json', 'rollback.json']);
  for (const path of [B2_DIR, B1_DIR, V1_DIR]) exactEntries(path, ['sanitized-summary.json']);
  const anchored = new Map<string, Buffer>();
  for (const [path, hash] of FILE_ANCHORS) {
    assertPath(path, 'file', 0o600);
    const bytes = readFileSync(path);
    if (sha256(bytes) !== hash) throw new ReadbackStop('anchor_hash');
    anchored.set(path, bytes);
  }
  const readApprovedReceipt = (path: string, hash: string, code: string): Record<string, unknown> => {
    assertPath(path, 'file', 0o600);
    const bytes = readFileSync(path);
    if (sha256(bytes) !== hash) throw new ReadbackStop(`${code}_hash`);
    return jsonObject(bytes, `${code}_json`);
  };
  const b0Receipt = readApprovedReceipt(B0_RECEIPT_FILE, b0ReceiptSha256, 'b0_receipt');
  const b3Receipt = readApprovedReceipt(B3_RECEIPT_FILE, b3ReceiptSha256, 'b3_receipt');
  assertPath(TOKEN_FILE, 'file', 0o600);
  const cloudflareToken = parseOneToken(readFileSync(TOKEN_FILE, 'utf8'), 'CLOUDFLARE_API_TOKEN');
  const serviceToken = parseOneToken(anchored.get(`${B0_DIR}/credential.env`)!.toString('utf8'),
    'LINE_ACCOUNTING_HARNESS_MEDIA_READ_CREDENTIAL');
  const credential = jsonObject(anchored.get(`${B0_DIR}/manifest.json`)!, 'credential_json');
  if (credential.scope !== 'incoming_media_read' || credential.token_sha256 !== sha256(serviceToken) ||
      typeof credential.line_account_id !== 'string') throw new ReadbackStop('credential_anchor');
  validateCompletedReceipts(b0Receipt, b3Receipt, approvedHead, credential);
  const manifest = jsonObject(anchored.get(MANIFEST_FILE)!, 'manifest_json') as {
    verified?: unknown; worker_url?: unknown; backfill_at?: unknown; entries?: unknown[];
  };
  if (manifest.verified !== true || manifest.worker_url !== `https://${WORKER_HOST}` ||
      typeof manifest.backfill_at !== 'string' || !Array.isArray(manifest.entries) ||
      manifest.entries.length !== EXPECTED_N) throw new ReadbackStop('manifest_shape');
  let total = 0;
  const entries = manifest.entries.map((raw) => {
    const row = raw as Record<string, unknown>;
    const strings = ['incoming_media_id', 'messages_log_id', 'messages_log_created_at', 'line_account_id',
      'line_message_id', 'source_type', 'source_id', 'sender_user_id', 'r2_key', 'mime_type', 'sha256'];
    if (strings.some((key) => typeof row[key] !== 'string' || !(row[key] as string)) ||
        row.source_type !== 'user' || row.mime_type !== 'image/jpeg' ||
        typeof row.byte_size !== 'number' || !Number.isSafeInteger(row.byte_size) || row.byte_size <= 0 ||
        !/^[0-9a-f]{64}$/.test(row.sha256 as string)) throw new ReadbackStop('manifest_entry');
    total += row.byte_size as number;
    const url = `https://${WORKER_HOST}/api/incoming-media/${encodeURIComponent(row.line_account_id as string)}/${encodeURIComponent(row.line_message_id as string)}/content`;
    return { ...row, replacement_content: JSON.stringify({ originalContentUrl: url, previewImageUrl: url }) } as unknown as Entry;
  });
  if (total !== EXPECTED_B || new Set(entries.map((row) => row.messages_log_id)).size !== EXPECTED_N ||
      new Set(entries.map((row) => row.incoming_media_id)).size !== EXPECTED_N ||
      entries.some((row) => row.line_account_id !== credential.line_account_id)) {
    throw new ReadbackStop('manifest_aggregate');
  }
  return { entries, cloudflareToken, serviceToken };
}

export function validateLocalState(head: string): string {
  if (!/^[0-9a-f]{40}$/.test(head)) throw new ReadbackStop('approved_head');
  const git = (worktree: string, args: string[]) =>
    execFileSync('git', ['-C', worktree, ...args], { encoding: 'utf8' }).trim();
  if (git(WORKTREE, ['rev-parse', 'HEAD']) !== head) throw new ReadbackStop('head_drift');
  if (git(WORKTREE, ['status', '--porcelain', '--untracked-files=all']) !== '') throw new ReadbackStop('worktree_dirty');
  if (git(ACCOUNTING_WORKTREE, ['rev-parse', 'HEAD']) !== ACCOUNTING_HEAD ||
      git(ACCOUNTING_WORKTREE, ['status', '--porcelain', '--untracked-files=all']) !== '') {
    throw new ReadbackStop('accounting_state');
  }
  for (const path of [EXECUTOR_FILE, TEST_FILE]) assertPath(path, 'file', 0o644);
  return head;
}
export function validateApproval(received: string, expires: string, now: number): void {
  if (received !== APPROVAL_RECEIVED || expires !== APPROVAL_EXPIRES) throw new ReadbackStop('approval_identity');
  if (now < Date.parse(received) || now >= Date.parse(expires)) throw new ReadbackStop('approval_inactive');
}
export function parseArgs(raw: string[]): { preflight: boolean; received: string; expires: string; head: string; b0ReceiptSha256: string; b3ReceiptSha256: string } {
  const validSha = (value: string | undefined): value is string => Boolean(value && /^[0-9a-f]{64}$/.test(value));
  if (raw.length === 7 && raw[0] === '--preflight-only' && raw[1] === '--approved-harness-head' && raw[2] &&
      raw[3] === '--approved-b0-receipt-sha256' && validSha(raw[4]) &&
      raw[5] === '--approved-b3-receipt-sha256' && validSha(raw[6])) {
    return { preflight: true, received: '', expires: '', head: raw[2], b0ReceiptSha256: raw[4], b3ReceiptSha256: raw[6] };
  }
  if (raw.length === 10 && raw[0] === '--approval-received' && raw[2] === '--approval-expires' &&
      raw[4] === '--approved-harness-head' && raw[1] && raw[3] && raw[5] &&
      raw[6] === '--approved-b0-receipt-sha256' && validSha(raw[7]) &&
      raw[8] === '--approved-b3-receipt-sha256' && validSha(raw[9])) {
    return { preflight: false, received: raw[1], expires: raw[3], head: raw[5], b0ReceiptSha256: raw[7], b3ReceiptSha256: raw[9] };
  }
  throw new ReadbackStop('arguments');
}

export function buildQueryPlan(entries: Entry[]): QueryPlan {
  const params = [JSON.stringify(entries)];
  const sql = `WITH frozen AS (
  SELECT json_extract(value,'$.incoming_media_id') AS media_id,
    json_extract(value,'$.messages_log_id') AS message_id,
    json_extract(value,'$.line_account_id') AS account_id,
    json_extract(value,'$.line_message_id') AS line_message_id,
    json_extract(value,'$.source_type') AS source_type,
    json_extract(value,'$.source_id') AS source_id,
    json_extract(value,'$.sender_user_id') AS sender_user_id,
    json_extract(value,'$.r2_key') AS r2_key,
    json_extract(value,'$.mime_type') AS mime_type,
    json_extract(value,'$.byte_size') AS byte_size,
    json_extract(value,'$.sha256') AS sha256,
    json_extract(value,'$.messages_log_created_at') AS created_at,
    json_extract(value,'$.replacement_content') AS replacement_content
  FROM json_each(?)
), matched AS (
  SELECT f.*, im.id AS live_media_id, im.line_account_id AS live_account_id,
    im.line_message_id AS live_line_message_id, im.source_type AS live_source_type,
    im.source_id AS live_source_id, im.sender_user_id AS live_sender_user_id,
    im.r2_key AS live_r2_key, im.mime_type AS live_mime_type, im.byte_size AS live_byte_size,
    im.sha256 AS live_sha256, im.status AS live_status, im.stored_at, im.created_at AS live_created_at,
    im.updated_at, ml.id AS live_message_id, ml.content AS live_content
  FROM frozen f LEFT JOIN incoming_media im ON im.id=f.media_id
  LEFT JOIN messages_log ml ON ml.id=f.message_id
)
SELECT COUNT(*) AS frozen_rows,
  SUM(live_media_id IS NOT NULL) AS ledger_rows,
  SUM(live_media_id=media_id AND live_account_id=account_id AND live_line_message_id=line_message_id
    AND live_source_type=source_type AND live_source_id=source_id AND live_sender_user_id=sender_user_id
    AND live_r2_key=r2_key AND live_mime_type=mime_type AND live_byte_size=byte_size
    AND live_sha256=sha256 AND live_status='stored' AND stored_at='2026-09-01T03:20:58.688Z'
    AND live_created_at=created_at AND updated_at='2026-09-01T03:20:58.688Z') AS ledger_exact_rows,
  SUM(live_message_id=message_id AND live_content=replacement_content) AS rewritten_message_rows,
  SUM(live_media_id=media_id AND live_message_id=message_id AND live_content=replacement_content
    AND live_account_id=account_id AND live_line_message_id=line_message_id AND live_r2_key=r2_key
    AND live_mime_type=mime_type AND live_byte_size=byte_size AND live_sha256=sha256
    AND live_status='stored') AS fully_matched_rows FROM matched`;
  return { sql, params };
}
export function validateAggregate(value: unknown): Aggregate {
  const fields: (keyof Aggregate)[] = ['frozen_rows', 'ledger_rows', 'ledger_exact_rows', 'rewritten_message_rows', 'fully_matched_rows'];
  const row = value as Record<string, unknown> | null;
  if (!row || fields.some((key) => row[key] !== EXPECTED_N)) throw new ReadbackStop('d1_aggregate');
  return Object.fromEntries(fields.map((key) => [key, EXPECTED_N])) as unknown as Aggregate;
}

export async function queryD1(plan: QueryPlan, token: string, expiresAt: number): Promise<Aggregate> {
  const body = Buffer.from(JSON.stringify({ sql: plan.sql, params: plan.params }));
  const response = await exactHttpsRequest({ hostname: 'api.cloudflare.com', method: 'POST',
    path: `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      'Accept-Encoding': 'identity', 'Content-Length': body.length }, body, maxBytes: MAX_D1_BYTES }, expiresAt);
  if (response.status !== 200 || String(response.headers['content-type'] ?? '').split(';')[0] !== 'application/json' ||
      (response.headers['content-encoding'] !== undefined && response.headers['content-encoding'] !== 'identity')) {
    throw new ReadbackStop('d1_response');
  }
  let parsed: { success?: unknown; result?: Array<{ success?: unknown; results?: unknown[] }> };
  try { parsed = JSON.parse(response.body.toString('utf8')) as typeof parsed; } catch { throw new ReadbackStop('d1_json'); }
  if (parsed.success !== true || parsed.result?.length !== 1 || parsed.result[0].success !== true ||
      parsed.result[0].results?.length !== 1) throw new ReadbackStop('d1_shape');
  return validateAggregate(parsed.result[0].results[0]);
}

function header(response: HttpResponse, name: string): string {
  const value = response.headers[name]; return typeof value === 'string' ? value : '';
}
export function validateMedia(response: HttpResponse, entry: Entry, head: boolean): void {
  if (response.status !== 200 || header(response, 'content-type').split(';')[0] !== entry.mime_type ||
      header(response, 'content-length') !== String(entry.byte_size) ||
      header(response, 'x-content-sha256') !== entry.sha256 || header(response, 'cache-control') !== 'private, no-store' ||
      !['', 'identity'].includes(header(response, 'content-encoding'))) {
    throw new ReadbackStop('media_response');
  }
  if (head) {
    if (response.body.length !== 0) throw new ReadbackStop('head_body');
    return;
  }
  const body = response.body;
  if (body.length !== entry.byte_size || sha256(body) !== entry.sha256 || body.length < 5 ||
      body[0] !== 0xff || body[1] !== 0xd8 || body[2] !== 0xff ||
      body[body.length - 2] !== 0xff || body[body.length - 1] !== 0xd9) throw new ReadbackStop('media_integrity');
}
function validateDenial(response: HttpResponse, status: number, empty: boolean): void {
  if (response.status !== status || !['', 'identity'].includes(header(response, 'content-encoding')) ||
      (empty && response.body.length !== 0)) throw new ReadbackStop('auth_matrix');
}

type Identity = { dev: number; ino: number };
function createOutput(path: string): Identity {
  if (existsSync(path)) throw new ReadbackStop('output_exists');
  mkdirSync(path, { mode: 0o700 }); assertPath(path, 'directory', 0o700);
  const stat = lstatSync(path); return { dev: stat.dev, ino: stat.ino };
}
function writeSummary(path: string, identity: Identity, value: unknown): void {
  const stat = lstatSync(path);
  if (stat.dev !== identity.dev || stat.ino !== identity.ino || readdirSync(path).length !== 0) throw new ReadbackStop('output_drift');
  const file = `${path}/sanitized-summary.json`;
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  assertPath(file, 'file', 0o600);
  const after = lstatSync(path);
  if (after.dev !== identity.dev || after.ino !== identity.ino ||
      JSON.stringify(readdirSync(path)) !== JSON.stringify(['sanitized-summary.json'])) throw new ReadbackStop('output_drift');
}
function reason(error: unknown): string { return error instanceof ReadbackStop ? error.code : 'provider_or_local_error'; }

export async function run(raw: string[], deps: Dependencies): Promise<Record<string, unknown>> {
  const args = parseArgs(raw);
  const head = deps.validateLocalState(args.head);
  if (existsSync(deps.outputDir)) throw new ReadbackStop('output_exists');
  if (!args.preflight) validateApproval(args.received, args.expires, deps.now());
  const inputs = deps.loadInputs(head, args.b0ReceiptSha256, args.b3ReceiptSha256);
  const plan = buildQueryPlan(inputs.entries);
  if (args.preflight) return { approval_id: APPROVAL_ID, status: 'preflight_passed', approved_harness_head: head,
    candidate_count: EXPECTED_N, b0_receipt_sha256: args.b0ReceiptSha256,
    b3_receipt_sha256: args.b3ReceiptSha256, token_count: 2, provider_requests: 0, provider_writes: 0, local_writes: 0 };
  const identity = createOutput(deps.outputDir); const startedAt = new Date(deps.now()).toISOString();
  const expiresAt = Date.parse(args.expires); let d1Reads = 0; let workerReads = 0; let verified = 0;
  try {
    d1Reads += 1;
    const aggregate = await deps.queryD1(plan, inputs.cloudflareToken, expiresAt);
    validateApproval(args.received, args.expires, deps.now()); validateAggregate(aggregate);
    const requestWorker = async (spec: ExactRequest): Promise<HttpResponse> => {
      validateApproval(args.received, args.expires, deps.now());
      if (spec.hostname !== WORKER_HOST || !['GET', 'HEAD'].includes(spec.method) || spec.body !== undefined) throw new ReadbackStop('request_scope');
      workerReads += 1; if (workerReads > EXPECTED_WORKER_READS) throw new ReadbackStop('request_count');
      const response = await deps.workerRequest(spec, expiresAt);
      validateApproval(args.received, args.expires, deps.now()); return response;
    };
    const first = inputs.entries[0]; const base = `/api/incoming-media/${encodeURIComponent(first.line_account_id)}/${encodeURIComponent(first.line_message_id)}`;
    const auth = { Authorization: `Bearer ${inputs.serviceToken}`, 'Accept-Encoding': 'identity' };
    validateDenial(await requestWorker({ hostname: WORKER_HOST, method: 'HEAD', path: base, headers: { 'Accept-Encoding': 'identity' }, maxBytes: 1024 }), 401, true);
    const invalid = `${inputs.serviceToken.slice(0, -1)}${inputs.serviceToken.endsWith('0') ? '1' : '0'}`;
    validateDenial(await requestWorker({ hostname: WORKER_HOST, method: 'HEAD', path: base, headers: { Authorization: `Bearer ${invalid}`, 'Accept-Encoding': 'identity' }, maxBytes: 1024 }), 401, true);
    const cross = `/api/incoming-media/cross-account-probe-5229/${encodeURIComponent(first.line_message_id)}`;
    validateDenial(await requestWorker({ hostname: WORKER_HOST, method: 'HEAD', path: cross, headers: auth, maxBytes: 1024 }), 404, true);
    validateDenial(await requestWorker({ hostname: WORKER_HOST, method: 'GET', path: '/api/friends', headers: auth, maxBytes: 4096 }), 401, false);
    for (const entry of inputs.entries) {
      const metadata = `/api/incoming-media/${encodeURIComponent(entry.line_account_id)}/${encodeURIComponent(entry.line_message_id)}`;
      validateMedia(await requestWorker({ hostname: WORKER_HOST, method: 'HEAD', path: metadata, headers: auth, maxBytes: 1024 }), entry, true);
      validateMedia(await requestWorker({ hostname: WORKER_HOST, method: 'GET', path: `${metadata}/content`, headers: auth, maxBytes: entry.byte_size + 1 }), entry, false);
      verified += 1;
    }
    if (workerReads !== EXPECTED_WORKER_READS || verified !== EXPECTED_N) throw new ReadbackStop('completion_count');
    const summary = { schema_version: 1, approval_id: APPROVAL_ID, approval_received: args.received,
      approval_expires: args.expires, approved_harness_head: head, started_at: startedAt,
      prerequisite_receipts: { b0_sha256: args.b0ReceiptSha256, b3_sha256: args.b3ReceiptSha256 },
      completed_at: new Date(deps.now()).toISOString(), status: 'completed', aggregates: {
        candidate_count: EXPECTED_N, total_bytes: EXPECTED_B, d1_ledger_exact_count: aggregate.ledger_exact_rows,
        rewritten_message_count: aggregate.rewritten_message_rows, authenticated_head_count: verified,
        authenticated_get_count: verified, content_sha256_match_count: verified, jpeg_magic_match_count: verified,
        anonymous_401_count: 1, invalid_credential_401_count: 1, cross_account_404_count: 1,
        unrelated_route_401_count: 1 }, request_counts: { d1_select_post: d1Reads,
        worker_head: EXPECTED_N + 3, worker_get: EXPECTED_N + 1, provider_total: d1Reads + workerReads,
        retry: 0, redirect: 0, provider_write: 0, r2_direct: 0, local_file_write: 1 } };
    writeSummary(deps.outputDir, identity, summary); return summary;
  } catch (error) {
    const stop = reason(error);
    try { writeSummary(deps.outputDir, identity, { schema_version: 1, approval_id: APPROVAL_ID,
      approval_received: args.received, approval_expires: args.expires, approved_harness_head: head,
      prerequisite_receipts: { b0_sha256: args.b0ReceiptSha256, b3_sha256: args.b3ReceiptSha256 },
      started_at: startedAt, completed_at: new Date(deps.now()).toISOString(), status: 'stopped', stop_reason: stop,
      verified_count: verified, request_counts: { d1_select_post: d1Reads, worker_read: workerReads,
        provider_total: d1Reads + workerReads, retry: 0, redirect: 0, provider_write: 0, r2_direct: 0, local_file_write: 1 } }); } catch { /* never repair contaminated output */ }
    throw new ReadbackStop(stop);
  }
}

const defaults: Dependencies = { now: Date.now, validateLocalState, loadInputs, outputDir: OUTPUT_DIR,
  queryD1, workerRequest: (spec, expiresAt) => exactHttpsRequest(spec, expiresAt) };
const isCli = (() => { try { return Boolean(argv[1]) && fileURLToPath(import.meta.url) === argv[1]; } catch { return false; } })();
if (isCli) run(argv.slice(2), defaults).then((value) => stdout.write(`${JSON.stringify(value)}\n`)).catch((error) => {
  stdout.write(`${JSON.stringify({ approval_id: APPROVAL_ID, status: 'stopped', stop_reason: reason(error), provider_writes: 0, retry: 0 })}\n`); exit(1);
});
