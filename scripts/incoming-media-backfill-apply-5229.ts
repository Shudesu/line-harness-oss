#!/usr/bin/env tsx
/** Exact approval-bound D1-only historical backfill executor for #5229 B3. */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request, type RequestOptions } from 'node:https';
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { argv, exit, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildIncomingMediaMigrationArtifacts } from './incoming-media-migration-plan.js';

export const APPROVAL_ID = '5229-B3-20260903';
export const APPROVAL_RECEIVED = '2026-09-03T05:51:46.737Z';
export const APPROVAL_EXPIRES = '2026-09-03T07:51:46.737Z';
export const HARNESS_PARENT_HEAD = 'fb2d6bb8e32b32bca9e3b9bff29d62acc53d39ee';
const ACCOUNT_ID = '67907592fdf596376bc2097e14a6563a';
const DATABASE_ID = 'c19584d7-e9f1-4d46-83c5-6c0ba96561d1';
const WORKTREE = '/Users/kensmba/.line-harness-wt/5229-private-incoming-media';
const TOKEN_FILE = '/Users/kensmba/.line-harness/.env.local';
export const OUTPUT_DIR = '/Users/kensmba/.line-harness-5229-B3-20260903';
const MAX_RESPONSE_BYTES = 262_144;
const EXPECTED_N = 77;
const EXPECTED_B = 27_625_839;

const FILES = {
  b1Receipt: ['/Users/kensmba/.line-harness-5229-B1-R1-20260903/sanitized-summary.json', 'a3f5e2c411f5b8656427f363549d5ed0952da3937a1c47e47185ea78faa3f785'],
  v1Receipt: ['/Users/kensmba/.line-harness-5229-B1-V1-20260903/sanitized-summary.json', '5e3dcbf0a5ae7b5e883788cfa7ce87f9bb411fa1935d885ae2bb10a2f769d3a6'],
  b2Receipt: ['/Users/kensmba/.line-harness-5229-B2-20260901/sanitized-summary.json', '5f393930c545582d656c0068ee1d854a01ef8d60e66e1d04e4dca49a0beda95f'],
  manifest: ['/Users/kensmba/.line-harness-5229-M0-20260901/incoming-media-backfill-manifest.json', 'cf35a1045040a265019a5afad8c2cefb8994edba684eeaa5dd2fad0b17b1663e'],
  preflight: ['/Users/kensmba/.line-harness-5229-M0-PLAN-20260901/preflight.json', 'cf6d513dc2712192f5739b90cf50212aae80d3cb5684b6065af6bae1921af077'],
  apply: ['/Users/kensmba/.line-harness-5229-M0-PLAN-20260901/apply.json', '38d616248dfce3db08f4340817278758445d574b9d405e29b4def5e066e974ce'],
  rollback: ['/Users/kensmba/.line-harness-5229-M0-PLAN-20260901/rollback.json', '4b77fd9c7dfada52d2b6746f054d6205840bb3f1d8da7978e8e7bdab32dd785e'],
  purge: ['/Users/kensmba/.line-harness-5229-M0-PLAN-20260901/purge.json', '3fb15f8bee9135e4459b82f69df04f1df2b0fb7933b83ea6dee8f876a66c65f1'],
  readback: ['/Users/kensmba/.line-harness-5229-M0-PLAN-20260901/readback.json', '7716f07a95ac9aad488cc7fbe3602328599f9afd78b4769dafeaab7e0b1ed59e'],
  b1Artifact: ['/Users/kensmba/.line-harness-5229-B1-R1-BUILD-20260903/apps/worker/dist-release-final/index.js', '07dcc5ef5504bf2ae70286fad2d356444beb7626f6d64faa920ea7b3c33b19c1'],
} as const;

const DIRECTORY_ENTRIES: Record<string, string[]> = {
  '/Users/kensmba/.line-harness-5229-B1-R1-20260903': ['sanitized-summary.json'],
  '/Users/kensmba/.line-harness-5229-B1-V1-20260903': ['sanitized-summary.json'],
  '/Users/kensmba/.line-harness-5229-B2-20260901': ['sanitized-summary.json'],
  '/Users/kensmba/.line-harness-5229-M0-20260901': ['incoming-media-backfill-manifest.json'],
  '/Users/kensmba/.line-harness-5229-M0-PLAN-20260901': ['apply.json', 'preflight.json', 'purge.json', 'readback.json', 'rollback.json'],
  '/Users/kensmba/.line-harness-5229-B1-R1-BUILD-20260903': ['apps'],
  '/Users/kensmba/.line-harness-5229-B1-R1-BUILD-20260903/apps': ['worker'],
  '/Users/kensmba/.line-harness-5229-B1-R1-BUILD-20260903/apps/worker': ['dist-release-final'],
  '/Users/kensmba/.line-harness-5229-B1-R1-BUILD-20260903/apps/worker/dist-release-final': ['index.js'],
};

export interface D1Statement { sql: string; params?: Array<string | number | null> }
export interface D1BatchBody { batch: D1Statement[] }
export interface D1HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}
export type RequestFunction = (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;

interface PlanOperation {
  name: string;
  sql: string;
  expected_rows?: number;
  expected_changes?: number;
}
interface Plan { mode: string; manifest_sha256: string; entry_count: number; operations: PlanOperation[] }
interface ManifestEntry {
  incoming_media_id: string; messages_log_id: string; messages_log_created_at: string;
  line_account_id: string; line_message_id: string; source_type: 'user'; source_id: string;
  sender_user_id: string; r2_key: string; mime_type: string; byte_size: number; sha256: string;
  messages_log_content_preimage: string;
}
interface Manifest {
  schema_version: 1; issue: 5229; verified: true; worker_url: string; backfill_at: string;
  provenance_basis: 'legacy_user_path_reconstruction'; raw_event_snapshot: false; entries: ManifestEntry[];
}

export interface PinnedInput { manifest: Manifest; preflight: Plan; apply: Plan }
export interface RunDependencies {
  now: () => number;
  validateLocalState: (approvedHead: string) => PinnedInput;
  loadToken: () => string;
  outputDir: string;
  post: (body: D1BatchBody, token: string, expiresAt: number) => Promise<D1HttpResponse>;
}

export class BackfillStop extends Error {
  constructor(readonly code: string) { super(code); }
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const row = value as Record<string, unknown>;
    return `{${Object.keys(row).sort().map((key) => `${JSON.stringify(key)}:${stable(row[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BackfillStop(code);
  return value as Record<string, unknown>;
}

function assertRealPath(path: string, kind: 'directory' | 'file', mode: number): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) ||
      (stat.mode & 0o777) !== mode) throw new BackfillStop(`${kind}_state`);
}

function checkedBytes(spec: readonly [string, string]): Buffer {
  assertRealPath(spec[0], 'file', 0o600);
  const bytes = readFileSync(spec[0]);
  if (sha256(bytes) !== spec[1]) throw new BackfillStop('artifact_hash');
  return bytes;
}

function checkedJson(spec: readonly [string, string]): Record<string, unknown> {
  const bytes = checkedBytes(spec);
  try { return object(JSON.parse(bytes.toString('utf8')), 'artifact_shape'); }
  catch (error) { if (error instanceof BackfillStop) throw error; throw new BackfillStop('artifact_json'); }
}

export function validateB1Receipt(value: unknown): void {
  const row = object(value, 'b1_receipt_shape');
  const counts = object(row.request_counts, 'b1_receipt_shape');
  const mutation = object(row.mutation, 'b1_receipt_shape');
  if (row.approval_id !== '5229-B1-R1-20260903' || row.status !== 'stopped' ||
      row.stop_reason !== 'settingsSha256_changed' || mutation.stage !== 'post_write_readback' ||
      mutation.outcome !== 'accepted' || mutation.put_attempts !== 1 || row.rollback_required !== true ||
      counts.cloudflare_read !== 19 || counts.worker_content_put !== 1 || counts.provider_total !== 21 || counts.retry !== 0) {
    throw new BackfillStop('b1_receipt_state');
  }
}

export function validateV1Receipt(value: unknown): void {
  const row = object(value, 'v1_receipt_shape');
  const deployment = object(row.deployment, 'v1_receipt_shape');
  const settings = object(row.settings_context, 'v1_receipt_shape');
  const semantics = object(row.version_semantics, 'v1_receipt_shape');
  const runtime = object(row.runtime, 'v1_receipt_shape');
  const counts = object(row.request_counts, 'v1_receipt_shape');
  if (row.approval_id !== '5229-B1-V1-20260903' || row.approval_received !== APPROVAL_RECEIVED ||
      row.approval_expires !== APPROVAL_EXPIRES || row.approved_harness_head !== HARNESS_PARENT_HEAD ||
      row.status !== 'completed' || row.prior_stop_receipt_sha256 !== FILES.b1Receipt[1] ||
      deployment.traffic_percentage !== 100 || deployment.terminal_active_unchanged !== true ||
      settings.classification !== 'bounded_current_config_anchors_and_version_resources_equal' ||
      semantics.resources_equal !== true || semantics.bindings_equal !== true || semantics.binding_count !== 20 ||
      runtime.version !== '0.19.0-5229.b1.9f3c6c3' ||
      runtime.worker_hash !== 'sha256:6420c520444baa670973197f6c336b23a511e9dcd8fdbdf24082b61ce24c2b1e' ||
      runtime.private_unauthenticated_head !== 401 || runtime.private_empty_body !== true ||
      runtime.legacy_public_head !== 200 || runtime.legacy_empty_body !== true ||
      counts.cloudflare_get !== 8 || counts.runtime_read !== 3 || counts.provider_total !== 11 ||
      counts.provider_write !== 0 || counts.transport_retry !== 0 ||
      row.disposition !== 'accept_candidate_no_rollback' || row.automatic_rollback !== 0) {
    throw new BackfillStop('v1_receipt_state');
  }
}

export function validateB2Receipt(value: unknown): void {
  const row = object(value, 'b2_receipt_shape');
  const counts = object(row.request_counts, 'b2_receipt_shape');
  const readback = object(row.readback, 'b2_receipt_shape');
  if (row.approval_id !== '5229-B2-20260901' || row.status !== 'completed' ||
      stable(readback.tables) !== stable(['incoming_media', 'incoming_media_service_credentials']) ||
      stable(readback.indexes) !== stable(['idx_incoming_media_status_updated', 'idx_incoming_media_service_credentials_account_active']) ||
      counts.d1_query_post !== 2 || counts.provider_total !== 2 || counts.provider_write_batches !== 1 || counts.retry !== 0) {
    throw new BackfillStop('b2_receipt_state');
  }
}

export function validatePlanArtifacts(manifest: unknown, preflight: unknown, apply: unknown): PinnedInput {
  const generated = buildIncomingMediaMigrationArtifacts(manifest);
  if (sha256(generated['preflight.json']) !== FILES.preflight[1] ||
      sha256(generated['apply.json']) !== FILES.apply[1] || sha256(generated['rollback.json']) !== FILES.rollback[1] ||
      sha256(generated['purge.json']) !== FILES.purge[1] || sha256(generated['readback.json']) !== FILES.readback[1]) {
    throw new BackfillStop('plan_regeneration_hash');
  }
  const manifestRow = object(manifest, 'manifest_shape') as unknown as Manifest;
  const preflightRow = object(preflight, 'preflight_shape') as unknown as Plan;
  const applyRow = object(apply, 'apply_shape') as unknown as Plan;
  if (manifestRow.entries.length !== EXPECTED_N ||
      manifestRow.entries.reduce((sum, entry) => sum + entry.byte_size, 0) !== EXPECTED_B ||
      preflightRow.mode !== 'read-only' || preflightRow.entry_count !== EXPECTED_N ||
      preflightRow.manifest_sha256 !== 'e50d8a0f10b15fba61d98860bf761587e34958a5b07b2c0ea4cdac9cbd2afe69' ||
      preflightRow.operations.length !== EXPECTED_N * 2 ||
      applyRow.mode !== 'external-write-requires-KEN-approval' || applyRow.entry_count !== EXPECTED_N ||
      applyRow.manifest_sha256 !== preflightRow.manifest_sha256 || applyRow.operations.length !== EXPECTED_N * 4) {
    throw new BackfillStop('plan_contract');
  }
  for (const operation of preflightRow.operations) {
    if (typeof operation.sql !== 'string' || operation.expected_rows === undefined || operation.expected_changes !== undefined ||
        !/^SELECT\b/i.test(operation.sql.trim())) throw new BackfillStop('preflight_operation');
  }
  for (let index = 0; index < applyRow.operations.length; index += 4) {
    const operations = applyRow.operations.slice(index, index + 4);
    if (operations[0]?.expected_changes !== 1 || operations[1]?.expected_rows !== 1 ||
        operations[2]?.expected_changes !== 1 || operations[3]?.expected_rows !== 1 ||
        !/^INSERT\b/i.test(operations[0].sql.trim()) || !/^SELECT\b/i.test(operations[1].sql.trim()) ||
        !/^UPDATE\b/i.test(operations[2].sql.trim()) || !/^SELECT\b/i.test(operations[3].sql.trim())) {
      throw new BackfillStop('apply_operation');
    }
  }
  return { manifest: manifestRow, preflight: preflightRow, apply: applyRow };
}

export function validateLocalState(approvedHead: string): PinnedInput {
  if (!/^[a-f0-9]{40}$/.test(approvedHead)) throw new BackfillStop('approved_head');
  const git = (args: string[]): string => execFileSync('git', ['-C', WORKTREE, ...args], { encoding: 'utf8' }).trim();
  if (git(['rev-parse', 'HEAD']) !== approvedHead) throw new BackfillStop('head_drift');
  if (git(['status', '--porcelain', '--untracked-files=all']) !== '') throw new BackfillStop('worktree_drift');
  for (const path of ['scripts/incoming-media-backfill-apply-5229.ts', 'scripts/incoming-media-backfill-apply-5229.test.ts']) {
    assertRealPath(`${WORKTREE}/${path}`, 'file', 0o644);
  }
  for (const [directory, entries] of Object.entries(DIRECTORY_ENTRIES)) {
    assertRealPath(directory, 'directory', 0o700);
    if (stable(readdirSync(directory).sort()) !== stable([...entries].sort())) throw new BackfillStop('artifact_entries');
  }
  validateB1Receipt(checkedJson(FILES.b1Receipt));
  validateV1Receipt(checkedJson(FILES.v1Receipt));
  validateB2Receipt(checkedJson(FILES.b2Receipt));
  checkedBytes(FILES.b1Artifact);
  const manifestBytes = checkedBytes(FILES.manifest);
  const planBytes = Object.fromEntries(['preflight', 'apply', 'rollback', 'purge', 'readback'].map((name) =>
    [name, checkedBytes(FILES[name as keyof Pick<typeof FILES, 'preflight' | 'apply' | 'rollback' | 'purge' | 'readback'>])])) as Record<string, Buffer>;
  const parse = (bytes: Buffer): unknown => { try { return JSON.parse(bytes.toString('utf8')); } catch { throw new BackfillStop('artifact_json'); } };
  const pinned = validatePlanArtifacts(parse(manifestBytes), parse(planBytes.preflight), parse(planBytes.apply));
  if (sha256(generatedText(pinned.preflight)) !== FILES.preflight[1] || sha256(generatedText(pinned.apply)) !== FILES.apply[1]) {
    throw new BackfillStop('plan_raw_mismatch');
  }
  return pinned;
}

function generatedText(value: unknown): string { return `${JSON.stringify(value, null, 2)}\n`; }

export function parseTokenFile(text: string): string {
  const values: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^CLOUDFLARE_API_TOKEN=(.*)$/.exec(line);
    if (!match) { if (line.startsWith('CLOUDFLARE_API_TOKEN')) throw new BackfillStop('token_format'); continue; }
    let value = match[1];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (!value || /[\0\r\n]/.test(value)) throw new BackfillStop('token_format');
    values.push(value);
  }
  if (values.length !== 1) throw new BackfillStop('token_count');
  return values[0];
}

export function loadToken(): string {
  assertRealPath(TOKEN_FILE, 'file', 0o600);
  return parseTokenFile(readFileSync(TOKEN_FILE, 'utf8'));
}

export function validateApprovalWindow(received: string, expires: string, now: number): void {
  if (received !== APPROVAL_RECEIVED || expires !== APPROVAL_EXPIRES) throw new BackfillStop('approval_identity');
  const start = Date.parse(received);
  const end = Date.parse(expires);
  if (end - start !== 7_200_000) throw new BackfillStop('approval_window');
  if (now < start || now >= end) throw new BackfillStop('approval_inactive');
}

export function parseArgs(raw: string[]): { preflightOnly: boolean; received: string; expires: string; approvedHead: string } {
  if (raw.length === 3 && raw[0] === '--preflight-only' && raw[1] === '--approved-harness-head' && /^[a-f0-9]{40}$/.test(raw[2])) {
    return { preflightOnly: true, received: '', expires: '', approvedHead: raw[2] };
  }
  if (raw.length === 6 && raw[0] === '--approval-received' && raw[1] === APPROVAL_RECEIVED &&
      raw[2] === '--approval-expires' && raw[3] === APPROVAL_EXPIRES && raw[4] === '--approved-harness-head' &&
      /^[a-f0-9]{40}$/.test(raw[5])) {
    return { preflightOnly: false, received: raw[1], expires: raw[3], approvedHead: raw[5] };
  }
  throw new BackfillStop('arguments');
}

export function buildReadbackBatch(manifest: Manifest): D1BatchBody {
  const batch: D1Statement[] = [];
  for (const entry of manifest.entries) {
    const privateUrl = new URL(`/api/incoming-media/${encodeURIComponent(entry.line_account_id)}/${encodeURIComponent(entry.line_message_id)}/content`, manifest.worker_url).toString();
    const replacement = JSON.stringify({ originalContentUrl: privateUrl, previewImageUrl: privateUrl });
    batch.push({
      sql: `SELECT COUNT(*) AS exact_rows FROM incoming_media WHERE id = ? AND line_account_id = ? AND line_message_id = ? AND source_type = ? AND source_id = ? AND sender_user_id = ? AND r2_key = ? AND mime_type = ? AND byte_size = ? AND sha256 = ? AND status = 'stored' AND stored_at = ? AND created_at = ? AND updated_at = ?`,
      params: [entry.incoming_media_id, entry.line_account_id, entry.line_message_id, entry.source_type,
        entry.source_id, entry.sender_user_id, entry.r2_key, entry.mime_type, entry.byte_size, entry.sha256,
        manifest.backfill_at, entry.messages_log_created_at, manifest.backfill_at],
    }, {
      sql: 'SELECT COUNT(*) AS exact_rows FROM messages_log WHERE id = ? AND content = ?',
      params: [entry.messages_log_id, replacement],
    });
  }
  if (batch.length !== EXPECTED_N * 2) throw new BackfillStop('readback_count');
  return { batch };
}

function contentType(response: D1HttpResponse): string {
  const value = response.headers['content-type'];
  return typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : '';
}

interface QueryResult { success?: unknown; results?: unknown[]; meta?: Record<string, unknown> }

function parseEnvelope(response: D1HttpResponse, expected: number): { results: QueryResult[]; cfRay: string | null } {
  if (response.status !== 200) throw new BackfillStop('http_status');
  if (contentType(response) !== 'application/json') throw new BackfillStop('content_type');
  const encoding = response.headers['content-encoding'];
  if (encoding !== undefined && encoding !== 'identity') throw new BackfillStop('content_encoding');
  let value: { success?: unknown; result?: unknown };
  try { value = JSON.parse(response.body.toString('utf8')) as typeof value; } catch { throw new BackfillStop('response_json'); }
  if (value.success !== true || !Array.isArray(value.result) || value.result.length !== expected ||
      value.result.some((item) => !item || typeof item !== 'object' || (item as QueryResult).success !== true ||
        !Array.isArray((item as QueryResult).results))) throw new BackfillStop('response_shape');
  const ray = response.headers['cf-ray'];
  return { results: value.result as QueryResult[], cfRay: typeof ray === 'string' ? ray : null };
}

export function parsePreflightResponse(response: D1HttpResponse, plan: Plan): { cfRay: string | null } {
  const parsed = parseEnvelope(response, plan.operations.length);
  plan.operations.forEach((operation, index) => {
    if (parsed.results[index].results?.length !== operation.expected_rows) throw new BackfillStop('preflight_expectation');
  });
  return { cfRay: parsed.cfRay };
}

export function parseApplyResponse(response: D1HttpResponse, plan: Plan): { cfRay: string | null } {
  const parsed = parseEnvelope(response, plan.operations.length);
  plan.operations.forEach((operation, index) => {
    const result = parsed.results[index];
    if (operation.expected_changes !== undefined) {
      if (!result.meta || result.meta.changes !== operation.expected_changes) throw new BackfillStop('apply_change_count');
    } else if (operation.expected_rows !== undefined) {
      if (stable(result.results) !== stable([{ exact_change_count: 1 }])) throw new BackfillStop('apply_assertion');
    } else throw new BackfillStop('apply_contract');
  });
  return { cfRay: parsed.cfRay };
}

export function parseReadbackResponse(response: D1HttpResponse, expected = EXPECTED_N * 2): { cfRay: string | null } {
  const parsed = parseEnvelope(response, expected);
  for (const result of parsed.results) {
    if (stable(result.results) !== stable([{ exact_rows: 1 }])) throw new BackfillStop('readback_expectation');
  }
  return { cfRay: parsed.cfRay };
}

export async function postD1(bodyValue: D1BatchBody, token: string, expiresAt: number, requestImpl: RequestFunction = request): Promise<D1HttpResponse> {
  const body = Buffer.from(JSON.stringify(bodyValue), 'utf8');
  return await new Promise<D1HttpResponse>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const finish = (value: D1HttpResponse): void => { if (!settled) { settled = true; if (timer) clearTimeout(timer); resolve(value); } };
    const fail = (error: unknown): void => { if (!settled) { settled = true; if (timer) clearTimeout(timer); reject(error); } };
    if (Date.now() >= expiresAt) { fail(new BackfillStop('approval_expired')); return; }
    const req = requestImpl({
      protocol: 'https:', hostname: 'api.cloudflare.com', port: 443, method: 'POST',
      path: `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Accept-Encoding': 'identity', 'Content-Length': body.length },
      agent: false,
    }, (res) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      let stopped = false;
      res.once('error', (error) => { stopped = true; fail(error); });
      res.once('aborted', () => { stopped = true; fail(new BackfillStop('response_aborted')); });
      res.on('readable', () => {
        if (stopped) return;
        let chunk: Buffer | null;
        while ((chunk = res.read(Math.min(16_384, MAX_RESPONSE_BYTES - bytes + 1)) as Buffer | null) !== null) {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) { stopped = true; req.destroy(new BackfillStop('response_oversize')); return; }
          chunks.push(chunk);
        }
      });
      res.on('end', () => { if (!stopped) finish({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }); });
    });
    req.once('error', fail);
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) { req.destroy(new BackfillStop('approval_expired')); return; }
    timer = setTimeout(() => req.destroy(new BackfillStop('approval_expired')), remaining);
    req.end(body);
  });
}

function createOutput(path: string): { dev: number; ino: number } {
  if (existsSync(path)) throw new BackfillStop('output_exists');
  mkdirSync(path, { mode: 0o700 });
  assertRealPath(path, 'directory', 0o700);
  const stat = lstatSync(path);
  if (readdirSync(path).length !== 0) throw new BackfillStop('output_drift');
  return { dev: stat.dev, ino: stat.ino };
}

function writeSummary(path: string, identity: { dev: number; ino: number }, summary: unknown): void {
  const stat = lstatSync(path);
  if (stat.dev !== identity.dev || stat.ino !== identity.ino || readdirSync(path).length !== 0) throw new BackfillStop('output_drift');
  const target = `${path}/sanitized-summary.json`;
  writeFileSync(target, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  assertRealPath(target, 'file', 0o600);
  const after = lstatSync(path);
  if (after.dev !== identity.dev || after.ino !== identity.ino || stable(readdirSync(path)) !== stable(['sanitized-summary.json'])) {
    throw new BackfillStop('output_drift');
  }
}

function safeReason(error: unknown): string { return error instanceof BackfillStop ? error.code : 'provider_or_local_error'; }

export async function run(raw: string[], dependencies?: Partial<RunDependencies>): Promise<Record<string, unknown>> {
  const deps: RunDependencies = {
    now: () => Date.now(), validateLocalState, loadToken, outputDir: OUTPUT_DIR, post: postD1, ...dependencies,
  };
  const args = parseArgs(raw);
  const pinned = deps.validateLocalState(args.approvedHead);
  if (existsSync(deps.outputDir)) throw new BackfillStop('output_exists');
  const token = deps.loadToken();
  const readbackBatch = buildReadbackBatch(pinned.manifest);
  if (args.preflightOnly) return {
    approval_id: APPROVAL_ID, status: 'preflight_passed', approved_harness_head: args.approvedHead,
    harness_parent_head: HARNESS_PARENT_HEAD,
    entry_count: EXPECTED_N, total_bytes: EXPECTED_B, preflight_expectations: pinned.preflight.operations.length,
    apply_operations: pinned.apply.operations.length, readback_expectations: readbackBatch.batch.length,
    token_present: token.length > 0, provider_requests: 0, provider_writes: 0, local_writes: 0,
  };
  validateApprovalWindow(args.received, args.expires, deps.now());
  const identity = createOutput(deps.outputDir);
  const startedAt = new Date(deps.now()).toISOString();
  const expiresAt = Date.parse(args.expires);
  let stage = 'preflight';
  let requests = 0;
  let writeBatches = 0;
  const cfRays: Array<string | null> = [];
  try {
    const post = async (body: D1BatchBody, isWrite = false): Promise<D1HttpResponse> => {
      validateApprovalWindow(args.received, args.expires, deps.now());
      requests += 1;
      if (isWrite) writeBatches += 1;
      const response = await deps.post(body, token, expiresAt);
      validateApprovalWindow(args.received, args.expires, deps.now());
      return response;
    };
    cfRays.push(parsePreflightResponse(await post({ batch: pinned.preflight.operations.map(({ sql }) => ({ sql })) }), pinned.preflight).cfRay);
    stage = 'apply';
    cfRays.push(parseApplyResponse(await post({ batch: pinned.apply.operations.map(({ sql }) => ({ sql })) }, true), pinned.apply).cfRay);
    stage = 'readback';
    cfRays.push(parseReadbackResponse(await post(readbackBatch), readbackBatch.batch.length).cfRay);
    stage = 'completed';
    const summary = {
      schema_version: 1, approval_id: APPROVAL_ID, approval_received: APPROVAL_RECEIVED,
      approval_expires: APPROVAL_EXPIRES, approved_harness_head: args.approvedHead,
      harness_parent_head: HARNESS_PARENT_HEAD, started_at: startedAt,
      completed_at: new Date(deps.now()).toISOString(), status: 'completed',
      anchors: {
        b1_receipt_sha256: FILES.b1Receipt[1], v1_receipt_sha256: FILES.v1Receipt[1],
        b2_receipt_sha256: FILES.b2Receipt[1], manifest_raw_sha256: FILES.manifest[1],
        manifest_canonical_sha256: pinned.apply.manifest_sha256,
        preflight_plan_sha256: FILES.preflight[1], apply_plan_sha256: FILES.apply[1],
      },
      counts: { entries: EXPECTED_N, bytes: EXPECTED_B, preflight_expectations: 154, apply_operations: 308, readback_expectations: 154 },
      result: { preflight_passed: 154, ledger_inserted: 77, messages_rewritten: 77, readback_passed: 154 },
      request_counts: { d1_query_post: requests, provider_total: requests, provider_write_batches: writeBatches, retry: 0 },
      cf_rays: cfRays,
      rollback_required: false,
      forbidden_actions: { automatic_rollback: 0, r2: 0, worker: 0, deploy: 0, purge: 0, gate_change: 0, credential_change: 0, line_send: 0 },
    };
    writeSummary(deps.outputDir, identity, summary);
    return summary;
  } catch (error) {
    const reason = safeReason(error);
    if (readdirSync(deps.outputDir).length === 0) {
      writeSummary(deps.outputDir, identity, {
        schema_version: 1, approval_id: APPROVAL_ID, approval_received: APPROVAL_RECEIVED,
        approval_expires: APPROVAL_EXPIRES, approved_harness_head: args.approvedHead,
        harness_parent_head: HARNESS_PARENT_HEAD, started_at: startedAt,
        completed_at: new Date(deps.now()).toISOString(), status: 'stopped', stop_stage: stage,
        stop_reason: reason, request_counts: { d1_query_post: requests, provider_total: requests, provider_write_batches: writeBatches, retry: 0 },
        rollback_required: writeBatches === 1,
        forbidden_actions: { automatic_rollback: 0, r2: 0, worker: 0, deploy: 0, purge: 0, gate_change: 0, credential_change: 0, line_send: 0 },
      });
    }
    throw new BackfillStop(reason);
  }
}

const isCliEntry = (() => {
  if (!argv[1]) return false;
  try { return fileURLToPath(import.meta.url) === argv[1]; } catch { return false; }
})();

if (isCliEntry) {
  run(argv.slice(2)).then((result) => stdout.write(`${JSON.stringify(result)}\n`)).catch((error: unknown) => {
    stdout.write(`${JSON.stringify({ approval_id: APPROVAL_ID, status: 'stopped', stop_reason: safeReason(error), retry: 0 })}\n`);
    exit(1);
  });
}
